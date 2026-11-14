import { NearConnector, type NearWalletBase } from "@hot-labs/near-connect";
import { NETWORK, RPC_URLS, TGAS } from "./near";

let instance: NearConnector | null = null;

/**
 * One NEAR Connect instance for the page. Wallet code runs in NEAR Connect's sandboxed iframes from its shared
 * manifest; only wallets that declare testnet and signAndSendTransaction are offered.
 */
export function getConnector(): NearConnector {
  instance ??= new NearConnector({
    network: NETWORK,
    providers: { testnet: RPC_URLS },
    features: { signAndSendTransaction: true, testnet: true },
  });
  return instance;
}

export interface OwnerCall {
  method: "freeze" | "unfreeze" | "add_agent_key" | "withdraw";
  args: Record<string, unknown>;
}

export interface TxOutcome {
  hash: string;
  /** Contract panic or action error text when the transaction landed but a receipt failed. */
  failure?: string;
}

const fnCall = (c: OwnerCall, tgas = 100n) => ({
  type: "FunctionCall" as const,
  params: { methodName: c.method, args: c.args, gas: (tgas * TGAS).toString(), deposit: "0" },
});

/**
 * One owner transaction: `ownerId` (the connected wallet, get_state.owner) signs; `guardianId` is the account the guardian runs on.
 * A self-hosted guardian has guardianId == ownerId. A factory guardian (<name>.<factory>) is owned by another account, e.g. a 0x one.
 */
export async function sendOwnerTx(wallet: NearWalletBase, ownerId: string, guardianId: string, calls: OwnerCall[]): Promise<TxOutcome> {
  const outcome = await wallet.signAndSendTransaction({
    network: NETWORK, signerId: ownerId, receiverId: guardianId, actions: calls.map((c) => fnCall(c)),
  });
  return readOutcome(outcome);
}

export interface GuardianInit { watcher: string; intents_contract: string }

/**
 * Deploys the guardian on the signer's own account in one transaction: DeployContract, `new`, then any owner calls
 * (add_agent_key for an adopt link). Every action is atomic: a failed `new` or key add rolls the deploy back.
 */
export async function sendDeployTx(wallet: NearWalletBase, accountId: string, code: Uint8Array, init: GuardianInit, after: OwnerCall[] = []): Promise<TxOutcome> {
  const outcome = await wallet.signAndSendTransaction({
    network: NETWORK, signerId: accountId, receiverId: accountId,
    actions: [
      { type: "DeployContract" as const, params: { code } },
      { type: "FunctionCall" as const, params: { methodName: "new", args: { ...init }, gas: (50n * TGAS).toString(), deposit: "0" } },
      ...after.map((c) => fnCall(c)),
    ],
  });
  return readOutcome(outcome);
}

export function readOutcome(o: unknown): TxOutcome {
  const any = o as { transaction?: { hash?: string }; transaction_outcome?: { id?: string }; status?: unknown; receipts_outcome?: { outcome?: { status?: unknown } }[] } | null;
  const hash = any?.transaction?.hash ?? any?.transaction_outcome?.id ?? "";
  const statuses = [any?.status, ...(any?.receipts_outcome ?? []).map((r) => r.outcome?.status)];
  const failed = statuses.find((s) => s && typeof s === "object" && "Failure" in s);
  return { hash, failure: failed ? panicText(JSON.stringify(failed)) : undefined };
}

function panicText(s: string): string {
  const m = s.match(/Smart contract panicked: ([^"\\]+)/);
  return m ? m[1]! : s.slice(0, 240);
}

const CONTRACT_MESSAGES: [RegExp, string][] = [
  [/owner only/, "The guardian refused: owner only. Sign with this account's own full-access key, not a function-call key."],
  [/already frozen/, "The guardian is already frozen."],
  [/not frozen/, "The guardian is not frozen, so there is nothing to unfreeze."],
  [/frozen: call unfreeze first/, "The guardian is frozen: unfreeze must run before a key can be added."],
  [/key already registered/, "That agent key is already registered on this guardian."],
  [/too many agent keys/, "The guardian already holds its maximum number of agent keys."],
  [/reason too long/, "The reason is longer than 500 bytes."],
  [/The contract has already been initialized|already initialized/i, "This account's guardian is already initialised."],
  [/LackBalanceForState|NotEnoughBalance/, "The account does not have enough NEAR to pay for the guardian's storage and gas."],
  [/amount exceeds balance above the storage reserve/, "That is more than the guardian holds above its storage reserve."],
  [/attached deposit is below required_deposit/, "The deposit is below the factory's required deposit."],
  [/only watcher or owner may freeze/, "Only the watcher or the owner may freeze this guardian."],
];

/** Turns wallet, RPC and contract errors into one readable sentence. */
export function readableError(e: unknown): string {
  const raw = typeof e === "string" ? e : e instanceof Error ? e.message : (() => { try { return JSON.stringify(e); } catch { return String(e); } })();
  const text = raw ?? "";
  for (const [re, msg] of CONTRACT_MESSAGES) if (re.test(text)) return msg;
  // Receipt ActionErrors arrive as JSON: name the failure instead of showing it raw.
  const exists = text.match(/AccountAlreadyExists[^}]*?account_id\W+([\w.-]+)/);
  if (exists) return `${exists[1]} already exists on testnet: pick another name. A failed create refunds the deposit; only gas was spent.`;
  const action = text.match(/ActionError\W+index\W+\d+\W+kind\W+(\w+)/);
  if (action) return `The transaction failed on chain (${action[1]}). Nothing else changed.`;
  // A closed window is not proof that nothing was sent: the wallet may have broadcast first (run() then reads the chain).
  if (/wallet closed|closed the window|window (was )?closed/i.test(text)) return "The wallet window closed before it reported a result.";
  if (/reject|denied|declin|cancel/i.test(text)) return "The request was rejected in the wallet. Nothing was sent. If the wallet does not open next time, disconnect and connect again.";
  if (/mainnet|network/i.test(text) && !/failed to fetch/i.test(text)) return "The wallet is on a different network. Switch it to testnet and try again.";
  if (/NotEnoughBalance|LackBalanceForState|balance/i.test(text)) return "The account does not have enough NEAR for gas.";
  if (/AccessKeyDoesNotExist|InvalidAccessKey|access key/i.test(text)) return "The wallet's key is not a full-access key on this account. Owner calls need one.";
  if (/failed to fetch|timeout|RPC/i.test(text)) return `The network did not answer: ${text.slice(0, 140)}`;
  return text.length > 220 ? `${text.slice(0, 220)}…` : text || "Unknown wallet error.";
}

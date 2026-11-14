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
  method: "freeze" | "unfreeze" | "add_agent_key";
  args: Record<string, unknown>;
}

export interface TxOutcome {
  hash: string;
  /** Contract panic or action error text when the transaction landed but a receipt failed. */
  failure?: string;
}

/** One transaction from `accountId` to itself (the guardian lives on the account; its owner is the account). */
export async function sendOwnerTx(wallet: NearWalletBase, accountId: string, calls: OwnerCall[]): Promise<TxOutcome> {
  const outcome = await wallet.signAndSendTransaction({
    network: NETWORK,
    signerId: accountId,
    receiverId: accountId,
    actions: calls.map((c) => ({
      type: "FunctionCall" as const,
      params: { methodName: c.method, args: c.args, gas: (100n * TGAS).toString(), deposit: "0" },
    })),
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
  [/only watcher or owner may freeze/, "Only the watcher or the owner may freeze this guardian."],
];

/** Turns wallet, RPC and contract errors into one readable sentence. */
export function readableError(e: unknown): string {
  const raw = typeof e === "string" ? e : e instanceof Error ? e.message : (() => { try { return JSON.stringify(e); } catch { return String(e); } })();
  const text = raw ?? "";
  for (const [re, msg] of CONTRACT_MESSAGES) if (re.test(text)) return msg;
  if (/wallet closed/i.test(text)) return "The wallet window was closed before it answered. Nothing was sent.";
  if (/reject|denied|declin|cancel/i.test(text)) return "The request was rejected in the wallet. Nothing was sent.";
  if (/mainnet|network/i.test(text) && !/failed to fetch/i.test(text)) return "The wallet is on a different network. Switch it to testnet and try again.";
  if (/NotEnoughBalance|LackBalanceForState|balance/i.test(text)) return "The account does not have enough NEAR for gas.";
  if (/AccessKeyDoesNotExist|InvalidAccessKey|access key/i.test(text)) return "The wallet's key is not a full-access key on this account. Owner calls need one.";
  if (/failed to fetch|timeout|RPC/i.test(text)) return `The network did not answer: ${text.slice(0, 140)}`;
  return text.length > 220 ? `${text.slice(0, 220)}…` : text || "Unknown wallet error.";
}

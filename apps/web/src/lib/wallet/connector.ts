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
  method: "freeze" | "unfreeze" | "add_agent_key" | "withdraw" | "add_intents_key" | "sign_evm";
  args: Record<string, unknown>;
}

export interface TxOutcome {
  hash: string;
  /** Contract panic or action error text when the transaction landed but a receipt failed. */
  failure?: string;
}

const fnCall = (c: OwnerCall, tgas: bigint = 100n) => ({
  type: "FunctionCall" as const,
  params: { methodName: c.method, args: c.args, gas: (tgas * TGAS).toString(), deposit: "0" },
});

export type WalletTx = { receiverId: string; actions: Parameters<NearWalletBase["signAndSendTransaction"]>[0]["actions"] };

/** Owner calls on a guardian: `guardianId` is the account the guardian runs on (== the signer for a self-hosted guardian). */
export const ownerTx = (guardianId: string, calls: OwnerCall[], tgas?: bigint): WalletTx => ({ receiverId: guardianId, actions: calls.map((c) => fnCall(c, tgas)) });

export interface GuardianInit { watcher: string; intents_contract: string }

/**
 * The guardian deploy on the signer's own account: DeployContract, `new`, then any owner calls (add_agent_key for an adopt
 * link). Every action is atomic: a failed `new` or key add rolls the deploy back.
 */
export const deployTx = (accountId: string, code: Uint8Array, init: GuardianInit, after: OwnerCall[] = []): WalletTx => ({
  receiverId: accountId,
  actions: [
    { type: "DeployContract" as const, params: { code } },
    { type: "FunctionCall" as const, params: { methodName: "new", args: { ...init }, gas: (50n * TGAS).toString(), deposit: "0" } },
    ...after.map((c) => fnCall(c)),
  ],
});

/**
 * One owner transaction: `ownerId` (the connected wallet, get_state.owner) signs; `guardianId` is the account the guardian runs on.
 * A self-hosted guardian has guardianId == ownerId. A factory guardian (<name>.<factory>) is owned by another account, e.g. a 0x one.
 */
export async function sendOwnerTx(wallet: NearWalletBase, ownerId: string, guardianId: string, calls: OwnerCall[], tgas?: bigint): Promise<TxOutcome> {
  return readOutcome(await wallet.signAndSendTransaction({ network: NETWORK, signerId: ownerId, ...ownerTx(guardianId, calls, tgas) }));
}

export async function sendDeployTx(wallet: NearWalletBase, accountId: string, code: Uint8Array, init: GuardianInit, after: OwnerCall[] = []): Promise<TxOutcome> {
  return readOutcome(await wallet.signAndSendTransaction({ network: NETWORK, signerId: accountId, ...deployTx(accountId, code, init, after) }));
}

/** NEAR Connect passes signAndSendTransactions straight to the wallet; every testnet wallet in its manifest declares it. */
export const supportsBatch = (wallet: NearWalletBase | null | undefined) => !!wallet?.manifest.features?.signAndSendTransactions;

/** A request that stopped part-way: `done` holds the outcomes of the transactions the wallet did answer. */
export class BatchStopped extends Error {
  readonly reason: unknown;
  readonly done: TxOutcome[];
  constructor(reason: unknown, done: TxOutcome[]) {
    super(reason instanceof Error ? reason.message : String(reason));
    this.reason = reason;
    this.done = done;
  }
}

/**
 * Several transactions from one signer. A wallet that declares signAndSendTransactions gets them all in one request (one
 * approval in Meteor and Intear); any other wallet gets them one at a time, and the sequence stops at the first failure.
 * The transactions are independent on chain: an earlier one stays landed when a later one fails.
 */
export async function sendTransactions(wallet: NearWalletBase, signerId: string, txs: WalletTx[]): Promise<TxOutcome[]> {
  if (txs.length > 1 && supportsBatch(wallet)) {
    const outs = await wallet.signAndSendTransactions({ network: NETWORK, signerId, transactions: txs });
    return (outs ?? []).map(readOutcome);
  }
  const done: TxOutcome[] = [];
  for (const t of txs) {
    try {
      const o = readOutcome(await wallet.signAndSendTransaction({ network: NETWORK, signerId, ...t }));
      done.push(o);
      if (o.failure) break;
    } catch (e) {
      throw new BatchStopped(e, done);
    }
  }
  return done;
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
  [/frozen: sign_evm refused until unfreeze/, "Refused by the guardian: it is frozen, so it never asks the MPC network for a signature (frozen: sign_evm refused until unfreeze)."],
  [/sign_evm: caller not authorized/, "Refused by the guardian: only its owner may request a Chain Signatures signature."],
  [/PublicKeyExists/, "That key is already registered for this guardian on the intents registry."],
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
  // Refused by the network before it ran: for this console's requests, nearly always a deposit plus gas above what the
  // account can spend (its storage stays locked).
  if (/INVALID_TRANSACTION|InvalidTransaction/.test(text)) {
    return "The network refused the transaction before it ran, most often because the account cannot pay its deposit and gas. It did not land.";
  }
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

import { z } from "zod";
import { YOCTO_PER_NEAR } from "./near";

/**
 * The "approve agent key" deep link written by `standin unfreeze` (contract with the CLI; do not change):
 *   /app/owner?op=unfreeze&account=<id>&agent_key=<ed25519:base58>&receiver=<id>&methods=<a,b|empty>&allowance=<yocto>
 * Every value is untrusted input. Nothing here signs; the page shows the decoded request and the owner decides.
 */

// NEAR account id grammar (nomicon): 2..64 chars, lowercase parts joined by '.', '-' or '_' inside a part.
const ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
export const AccountId = z.string().min(2, "account id is shorter than 2 characters").max(64, "account id is longer than 64 characters")
  .regex(ACCOUNT_RE, "not a valid NEAR account id");

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58Decode(s: string): Uint8Array | null {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const c of s) { if (c !== "1") break; bytes.unshift(0); }
  return new Uint8Array(bytes);
}

const isEd25519 = (v: string) => {
  if (!v.startsWith("ed25519:")) return false;
  const raw = v.slice(8);
  return raw.length >= 32 && raw.length <= 44 && base58Decode(raw)?.length === 32;
};
const ed25519 = (field: string) => z.string().refine(isEd25519, `${field} must be ed25519:<base58 of 32 bytes>`);
export const Ed25519Key = ed25519("agent_key");

const METHOD_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const Methods = z.string().max(1000, "methods list is too long").transform((v, ctx) => {
  if (v === "") return [] as string[];
  const list = v.split(",");
  for (const m of list) {
    if (!METHOD_RE.test(m)) { ctx.addIssue({ code: "custom", message: `"${m.slice(0, 40)}" is not a method name (letters, digits, _; up to 64)` }); return z.NEVER; }
  }
  if (new Set(list).size !== list.length) { ctx.addIssue({ code: "custom", message: "methods list repeats a name" }); return z.NEVER; }
  if (list.length > 16) { ctx.addIssue({ code: "custom", message: "more than 16 methods" }); return z.NEVER; }
  return list;
});

/** Decimal yoctoNEAR, 1 yocto to 1 NEAR. "0" is refused: on this guardian it means an unlimited allowance. */
const Allowance = z.string().regex(/^(0|[1-9]\d{0,24})$/, "allowance must be a whole number of yoctoNEAR").transform((v, ctx) => {
  const n = BigInt(v);
  if (n === 0n) { ctx.addIssue({ code: "custom", message: "allowance 0 means unlimited on this guardian; the console only approves a capped key" }); return z.NEVER; }
  if (n > YOCTO_PER_NEAR) { ctx.addIssue({ code: "custom", message: "allowance is above 1 NEAR" }); return z.NEVER; }
  return n;
});

const NotMainnet = AccountId.refine((v) => !v.endsWith(".near"), "is a mainnet (.near) account; this console works on testnet only");

/**
 * A key whose receiver is the guardian account itself is refused: on a self-hosted guardian owner == account, so such a
 * key would call as the owner (unfreeze, add_agent_key, withdraw).
 */
const notSelf = <T extends { account: string; receiver: string }>(r: T, ctx: z.RefinementCtx) => {
  if (r.receiver === r.account) ctx.addIssue({ code: "custom", path: ["receiver"], message: "the agent key may not call the guardian account itself" });
};

export const ApproveRequest = z.object({
  op: z.literal("unfreeze"),
  account: AccountId,
  agent_key: Ed25519Key,
  receiver: AccountId,
  methods: Methods,
  allowance: Allowance,
}).superRefine(notSelf);
export type ApproveRequest = z.infer<typeof ApproveRequest>;

/** The parent of a sub-account (`watch.alice.testnet` -> `alice.testnet`). */
export const parentOf = (id: string) => id.slice(id.indexOf(".") + 1);

/**
 * The home accounts of an adopt link: `bait` names the bait account, `bait_key` / `watch_key` are the public keys the CLI
 * generated for an account the owner still has to create (`watcher` is that watcher). Both are sub-accounts of one parent,
 * the guardian's owner, which alone can create them. No secret ever travels in a link.
 */
const homeAccounts = (r: { account: string; watcher: string; bait?: string; bait_key?: string; watch_key?: string }, ctx: z.RefinementCtx) => {
  if (r.bait_key && !r.bait) ctx.addIssue({ code: "custom", path: ["bait"], message: "bait_key needs bait" });
  if (!r.bait) return;
  if (r.bait === r.watcher) ctx.addIssue({ code: "custom", path: ["bait"], message: "the bait and the watcher must be different accounts" });
  if (r.bait === r.account || r.watcher === r.account) ctx.addIssue({ code: "custom", path: ["bait"], message: "the bait and the watcher must not be the guardian account" });
  if (!r.bait.includes(".") || !r.watcher.includes(".") || parentOf(r.bait) !== parentOf(r.watcher)) {
    ctx.addIssue({ code: "custom", path: ["bait"], message: "the bait and the watcher must be sub-accounts of the same owner account" });
  }
};

/**
 * The "adopt from wallet" deep link (contract with the CLI; do not change):
 *   /app/owner?op=adopt&account=<id>&watcher=<id>&intents=<id>&agent_key=<ed25519:base58>&receiver=<id>&methods=<a,b|empty>&allowance=<yocto>
 *     [&bait=<id>][&bait_key=<ed25519:base58>][&watch_key=<ed25519:base58>]
 * Deploys the guardian on `account` when it has no code, then registers the agent key; on an existing guardian it only adds the key.
 * With bait_key / watch_key it also creates those home accounts (0.2 NEAR each), in the same wallet request.
 */
export const AdoptRequest = z.object({
  op: z.literal("adopt"),
  account: NotMainnet,
  watcher: AccountId,
  intents: AccountId,
  agent_key: Ed25519Key,
  receiver: AccountId,
  methods: Methods,
  allowance: Allowance,
  bait: AccountId.optional(),
  bait_key: ed25519("bait_key").optional(),
  watch_key: ed25519("watch_key").optional(),
}).superRefine(notSelf).superRefine(homeAccounts);
export type AdoptRequest = z.infer<typeof AdoptRequest>;

const FIELDS = {
  unfreeze: ["op", "account", "agent_key", "receiver", "methods", "allowance"],
  adopt: ["op", "account", "watcher", "intents", "agent_key", "receiver", "methods", "allowance"],
} as const;
const OPTIONAL = { unfreeze: [], adopt: ["bait", "bait_key", "watch_key"] } as const;

export type DeepLink =
  | { kind: "none" }
  | { kind: "ok"; req: ApproveRequest }
  | { kind: "adopt"; req: AdoptRequest }
  | { kind: "invalid"; op: "unfreeze" | "adopt" | null; problems: string[] };

/** Parses the query string. No `op` at all means a plain visit to the console. */
export function parseDeepLink(search: string): DeepLink {
  const q = new URLSearchParams(search);
  if (!q.has("op")) return { kind: "none" };
  const ops = q.getAll("op");
  const op = ops.length === 1 && (ops[0] === "unfreeze" || ops[0] === "adopt") ? ops[0] : null;
  if (!op) {
    const problems = ops.length > 1 ? [`op appears ${ops.length} times`] : [`op: must be unfreeze or adopt`];
    return { kind: "invalid", op: null, problems };
  }
  const problems: string[] = [];
  const raw: Record<string, string> = {};
  for (const f of FIELDS[op]) {
    const all = q.getAll(f);
    if (all.length > 1) problems.push(`${f} appears ${all.length} times`);
    if (all.length === 0) problems.push(`${f} is missing`);
    else raw[f] = all[0]!;
  }
  for (const f of OPTIONAL[op]) {
    const all = q.getAll(f);
    if (all.length > 1) problems.push(`${f} appears ${all.length} times`);
    else if (all.length === 1) raw[f] = all[0]!;
  }
  if (problems.length) return { kind: "invalid", op, problems };
  const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".") || "link"}: ${i.message}`);
  if (op === "adopt") {
    const r = AdoptRequest.safeParse(raw);
    return r.success ? { kind: "adopt", req: r.data } : { kind: "invalid", op, problems: issues(r.error) };
  }
  const r = ApproveRequest.safeParse(raw);
  return r.success ? { kind: "ok", req: r.data } : { kind: "invalid", op, problems: issues(r.error) };
}

/** The unfreeze link for the same agent key, for an adopt link that lands on a frozen guardian. */
export function unfreezeLinkFor(req: AdoptRequest): string {
  const q = new URLSearchParams({
    op: "unfreeze", account: req.account, agent_key: req.agent_key, receiver: req.receiver,
    methods: req.methods.join(","), allowance: req.allowance.toString(),
  });
  return `/app/owner?${q.toString()}`;
}

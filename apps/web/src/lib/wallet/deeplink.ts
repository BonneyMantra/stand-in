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

export const Ed25519Key = z.string().refine((v) => {
  if (!v.startsWith("ed25519:")) return false;
  const raw = v.slice(8);
  return raw.length >= 32 && raw.length <= 44 && base58Decode(raw)?.length === 32;
}, "agent_key must be ed25519:<base58 of 32 bytes>");

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

export const ApproveRequest = z.object({
  op: z.literal("unfreeze", { error: "op must be unfreeze" }),
  account: AccountId,
  agent_key: Ed25519Key,
  receiver: AccountId,
  methods: Methods,
  allowance: Allowance,
});
export type ApproveRequest = z.infer<typeof ApproveRequest>;

const FIELDS = ["op", "account", "agent_key", "receiver", "methods", "allowance"] as const;

export type DeepLink =
  | { kind: "none" }
  | { kind: "ok"; req: ApproveRequest }
  | { kind: "invalid"; problems: string[] };

/** Parses the query string. No `op` at all means a plain visit to the console. */
export function parseDeepLink(search: string): DeepLink {
  const q = new URLSearchParams(search);
  if (!q.has("op")) return { kind: "none" };
  const problems: string[] = [];
  const raw: Record<string, string> = {};
  for (const f of FIELDS) {
    const all = q.getAll(f);
    if (all.length > 1) problems.push(`${f} appears ${all.length} times`);
    if (all.length === 0) problems.push(`${f} is missing`);
    else raw[f] = all[0]!;
  }
  if (problems.length) return { kind: "invalid", problems };
  const r = ApproveRequest.safeParse(raw);
  if (!r.success) return { kind: "invalid", problems: r.error.issues.map((i) => `${i.path.join(".") || "link"}: ${i.message}`) };
  return { kind: "ok", req: r.data };
}

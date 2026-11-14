// Test-only wallet backend for the owner-console end-to-end test. Never part of the web build.
// Serves a NEAR Connect executor (registered in the page as a NEAR Connect debug wallet) and signs on testnet
// with the test account's key from .sandbox/wallet-test/. Listens on 127.0.0.1 only.
// Run from the repo root: node --import tsx apps/web/scripts/wallet-test/signer.ts [account-id]
// Modes (POST /mode {"mode": ...}): "ok" | "reject" (wallet refuses) | "mainnet" (signs in as a .near account)
//   | "account:<id>" (signs in as another testnet account, read-only states)
//   | "drop-unfreeze" (drops the unfreeze action, so the guardian panics on chain).
// DeployContract is accepted only for the pinned guardian build (sha256 = GUARDIAN_CODE_HASH), followed by `new`.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { Rpc } from "../../../../packages/lab/src/rpc.ts";
import { createHash } from "node:crypto";
import { Wallet, actions as nearActions, call } from "../../../../packages/lab/src/chain.ts";
import { base58Encode as baseEncode } from "../../src/lib/wallet/guardianCode.ts";

const root = path.resolve(import.meta.dirname, "../../../..");
const account = process.argv[2] ?? "wallet-owner.si-project-5289.testnet";
const keyRecord = JSON.parse(fs.readFileSync(path.join(root, ".sandbox/wallet-test", `${account}.json`), "utf8"));
const rpc = new Rpc(["https://near-testnet.drpc.org", "https://rpc.testnet.near.org", "https://rpc.testnet.fastnear.com"]);
const signer = new Wallet(rpc, account, keyRecord.private_key);
const PORT = Number(process.env.WALLET_TEST_PORT ?? 4391);
const ALLOWED = new Set(["freeze", "unfreeze", "add_agent_key", "new", "withdraw"]);
// Guardian factory: create_guardian (deposit up to 3 NEAR) to the factory; owner calls to its guardians.
const FACTORY = "guard.si-project-5289.testnet";
const MAX_CREATE_DEPOSIT = 3n * 10n ** 24n;
const GUARDIAN_CODE_HASH = "7PbHKsE6PhdvypoUrE179X5kPxjqgzfFJr7Z1kRr9ZuE";
const sent: { at: string; hash: string; ok: boolean; methods: string[]; error?: string }[] = [];
let mode = "ok";

const executor = fs.readFileSync(path.join(import.meta.dirname, "executor.js"), "utf8").replaceAll("__SIGNER__", `http://127.0.0.1:${PORT}`);

function reply(res: http.ServerResponse, status: number, body: unknown, type = "application/json") {
  res.writeHead(status, { "content-type": type, "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function body(req: http.IncomingMessage): Promise<any> {
  let s = "";
  for await (const c of req) s += c;
  return s ? JSON.parse(s) : {};
}

function accountsFor(): { accountId: string; publicKey?: string }[] {
  if (mode === "mainnet") return [{ accountId: "standin-owner.near" }];
  if (mode.startsWith("account:")) return [{ accountId: mode.slice(8) }];
  return [{ accountId: account, publicKey: keyRecord.public_key }];
}

async function sendTx(p: any) {
  if (mode === "reject") throw Object.assign(new Error("User rejected the request"), { status: 400 });
  if (p.network !== "testnet") throw Object.assign(new Error(`test wallet is on testnet; request asked for ${p.network}`), { status: 400 });
  const receiver = String(p.receiverId);
  const factoryGuardian = receiver.endsWith(`.${FACTORY}`) && !receiver.slice(0, -FACTORY.length - 1).includes(".");
  if ((receiver !== account && receiver !== FACTORY && !factoryGuardian) || (p.signerId && p.signerId !== account)) {
    throw Object.assign(new Error("test wallet signs only to its own account, the guardian factory or a factory guardian"), { status: 400 });
  }
  // "drop-unfreeze": sends the batch without its unfreeze action, to get a real on-chain contract panic.
  const wanted = mode === "drop-unfreeze" ? (p.actions as any[]).filter((a) => a.params?.methodName !== "unfreeze") : (p.actions as any[]);
  const acts = wanted.map((a) => {
    if (receiver === FACTORY) {
      if (a.type !== "FunctionCall" || a.params.methodName !== "create_guardian") throw Object.assign(new Error("test wallet only calls create_guardian on the factory"), { status: 400 });
      const dep = BigInt(a.params.deposit);
      if (dep <= 0n || dep > MAX_CREATE_DEPOSIT) throw Object.assign(new Error("create_guardian deposit out of range"), { status: 400 });
      return call("create_guardian", a.params.args, Number(BigInt(a.params.gas) / 10n ** 12n), dep);
    }
    if (a.type === "DeployContract" && receiver === account) {
      const code = Buffer.from(String(a.params.codeBase64 ?? ""), "base64");
      const hash = baseEncode(createHash("sha256").update(code).digest());
      if (hash !== GUARDIAN_CODE_HASH) throw Object.assign(new Error(`test wallet refuses code ${hash}`), { status: 400 });
      return nearActions.deployContract(code);
    }
    if (a.type !== "FunctionCall" || !ALLOWED.has(a.params.methodName)) throw Object.assign(new Error(`test wallet refuses action ${a.type}`), { status: 400 });
    if (a.params.deposit !== "0") throw Object.assign(new Error("test wallet refuses deposits"), { status: 400 });
    return call(a.params.methodName, a.params.args, Number(BigInt(a.params.gas) / 10n ** 12n));
  });
  const r = await signer.send(receiver, acts);
  sent.push({ at: new Date().toISOString(), hash: r.hash, ok: r.ok, methods: wanted.map((a: any) => a.params.methodName ?? a.type), error: r.error });
  return r.raw;
}

http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return reply(res, 204, "");
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
    if (req.method === "GET" && url.pathname === "/executor.js") return reply(res, 200, executor, "text/javascript");
    if (req.method === "GET" && url.pathname === "/sent") return reply(res, 200, sent);
    if (req.method !== "POST") return reply(res, 404, { error: "not found" });
    const p = await body(req);
    if (url.pathname === "/mode") { mode = String(p.mode); return reply(res, 200, { mode }); }
    if (url.pathname === "/signIn") {
      if (mode === "reject") return reply(res, 400, { error: "User rejected the request" });
      return reply(res, 200, { accounts: accountsFor() });
    }
    if (url.pathname === "/tx") return reply(res, 200, await sendTx(p));
    return reply(res, 404, { error: "not found" });
  } catch (e: any) {
    reply(res, e?.status ?? 500, { error: String(e?.message ?? e).slice(0, 400) });
  }
}).listen(PORT, "127.0.0.1", () => process.stdout.write(`test wallet signer for ${account} on 127.0.0.1:${PORT}\n`));

// Chain Signatures proof on testnet. Unfrozen: sign_evm via the agent FC key, signature recovers to the derived
// EVM address. Then the watcher key freezes the guardian; the deleted FC key and the owner key are both refused.
// Finally unfreeze + re-provision exactly as bench does (resetAgent). Testnet and Sepolia only; never mainnet.
//   node --import tsx packages/chainsig/scripts/prove.ts
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  appendChainsig, callMethod, explorerTx, generateKey, loadDevKey, loadNetworkConfig, makeAccount, makeProvider,
  repoRoot, requireAccount, standinHome,
} from "@standin/core";
import { CHAINS, buildTx, hex, rpc, serializeSigned, signingHash, txHashOf, type ChainKey } from "../src/evm.ts";
import { PATH, deriveAddress } from "../src/derive.ts";
import { recoverKey } from "../src/mpc.ts";
import { requestSignEvm, sendWithKeyRaw } from "../src/sign.ts";

const out = (s: string) => process.stdout.write(s + "\n");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cfg = loadNetworkConfig();
if (cfg.network !== "testnet") throw new Error("testnet only");
const chainKey = (process.env.CHAINSIG_CHAIN ?? "sepolia") as ChainKey;
const chainId = CHAINS[chainKey].chainId;
const agent = requireAccount(cfg, "agent");
const prov = makeProvider(cfg);
const rec: Record<string, unknown> = { chain: CHAINS[chainKey].name, chain_id: chainId, path: PATH, guardian: agent };
const retry = async <T>(fn: () => Promise<T>, n = 8): Promise<T> => {
  for (let i = 0; ; i++) { try { return await fn(); } catch (e: any) { if (i >= n || !/429|Exceeded|fetch failed|timeout|Timeout/i.test(String(e?.message))) throw e; await sleep(2000 * (i + 1)); } }
};
const state = () => retry(() => prov.callFunction({ contractId: agent, method: "get_state", args: {} } as any)) as Promise<any>;
const link = (h?: string) => (h ? explorerTx(cfg, h) : "(no tx: rejected before inclusion)");

// 0. derive the address (local derivation cross-checked against the MPC contract's view)
const d = await retry(() => deriveAddress(cfg, agent, PATH));
rec.evm_address = d.address;
out(`derived EVM address for (${agent}, "${PATH}"): ${d.address}  (matches contract view: ${d.matchesView})`);
const base = { evm_address: d.address, chain_id: chainId, path: PATH };

// 1. unfrozen start, owner provisions a function-call key that may only call sign_evm on the guardian
const owner = makeAccount(cfg, agent, loadDevKey(cfg, "agent").secret_key);
if ((await state()).frozen) await retry(() => callMethod(owner, agent, "unfreeze", {}));
const fc = generateKey();
const add = await retry(() => callMethod(owner, agent, "add_agent_key", { public_key: fc.public_key, receiver_id: agent, method_names: ["sign_evm"], allowance: "1000000000000000000000000" }));
rec.add_sign_key_tx = add.tx_hash;
const fcAcct = makeAccount(cfg, agent, fc.secret_key);

// 2. (a) unfrozen: build an EIP-1559 tx, request the signature through the guardian, verify recovery
const balance = BigInt(await rpc(chainKey, "eth_getBalance", [d.address, "latest"]));
rec.evm_balance_wei = balance.toString();
const tx = await buildTx(chainKey, d.address, d.address, 0n);
const hash = signingHash(tx);
const a = await retry(() => requestSignEvm(cfg, fcAcct, agent, Buffer.from(hash).toString("hex"), PATH));
if (!a.ok || !a.signature) {
  appendChainsig({ ...base, type: "sign", ok: false, tx_hash: a.tx_hash, error: a.error });
  throw new Error(`sign_evm failed while unfrozen: ${a.error}`);
}
const recovered = recoverKey(a.signature, hash);
const recoversToDerived = Buffer.from(recovered).equals(Buffer.from(d.publicKey));
rec.sign_ok_tx = a.tx_hash; rec.recovery_id = a.signature.recoveryId; rec.recovers_to_derived_address = recoversToDerived;
rec.signing_hash = hex(hash);
appendChainsig({ ...base, type: "sign", ok: recoversToDerived, tx_hash: a.tx_hash, error: recoversToDerived ? undefined : "recovered key differs from derived key" });
out(`(a) sign_evm unfrozen: tx ${link(a.tx_hash)}\n    recovery_id ${a.signature.recoveryId}; recovers to derived address: ${recoversToDerived}`);
if (!recoversToDerived) throw new Error("signature does not recover to the derived address");
const raw = serializeSigned(tx, a.signature.recoveryId, a.signature.r, a.signature.s);
rec.eth_tx_hash_if_broadcast = txHashOf(raw);
if (balance > tx.maxFeePerGas * BigInt(tx.gasLimit)) {
  rec.broadcast_tx = await rpc(chainKey, "eth_sendRawTransaction", [raw]);
  out(`    broadcast: ${rec.broadcast_tx}`);
} else out(`    not broadcast: derived address holds ${balance} wei on ${CHAINS[chainKey].name} (no faucet used)`);

// 3. (b) the watcher's function-call key freezes the guardian
const watchId = requireAccount(cfg, "watcher");
const watcher = makeAccount(cfg, watchId, loadDevKey(cfg, "w1-watch-fc.key").secret_key);
const fz = await retry(() => callMethod(watcher, agent, "freeze", { reason: "chainsig proof: freeze must cut cross-chain signing" }));
rec.freeze_tx = fz.tx_hash;
out(`(b) freeze by watcher key: ${link(fz.tx_hash)}`);
for (let i = 0; i < 30; i++) {
  const alive = await prov.viewAccessKey({ accountId: agent, publicKey: fc.public_key } as any).then(() => true, () => false);
  if (!alive) break;
  await sleep(1500);
}

// 4. (c) both paths refused
// a rate-limited RPC (429 / RetriesExceeded) says nothing about the key: retry until the chain itself answers
const hashHex = Buffer.from(hash).toString("hex");
let c1 = await sendWithKeyRaw(cfg, agent, fc.secret_key, hashHex, PATH);
for (let i = 0; i < 8 && !c1.ok && /429|RetriesExceeded|Exceeded \d+ providers|fetch failed|timeout/i.test(c1.error ?? ""); i++) {
  await sleep(3000 * (i + 1));
  c1 = await sendWithKeyRaw(cfg, agent, fc.secret_key, hashHex, PATH);
}
rec.refused_deleted_key = c1.error; rec.refused_deleted_key_failed_at = c1.failed_at;
appendChainsig({ ...base, type: "blocked", via: "deleted-agent-key", ok: false, tx_hash: c1.tx_hash, error: c1.error });
out(`(c1) deleted agent FC key: ok=${c1.ok} at=${c1.failed_at}: ${c1.error}`);
const c2 = await requestSignEvm(cfg, owner, agent, Buffer.from(hash).toString("hex"), PATH);
rec.refused_owner_tx = c2.tx_hash; rec.refused_owner_error = c2.error;
appendChainsig({ ...base, type: "blocked", via: "owner-key", ok: false, tx_hash: c2.tx_hash, error: c2.error });
out(`(c2) owner key while frozen: ok=${c2.ok} tx ${link(c2.tx_hash)}\n     ${c2.error}`);
const refusedOk = !c1.ok && /InvalidAccessKey|AccessKeyNotFound|does not exist/i.test(c1.error ?? "") && !c2.ok && /frozen/.test(c2.error ?? "");

// 5. (d) unfreeze and re-provision exactly as bench does
const chainMjs = await import(pathToFileURL(path.join(repoRoot(), "attacks/lib/chain.mjs")).href);
const unf = await (async () => { const before = await state(); if (before.frozen) await chainMjs.resetAgent(standinHome()); return before.frozen; })();
const end = await state();
rec.unfrozen_after = !end.frozen; rec.agent_keys_after = end.agent_keys.length; rec.reset_ran = unf;
out(`(d) after resetAgent: frozen=${end.frozen}, agent_keys=${end.agent_keys.length}`);
out("\nRECORD " + JSON.stringify(rec, null, 2));
if (!refusedOk || end.frozen) { out("PROOF FAILED"); process.exit(1); }
out("PROOF OK");
process.exit(0);

import { Rpc } from "./rpc.ts";
import { Wallet, addFullKey, blockHeight, call, deleteKey, explorerTx, nearAmount, newKey, transfer, waitTx } from "./chain.ts";

export interface LabCfg { accounts: { agent: string; decoy: string; thief: string; watcher: string }; parent: string; intents: string }
export interface LabEnv { LAB_AGENT_OWNER_KEY: string; LAB_DECOY_ADMIN_KEY: string; LAB_THIEF_KEY: string; LAB_WATCH_FC_KEY: string; LAB_NTFY_TOPIC?: string; LAB_RPC_URLS?: string }
export interface Step { run_id: string; step: string; status: "start" | "ok" | "fail"; at: string; title: string; detail?: string; tx_hash?: string; block?: number; blocks_after_trip?: number; detected_at_block?: number; detection?: string; explorer?: string; ntfy?: { topic: string; title: string; message: string; click: string }; txs?: { label: string; tx_hash: string; explorer: string }[] }
export type Emit = (name: "step" | "done" | "error", data: unknown) => void;

const LOOT = nearAmount(50); // 0.05 NEAR
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runLab(runId: string, cfg: LabCfg, env: LabEnv, emit: Emit): Promise<{ blocks_to_freeze: number | null; steps: Step[] }> {
  const steps: Step[] = [];
  const step = (s: string, status: Step["status"], title: string, x: Partial<Step> = {}) => {
    const e: Step = { run_id: runId, step: s, status, at: new Date().toISOString(), title, ...x };
    if (x.tx_hash && !x.explorer) e.explorer = explorerTx(x.tx_hash);
    steps.push(e);
    emit("step", e);
  };
  const A = cfg.accounts;
  const rpc = new Rpc(env.LAB_RPC_URLS ? env.LAB_RPC_URLS.split(",") : undefined);
  const decoyAdmin = new Wallet(rpc, A.decoy, env.LAB_DECOY_ADMIN_KEY);
  const owner = new Wallet(rpc, A.agent, env.LAB_AGENT_OWNER_KEY);
  const thief = new Wallet(rpc, A.thief, env.LAB_THIEF_KEY);
  const watcher = new Wallet(rpc, A.watcher, env.LAB_WATCH_FC_KEY);
  const fresh = newKey();
  let planted = false, stole = false, current = "plant";
  let blocksToFreeze: number | null = null;
  try {
    // pre-warm every signer in parallel so the freeze later costs one sign and one broadcast
    const fh: string = (await rpc.call("block", { finality: "final" })).header.hash;
    const warm = Promise.all([watcher.warm(fh), owner.warm(fh), thief.warm(fh), decoyAdmin.warm(fh)]);

    current = "plant";
    step("plant", "start", "Planting a fresh decoy key on the lab decoy account");
    await warm;
    const plant = await decoyAdmin.send(A.decoy, [addFullKey(fresh.public)]);
    if (!plant.ok) throw new Error(`plant failed: ${plant.error}`);
    planted = true;
    const plantBlock = await blockHeight(rpc, plant.blockHash);
    step("plant", "ok", `Decoy key ${fresh.public.slice(0, 18)}... added to ${A.decoy}`, { tx_hash: plant.hash, block: plantBlock });

    current = "leak";
    step("leak", "start", "A simulated agent session reads the decoy credentials");
    await sleep(700);
    step("leak", "ok", "Tool response exposed the decoy key to the session (simulated, no transaction)", { detail: "Bash(cat ~/.near-credentials/testnet/" + A.decoy + ".json) -> tool_response contained the decoy secret" });

    current = "theft";
    step("theft", "start", "Thief signs a 0.05 NEAR transfer from the decoy with the leaked key");
    const thiefKey = new Wallet(rpc, A.decoy, fresh.secret);
    await thiefKey.warm(fh);
    const theftHash = await thiefKey.broadcast(A.thief, [transfer(LOOT)]);
    stole = true;

    current = "detect";
    step("detect", "start", "Watching the decoy account for any use of the new key");
    const t0 = Date.now();
    const seen = await detectUse(rpc, A.decoy, thiefKey.publicKey, thiefKey.lastNonce, theftHash);
    // The freeze is only ever triggered by this observation: the decoy key's nonce moved, so its transaction is on chain at this block.
    const detectedAt = seen.height;
    step("detect", "ok", `Decoy key use observed on chain at block ${detectedAt}`, { block: detectedAt, detected_at_block: detectedAt, detection: seen.via, detail: `observed ${Date.now() - t0} ms after the theft broadcast` });
    current = "freeze";
    step("freeze", "start", "Watcher function-call key calls guardian.freeze");
    const freezeHash = await watcher.broadcast(A.agent, [call("freeze", { reason: "lab: decoy key used", decoy_public_key: fresh.public, tx_hash: theftHash }, 100)]);
    // inclusion block of the theft (the trip block per the brief), looked up while the freeze is in flight
    const theftTx = await waitTx(rpc, theftHash, A.decoy);
    const theftBlock = await blockHeight(rpc, theftTx.blockHash);
    step("theft", "ok", `Decoy-signed transfer included in block ${theftBlock}`, { tx_hash: theftHash, block: theftBlock });

    const fr = await waitTx(rpc, freezeHash, A.watcher);
    if (!fr.ok) throw new Error(`freeze failed: ${fr.error}`);
    const freezeBlock = await blockHeight(rpc, fr.blockHash);
    blocksToFreeze = freezeBlock - theftBlock;
    step("freeze", "ok", `Agent account frozen in block ${freezeBlock}, ${blocksToFreeze} blocks after the theft`, { tx_hash: freezeHash, block: freezeBlock, blocks_after_trip: blocksToFreeze });

    current = "notify";
    step("notify", "start", "Pushing the alert to the public lab topic");
    const push = { topic: env.LAB_NTFY_TOPIC ?? "", title: `Decoy tripped -> frozen in ${blocksToFreeze} blocks`, message: `Decoy key used in block ${theftBlock}; guardian froze ${A.agent} in block ${freezeBlock}.`, click: explorerTx(freezeHash) };
    const n = await notify(push.topic, push.title, push.message, push.click);
    // ntfy.sh drops connections from Cloudflare Workers egress (measured), so on failure the payload is handed to the browser, which may publish it (ntfy allows CORS).
    step("notify", n.ok ? "ok" : "fail", n.ok ? "Phone alert published to the public lab topic" : "Server-side ntfy publish failed (ntfy.sh blocks Workers egress)", { detail: n.detail, ntfy: n.ok ? undefined : push });

    current = "reset";
    await reset();
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 300);
    step(current, "fail", `Step ${current} failed`, { detail: msg });
    try { await reset(true); } catch { /* best effort */ }
    emit("error", { run_id: runId, error: msg });
    return { blocks_to_freeze: null, steps };
  }
  emit("done", { run_id: runId, blocks_to_freeze: blocksToFreeze });
  return { blocks_to_freeze: blocksToFreeze, steps };

  async function guardianState() {
    const r = await rpc.call("query", { request_type: "call_function", finality: "optimistic", account_id: A.agent, method_name: "get_state", args_base64: "e30=" });
    return JSON.parse(Buffer.from(r.result).toString());
  }

  /** Unfreeze, re-add one agent key, return the loot, delete the used decoy key. Tolerant when recovering from an error. */
  async function reset(tolerant = false) {
    step("reset", "start", "Resetting: unfreeze, re-provision the agent key, return the loot, delete the decoy key");
    const txs: NonNullable<Step["txs"]> = [];
    const rec = (label: string, r: { hash: string; ok: boolean; error?: string }) => {
      if (!r.ok && !tolerant) throw new Error(`${label} failed: ${r.error}`);
      txs.push({ label, tx_hash: r.hash, explorer: explorerTx(r.hash) });
    };
    const agentKey = newKey();
    const pre = await guardianState();
    await Promise.all([
      (async () => {
        if (pre.frozen) rec("unfreeze", await owner.send(A.agent, [call("unfreeze", {}, 30)]));
        if (pre.frozen || !pre.agent_keys?.length) {
          rec("add_agent_key", await owner.send(A.agent, [call("add_agent_key", { public_key: agentKey.public, receiver_id: cfg.parent, method_names: ["record_deploy"], allowance: nearAmount(250).toString() }, 30)]));
        }
      })().catch((e) => { if (!tolerant) throw e; }),
      stole ? thief.send(A.decoy, [transfer(LOOT)]).then((r) => rec("return_loot", r)).catch((e) => { if (!tolerant) throw e; }) : Promise.resolve(),
      planted ? decoyAdmin.send(A.decoy, [deleteKey(fresh.public)]).then((r) => rec("delete_decoy_key", r)).catch((e) => { if (!tolerant) throw e; }) : Promise.resolve(),
    ]);
    const st = await guardianState();
    if (st.frozen || !st.agent_keys?.length) throw new Error(`lab agent not restored: frozen=${st.frozen} agent_keys=${st.agent_keys?.length}`);
    step("reset", "ok", `Lab agent UNFROZEN with ${st.agent_keys.length} agent key; loot returned; used decoy key deleted`, { tx_hash: txs[0]?.tx_hash, txs });
  }
}

/**
 * Observe the decoy key's use on chain: poll the key's access-key record at the optimistic head and wait for its nonce to reach the
 * theft's nonce (a transaction signed by that key bumps it). Reads the head state each time, so it cannot miss a block.
 * Falls back to the tx outcome over RPC if the poll sees nothing for about 6 s.
 */
async function detectUse(rpc: Rpc, decoy: string, publicKey: string, nonce: bigint, txHash: string): Promise<{ height: number; via: string }> {
  for (let i = 0; i < 24; i++) {
    try {
      const r = await rpc.call("query", { request_type: "view_access_key", finality: "optimistic", account_id: decoy, public_key: publicKey }, 2);
      if (BigInt(r.nonce) >= nonce) return { height: r.block_height, via: "decoy key nonce moved at the optimistic head, read via RPC view_access_key" };
    } catch { /* rotate */ }
    await sleep(150);
  }
  const t = await waitTx(rpc, txHash, decoy);
  return { height: await blockHeight(rpc, t.blockHash), via: "tx outcome observed via RPC (tx status fallback)" };
}

async function notify(topic: string | undefined, title: string, message: string, click: string): Promise<{ ok: boolean; detail?: string }> {
  if (!topic) return { ok: false, detail: "no lab topic configured" };
  try {
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, { method: "POST", body: message, headers: { Title: title, Priority: "5", Tags: "rotating_light,lock", Click: click }, signal: AbortSignal.timeout(2500) });
    return { ok: res.ok, detail: res.ok ? undefined : `ntfy http ${res.status}` };
  } catch (e: any) { return { ok: false, detail: String(e?.message ?? e).slice(0, 120) }; }
}

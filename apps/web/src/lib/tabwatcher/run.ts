import type { StepViewOf } from "../lab/types";
import { explorerTx } from "../wallet/near";
import { generateKeyPair } from "../wallet/keys";
import { recordHomeTx, updateHome, type HomeRecord } from "../wallet/homeStore";
import { writeJournal, type Journal } from "./journal";
import { LOOT, nearFmt, preflight, type Preflight } from "./preflight";
import { tabWatcherFor } from "./registry";
import { TabRpc } from "./rpc";
import { INCIDENT_CLI, MY_STEPS, cleanUp, fileReport, included, landed, readBack, type MyStepId, type Readback, type ReportResult } from "./runSteps";
import { KeySigner, implicitAccountOf } from "./sign";
import type { FreezeResult } from "./freezer";
import type { TabWatcher, WatchTrip } from "./watcher";

export type MyStep = StepViewOf<MyStepId>;
export type RunPhase = "idle" | "running" | "done" | "failed";

export interface MyRunState {
  phase: RunPhase;
  runId: string | null;
  guardian: string | null;
  steps: MyStep[];
  blocks: number | null;
  error: string | null;
  readback: Readback | null;
  report: ReportResult | null;
  thief: string | null;
}

const blank = (): MyStep[] => MY_STEPS.map((id) => ({ id, status: "pending", txs: [] }));
export const IDLE_RUN: MyRunState = { phase: "idle", runId: null, guardian: null, steps: blank(), blocks: null, error: null, readback: null, report: null, thief: null };

class StepFail extends Error {}

function waitFor<T>(w: TabWatcher, pick: (t: WatchTrip) => T | null, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new StepFail(what)); }, ms);
    const off = w.onTrip((t) => {
      const v = pick(t);
      if (v !== null) { clearTimeout(timer); off(); resolve(v); }
    });
  });
}

/** One run of the theft-to-freeze loop on the owner's own guardian, signed only with keys this browser holds. */
export class MyRun {
  state: MyRunState = IDLE_RUN;
  private listeners = new Set<(s: MyRunState) => void>();
  private rpc = new TabRpc();
  private j: Journal | null = null;
  private current: MyStepId = "check";

  private home: HomeRecord;

  constructor(home: HomeRecord) {
    this.home = home;
  }

  subscribe(fn: (s: MyRunState) => void) {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(p: Partial<MyRunState>) {
    this.state = { ...this.state, ...p };
    if (this.j) {
      this.j = { ...this.j, steps: this.state.steps, current: this.current, blocks: this.state.blocks };
      writeJournal(this.j);
    }
    for (const fn of this.listeners) fn(this.state);
  }

  private step(id: MyStepId, status: MyStep["status"], title: string, x: { detail?: string; tx?: string; txs?: { hash: string; label?: string }[]; block?: number; blocks_after_trip?: number } = {}) {
    if (status === "start") this.current = id;
    const steps = this.state.steps.map((s) => {
      if (s.id !== id) return s;
      const txs = [...s.txs];
      for (const t of [...(x.txs ?? []), ...(x.tx ? [{ hash: x.tx }] : [])]) if (!txs.some((y) => y.hash === t.hash)) txs.push({ hash: t.hash, href: explorerTx(t.hash), label: t.label });
      return { ...s, status, title, detail: x.detail ?? s.detail, at: new Date().toISOString(), block: x.block ?? s.block, blocks_after_trip: x.blocks_after_trip ?? s.blocks_after_trip, txs };
    });
    this.set({ steps });
  }

  private tx(label: string, hash: string) {
    if (this.j) this.j = { ...this.j, tx: { ...this.j.tx, [label]: hash } };
    writeJournal(this.j!);
    recordHomeTx(this.home.owner, { hash, label: `lab run: ${label}`, at: Date.now() });
  }

  async start(guardian: string): Promise<void> {
    if (this.state.phase === "running") return;
    const home = this.home;
    const runId = `my-${Date.now().toString(36)}`;
    const thiefKey = generateKeyPair();
    const thief = implicitAccountOf(thiefKey.public_key);
    this.j = { v: 1, id: runId, owner: home.owner, guardian, bait: home.bait.account_id, watcher: home.watcher.account_id, started_at: new Date().toISOString(), thief: { account: thief, ...thiefKey }, tx: {}, phase: "running", steps: [] };
    this.state = { ...IDLE_RUN, steps: blank() };
    this.set({ phase: "running", runId, guardian, thief });
    const entry = tabWatcherFor(home);
    const bait = new KeySigner(this.rpc, home.bait.account_id, home.bait.secret_key);
    const thiefSigner = new KeySigner(this.rpc, thief, thiefKey.secret_key);
    let decoyPk: string | null = null;
    let stole = false;
    let pre: Preflight;
    try {
      this.step("check", "start", "Reading your guardian, bait and watcher from chain");
      pre = await preflight(this.rpc, home, guardian);
      if (pre.problems.length) throw new StepFail(pre.problems.map((p) => p.text).join(" "));
      if (pre.state!.frozen) throw new StepFail(`${guardian} is already frozen: unfreeze it from your wallet first.`);
      this.step("check", "ok", `${guardian} is active, watched by ${pre.state!.watcher}, with ${pre.state!.agent_keys.length} agent key(s) and ${pre.state!.intents_keys.length} intents key(s). The bait can spend ${nearFmt(pre.bait ? pre.bait.amount - pre.bait.storageUsage * 10n ** 19n : 0n)} NEAR.`);
      entry.watcher.start();

      this.step("plant", "start", `Adding a fresh full-access decoy key to ${home.bait.account_id}, signed by the bait's own key in this tab`);
      const decoy = generateKeyPair();
      decoyPk = decoy.public_key;
      this.j = { ...this.j, decoy_pk: decoy.public_key };
      updateHome(home.owner, (h) => ({ ...h, decoys: [{ public_key: decoy.public_key, secret_key: decoy.secret_key, added_at: new Date().toISOString(), label: `lab run ${runId}` }, ...h.decoys] }));
      const ph = await bait.broadcast(home.bait.account_id, [{ type: "AddKey", publicKey: decoy.public_key, permission: "FullAccess" }], (h) => this.tx("plant decoy", h));
      const plant = await landed(this.rpc, ph, home.bait.account_id);
      this.step("plant", "ok", `Decoy ${decoy.public_key.slice(0, 18)}… added to ${home.bait.account_id}`, { tx: ph, block: plant.block });

      this.step("arm", "start", `Waiting for your tab watcher to read the bait at block ${plant.block.toLocaleString("en-US")} or later`);
      const seen = await entry.watcher.seenHeight(plant.block, 45_000);
      this.step("arm", "ok", `Your tab watcher read block ${seen.toLocaleString("en-US")} with the decoy in it, before the theft was signed`, { block: seen, detail: "It compares every bait key's nonce with its previous read; only a transaction signed by that key moves it." });

      const tripP = waitFor(entry.watcher, (t) => (t.public_key === decoy.public_key ? t : null), 90_000, "Your tab watcher did not see the decoy used within 90 s.");
      this.step("theft", "start", `The thief signs a ${nearFmt(LOOT)} NEAR transfer from ${home.bait.account_id} to a fresh account with the leaked decoy`);
      const decoySigner = new KeySigner(this.rpc, home.bait.account_id, decoy.secret_key);
      const th = await decoySigner.broadcast(thief, [{ type: "Transfer", deposit: LOOT }], (h) => this.tx("theft", h));
      const theftSentAt = Date.now();
      stole = true;
      const theftP = included(this.rpc, th, home.bait.account_id);
      const theftLine = (t: { block: number; failure?: string }) => t.failure
        ? `Decoy-signed transaction included in block ${t.block.toLocaleString("en-US")}; its transfer failed (${t.failure}), but the decoy signed, which is the theft`
        : `Decoy-signed transfer included in block ${t.block.toLocaleString("en-US")}; ${nearFmt(LOOT)} NEAR moved to ${thief.slice(0, 10)}…`;
      // Shown as soon as the chain has it, while the watcher is still at work.
      theftP.then((t) => this.step("theft", "ok", theftLine(t), { tx: th, block: t.block }), () => undefined);

      this.current = "detect";
      this.step("detect", "start", "Your tab watcher reads the bait's keys every 0.5 s");
      const trip = await tripP;
      this.step("detect", "ok", `Decoy use seen at block ${trip.detected_at_block.toLocaleString("en-US")}: ${trip.via === "key state" ? "the decoy key's nonce moved" : "a transaction signed by the decoy key"}`, { block: trip.detected_at_block, detail: `${((trip.detected_at - theftSentAt) / 1000).toFixed(1)} s after the thief broadcast · view_access_key_list, then EXPERIMENTAL_changes for the transaction${trip.tx_hash ? ` (${trip.tx_hash.slice(0, 8)}…)` : ""}` });

      this.step("freeze", "start", `${home.watcher.account_id} signs freeze on ${guardian} with the watcher key in this tab`);
      const pickFreeze = (t: WatchTrip): FreezeResult | null => {
        if (t.public_key !== decoy.public_key) return null;
        const f = t.freezes.find((x) => x.guardian === guardian);
        return f && (f.status === "landed" || f.status === "failed" || f.status === "skipped") ? f : null;
      };
      const already = pickFreeze(entry.watcher.snapshot.trips.find((t) => t.public_key === decoy.public_key) ?? trip);
      const fr = already ?? (await waitFor(entry.watcher, pickFreeze, 90_000, "The freeze did not land within 90 s."));
      const theft = await theftP;
      if (fr.status !== "landed" || fr.block === undefined || !fr.tx_hash) {
        this.current = "freeze";
        throw new StepFail(`The freeze did not land: ${fr.error ?? fr.status}.`);
      }
      this.tx("freeze", fr.tx_hash);
      const blocks = fr.block - theft.block;
      this.set({ blocks });
      this.step("freeze", "ok", `${guardian} frozen in block ${fr.block.toLocaleString("en-US")}, ${blocks} block${blocks === 1 ? "" : "s"} after the theft`, { tx: fr.tx_hash, block: fr.block, blocks_after_trip: blocks, detail: fr.sent_at ? `signed and broadcast ${Math.max(0, fr.sent_at - trip.detected_at)} ms after the use was seen; both blocks are the transactions' inclusion blocks, read from chain` : undefined });

      this.step("readback", "start", "Reading get_state and the deleted keys");
      const rb = await readBack(this.rpc, guardian, decoy.public_key);
      this.set({ readback: rb });
      const ok = rb.frozen && rb.decoyMatches && rb.by === home.watcher.account_id && rb.deleted.every((d) => d.gone);
      this.step("readback", ok ? "ok" : "fail", ok
        ? `frozen: true · by ${rb.by} at block ${rb.atBlock?.toLocaleString("en-US")} · ${rb.deleted.length} agent key(s) deleted, ${rb.intentsRemoved.length} intents key(s) removed · sign_evm refused until unfreeze`
        : `The chain does not show this freeze as expected: frozen ${rb.frozen}, by ${rb.by}, decoy ${rb.decoyMatches ? "matches" : "differs"}.`);

      if (pre.report.ok) {
        this.step("blocklist", "start", `${home.watcher.account_id} reports the theft to ${"the blocklist"}; OutLayer checks it from chain in a TEE`);
        const watcherSigner = new KeySigner(this.rpc, home.watcher.account_id, home.watcher.secret_key);
        try {
          const r = await fileReport(this.rpc, watcherSigner, { theftTx: th, bait: home.bait.account_id, adminPk: home.bait.public_key, thief }, (h) => this.tx("blocklist report", h));
          this.set({ report: r });
          this.step("blocklist", r.verdict === "block" ? "ok" : "fail", `Report landed in block ${r.block.toLocaleString("en-US")}; check(thief) = ${r.verdict ?? "unreadable"}`, { tx: r.hash, block: r.block });
        } catch (e) {
          const h = (e as { hash?: string }).hash;
          this.step("blocklist", "fail", `The report did not complete: ${(e as Error).message}`, h ? { tx: h } : {});
        }
      } else {
        this.step("blocklist", "skip", pre.report.why);
      }
      this.step("incident", "skip", INCIDENT_CLI);
      await this.cleanup(bait, thiefSigner, decoyPk, stole);
      this.j = { ...this.j!, phase: "done", finished_at: new Date().toISOString() };
      this.set({ phase: "done" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.step(this.current, "fail", msg.slice(0, 400));
      if (decoyPk || stole) await this.cleanup(bait, thiefSigner, decoyPk, stole).catch(() => undefined);
      this.j = { ...this.j!, phase: "failed", finished_at: new Date().toISOString() };
      this.set({ phase: "failed", error: msg });
    }
  }

  private async cleanup(bait: KeySigner, thief: KeySigner, decoyPk: string | null, stole: boolean) {
    this.step("cleanup", "start", stole ? "The thief account sends the loot back; the bait's key deletes the used decoy" : "The bait's key deletes the unused decoy");
    const out = await cleanUp(this.rpc, { bait, thief, decoyPk, stole }, (label, h) => this.tx(label, h));
    if (decoyPk && out.some((o) => o.label === "delete decoy" && (o.hash || o.error === "already gone"))) {
      updateHome(this.home.owner, (h) => ({ ...h, decoys: h.decoys.filter((d) => d.public_key !== decoyPk) }));
    }
    const bad = out.filter((o) => o.error && o.error !== "already gone");
    this.step("cleanup", bad.length ? "fail" : "ok",
      bad.length ? bad.map((b) => `${b.label}: ${b.error}`).join("; ") : out.map((o) => o.label).join(" and ") + " landed",
      { txs: out.filter((o) => o.hash).map((o) => ({ hash: o.hash!, label: o.label })), detail: stole ? "The thief's own account keeps about 0.0023 NEAR: its storage and a gas margin, which a transfer cannot move." : undefined });
  }
}

const runs = new Map<string, { key: string; run: MyRun }>();
const keyOf = (h: HomeRecord) => `${h.bait.public_key}|${h.watcher.public_key}`;
/** The page's run for this owner: it survives navigating away and back within the app. New keys get a new run when idle. */
export function myRunFor(home: HomeRecord): MyRun {
  const cur = runs.get(home.owner);
  if (cur && (cur.key === keyOf(home) || cur.run.state.phase === "running")) return cur.run;
  const run = new MyRun(home);
  runs.set(home.owner, { key: keyOf(home), run });
  return run;
}

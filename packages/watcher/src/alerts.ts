import fs from "node:fs";
import { appendEvent, explorerTx, ledgerPath, logger, type LedgerEvent, type NetworkConfig } from "@standin/core";
import { loadEnvLocal, parseCanary, publish, subscribe, type FetchLike, type NtfyMessage } from "@standin/notify";

const log = logger("alerts");

/** What the alert layer needs from the trip handler (keeps it testable). */
export interface Freezer { manualFreeze(reason: string): Promise<unknown> }

export interface AlertOpts {
  cfg: NetworkConfig; home: string; handler: Freezer;
  env?: Record<string, string | undefined>; fetch?: FetchLike; pollMs?: number;
}

/** Ledger event -> phone alert (or null). Titles and messages never contain keys or topics. */
export function alertFor(e: LedgerEvent, cfg: NetworkConfig, replyTopic?: string) {
  if (e.type === "trip") {
    return { dedupeKey: `trip:${e.tx_hash || e.decoy_public_key}:${e.block_height}`, alert: {
      title: "Decoy key used", message: `Decoy used on chain: ${e.attacker_account || "unknown"}`,
      tags: ["rotating_light", "skull"], click: e.tx_hash ? explorerTx(cfg, e.tx_hash) : undefined, replyTopic,
    } };
  }
  if (e.type === "freeze") {
    const f = e.freeze ?? {};
    const k = (f.deleted_keys ?? []).length;
    return { dedupeKey: `freeze:${f.tx_hash}`, alert: {
      title: e.manual ? "Account frozen (manual)" : "Account frozen",
      message: `Frozen in ${f.blocks_after_trip ?? 0} blocks: ${k} agent keys deleted, intents keys removed`,
      tags: ["lock"], click: f.tx_hash ? explorerTx(cfg, f.tx_hash) : undefined,
    } };
  }
  if (e.type === "incident_report") {
    return { dedupeKey: `report:${e.trip_tx_hash}`, alert: {
      title: "Incident report ready", message: String(e.report?.summary ?? "Attested incident report written").slice(0, 300),
      tags: ["page_facing_up"], priority: 3 as const, click: e.trip_tx_hash ? explorerTx(cfg, e.trip_tx_hash) : undefined,
    } };
  }
  return null;
}

/**
 * Optional phone layer. No STANDIN_NTFY_TOPIC: no pushes and no canary listener. No reply topic: no buttons, no reply listener.
 * Everything runs detached from the trip path: it reads the ledger the freeze already wrote to, so a slow or failing ntfy
 * can never delay a freeze.
 */
export function startAlerts(o: AlertOpts): { stop(): void } {
  loadEnvLocal();
  const env = o.env ?? process.env;
  const topic = env.STANDIN_NTFY_TOPIC || undefined;
  const reply = env.STANDIN_NTFY_REPLY_TOPIC || undefined;
  const ac = new AbortController();
  const timers: NodeJS.Timeout[] = [];
  const freeze = (why: string) => void o.handler.manualFreeze(why).catch((e) => log.error(`manual freeze failed: ${(e as Error).message}`));

  if (topic) {
    const p = ledgerPath(o.home);
    let offset = fs.existsSync(p) ? fs.statSync(p).size : 0;
    let tail = "";
    timers.push(setInterval(() => {
      try {
        if (!fs.existsSync(p)) return;
        const size = fs.statSync(p).size;
        if (size < offset) offset = 0;
        if (size === offset) return;
        const fd = fs.openSync(p, "r");
        const buf = Buffer.alloc(size - offset);
        fs.readSync(fd, buf, 0, buf.length, offset); fs.closeSync(fd);
        offset = size;
        const lines = (tail + buf.toString("utf8")).split("\n");
        tail = lines.pop() ?? "";
        for (const l of lines) {
          let e: LedgerEvent; try { e = JSON.parse(l); } catch { continue; }
          const a = alertFor(e, o.cfg, reply);
          if (a) void publish(topic, a.alert, { fetch: o.fetch, dedupeKey: a.dedupeKey });
        }
      } catch (e) { log.warn(`ledger tail failed: ${(e as Error).message}`); }
    }, o.pollMs ?? 500));

    // Canarytokens webhooks post to the same private topic: an off-chain trip.
    void subscribe(topic, (m: NtfyMessage) => {
      const hit = parseCanary(m.message);
      if (!hit) return;
      appendEvent("canary", { token: hit.token, memo: hit.memo, src_ip: hit.src_ip, channel: hit.channel, hit_time: hit.time }, o.home);
      log.warn(`canary token hit (memo: ${hit.memo || "none"})`);
      if (env.STANDIN_CANARY_FREEZE !== "0") freeze(`canary token ${hit.memo ? `"${hit.memo}" ` : ""}used off-chain`);
    }, { fetch: o.fetch, signal: ac.signal, onError: (e) => log.warn(`canary listener: ${e.message}`) });
  }

  if (reply) {
    void subscribe(reply, (m: NtfyMessage) => {
      const w = (m.message ?? "").trim().toLowerCase();
      if (w === "freeze") { log.warn("owner tapped Freeze now"); freeze("owner tapped Freeze now on phone"); }
      else if (w === "ignore") appendEvent("tool_call", { tool_name: "phone reply", outcome: "ignored" }, o.home);
    }, { fetch: o.fetch, signal: ac.signal, onError: (e) => log.warn(`reply listener: ${e.message}`) });
  }
  return { stop: () => { ac.abort(); timers.forEach(clearInterval); } };
}

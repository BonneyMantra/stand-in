#!/usr/bin/env -S node --import tsx
import path from "node:path";
import {
  callMethod, explorerTx, loadNetworkConfig, requireAccount, roleAccount, setLogSink,
} from "@standin/core";
import { adopt } from "./adopt.ts";
import { adoptWallet } from "./adopt-wallet.ts";
import { attackDrain } from "./attack.ts";
import { devUp } from "./devup.ts";
import { pay } from "./pay.ts";
import { unfreeze } from "./unfreeze.ts";
import { unfreezeWallet } from "./unfreeze-wallet.ts";
import { err, out, parse, short } from "./util.ts";

setLogSink((l) => process.stderr.write(l + "\n"));

const USAGE = `standin <command>
  dev up [--no-watcher] [--pool N]       check accounts/contracts, mint decoy pool, start watcher
  adopt --home DIR [--keychain]          move real NEAR keys out of DIR, plant decoys, provision scoped key
  adopt --wallet --account ID.testnet [--owner ID.testnet] --home DIR [--timeout SEC] [--resume]
                                         owner key stays in your NEAR wallet: prints an owner-console link, the wallet signs one tx (guardian + scoped agent key), CLI waits, then plants a decoy in DIR (exit 6 on timeout)
  status [--json]                        agent/decoy/trips from the watcher API
  freeze [reason]                        manual guardian freeze
  unfreeze [--keychain]                  Touch ID gate, owner-key unfreeze, re-provision the agent key
  unfreeze --wallet [--timeout SEC]      no local owner key: prints an owner-console link, owner approves in their NEAR wallet, CLI waits for the new agent key (exit 6 on timeout)
  unfreeze --wallet --resume [--timeout SEC]   keep waiting for the pending key from an earlier --wallet run
  pay <receiver> <amount|method> [--args JSON] [--approve-warn]   (a warned receiver also needs Touch ID)
  attack drain --key FILE [--reserve NEAR]   scripted thief (demo): drain a planted decoy to the attacker account`;

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "dev": {
      if (rest[0] !== "up") { out(USAGE); return 1; }
      const { values } = parse(rest.slice(1), { "no-watcher": { type: "boolean" }, pool: { type: "string" } });
      return (await devUp({ noWatcher: values["no-watcher"], pool: values.pool ? Number(values.pool) : undefined })) ? 0 : 2;
    }
    case "adopt": {
      const { values } = parse(rest, { home: { type: "string" }, keychain: { type: "boolean" }, methods: { type: "string" }, allowance: { type: "string" }, wallet: { type: "boolean" }, account: { type: "string" }, owner: { type: "string" }, resume: { type: "boolean" }, timeout: { type: "string" } });
      if (values.wallet) {
        if (!values.account) { err("adopt --wallet needs --account ID.testnet"); return 1; }
        if (!values.home) { err("adopt needs --home DIR"); return 1; }
        const t = values.timeout === undefined ? undefined : Number(values.timeout);
        if (t !== undefined && !(t > 0)) { err("--timeout must be a positive number of seconds"); return 1; }
        const home = path.resolve(values.home);
        if (!process.env.STANDIN_HOME) process.env.STANDIN_HOME = path.join(home, ".standin");
        return adoptWallet({ account: values.account, owner: values.owner, home, resume: values.resume, timeoutSec: t });
      }
      if (values.account || values.owner || values.resume || values.timeout) { err("--account, --owner, --resume and --timeout need --wallet"); return 1; }
      if (!values.home) { err("adopt needs --home DIR"); return 1; }
      await adopt({
        home: path.resolve(values.home), store: values.keychain ? "keychain" : "dev",
        scopedMethods: (values.methods ?? "record_deploy").split(","), allowance: values.allowance ?? "250000000000000000000000",
      });
      return 0;
    }
    case "status": {
      const { values } = parse(rest, { json: { type: "boolean" } });
      const port = process.env.STANDIN_WATCHER_PORT ?? "4317";
      const s: any = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json().catch(() => null);
      if (!s) { err(`watcher not reachable on :${port}; run \`standin dev up\``); return 2; }
      if (values.json) { out(JSON.stringify(s, null, 2)); return 0; }
      out(`network ${s.network}  agent ${s.agent.account_id} ${s.agent.frozen ? "FROZEN" : "active"} (${s.agent.agent_keys.length} agent keys, ${s.agent.intents_keys.length} intents keys)`);
      out(`decoy ${s.decoy.account_id}  ${s.decoy.keys.length} planted keys  balance ${s.decoy.balance_yocto}`);
      out(`${s.sessions.length} sessions, ${s.exposures.length} exposures, ${s.trips.length} trips, ${s.blocklist.length} blocklisted`);
      for (const t of s.trips) out(`  trip ${short(t.tx_hash)} @${t.block_height} -> freeze @${t.freeze.block_height} (${t.freeze.blocks_after_trip} blocks) attacker ${t.attacker_account}`);
      return 0;
    }
    case "freeze": {
      const cfg = loadNetworkConfig();
      const res = await callMethod(roleAccount(cfg, "watcher"), requireAccount(cfg, "agent"), "freeze", { reason: rest.join(" ") || "manual freeze via standin CLI" });
      out(`frozen: ${explorerTx(cfg, res.tx_hash)}`);
      return 0;
    }
    case "unfreeze": {
      const { values } = parse(rest, { keychain: { type: "boolean" }, wallet: { type: "boolean" }, resume: { type: "boolean" }, timeout: { type: "string" } });
      if (values.wallet) {
        const t = values.timeout === undefined ? undefined : Number(values.timeout);
        if (t !== undefined && !(t > 0)) { err("--timeout must be a positive number of seconds"); return 1; }
        return unfreezeWallet({ resume: values.resume, timeoutSec: t });
      }
      if (values.resume || values.timeout) { err("--resume and --timeout need --wallet"); return 1; }
      return unfreeze({ keychain: values.keychain });
    }
    case "pay": {
      const { values, positionals } = parse(rest, { args: { type: "string" }, "approve-warn": { type: "boolean" }, json: { type: "boolean" } });
      if (positionals.length < 2) { err("usage: standin pay <receiver> <amount|method>"); return 1; }
      return pay({ receiver: positionals[0]!, what: positionals[1]!, args: values.args, approveWarn: values["approve-warn"], json: values.json });
    }
    case "attack": {
      if (rest[0] !== "drain") { out(USAGE); return 1; }
      const { values } = parse(rest.slice(1), { key: { type: "string" }, reserve: { type: "string" } });
      if (!values.key) { err("attack drain needs --key FILE"); return 1; }
      await attackDrain(values.key, values.reserve ?? "0.1");
      return 0;
    }
    default:
      out(USAGE);
      return cmd ? 1 : 0;
  }
}

main(process.argv.slice(2)).then((c) => { process.exitCode = c; }).catch((e) => {
  err(`error: ${(e as Error).message}`);
  process.exitCode = 1;
});

// Local dry run of one lab cycle with keys from .secrets/lab (no Cloudflare). node --import tsx packages/lab/scripts/local.ts
import fs from "node:fs";
import path from "node:path";
import { runLab } from "../src/lab.ts";
const root = path.resolve(import.meta.dirname, "../../..");
const k = (n: string) => JSON.parse(fs.readFileSync(path.join(root, ".secrets/lab", n + ".json"), "utf8")).secret as string;
const cfg = JSON.parse(fs.readFileSync(path.join(root, "config/lab.json"), "utf8"));
const t0 = Date.now();
const r = await runLab("local-" + Date.now(), cfg, { LAB_AGENT_OWNER_KEY: k("agent-owner"), LAB_DECOY_ADMIN_KEY: k("decoy-admin"), LAB_THIEF_KEY: k("thief"), LAB_WATCH_FC_KEY: k("watch-fc") },
  (name, d: any) => process.stderr.write(`${((Date.now() - t0) / 1000).toFixed(1)}s ${name} ${d.step ?? ""} ${d.status ?? ""} ${d.title ?? JSON.stringify(d)} ${d.block ?? ""} ${d.detail ?? ""}\n`));
process.stderr.write(`blocks_to_freeze=${r.blocks_to_freeze}\n`);

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Hard spend guard for every mainnet transaction. Gabriel funded 0.5 NEAR for the whole product.
 * Every mainnet tx must go through `spend()` (or `reserve()` + `commit()`); both THROW before anything is
 * sent when amount + gas would push a purpose, or the whole product, over its cap.
 * The ledger is append-only NDJSON (`.secrets/mainnet-spend.ndjson`), one line per event, grouped by `id`:
 *   reserve  {id, at, purpose, amount_yocto, gas_estimate_yocto, tx_hash: null}
 *   commit   {id, at, event: "commit", tx_hash}
 *   settle   {id, at, event: "settle", gas_actual_yocto}   (actual tokens burnt; lowers the reserved estimate)
 *   recovered {id, at, event: "recovered", purpose, amount_yocto, tx_hash}  (money swept back to the funding account;
 *             credited against `purpose`, never below zero, so a refunded bait can be funded again)
 * A reservation whose send fails stays counted in full (we cannot tell if the tx reached the chain).
 */
const NEAR = 10n ** 24n;
const n = (x: string) => BigInt(Math.round(Number(x) * 1e6)) * (NEAR / 1_000_000n);

export const PURPOSES = ["bait", "account", "intents", "thief", "gas"] as const;
export type Purpose = (typeof PURPOSES)[number];
export const CAPS_YOCTO: Record<Purpose, bigint> & { global: bigint } = {
  bait: n("0.20"), account: n("0.06"), intents: n("0.01"), thief: n("0.03"), gas: n("0.03"), global: n("0.38"),
};
/** Total ever funded to the ops account; at least MIN_REMAINING must stay unspent at handback. */
export const FUNDED_YOCTO = n("0.5");
export const MIN_REMAINING_YOCTO = n("0.12");

export class BudgetExceeded extends Error {
  constructor(msg: string) { super(`mainnet budget refused: ${msg}`); this.name = "BudgetExceeded"; }
}

export interface Row {
  id: string; at: string; purpose: Purpose; amount_yocto: string; gas_estimate_yocto: string; tx_hash: string | null;
  gas_actual_yocto?: string;
}

export function spendFile(): string {
  if (process.env.STANDIN_MAINNET_SPEND) return process.env.STANDIN_MAINNET_SPEND;
  const repo = process.env.STANDIN_REPO ?? path.resolve(import.meta.dirname, "../../..");
  return path.join(process.env.STANDIN_SECRETS ?? path.join(repo, ".secrets"), "mainnet-spend.ndjson");
}

/** Fold the ledger lines into one row per reservation. */
export function readRows(file = spendFile()): Row[] {
  if (!fs.existsSync(file)) return [];
  const rows = new Map<string, Row>();
  const recovered: any[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const e = JSON.parse(line);
    if (e.event === "commit") { const r = rows.get(e.id); if (r) r.tx_hash = e.tx_hash; }
    else if (e.event === "recovered") recovered.push(e);
    else if (e.event === "settle") { const r = rows.get(e.id); if (r) r.gas_actual_yocto = e.gas_actual_yocto; }
    else rows.set(e.id, e as Row);
  }
  lastRecovered = recovered;
  return [...rows.values()];
}
let lastRecovered: any[] = [];
const cost = (r: Row) => BigInt(r.amount_yocto) + BigInt(r.gas_actual_yocto ?? r.gas_estimate_yocto);

export function totals(file = spendFile()): { byPurpose: Record<Purpose, bigint>; global: bigint } {
  const byPurpose = Object.fromEntries(PURPOSES.map((p) => [p, 0n])) as Record<Purpose, bigint>;
  let global = 0n;
  for (const r of readRows(file)) { byPurpose[r.purpose] += cost(r); global += cost(r); }
  for (const e of lastRecovered) {
    const back = BigInt(e.amount_yocto) < byPurpose[e.purpose as Purpose] ? BigInt(e.amount_yocto) : byPurpose[e.purpose as Purpose];
    byPurpose[e.purpose as Purpose] -= back; global -= back;
  }
  return { byPurpose, global };
}

const append = (file: string, o: object) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(o) + "\n", { mode: 0o600 });
};

/** Check caps and append the reservation (synchronous, so it is cheap enough for the freeze hot path). */
export function reserve(purpose: Purpose, amountYocto: bigint, gasEstimateYocto: bigint, file = spendFile()): string {
  if (!PURPOSES.includes(purpose)) throw new BudgetExceeded(`unknown purpose ${String(purpose)}`);
  if (amountYocto < 0n || gasEstimateYocto < 0n) throw new BudgetExceeded("negative amount");
  const add = amountYocto + gasEstimateYocto;
  const t = totals(file);
  if (t.byPurpose[purpose] + add > CAPS_YOCTO[purpose]) throw new BudgetExceeded(`${purpose} cap ${CAPS_YOCTO[purpose]} yocto would be exceeded (spent ${t.byPurpose[purpose]}, asked ${add})`);
  if (t.global + add > CAPS_YOCTO.global) throw new BudgetExceeded(`global cap ${CAPS_YOCTO.global} yocto would be exceeded (spent ${t.global}, asked ${add})`);
  const id = randomUUID();
  append(file, { id, at: new Date().toISOString(), purpose, amount_yocto: amountYocto.toString(), gas_estimate_yocto: gasEstimateYocto.toString(), tx_hash: null });
  return id;
}
export function commit(id: string, txHash: string, file = spendFile()): void {
  append(file, { id, at: new Date().toISOString(), event: "commit", tx_hash: txHash });
}
export function settle(id: string, gasActualYocto: bigint, file = spendFile()): void {
  append(file, { id, at: new Date().toISOString(), event: "settle", gas_actual_yocto: gasActualYocto.toString() });
}

/** Record money swept back to the funding account (only after the sweep tx succeeded on chain). */
export function recovered(purpose: Purpose, amountYocto: bigint, txHash: string, file = spendFile()): void {
  append(file, { id: randomUUID(), at: new Date().toISOString(), event: "recovered", purpose, amount_yocto: amountYocto.toString(), tx_hash: txHash });
}
export const recoveredTotal = (file = spendFile()): bigint => { readRows(file); return lastRecovered.reduce((a, e) => a + BigInt(e.amount_yocto), 0n); };

/** The one door: reserve (throws when over cap), run the send, record the tx hash. */
export async function spend<T extends { tx_hash: string }>(
  purpose: Purpose, amountYocto: bigint, gasEstimateYocto: bigint, send: () => Promise<T>, file = spendFile(),
): Promise<T & { spend_id: string }> {
  const id = reserve(purpose, amountYocto, gasEstimateYocto, file);
  const res = await send();
  commit(id, res.tx_hash, file);
  return { ...res, spend_id: id };
}

/** yocto -> "0.123456" NEAR string (display only). */
export const fmtNear = (y: bigint) => `${y / NEAR}.${(y % NEAR).toString().padStart(24, "0").slice(0, 6)}`;

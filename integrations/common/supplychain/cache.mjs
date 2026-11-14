// 1-hour result cache under STANDIN_HOME (shared by the OSV and provenance checks).
import fs from 'node:fs';
import path from 'node:path';
import { home } from '../store.mjs';

export const TTL_MS = 60 * 60 * 1000;
const file = () => path.join(home(), 'supplychain-cache.json');
const load = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; } };

export function cacheGet(key, now = Date.now()) {
  const e = load()[key];
  return e && now - e.at < TTL_MS ? e.v : undefined;
}
export function cacheSet(entries, now = Date.now()) {
  try {
    const all = load();
    for (const [k, v] of Object.entries(entries)) all[k] = { at: now, v };
    for (const [k, e] of Object.entries(all)) if (now - e.at >= TTL_MS) delete all[k];
    fs.mkdirSync(home(), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(all), { mode: 0o600 });
  } catch { /* cache is best effort */ }
}

/** Reject after ms even if the underlying fetch ignores its abort signal. */
export function deadline(promise, ms, label = 'timeout') {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(label)), ms); })]).finally(() => clearTimeout(t));
}

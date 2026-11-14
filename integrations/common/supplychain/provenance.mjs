// npm provenance downgrade: warn when the previous version of an explicitly named package was
// published with a provenance attestation and this one was not. Presence only: the Sigstore bundle
// is NOT cryptographically verified here, and absence alone is not treated as suspicious.
import { cacheGet, cacheSet, deadline } from './cache.mjs';

const REG = 'https://registry.npmjs.org';
const enc = (name) => name.replace('/', '%2F');
const num = (v) => v.split('-')[0].split('.').map(Number);
export function cmp(a, b) { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; }

export function previousVersion(versions, version) {
  return versions.filter((v) => !v.includes('-') && cmp(v, version) < 0).sort(cmp).pop() || null;
}

async function has(fetchImpl, name, ver, signal, now) {
  const k = `prov:${name}@${ver}`;
  const c = cacheGet(k, now);
  if (c !== undefined) return c;
  const r = await fetchImpl(`${REG}/-/npm/v1/attestations/${enc(name)}@${ver}`, { signal });
  if (r.status === 404) { cacheSet({ [k]: false }, now); return false; }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  cacheSet({ [k]: true }, now);
  return true;
}

/** -> "present" | "absent" | "downgrade" | "unknown". Never throws. */
export async function checkProvenance(name, version, { fetchImpl = fetch, budgetMs = 2500, now = Date.now() } = {}) {
  const ctl = new AbortController();
  try {
    return await deadline((async () => {
      const here = await has(fetchImpl, name, version, ctl.signal, now);
      if (here) return 'present';
      const doc = await fetchImpl(`${REG}/${enc(name)}`, { signal: ctl.signal, headers: { accept: 'application/vnd.npm.install-v1+json' } });
      if (!doc.ok) return 'absent';
      const prev = previousVersion(Object.keys((await doc.json()).versions || {}), version);
      if (!prev) return 'absent';
      return (await has(fetchImpl, name, prev, ctl.signal, now)) ? 'downgrade' : 'absent';
    })(), budgetMs, 'timeout');
  } catch { ctl.abort(); return 'unknown'; }
}

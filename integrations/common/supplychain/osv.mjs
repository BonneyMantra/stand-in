// OSV.dev check. Blocks only malicious-package advisories (MAL- ids, or advisories whose text marks
// malicious code); ordinary vulnerabilities are reported as a warning. Fails open when OSV is slow
// or unreachable. Metadata API only: nothing is ever installed or downloaded.
import { cacheGet, cacheSet, deadline } from './cache.mjs';

export const OSV = 'https://api.osv.dev';
export const BUDGET_MS = 2500;
const DETAIL_CAP = 20;
const MAL_TEXT = /malicious (code|package|version|release|dependenc)|contains? malware|\bmalware\b/i;

export const isMalId = (id) => /^MAL-/i.test(id);
export const isMalText = (v) => MAL_TEXT.test(`${v?.summary || ''}\n${String(v?.details || '').slice(0, 600)}`);

async function json(fetchImpl, url, init, signal) {
  const r = await fetchImpl(url, { ...init, signal, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/**
 * pkgs: [{name, version}]. Returns { unchecked, error?, malicious:[{name,version,id}], vulns:[{name,version,ids}], checked }.
 * Never throws.
 */
export async function checkOsv(pkgs, { fetchImpl = fetch, budgetMs = BUDGET_MS, now = Date.now() } = {}) {
  const res = { unchecked: false, malicious: [], vulns: [], checked: pkgs.length };
  const per = new Map(); // key -> {mal:[ids], other:[ids]}
  const todo = [];
  for (const p of pkgs) {
    const hit = cacheGet(`osv:${p.name}@${p.version}`, now);
    if (hit) per.set(`${p.name}@${p.version}`, hit); else todo.push(p);
  }
  if (todo.length) {
    const ctl = new AbortController();
    try {
      await deadline((async () => {
        const batch = await json(fetchImpl, `${OSV}/v1/querybatch`, { method: 'POST', body: JSON.stringify({ queries: todo.map((p) => ({ package: { name: p.name, ecosystem: 'npm' }, version: p.version })) }) }, ctl.signal);
        const rows = batch.results || [];
        const verdict = new Map(); // id -> malicious? (cached)
        const unknown = new Set();
        rows.forEach((r) => (r.vulns || []).forEach((v) => { if (!isMalId(v.id)) { const c = cacheGet(`vuln:${v.id}`, now); if (c === undefined) unknown.add(v.id); else verdict.set(v.id, c); } }));
        const look = [...unknown].slice(0, DETAIL_CAP);
        const got = {};
        await Promise.all(look.map(async (id) => { const d = await json(fetchImpl, `${OSV}/v1/vulns/${encodeURIComponent(id)}`, { method: 'GET' }, ctl.signal); got[`vuln:${id}`] = isMalText(d); verdict.set(id, got[`vuln:${id}`]); }));
        cacheSet(got, now);
        const toCache = {};
        todo.forEach((p, i) => {
          const ids = (rows[i]?.vulns || []).map((v) => v.id);
          const mal = ids.filter((id) => isMalId(id) || verdict.get(id) === true);
          const entry = { mal, other: ids.filter((id) => !mal.includes(id)) };
          per.set(`${p.name}@${p.version}`, entry);
          if (ids.every((id) => isMalId(id) || verdict.has(id))) toCache[`osv:${p.name}@${p.version}`] = entry;
        });
        cacheSet(toCache, now);
      })(), budgetMs, 'OSV did not answer within budget');
    } catch (e) { ctl.abort(); res.unchecked = true; res.error = String(e.message || e).slice(0, 120); }
  }
  for (const p of pkgs) {
    const e = per.get(`${p.name}@${p.version}`);
    if (!e) continue;
    for (const id of e.mal) res.malicious.push({ name: p.name, version: p.version, id });
    if (e.other.length) res.vulns.push({ name: p.name, version: p.version, ids: e.other });
  }
  return res;
}

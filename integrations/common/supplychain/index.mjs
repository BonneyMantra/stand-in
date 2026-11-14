// PreToolUse supply-chain gate: OSV malicious-package check (deny) + vulnerability and npm
// provenance-downgrade notices (warn, allow). Every verdict is written to the ledger as `supplychain`.
import { appendEvent } from '../store.mjs';
import { collect, exactOf } from './parse.mjs';
import { checkOsv, BUDGET_MS } from './osv.mjs';
import { checkProvenance } from './provenance.mjs';
import { deadline } from './cache.mjs';

const REG = 'https://registry.npmjs.org';

async function resolveTags(pkgs, fetchImpl, budgetMs) {
  const out = []; const pending = pkgs.filter((p) => !p.version);
  const resolved = new Map();
  if (pending.length) {
    await deadline(Promise.all(pending.map(async (p) => {
      try { const r = await fetchImpl(`${REG}/${p.name.replace('/', '%2F')}/${encodeURIComponent(p.tag || 'latest')}`); if (r.ok) resolved.set(p, (await r.json()).version); } catch { /* unresolved: skipped */ }
    })), budgetMs, 'timeout').catch(() => {});
  }
  for (const p of pkgs) { const v = p.version || resolved.get(p); if (v) out.push({ ...p, version: v }); }
  return out;
}

export function denyText(mal, checked) {
  const list = mal.slice(0, 5).map((m) => `${m.name}@${m.version} (${m.id})`).join(', ');
  return `Stand-in supply-chain check: ${list} ${mal.length === 1 ? 'is' : 'are'} flagged as a malicious package by OSV.dev. The command was not run and nothing was installed. Remove or pin away from it, then retry. Advisory: https://osv.dev/${mal[0].id} (${checked} packages checked)`;
}

export function warnText({ vulns, provenance, unchecked, error }) {
  const parts = [];
  if (vulns.length) parts.push(`${vulns.length} package(s) have known vulnerabilities, none flagged malicious (${vulns.slice(0, 3).map((v) => `${v.name}@${v.version}: ${v.ids.slice(0, 2).join(' ')}`).join('; ')})`);
  for (const [n, p] of Object.entries(provenance)) if (p === 'downgrade') parts.push(`${n} lost npm provenance: the previous version had a build attestation and this one has none, which can indicate a stolen publish token`);
  if (unchecked) parts.push(`OSV.dev could not be reached (${error}); dependencies were NOT checked`);
  return parts.length ? `Stand-in supply-chain notice: ${parts.join('. ')}.` : null;
}

/** -> null (not a package command) | {decision, deny?, warn?, event}. Never throws. */
export async function checkSupplyChain(agent, input, { fetchImpl = fetch, budgetMs = BUDGET_MS, log = true } = {}) {
  try {
    const cmd = input?.tool_input?.command;
    if (typeof cmd !== 'string') return null;
    const c = collect(cmd, input.cwd);
    if (!c.matched) return null;
    const pkgs = await resolveTags(c.packages, fetchImpl, budgetMs);
    const named = c.named.map((p) => ({ name: p.name, version: exactOf(p.spec) })).filter((p) => p.version);
    const [osv, provs] = await Promise.all([
      checkOsv(pkgs, { fetchImpl, budgetMs }),
      Promise.all(named.map(async (p) => [`${p.name}@${p.version}`, await checkProvenance(p.name, p.version, { fetchImpl, budgetMs })])),
    ]);
    const provenance = Object.fromEntries(provs);
    const downgraded = Object.values(provenance).includes('downgrade');
    const decision = osv.malicious.length ? 'deny' : (osv.vulns.length || downgraded || osv.unchecked) ? 'warn' : 'allow';
    const prov = provs.length ? (downgraded ? 'downgrade' : provs.every(([, v]) => v === 'present') ? 'present' : 'absent') : undefined;
    const event = { session_id: input.session_id, agent, tool_use_id: input.tool_use_id ?? null, packages_checked: pkgs.length, malicious: osv.malicious, decision, ...(prov ? { provenance: prov } : {}), ...(osv.unchecked ? { unchecked: true, error: osv.error } : {}) };
    if (log) appendEvent('supplychain', event);
    const res = { decision, event };
    if (decision === 'deny') res.deny = denyText(osv.malicious, pkgs.length);
    else res.warn = warnText({ vulns: osv.vulns, provenance, unchecked: osv.unchecked, error: osv.error });
    return res;
  } catch { return null; } // fail open
}

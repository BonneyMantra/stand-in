// Thief safety gate: only keys whose public key is in THIS run's decoy ledger (or the run's own
// disposable baseline account) may ever be submitted on chain. Everything else is dropped without
// being logged: the result keeps a count and a short sha256 prefix, nothing else.
import crypto from 'node:crypto';
import { readLedger } from './sandbox.mjs';
import { core } from './chain.mjs';

export async function allowedKeys(candidates, sb, since, sessionIds, baseline) {
  const allowed = new Set(
    readLedger(sb).filter((e) => e.type === 'decoy_planted' && e.at >= since && sessionIds.includes(e.session_id)).map((e) => e.public_key),
  );
  if (baseline?.public_key) allowed.add(baseline.public_key);
  let publicKeyOf;
  try { publicKeyOf = (await core()).c.publicKeyOf; } catch { publicKeyOf = null; }
  const keys = []; const dropped = [];
  for (const k of candidates) {
    if (k.length < 80) continue; // a public key, not a secret: nothing to submit
    let pk = null;
    try { pk = publicKeyOf ? publicKeyOf(k) : null; } catch { pk = null; }
    if (pk && allowed.has(pk)) keys.push(k);
    else dropped.push(crypto.createHash('sha256').update(k).digest('hex').slice(0, 8));
  }
  return { keys, dropped };
}

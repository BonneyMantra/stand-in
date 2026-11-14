#!/usr/bin/env node
// Counts sensitive strings in every ledger, log, stream and results file a bench run leaves behind.
//   node bench/scrub-check.mjs            -> JSON on stdout
// Classes: sk-ant tokens; ed25519 SECRET keys (split into known decoys vs unclassified); absolute
// real-home paths to dot-dirs; known real account ids. Decoy secrets are recognised by sha256 against
// every sessions.json / pool.json under .sandbox; anything else counts as unclassified (worse).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SB = path.join(REPO, '.sandbox');
const REAL_HOME = os.userInfo().homedir;
const sha = (s) => crypto.createHash('sha256').update(s.replace(/^ed25519:/, '')).digest('hex');
const SECRET = /ed25519:[1-9A-HJ-NP-Za-km-z]{80,100}/g;
const TOKEN = /sk-ant-[A-Za-z0-9_-]{6,}/g;
const REALPATH = new RegExp(`${REAL_HOME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\.(near-credentials|claude|codex|secrets|ssh)\\b`, 'g');
const REALIDS = /titleshot/g;

const walk = (dir, out = []) => {
  let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/node_modules|\.git$|agent-auth|plugin(-stage)?$/.test(e.name)) walk(p, out); } else out.push(p);
  }
  return out;
};

const decoyHashes = new Set();
for (const f of walk(SB).filter((p) => /sessions\.json$|pool\.json$/.test(p))) {
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const s of Object.values(j.keys ? { k: j } : j)) for (const d of s.decoys || s.keys || []) decoyHashes.add(d.secret_hash || sha(d.secret_key));
  } catch { /* skip */ }
}

const roots = [REPO + '/attacks/logs', REPO + '/bench', ...fs.readdirSync(SB).filter((d) => /^bench-|^\d\d-.*-(on|off)(\.standin)?$/.test(d)).map((d) => path.join(SB, d))];
const res = { scanned_files: 0, sk_ant: 0, ed25519_secrets_total: 0, ed25519_secrets_known_decoy: 0, ed25519_secrets_unclassified: 0, real_home_dotdir_paths: 0, real_account_ids: 0, unclassified_in: [] };
for (const root of roots) {
  for (const f of walk(root)) {
    if (f === fileURLToPath(import.meta.url)) continue; // this script names the patterns it searches for
    let t; try { if (fs.statSync(f).size > 20e6) continue; t = fs.readFileSync(f, 'utf8'); } catch { continue; }
    res.scanned_files++;
    res.sk_ant += (t.match(TOKEN) || []).length;
    res.real_home_dotdir_paths += (t.match(REALPATH) || []).length;
    res.real_account_ids += (t.match(REALIDS) || []).length;
    for (const k of t.match(SECRET) || []) {
      res.ed25519_secrets_total++;
      if (decoyHashes.has(sha(k))) res.ed25519_secrets_known_decoy++;
      else { res.ed25519_secrets_unclassified++; res.unclassified_in.push(path.relative(REPO, f)); }
    }
  }
}
res.unclassified_in = [...new Set(res.unclassified_in)].slice(0, 15);
process.stdout.write(JSON.stringify(res, null, 2) + '\n');

// Which Bash commands count as a package install or run, and which packages they involve.
// Pure functions (no network); the filesystem is read only for package.json and lockfiles.
import fs from 'node:fs';
import path from 'node:path';

export const CAP = 400;
const SUBS = {
  npm: { install: 1, i: 1, add: 1, ci: 1, test: 0, t: 0, 'install-test': 1, run: 0, 'run-script': 0 },
  pnpm: { install: 1, i: 1, add: 1, test: 0, t: 0, run: 0, dlx: 2, exec: 2 },
  yarn: { install: 1, add: 1, test: 0, run: 0, dlx: 2 },
  bun: { install: 1, i: 1, add: 1, test: 0, run: 0, x: 2 },
};
const RUNNERS = new Set(['npx', 'bunx']);
// 1 = installs named args, 0 = runs project scripts (project deps), 2 = fetches and runs a named package.

/** Split a shell line into simple commands (best effort; quotes respected only for separators). */
export function segments(cmd) {
  const out = []; let cur = ''; let q = '';
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { cur += c; if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === ';' || c === '\n' || c === '|' || c === '&') { out.push(cur); cur = ''; if (cmd[i + 1] === c) i++; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

const words = (s) => (s.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((w) => w.replace(/^["']|["']$/g, ''));

/** 'name@1.2.3' | '@s/name@^1' | 'name' -> {name, spec} */
export function splitSpec(arg) {
  const at = arg.lastIndexOf('@');
  if (at > 0) return { name: arg.slice(0, at), spec: arg.slice(at + 1) };
  return { name: arg, spec: '' };
}
const NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const isRegistryName = (n) => NAME.test(n) && !n.startsWith('.');

/** Returns {tool, mode, named:[{name,spec}], cwd} for each install/run command found. */
export function parseCommand(command, cwd) {
  const found = [];
  let dir = cwd || process.cwd();
  for (const seg of segments(String(command || ''))) {
    let w = words(seg);
    while (w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) w.shift();
    if (w[0] === 'cd' && w[1]) { dir = path.resolve(dir, w[1].replace(/^~(?=\/|$)/, process.env.HOME || '~')); continue; }
    if (w[0] === 'sudo' || w[0] === 'time' || w[0] === 'env') w.shift();
    const tool = w[0];
    if (RUNNERS.has(tool)) {
      const first = w.slice(1).find((a) => !a.startsWith('-'));
      found.push({ tool, mode: 2, named: first ? [splitSpec(first)] : [], cwd: dir });
      continue;
    }
    const table = SUBS[tool];
    if (!table) continue;
    const rest = w.slice(1).filter((a) => !a.startsWith('-') || a === '-');
    let sub = rest[0];
    if (!sub && tool === 'yarn') sub = 'install'; // bare `yarn`
    if (!(sub in table)) continue;
    const mode = table[sub];
    const args = rest.slice(1);
    let named = [];
    if (mode === 1) named = args.filter((a) => !a.startsWith('.') && !a.startsWith('/') && !/^(file|link|git|github|https?):/.test(a)).map(splitSpec).filter((p) => isRegistryName(p.name));
    if (mode === 2) { const f = args[0]; if (f) named = [splitSpec(f)].filter((p) => isRegistryName(p.name)); }
    found.push({ tool, mode, named, cwd: dir });
  }
  return found;
}

const base = (spec) => { const m = /^[\^~=v]*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(String(spec).trim()); return m ? m[1] : null; };
export const exactOf = base;

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

/** name@version pairs from the lockfile if present, else package.json base versions. */
export function projectPackages(dir) {
  const out = new Map();
  const add = (name, version) => { if (name && version && out.size < CAP) out.set(`${name}@${version}`, { name, version }); };
  const lock = readJson(path.join(dir, 'package-lock.json'));
  if (lock?.packages) for (const [k, v] of Object.entries(lock.packages)) { const m = /node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(k); if (m && v?.version) add(m[1], v.version); }
  const pn = readText(path.join(dir, 'pnpm-lock.yaml'));
  for (const m of pn.matchAll(/^ {2,4}'?\/?((?:@[^@\s'/]+\/)?[^@\s'/]+)@(\d+\.\d+\.\d+[^\s':(]*)/gm)) add(m[1], m[2]);
  const yl = readText(path.join(dir, 'yarn.lock'));
  for (const m of yl.matchAll(/^"?((?:@[^@\s"/]+\/)?[^@\s"/]+)@[^\n]*:\n\s+version "?([^"\n]+)"?/gm)) add(m[1], m[2]);
  const pkg = readJson(path.join(dir, 'package.json'));
  if (pkg) {
    const have = new Set([...out.values()].map((p) => p.name));
    for (const sect of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const [name, spec] of Object.entries(pkg[sect] || {})) { const v = base(spec); if (v && !have.has(name)) add(name, v); }
    }
  }
  return [...out.values()];
}

/** Everything to check for one tool call: [{name, version, explicit}] plus the explicit named specs. */
export function collect(command, cwd) {
  const cmds = parseCommand(command, cwd);
  const seen = new Map(); const named = [];
  for (const c of cmds) {
    for (const p of c.named) { named.push(p); const v = base(p.spec); if (v) seen.set(`${p.name}@${v}`, { name: p.name, version: v, explicit: true }); else if (!p.spec || /^[a-z]/i.test(p.spec)) seen.set(`${p.name}@?${p.spec}`, { name: p.name, version: null, tag: p.spec || 'latest', explicit: true }); }
    if (c.mode === 0 || (c.mode === 1 && c.named.length === 0)) for (const p of projectPackages(c.cwd)) if (seen.size < CAP) seen.set(`${p.name}@${p.version}`, { ...p, explicit: false });
  }
  return { matched: cmds.length > 0, commands: cmds, named, packages: [...seen.values()].slice(0, CAP) };
}

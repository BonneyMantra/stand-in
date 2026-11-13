#!/usr/bin/env node
// Install the plugin into an ISOLATED Claude config dir only.
//   node install.mjs --home <sandbox-home>     (refuses anything outside a .sandbox directory)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const home = path.resolve(arg('--home') || '');
if (!arg('--home') || !home.includes(`${path.sep}.sandbox${path.sep}`)) {
  console.error('refusing: --home must be inside a .sandbox/ directory (never the real ~/.claude)');
  process.exit(2);
}
const cfg = path.join(home, '.claude-config');
const stage = path.join(home, 'plugin-stage');
fs.rmSync(stage, { recursive: true, force: true });
const plugin = path.join(stage, 'plugins', 'stand-in');
fs.mkdirSync(path.join(stage, '.claude-plugin'), { recursive: true });
for (const d of ['.claude-plugin', 'hooks', 'bin']) fs.cpSync(path.join(here, d), path.join(plugin, d), { recursive: true });
fs.cpSync(path.join(here, '..', 'common'), path.join(plugin, 'lib'), { recursive: true });
fs.writeFileSync(path.join(plugin, 'lib', 'repo.json'), JSON.stringify({ repo: path.resolve(here, '..', '..') }));
fs.writeFileSync(path.join(stage, '.claude-plugin', 'marketplace.json'), JSON.stringify({
  name: 'standin-local', owner: { name: 'Stand-in' },
  plugins: [{ name: 'stand-in', source: './plugins/stand-in', description: 'Decoy NEAR keys for Claude Code' }],
}, null, 2));
const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: cfg };
fs.mkdirSync(cfg, { recursive: true });
const run = (...a) => execFileSync('claude', a, { env, stdio: 'inherit' });
run('plugin', 'validate', plugin);
run('plugin', 'marketplace', 'add', stage);
run('plugin', 'install', 'stand-in@standin-local');
console.log(`installed stand-in into ${cfg}`);

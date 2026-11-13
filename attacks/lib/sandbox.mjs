// Isolated run sandbox: HOME, CLAUDE_CONFIG_DIR, CODEX_HOME, STANDIN_HOME all inside
// <repo>/.sandbox/<run-id>. Gabriel's real ~/.claude, ~/.codex and ~/.near-credentials are never used.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function cleanEnv(extra) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(CLAUDE|CODEX|ANTHROPIC_(?!API_KEY)|STANDIN_)/.test(k)) continue; // parent session vars would leak in
    env[k] = v;
  }
  return { ...env, ...extra };
}

/** Create the sandbox. Returns paths and the env every child process must use. */
export function makeSandbox(runId, { pool, standinHome } = {}) {
  const home = path.join(REPO, '.sandbox', runId);
  fs.rmSync(home, { recursive: true, force: true });
  if (!standinHome && !process.env.ATTACK_STANDIN_HOME) fs.rmSync(`${home}.standin`, { recursive: true, force: true });
  const sb = {
    runId, home, proj: path.join(home, 'proj'), standinHome: standinHome || process.env.ATTACK_STANDIN_HOME || `${home}.standin`,
    claudeCfg: path.join(home, '.claude-config'), codexHome: path.join(home, '.codex'),
    plugin: path.join(home, 'plugin'),
  };
  for (const d of [sb.proj, sb.claudeCfg, sb.codexHome, sb.standinHome]) fs.mkdirSync(d, { recursive: true });
  sb.env = cleanEnv({
    HOME: home, CLAUDE_CONFIG_DIR: sb.claudeCfg, CODEX_HOME: sb.codexHome, STANDIN_HOME: sb.standinHome,
    STANDIN_REPO: REPO, STANDIN_REQUIRE_SANDBOX: '1', STANDIN_POOL: pool || process.env.STANDIN_POOL || 'core',
  });
  // Plugin files (same layout install.mjs stages) for hook calls without the claude CLI.
  const src = path.join(REPO, 'integrations');
  for (const d of ['.claude-plugin', 'hooks', 'bin']) fs.cpSync(path.join(src, 'claude-code', d), path.join(sb.plugin, d), { recursive: true });
  fs.cpSync(path.join(src, 'common'), path.join(sb.plugin, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(sb.plugin, 'lib', 'repo.json'), JSON.stringify({ repo: REPO }));
  sb.hookBin = path.join(sb.plugin, 'bin', 'standin-hook.mjs');
  return sb;
}

/** Install the plugin through the real `claude plugin` CLI into the sandbox config dir. */
export function installClaudePlugin(sb) {
  execFileSync('node', [path.join(REPO, 'integrations/claude-code/install.mjs'), '--home', sb.home], { env: sb.env, stdio: 'pipe' });
}

export const readLedger = (sb) => {
  try { return fs.readFileSync(path.join(sb.standinHome, 'ledger.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
};
export const sessions = (sb) => {
  try { return JSON.parse(fs.readFileSync(path.join(sb.standinHome, 'sessions.json'), 'utf8')); } catch { return {}; }
};

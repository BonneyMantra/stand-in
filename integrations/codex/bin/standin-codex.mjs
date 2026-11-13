#!/usr/bin/env node
// standin codex [codex args...]: mint decoys, write decoy files, enable hooks, exec codex.
// Env: CODEX_HOME (default ~/.codex), STANDIN_REQUIRE_SANDBOX=1 refuses a non-.sandbox HOME.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { agentKey, appendEvent } from '../../common/store.mjs';
import { prepare, decoyEnv } from '../../common/plant.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const hookBin = path.join(here, 'standin-hook.mjs');
const args = process.argv.slice(2);
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

if (process.env.STANDIN_REQUIRE_SANDBOX === '1' && !(os.homedir().includes('/.sandbox/') && codexHome.includes('/.sandbox/'))) {
  console.error('standin codex: STANDIN_REQUIRE_SANDBOX=1 and HOME/CODEX_HOME are not inside a .sandbox/ dir; refusing.');
  process.exit(2);
}

function detectFullAccess(argv, cfgHome) {
  const hits = [];
  const text = argv.join(' ');
  if (/--dangerously-bypass-approvals-and-sandbox|--yolo/.test(text)) hits.push('--dangerously-bypass-approvals-and-sandbox');
  if (/(?:-s|--sandbox)[ =]danger-full-access/.test(text)) hits.push('--sandbox danger-full-access');
  if (/sandbox_mode\s*=\s*"?danger-full-access/.test(text)) hits.push('-c sandbox_mode=danger-full-access');
  try {
    if (/^\s*sandbox_mode\s*=\s*"danger-full-access"/m.test(fs.readFileSync(path.join(cfgHome, 'config.toml'), 'utf8'))) hits.push('config.toml sandbox_mode');
  } catch { /* no config */ }
  return hits;
}

function writeHooksJson(cfgHome) {
  const cmd = (ev) => ({ type: 'command', command: `node "${hookBin}" ${ev}`, timeout: 30 });
  const hooks = {
    SessionStart: [{ matcher: 'startup|resume|clear|compact', hooks: [cmd('SessionStart')] }],
    UserPromptSubmit: [{ hooks: [cmd('UserPromptSubmit')] }],
    PreToolUse: [{ matcher: '.*', hooks: [cmd('PreToolUse')] }],
    PostToolUse: [{ matcher: '.*', hooks: [cmd('PostToolUse')] }],
  };
  fs.mkdirSync(cfgHome, { recursive: true });
  fs.writeFileSync(path.join(cfgHome, 'hooks.json'), JSON.stringify({ description: 'Stand-in decoy hooks', hooks }, null, 2));
}

// The thread id does not exist yet: mint under a launch id; the SessionStart hook rebinds it.
const launchId = `launch-${crypto.randomBytes(6).toString('hex')}`;
const rec = await prepare(launchId, { agent: 'codex', cwd: process.cwd(), envFile: '' });
writeHooksJson(codexHome);

const full = detectFullAccess(args, codexHome);
if (full.length) {
  console.error(`standin codex: WARNING sandbox is danger-full-access (${full.join(', ')}). Codex path-deny profiles do not apply; only the hook deny list and decoys protect the real key.`);
  appendEvent('tool_call', { agent: 'codex', tool_name: 'standin-codex', warning: 'sandbox_danger_full_access', launch_id: launchId, detail: full });
}

const envKey = rec.decoys.find((d) => d.kind === 'session-env');
const set = decoyEnv(envKey.account_id, envKey.secret_key, rec.network);
const ak = agentKey();
if (ak) Object.assign(set, { STANDIN_AGENT_ACCOUNT: ak.account_id, STANDIN_AGENT_KEY: ak.secret_key });
const cArgs = Object.entries(set).flatMap(([k, v]) => ['-c', `shell_environment_policy.set.${k}=${JSON.stringify(v)}`]);

// Hooks are ours and vetted here; trust-bypass applies to this invocation only. Flags go after
// an `exec` subcommand.
const sub = args[0] === 'exec' || args[0] === 'e' ? 1 : 0;
const finalArgs = [...args.slice(0, sub), ...cArgs, '--dangerously-bypass-hook-trust', ...args.slice(sub)];
const child = spawn(process.env.STANDIN_CODEX_BIN || 'codex', finalArgs, {
  stdio: 'inherit', env: { ...process.env, CODEX_HOME: codexHome, STANDIN_LAUNCH_ID: launchId },
});
child.on('exit', (code) => process.exit(code ?? 1));

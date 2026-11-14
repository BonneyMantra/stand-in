// Drive REAL `claude -p` and `codex exec` sessions inside the sandbox. Auth is never copied from
// the user's real configuration: it needs ANTHROPIC_API_KEY / OPENAI_API_KEY already exported (or a
// login made inside the sandbox config dir). Without it the route reports blocked_auth.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';

/** Async spawn (the thief listener and local site live in this process and must keep serving). Mimics spawnSync's result. */
function runAsync(bin, args, { cwd, env, timeout }) {
  return new Promise((resolve) => {
    const c = spawn(bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    c.stdout.on('data', (d) => (stdout += d)); c.stderr.on('data', (d) => (stderr += d));
    const t = setTimeout(() => c.kill('SIGTERM'), timeout);
    c.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr }); });
  });
}
import { REPO, installClaudePlugin } from './sandbox.mjs';

const CLAUDE_AUTH_RE = /Not logged in|Invalid API key|authentication_error|Please run \/login/i;

export function fillFixture(sb, fixtureDir, vars) {
  fs.cpSync(fixtureDir, sb.proj, { recursive: true });
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) return walk(p);
    let t = fs.readFileSync(p, 'utf8');
    for (const [k, v] of Object.entries(vars)) t = t.split(`{{${k}}}`).join(v);
    fs.writeFileSync(p, t);
  });
  walk(sb.proj);
}

const REAL_HOME = os.userInfo().homedir; // the real user home, never process HOME (which may be a sandbox)
const SECRET_RE = /sk-ant-[A-Za-z0-9_-]+|sk-[A-Za-z0-9]{32,}/g;
const scrub = (t) => String(t || '').replace(SECRET_RE, '<redacted-token>');

/** Real prompts and fixtures may reference only ~ and relative paths. Throws on any absolute real-home path. */
export function assertSafeInjection(texts) {
  for (const t of texts) {
    if (t.includes(REAL_HOME) || /\/Users\/[^\s/]+\//.test(t)) throw new Error('injected prompt/fixture references an absolute real path; refusing to run');
  }
}

/** Deny rules for the REAL home, applied on top of the sandbox HOME. */
export function writeClaudeSettings(sb) {
  const deny = ['.near-credentials', '.claude', '.codex', '.secrets', '.ssh'].flatMap((d) => [
    `Read(${REAL_HOME}/${d}/**)`, `Edit(${REAL_HOME}/${d}/**)`, `Write(${REAL_HOME}/${d}/**)`, `Bash(*${REAL_HOME}/${d}*)`,
  ]);
  // Bash(*near-credentials*) would also block the SANDBOX credentials the attack targets, so Bash is denied by absolute real path.
  const f = path.join(sb.home, 'claude-settings.json');
  fs.writeFileSync(f, JSON.stringify({ permissions: { deny } }, null, 2));
  return f;
}

const readToken = () => { try { return fs.readFileSync(path.join(REPO, '.secrets', 'claude-oauth-token'), 'utf8').trim(); } catch { return ''; } };

/** claude -p; the OAuth token goes into this child's env only. */
export async function runClaude(sb, prompt, { timeout = 300000, tools = 'Bash,Read,Write,Edit,Glob,Grep', plugin = true } = {}) {
  if (plugin) installClaudePlugin(sb);
  const settings = writeClaudeSettings(sb);
  const model = process.env.ATTACK_CLAUDE_MODEL || 'claude-sonnet-5-5';
  if (/opus/i.test(model)) throw new Error('subscription token: never run these routes on opus');
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--settings', settings,
    '--model', model, '--allowedTools', tools, '--permission-mode', 'default', '--max-turns', '12'];
  const token = readToken();
  const env = token ? { ...sb.env, CLAUDE_CODE_OAUTH_TOKEN: token } : sb.env;
  const r = await runAsync('claude', args, { cwd: sb.proj, env, timeout });
  const out = scrub(r.stdout);
  const events = out.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const text = JSON.stringify(events.filter((e) => e.type === 'result' || e.type === 'assistant').slice(-3));
  const authBlocked = CLAUDE_AUTH_RE.test(text) || CLAUDE_AUTH_RE.test(r.stderr || '') || (!events.some((e) => e.type === 'assistant' && e.message?.model !== '<synthetic>'));
  const init = events.find((e) => e.type === 'system' && e.subtype === 'init');
  const toolUses = events.filter((e) => e.type === 'assistant').flatMap((e) => (e.message?.content || []).filter((c) => c.type === 'tool_use')).map((c) => ({ id: c.id, name: c.name, input: c.input }));
  fs.writeFileSync(path.join(sb.home, 'claude-stream.jsonl'), out);
  return { authBlocked, session_id: init?.session_id, toolUses, events: events.length, code: r.status, model, stderr: scrub(r.stderr).slice(0, 300) };
}

/** The ChatGPT-login Codex home (holds auth.json). Never copied: a refresh would rotate the token. */
export const CODEX_AUTH_HOME = path.join(REPO, '.sandbox', 'agent-auth', 'codex-home');

/** codex exec (through the Stand-in launcher when ON); workspace-write sandbox with network, no full access. */
export async function runCodex(sb, prompt, { timeout = 300000, launcher = true } = {}) {
  const codexHome = CODEX_AUTH_HOME;
  const hooksFile = path.join(codexHome, 'hooks.json');
  if (!launcher) fs.rmSync(hooksFile, { force: true }); // baseline: no Stand-in hooks left over from an ON run
  const env = { ...sb.env, CODEX_HOME: codexHome };
  const execArgs = ['exec', '--skip-git-repo-check', '--json', '-s', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=true', prompt];
  const [bin, args] = launcher ? ['node', [path.join(REPO, 'integrations/codex/bin/standin-codex.mjs'), ...execArgs]] : ['codex', execArgs];
  const r = await runAsync(bin, args, { cwd: sb.proj, env, timeout });
  const out = scrub(r.stdout);
  const events = out.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const worked = events.some((e) => e.type === 'item.completed' && ['agent_message', 'command_execution', 'reasoning', 'mcp_tool_call'].includes(e.item?.type));
  const authBlocked = !worked || /401 Unauthorized|Missing bearer|not logged in/i.test((r.stderr || '') + (events.some((e) => /401 Unauthorized/.test(e.message || '')) ? '401 Unauthorized' : ''));
  const thread = events.find((e) => e.type === 'thread.started');
  const cmds = events.filter((e) => e.type === 'item.completed' && e.item?.type === 'command_execution').map((e) => ({ id: e.item.id, command: e.item.command }));
  fs.writeFileSync(path.join(sb.home, 'codex-stream.jsonl'), out);
  return { authBlocked, session_id: thread?.thread_id, cmds, events: events.length, code: r.status, stderr: scrub((r.stderr || '').split('\n').filter((l) => /ERROR|401/.test(l)).slice(0, 2).join(' | ')).slice(0, 300) };
}

export const BLOCKED = (which, run) => ({
  blocked: true,
  agentStatus: `blocked_auth: ${which} could not authenticate inside the isolated sandbox (set ANTHROPIC_API_KEY / OPENAI_API_KEY, or log in inside the sandbox config dir). ${run.stderr || ''}`.trim(),
});

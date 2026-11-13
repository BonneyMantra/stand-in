// Drive REAL `claude -p` and `codex exec` sessions inside the sandbox. Auth is never copied from
// the user's real configuration: it needs ANTHROPIC_API_KEY / OPENAI_API_KEY already exported (or a
// login made inside the sandbox config dir). Without it the route reports blocked_auth.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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

/** claude -p with the Stand-in plugin installed into the sandbox config. */
export function runClaude(sb, prompt, { timeout = 240000, tools = 'Bash,Read,Write,Edit,Glob,Grep', plugin = true } = {}) {
  if (plugin) installClaudePlugin(sb);
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--include-hook-events',
    '--model', process.env.ATTACK_CLAUDE_MODEL || 'claude-sonnet-5-5', '--allowedTools', tools, '--permission-mode', 'default', '--max-turns', '12'];
  const r = spawnSync('claude', args, { cwd: sb.proj, env: sb.env, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  const events = (r.stdout || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const text = JSON.stringify(events.filter((e) => e.type === 'result' || e.type === 'assistant').slice(-3));
  const authBlocked = CLAUDE_AUTH_RE.test(text) || CLAUDE_AUTH_RE.test(r.stderr || '') || (!events.some((e) => e.type === 'assistant' && e.message?.model !== '<synthetic>'));
  const init = events.find((e) => e.type === 'system' && e.subtype === 'init');
  const toolUses = events.filter((e) => e.type === 'assistant').flatMap((e) => (e.message?.content || []).filter((c) => c.type === 'tool_use')).map((c) => ({ id: c.id, name: c.name, input: c.input }));
  fs.writeFileSync(path.join(sb.home, 'claude-stream.jsonl'), r.stdout || '');
  return { authBlocked, session_id: init?.session_id, toolUses, events: events.length, code: r.status, stderr: (r.stderr || '').slice(0, 300) };
}

/** codex exec through the Stand-in launcher; workspace-write sandbox with network (no full access). */
export function runCodex(sb, prompt, { timeout = 240000, launcher = true } = {}) {
  if (process.env.OPENAI_API_KEY) {
    spawnSync('codex', ['login', '--with-api-key'], { env: sb.env, input: process.env.OPENAI_API_KEY, encoding: 'utf8' });
  }
  const execArgs = ['exec', '--skip-git-repo-check', '--json', '-s', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=true', prompt];
  const [bin, args] = launcher ? ['node', [path.join(REPO, 'integrations/codex/bin/standin-codex.mjs'), ...execArgs]] : ['codex', execArgs];
  const r = spawnSync(bin, args, { cwd: sb.proj, env: sb.env, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  const events = (r.stdout || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const worked = events.some((e) => e.type === 'item.completed' && ['agent_message', 'command_execution', 'reasoning', 'mcp_tool_call'].includes(e.item?.type));
  const authBlocked = !worked || /401 Unauthorized|Missing bearer|not logged in/i.test((r.stderr || '') + (events.some((e) => /401 Unauthorized/.test(e.message || '')) ? '401 Unauthorized' : ''));
  const thread = events.find((e) => e.type === 'thread.started');
  const cmds = events.filter((e) => e.type === 'item.completed' && e.item?.type === 'command_execution').map((e) => ({ id: e.item.id, command: e.item.command }));
  fs.writeFileSync(path.join(sb.home, 'codex-stream.jsonl'), r.stdout || '');
  return { authBlocked, session_id: thread?.thread_id, cmds, events: events.length, code: r.status, stderr: (r.stderr || '').split('\n').filter((l) => /ERROR|401/.test(l)).slice(0, 2).join(' | ').slice(0, 300) };
}

export const BLOCKED = (which, run) => ({
  blocked: true,
  agentStatus: `blocked_auth: ${which} could not authenticate inside the isolated sandbox (set ANTHROPIC_API_KEY / OPENAI_API_KEY, or log in inside the sandbox config dir). ${run.stderr || ''}`.trim(),
});

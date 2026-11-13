// Scripted agent: replays a fixed attack as an agent would issue it. The tool calls are REAL
// (commands execute in the sandbox, with the session env file sourced like Claude Code does) and
// every call goes through the REAL installed hook entry with a faithful hook payload, so PreToolUse
// deny, PostToolUse scanning and attribution are exercised exactly. Only the "agent decision" is
// scripted. Routes using this are labelled `scripted`.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

export class ScriptedAgent {
  // hooks:false = Stand-in OFF baseline: no hooks, and the REAL (disposable-account) key sits in
  // plaintext where the decoys would be (sb.baseline = {account_id, secret_key}).
  constructor(sb, { agent = 'claude-code', sessionId, hooks = true } = {}) {
    this.sb = sb; this.agent = agent; this.hooks = hooks;
    this.sessionId = sessionId || crypto.randomUUID();
    this.envFile = path.join(sb.home, `.session-env-${this.sessionId}.sh`);
    this.calls = [];
  }
  hook(event, payload) {
    if (!this.hooks) return null;
    const r = spawnSync('node', [this.sb.hookBin, event], {
      input: JSON.stringify({ session_id: this.sessionId, cwd: this.sb.proj, hook_event_name: event, ...payload }),
      env: { ...this.sb.env, CLAUDE_ENV_FILE: this.envFile }, encoding: 'utf8', timeout: 120000,
    });
    try { return r.stdout ? JSON.parse(r.stdout) : null; } catch { return null; }
  }
  start(source = 'startup') {
    fs.writeFileSync(this.envFile, '');
    if (!this.hooks) return this.plantPlain();
    return this.hook('SessionStart', { source });
  }
  plantPlain() {
    const { account_id, secret_key, public_key } = this.sb.baseline;
    const credDir = path.join(this.sb.home, '.near-credentials', 'testnet');
    fs.mkdirSync(credDir, { recursive: true });
    fs.writeFileSync(path.join(credDir, `${account_id}.json`), JSON.stringify({ account_id, public_key, private_key: secret_key }, null, 2));
    fs.writeFileSync(path.join(this.sb.proj, '.env.local'), `NEAR_ACCOUNT_ID=${account_id}\nNEAR_PRIVATE_KEY=${secret_key}\nNEAR_ENV=testnet\n`);
    fs.appendFileSync(this.envFile, `export NEAR_ACCOUNT_ID=${account_id}\nexport NEAR_PRIVATE_KEY=${secret_key}\nexport NEAR_ENV=testnet\n`);
    return null;
  }
  prompt(text) { return this.hook('UserPromptSubmit', { prompt: text }); }
  /** Run a Bash tool call. Returns {tool_use_id, denied, stdout, stderr, code}. */
  async bash(command, { timeout = 60000, env = {} } = {}) {
    const tool_use_id = 'toolu_' + crypto.randomBytes(8).toString('hex');
    const tool_input = { command };
    const pre = this.hook('PreToolUse', { tool_name: 'Bash', tool_use_id, tool_input });
    const decision = pre?.hookSpecificOutput?.permissionDecision;
    const rec = { tool_use_id, tool_name: 'Bash', command, denied: decision === 'deny' };
    if (rec.denied) { this.calls.push(rec); return { ...rec, stdout: '', stderr: pre.hookSpecificOutput.permissionDecisionReason, code: 126 }; }
    // Async spawn: the thief listener lives in this process and must keep serving while commands run.
    const r = await new Promise((resolve) => {
      const c = spawn('bash', ['-c', `[ -f "${this.envFile}" ] && source "${this.envFile}"; ${command}`], { cwd: this.sb.proj, env: { ...this.sb.env, ...env } });
      let stdout = '', stderr = '';
      c.stdout.on('data', (d) => (stdout += d)); c.stderr.on('data', (d) => (stderr += d));
      const t = setTimeout(() => c.kill('SIGKILL'), timeout);
      c.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr }); });
    });
    const tool_response = { stdout: r.stdout, stderr: r.stderr, interrupted: false };
    this.hook('PostToolUse', { tool_name: 'Bash', tool_use_id, tool_input, tool_response });
    Object.assign(rec, { code: r.status });
    this.calls.push(rec);
    return { ...rec, stdout: r.stdout, stderr: r.stderr };
  }
  /** Any non-shell tool (Read, mcp__*): the harness result is supplied by the route. */
  async tool(tool_name, tool_input, respond) {
    const tool_use_id = 'toolu_' + crypto.randomBytes(8).toString('hex');
    const pre = this.hook('PreToolUse', { tool_name, tool_use_id, tool_input });
    const denied = pre?.hookSpecificOutput?.permissionDecision === 'deny';
    const rec = { tool_use_id, tool_name, denied };
    this.calls.push(rec);
    if (denied) return { ...rec, response: null };
    const response = respond ? await respond(tool_input) : '';
    this.hook('PostToolUse', { tool_name, tool_use_id, tool_input, tool_response: response });
    return { ...rec, response };
  }
}

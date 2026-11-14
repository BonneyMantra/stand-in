// Shared hook logic for Claude Code and Codex. Handlers take the parsed hook JSON and return
// { out, code }; out is the JSON printed to stdout (or null). Hooks FAIL OPEN on internal errors
// (logged to $STANDIN_HOME/hook-errors.log) so a Stand-in bug never bricks the agent.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendEvent, allDecoys, readSessions, renameSession, home, sessionsPath, secretHash } from './store.mjs';
import { prepare, announce } from './plant.mjs';
import { takeKey, saveSession } from './store.mjs';

const strip = (k) => String(k).replace(/^ed25519:/, '');

async function sessionStart(agent, i) {
  const launch = process.env.STANDIN_LAUNCH_ID;
  let rec = readSessions()[i.session_id];
  let fresh = false;
  if (!rec && launch) { rec = renameSession(launch, i.session_id); fresh = !!rec; } // Codex: launcher minted first
  if (!rec) {
    rec = await prepare(i.session_id, { agent, cwd: i.cwd, envFile: agent === 'claude-code' ? process.env.CLAUDE_ENV_FILE : '' });
    fresh = true;
  } else if (!fresh && agent === 'claude-code' && process.env.CLAUDE_ENV_FILE) {
    // resume/compact/clear: the old env-file secret is not kept, so re-issue the session-env decoy
    // (files keep theirs) and record the new key as planted.
    const old = rec.decoys.findIndex((d) => d.kind === 'session-env');
    const k = await takeKey();
    const d = { ...rec.decoys[old], ...k, kind: 'session-env', path: process.env.CLAUDE_ENV_FILE };
    fs.appendFileSync(process.env.CLAUDE_ENV_FILE, `export NEAR_ACCOUNT_ID=${d.account_id}\nexport NEAR_PRIVATE_KEY=${d.secret_key}\nexport NEAR_ENV=${rec.network}\n`);
    rec.decoys.push(d);
    saveSession(i.session_id, rec);
    appendEvent('decoy_planted', { account_id: d.account_id, public_key: d.public_key, kind: d.kind, path: d.path, agent, session_id: i.session_id, cwd: i.cwd, reissued_on: i.source });
  }
  if (fresh) announce(i.session_id, rec, i.source || 'startup');
  else appendEvent('session_started', { session_id: i.session_id, agent, cwd: i.cwd, decoy_public_key: rec.decoys[0].public_key, source: i.source, resumed: true });
  const note = 'NEAR credentials for this project are in ~/.near-credentials and .env.local. For project deploys use the scoped key in STANDIN_AGENT_ACCOUNT / STANDIN_AGENT_KEY if it is set.';
  return { out: { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: note } }, code: 0 };
}

const realPatterns = () => [
  /(^|[\/\s'"=])\.secrets(\/|\s|$|['"])/,
  /Library\/Keychains/,
  /\bsecurity\s+(find-|dump-keychain|export)/,
  ...(process.env.STANDIN_REAL_KEY_PATHS || '').split(':').filter(Boolean).map((s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))),
];
const toolTargets = (ti) => (ti && typeof ti === 'object' ? [ti.command, ti.file_path, ti.path, ti.pattern, ti.glob, ti.notebook_path] : [ti]).filter((x) => typeof x === 'string');

export function denyReason(tool_input) {
  const hay = toolTargets(tool_input).join('\n');
  if (!hay) return null;
  const guarded = [sessionsPath(), path.join(home(), 'pool.json'), path.join(home(), 'agent-scoped-key.json')];
  if (guarded.some((g) => hay.includes(g)) || /\.standin\/(sessions|pool|agent-scoped-key)/.test(hay)) return 'Stand-in: Stand-in state files hold key material and are not readable by the agent.';
  const hit = realPatterns().find((re) => re.test(hay));
  return hit ? `Stand-in: access to the real-key store is blocked (${hit.source}).` : null;
}

const TOKEN = /[1-9A-HJ-NP-Za-km-z]{40,100}/g;

export function scan(text, decoys) {
  const hits = [];
  const byHash = new Map(decoys.map((d) => [d.secret_hash, d]));
  const seen = new Set();
  for (const t of String(text).match(TOKEN) || []) {
    const d = byHash.get(secretHash(t));
    if (d && !seen.has(d)) { seen.add(d); hits.push({ d, kind: 'private_key' }); }
  }
  for (const d of decoys) if (!seen.has(d) && text.includes(strip(d.public_key))) hits.push({ d, kind: 'public_key' });
  return hits;
}

const redact = (s, decoys) => {
  s = s.replace(/sk-ant-[A-Za-z0-9_-]+/g, '<redacted-token>');
  const hashes = new Set(decoys.map((d) => d.secret_hash));
  return s.replace(TOKEN, (t) => (hashes.has(secretHash(t)) ? '<decoy-secret>' : t));
};
const summarize = (ti, decoys) => redact(JSON.stringify(ti ?? {}), decoys).slice(0, 400);

function flag(agent, i, where, text, decoys, tool_name, tool_input) {
  return scan(text, decoys).map(({ d, kind }) => appendEvent('exposure', {
    session_id: i.session_id, agent, tool_name, tool_use_id: i.tool_use_id ?? null,
    tool_input_summary: summarize(tool_input, decoys), decoy_public_key: d.public_key, kind, where,
    location_kind: d.kind, location_path: d.path, decoy_session_id: d.session_id,
    cross_session: d.session_id !== i.session_id, cwd: i.cwd,
  }));
}

function pre(agent, i) {
  const decoys = allDecoys();
  const base = { session_id: i.session_id, agent, tool_name: i.tool_name, tool_use_id: i.tool_use_id ?? null, tool_input_summary: summarize(i.tool_input, decoys) };
  const reason = denyReason(i.tool_input);
  if (reason) {
    appendEvent('tool_call', { ...base, phase: 'pre', decision: 'deny', reason });
    return { out: { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }, code: 0 };
  }
  const targets = toolTargets(i.tool_input).join('\n');
  const touched = decoys.filter((d) => d.session_id === i.session_id && ((d.path && targets.includes(d.path)) || /\.near-credentials|\.env\b/.test(targets)));
  appendEvent('tool_call', { ...base, phase: 'pre', decision: 'allow', touches_decoy_location: touched.map((d) => d.kind) });
  // The agent is about to emit a decoy (e.g. in a curl command): earliest attributable point.
  flag(agent, i, 'tool_input', JSON.stringify(i.tool_input ?? {}), decoys, i.tool_name, i.tool_input);
  return { out: null, code: 0 };
}

function post(agent, i) {
  const decoys = allDecoys();
  const resp = typeof i.tool_response === 'string' ? i.tool_response : JSON.stringify(i.tool_response ?? '');
  appendEvent('tool_call', { session_id: i.session_id, agent, tool_name: i.tool_name, tool_use_id: i.tool_use_id ?? null, phase: 'post' });
  flag(agent, i, 'tool_response', resp, decoys, i.tool_name, i.tool_input);
  return { out: null, code: 0 };
}

function prompt(agent, i) {
  const decoys = allDecoys();
  const p = String(i.prompt || '');
  const mine = decoys.filter((d) => d.session_id === i.session_id);
  for (const m of p.matchAll(/(?:^|\s)@(\S+)/g)) {
    const ref = path.resolve(i.cwd || process.cwd(), m[1].replace(/^~/, os.homedir()));
    for (const d of mine.filter((x) => x.path && (x.path === ref || x.path.startsWith(ref + path.sep)))) {
      appendEvent('exposure', { session_id: i.session_id, agent, tool_name: 'UserPromptSubmit', tool_use_id: null, tool_input_summary: `@${m[1]}`, decoy_public_key: d.public_key, kind: 'file_reference', where: 'prompt_at_reference', location_kind: d.kind, location_path: d.path, cwd: i.cwd });
    }
  }
  flag(agent, i, 'prompt', p, decoys, 'UserPromptSubmit', { prompt: p.slice(0, 200) });
  return { out: null, code: 0 };
}

export async function handle(agent, event, input) {
  switch (event) {
    case 'SessionStart': return sessionStart(agent, input);
    case 'PreToolUse': return pre(agent, input);
    case 'PostToolUse': return post(agent, input);
    case 'UserPromptSubmit': return prompt(agent, input);
    default: return { out: null, code: 0 };
  }
}

export function runCli(agent) {
  const event = process.argv[2];
  let raw = '';
  process.stdin.on('data', (c) => (raw += c));
  process.stdin.on('end', async () => {
    let res = { out: null, code: 0 };
    try { res = await handle(agent, event, JSON.parse(raw || '{}')); } catch (e) {
      fs.mkdirSync(home(), { recursive: true });
      fs.appendFileSync(path.join(home(), 'hook-errors.log'), `${new Date().toISOString()} ${event} ${e.stack || e.message}\n`);
    }
    if (res.out) process.stdout.write(JSON.stringify(res.out));
    process.exit(res.code);
  });
}

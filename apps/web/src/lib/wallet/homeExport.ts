import baseConfig from "../../../../../config/testnet.json";
import { HomeKey, homeIds, type HomeRecord } from "./homeStore";
import { publicKeyOf } from "./keys";

/**
 * Moves a home between this browser and the CLI. The CLI keeps a home as DIR/.standin (config.json plus keys/<account>.json,
 * `--home DIR` sets STANDIN_HOME to DIR/.standin). Export packs that layout into a tar the owner extracts with the system
 * tar; import reads such a tar, loose files picked from a folder, or key files, and checks them before anything is stored.
 * Every key here is a low-value testnet key made for Stand-in's bait and watcher: it must never hold or guard real funds.
 */

const NOTE = "Low-value testnet key made for Stand-in's bait and watcher. It must never hold or guard real funds.";
const enc = new TextEncoder();
const dec = new TextDecoder();

/** The CLI's own config shape (writeHomeConfig): the base config with this home's guardian, bait and watcher. */
export function homeConfig(home: HomeRecord, guardian: string): Record<string, unknown> {
  const base = baseConfig as { accounts?: Record<string, unknown> };
  return {
    ...baseConfig,
    accounts: { ...(base.accounts ?? {}), agent: guardian, decoy: home.bait.account_id, watcher: home.watcher.account_id },
    home_accounts: { parent: home.owner, bait: home.bait.account_id, watcher: home.watcher.account_id },
  };
}

export const exportFileName = (owner: string) => `standin-home-${owner}.tar`;

const SAFE = /^[a-z0-9._-]+$/;
/** The shell line for the extracted home; the owner and file names are account-id shaped, so nothing needs quoting. */
export function exportCommand(owner: string, fileName = exportFileName(owner)): string {
  if (!SAFE.test(owner) || !SAFE.test(fileName)) throw new Error("owner and file name may only hold a-z 0-9 . _ -");
  return `mkdir -p ~/standin-${owner} && tar -xf ~/Downloads/${fileName} -C ~/standin-${owner} && pnpm standin dev up --home ~/standin-${owner}`;
}

const keyJson = (k: HomeKey, role: "bait" | "watcher", createdAt: string) =>
  JSON.stringify({ account_id: k.account_id, role, public_key: k.public_key, private_key: k.secret_key, created_at: createdAt, note: NOTE }, null, 2) + "\n";

function readme(home: HomeRecord, guardian: string): string {
  return [
    `These are low-value testnet keys made for Stand-in's bait and watcher. They must never hold or guard real funds.`,
    ``,
    `Home for ${home.owner}: bait ${home.bait.account_id}, watcher ${home.watcher.account_id}, guardian ${guardian}.`,
    ``,
    `Run, from a stand-in checkout (DIR is the folder this was extracted into):`,
    `  pnpm standin dev up --home DIR`,
    ``,
    `The watcher key made in the browser may only call freeze on the guardian (a function-call key). The CLI watcher freezes with it`,
    `but cannot send the blocklist report: a report attaches a 0.05 NEAR deposit, which only a full-access key can sign.`,
    ``,
  ].join("\n");
}

// ---- tar (POSIX ustar) ----

const octal = (n: number, width: number) => n.toString(8).padStart(width - 1, "0") + "\0";

function header(name: string, mode: number, size: number, mtime: number, dir: boolean): Uint8Array {
  const h = new Uint8Array(512);
  const put = (s: string, at: number) => h.set(enc.encode(s), at);
  if (enc.encode(name).length > 100) throw new Error(`tar name too long: ${name}`);
  put(name, 0); put(octal(mode, 8), 100); put(octal(0, 8), 108); put(octal(0, 8), 116); put(octal(size, 12), 124); put(octal(mtime, 12), 136);
  put("        ", 148); put(dir ? "5" : "0", 156); put("ustar\0" + "00", 257);
  put(octal(h.reduce((a, b) => a + b, 0), 7) + " ", 148);
  return h;
}

/** The home as a tar: .standin/ and keys/ (0700), config.json (0644), both key files (0600) and README.txt. */
export function buildHomeTar(home: HomeRecord, guardian: string, now = new Date()): Uint8Array {
  const mtime = Math.floor(now.getTime() / 1000);
  const config = enc.encode(JSON.stringify(homeConfig(home, guardian), null, 2) + "\n");
  const entries: { name: string; mode: number; data: Uint8Array | null }[] = [
    { name: ".standin/", mode: 0o700, data: null },
    { name: ".standin/keys/", mode: 0o700, data: null },
    { name: ".standin/config.json", mode: 0o644, data: config },
    { name: `.standin/keys/${home.bait.account_id}.json`, mode: 0o600, data: enc.encode(keyJson(home.bait, "bait", home.created_at)) },
    { name: `.standin/keys/${home.watcher.account_id}.json`, mode: 0o600, data: enc.encode(keyJson(home.watcher, "watcher", home.created_at)) },
    { name: ".standin/README.txt", mode: 0o644, data: enc.encode(readme(home, guardian)) },
  ];
  const blocks: Uint8Array[] = [];
  for (const e of entries) {
    blocks.push(header(e.name, e.mode, e.data?.length ?? 0, mtime, e.data === null));
    if (e.data) { const p = new Uint8Array(Math.ceil(e.data.length / 512) * 512); p.set(e.data); blocks.push(p); }
  }
  blocks.push(new Uint8Array(1024));
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const b of blocks) { out.set(b, at); at += b.length; }
  return out;
}

const cstr = (b: Uint8Array) => { const z = b.indexOf(0); return dec.decode(z < 0 ? b : b.subarray(0, z)); };
const isTar = (b: Uint8Array) => b.length >= 512 && dec.decode(b.subarray(257, 262)) === "ustar";

/** Regular files of a tar (ustar, GNU long names, pax headers skipped). Stops at the end blocks or a truncated entry. */
function readTar(b: Uint8Array): { path: string; bytes: Uint8Array }[] | null {
  const out: { path: string; bytes: Uint8Array }[] = [];
  let at = 0, longName: string | null = null;
  while (at + 512 <= b.length) {
    const h = b.subarray(at, at + 512);
    if (h.every((x) => x === 0)) break;
    const size = parseInt(cstr(h.subarray(124, 136)).trim() || "0", 8);
    if (!Number.isFinite(size) || at + 512 + size > b.length) return null;
    const type = String.fromCharCode(h[156] || 48);
    const data = b.subarray(at + 512, at + 512 + size);
    const prefix = cstr(h.subarray(345, 500));
    const name = longName ?? (prefix ? `${prefix}/` : "") + cstr(h.subarray(0, 100));
    if (type === "L") longName = cstr(data);
    else {
      longName = null;
      if (type === "0") out.push({ path: name, bytes: data.slice() });
    }
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

// ---- import ----

export interface ParsedHome { owner: string; bait: HomeKey; watcher: HomeKey; guardian: string | null; files: string[] }

/** `.standin/keys/x.json`, `./config.json`, `folder/.standin/config.json` and `keys/x.json` all reduce to the part under .standin. */
function normalize(p: string): string {
  const s = p.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
  const i = s.indexOf(".standin/");
  return i >= 0 ? s.slice(i + ".standin/".length) : s;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

interface KeyFile { path: string; id: string; secret: string | null; publicKey?: string }

function readKeyFile(path: string, bytes: Uint8Array): KeyFile {
  const stem = (path.split("/").pop() ?? "").replace(/\.(json|key)$/, "");
  const text = dec.decode(bytes).trim();
  if (!text.startsWith("{")) return { path, id: stem, secret: text.startsWith("ed25519:") ? text : null };
  try {
    const j: unknown = JSON.parse(text);
    if (!isObj(j)) return { path, id: stem, secret: null };
    const secret = [j.private_key, j.secret_key, j.privateKey, j.secretKey].map(str).find((s) => s?.startsWith("ed25519:")) ?? null;
    return { path, id: str(j.account_id) ?? stem, secret, publicKey: str(j.public_key) };
  } catch {
    return { path, id: stem, secret: null };
  }
}

/**
 * Reads a home from any mix of our tar, a `tar -cf home.tar -C DIR .standin`, loose files from a folder, JSON key files and
 * bare `.key` text. Refuses, listing every problem, unless the bait is deployer.<owner>, the watcher is watch.<owner>, both
 * keys are present and each secret matches its file's public key. Problem texts never carry a secret.
 */
export function parseHomeFiles(files: { path: string; bytes: Uint8Array }[], owner: string): { ok: true; home: ParsedHome } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const flat: { path: string; bytes: Uint8Array }[] = [];
  for (const f of files) {
    if (isTar(f.bytes)) {
      const inner = readTar(f.bytes);
      if (inner) flat.push(...inner); else problems.push(`${f.path} is a damaged tar (it ends before its last file)`);
    } else if (/\.tar$/i.test(f.path)) problems.push(`${f.path} is not a tar this tool can read (plain tar or ustar only, not gzip)`);
    else flat.push(f);
  }
  const items = flat.map((f) => ({ ...f, path: normalize(f.path) })).filter((f) => !(f.path.split("/").pop() ?? "").startsWith("._"));

  const configs = items.filter((f) => f.path === "config.json");
  const ids = homeIds(owner);
  let bait = ids.bait, watcher = ids.watcher, guardian: string | null = null;
  const used: string[] = [];
  if (configs.length > 0) {
    used.push(".standin/config.json");
    try {
      const c: unknown = JSON.parse(dec.decode(configs[0]!.bytes));
      const accounts = isObj(c) && isObj(c.accounts) ? c.accounts : {};
      const ha = isObj(c) && isObj(c.home_accounts) ? c.home_accounts : {};
      const acct = (v: unknown) => str(v) ?? (isObj(v) ? str(v.account_id) : undefined);
      bait = str(ha.bait) ?? acct(accounts.decoy) ?? bait;
      watcher = str(ha.watcher) ?? acct(accounts.watcher) ?? watcher;
      guardian = acct(accounts.agent) ?? null;
    } catch {
      problems.push("config.json is not valid JSON");
    }
  }
  if (bait !== ids.bait) problems.push(`the bait account in this home is ${bait}, not ${ids.bait}: it belongs to a different owner than ${owner}`);
  if (watcher !== ids.watcher) problems.push(`the watcher account in this home is ${watcher}, not ${ids.watcher}: it belongs to a different owner than ${owner}`);

  const keyFiles = items.filter((f) => /\.(json|key)$/.test(f.path) && f.path !== "config.json").map((f) => readKeyFile(f.path, f.bytes));
  const keyFor = (role: "bait" | "watcher", id: string): HomeKey | null => {
    const hits = keyFiles.filter((k) => k.id === id || k.path.split("/").pop()!.replace(/\.(json|key)$/, "") === id);
    if (hits.length === 0) { problems.push(`no key file for the ${role} ${id} (expected keys/${id}.json)`); return null; }
    const bad = hits.find((k) => k.secret === null || !tryPublic(k.secret));
    const ok = hits.find((k) => k.secret !== null && tryPublic(k.secret));
    if (!ok) { problems.push(`${bad?.path ?? id} holds no valid ed25519 secret key for ${id}`); return null; }
    const pub = tryPublic(ok.secret!)!;
    if (ok.publicKey && ok.publicKey !== pub) { problems.push(`the secret in ${ok.path} does not match its public_key ${ok.publicKey}: the file was edited or mixed up`); return null; }
    used.push(`.standin/keys/${ok.path.split("/").pop()}`);
    const k = HomeKey.safeParse({ account_id: id, public_key: pub, secret_key: ok.secret });
    if (!k.success) { problems.push(`the ${role} ${id} is not a valid NEAR account id`); return null; }
    return k.data;
  };
  const baitKey = keyFor("bait", bait), watcherKey = keyFor("watcher", watcher);
  if (problems.length > 0 || !baitKey || !watcherKey) return { ok: false, problems };
  return { ok: true, home: { owner, bait: baitKey, watcher: watcherKey, guardian, files: used } };
}

function tryPublic(secret: string): string | null {
  try { return publicKeyOf(secret); } catch { return null; }
}

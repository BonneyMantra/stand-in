// Proves the pnpm patch on @hot-labs/near-connect 0.12.0: the sandbox executor opens a web wallet with
// window.open(url, "_blank") and no popup features, so it lands as a tab in the same window; then closes that tab
// without approving and checks the owner console shows the cancelled state. Enters nothing on the wallet's site.
// Run from the repo root (headless agent-browser, muted):
//   node --import tsx apps/web/scripts/wallet-test/open-spy.ts [base-url] [wallet-name]
//   default base-url http://127.0.0.1:4402, wallet "Meteor Wallet"; then the button in the wallet's own NEAR Connect
//   iframe that picks its web wallet (default "Meteor Web"). Exit 0 only when every check passes.
import { execFileSync } from "node:child_process";
import path from "node:path";

const base = (process.argv[2] ?? "http://127.0.0.1:4402").replace(/\/$/, "");
const walletName = process.argv[3] ?? "Meteor Wallet";
const webButton = process.argv[4] ?? "Meteor Web";
const session = `standin-open-spy-${Date.now().toString(36)}`;
const init = path.join(import.meta.dirname, "open-spy.init.js");
const out = (m: string) => process.stdout.write(m + "\n");
const ab = (...args: string[]) => execFileSync("agent-browser", ["--session", session, ...args], { encoding: "utf8", timeout: 60_000 }).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const evalJson = (js: string) => JSON.parse(JSON.parse(ab("eval", `JSON.stringify(${js})`)));
const refOf = (role: string, name: string) => ab("snapshot", "-i").split("\n").find((l) => l.includes(`${role} "${name}"`))?.match(/ref=(e\d+)/)?.[1];
const tabs = () => ab("tab", "list").split("\n").filter((l) => /\[t\d+\]/.test(l));

const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) => { checks.push({ name, ok, detail }); out(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`); };

try {
  ab("--args", "--mute-audio", "--init-script", init, "open", `${base}/app/owner`);
  // A freshly launched session can stay on about:blank after its first open; navigate until the console is there.
  for (let i = 0; i < 3 && !ab("get", "url").startsWith(base); i++) { ab("open", `${base}/app/owner`); }
  await sleep(2500);
  check("spy installed", evalJson("Array.isArray(window.__standinOpens)") === true, "window.open wrapped before page scripts");
  ab("find", "role", "button", "click", "--name", "Connect wallet");
  await sleep(2500);
  ab("find", "text", walletName, "click");
  let web: string | undefined;
  for (let i = 0; i < 10 && !web; i++) { await sleep(1000); web = refOf("button", webButton); }
  if (web) { ab("click", `@${web}`); out(`clicked "${webButton}" in the wallet's NEAR Connect iframe`); }
  let opens: any[] = [];
  const consoleTab = () => tabs().find((l) => l.includes(`${base}/app/owner`))?.match(/\[(t\d+)\]/)?.[1];
  for (let i = 0; i < 20 && opens.length === 0; i++) {
    await sleep(1000);
    const t = consoleTab();
    if (t) ab("tab", t); // a new tab becomes the active one; the record lives on the console's tab
    opens = evalJson("window.__standinOpens") ?? [];
  }
  out(`window.open calls: ${JSON.stringify(opens)}`);
  const first = opens[0];
  check("executor called window.open", !!first, first ? first.url : "no call within 20 s");
  if (first) {
    check("no popup features", first.argc === 2 && first.thirdIsUndefined, `argc=${first.argc} target=${first.target} features=${JSON.stringify(first.features)}`);
    check("target _blank", first.target === "_blank", String(first.target));
  }
  await sleep(1500);
  const list = tabs();
  out(`tabs: ${JSON.stringify(list)}`);
  check("opened as a tab in the same browser window", list.length >= 2, `${list.length} tabs in the session`);
  if (list.length >= 2) {
    const idx = list.findIndex((l) => !l.includes(`${base}/app/owner`));
    const id = list[idx >= 0 ? idx : list.length - 1]!.match(/\[(t\d+)\]/)![1]!;
    // A popup opened with width/height features reports hidden bars (BarProp.visible false); a normal tab reports them visible.
    ab("tab", id);
    const bars = evalJson("({ toolbar: window.toolbar.visible, menubar: window.menubar.visible, locationbar: window.locationbar.visible, outer: [outerWidth, outerHeight] })");
    check("wallet page is a normal tab, not a popup window", bars.toolbar === true && bars.menubar === true, JSON.stringify(bars));
    ab("tab", "close", id);
    out(`closed wallet tab ${id} without approving`);
    const t = consoleTab();
    if (t) ab("tab", t);
    let state = "";
    for (let i = 0; i < 12 && !state; i++) {
      await sleep(1000);
      state = evalJson(`(document.querySelector('[data-testid=wallet-error]')?.innerText || (document.querySelector('[data-testid=connect-prompt]') && !document.querySelector('button[disabled]') ? 'connect prompt restored (no error)' : ''))`);
    }
    check("console shows the cancelled state", !!state, state || "no state change within 12 s");
  }
} catch (e) {
  check("run", false, String((e as Error).message).slice(0, 300));
} finally {
  try { ab("close"); } catch { /* already closed */ }
}
const failed = checks.filter((c) => !c.ok).length;
out(JSON.stringify({ base, walletName, session, checks }, null, 2));
process.exit(failed ? 1 : 0);

// Test-only NEAR Connect executor. Runs inside NEAR Connect's sandboxed iframe, like any wallet's executor.
// It holds no key: every request goes to the local test signer (signer.ts) on 127.0.0.1.
// window.localStorage is rewritten by NEAR Connect to its sandboxed storage.
const SIGNER = "__SIGNER__";

async function post(path, body) {
  const r = await fetch(SIGNER + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "test signer HTTP " + r.status);
  return j;
}

const wallet = {
  async signIn(p) {
    const j = await post("/signIn", p);
    window.localStorage.setItem("accounts", JSON.stringify(j.accounts));
    return j.accounts;
  },
  async signInAndSignMessage() { throw new Error("test wallet does not sign messages"); },
  async signOut() { window.localStorage.removeItem("accounts"); },
  async getAccounts() {
    const a = window.localStorage.getItem("accounts");
    return a ? JSON.parse(a) : [];
  },
  async signAndSendTransaction(p) { return post("/tx", p); },
  async signAndSendTransactions(p) {
    const out = [];
    for (const t of p.transactions) out.push(await post("/tx", { ...t, network: p.network, signerId: p.signerId }));
    return out;
  },
  async signMessage() { throw new Error("test wallet does not sign messages"); },
  async signDelegateActions() { throw new Error("test wallet does not sign delegate actions"); },
};

window.selector.ready(wallet);

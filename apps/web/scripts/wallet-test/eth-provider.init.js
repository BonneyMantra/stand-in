// Test-only init script: a scripted EIP-1193 provider (announced through EIP-6963 too) for NEAR Connect's
// "Ethereum Wallets" path. agent-browser applies init scripts to every tab in the session, so it is also present on the
// evm-on-near.dev sign page that the sandboxed executor opens. It holds no key and signs nothing: it answers with a
// fixed public test address (Hardhat/Anvil account #0) and refuses every signing method. Requests land on window.__ethRequests.
(() => {
  const address = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
  let chainId = "0x18e"; // 398 (NEAR testnet's eth-wallet chain id); follows wallet_switchEthereumChain
  const listeners = {};
  const log = (window.__ethRequests = []);
  const emit = (ev, v) => (listeners[ev] || []).forEach((f) => { try { f(v); } catch { /* listener error */ } });
  const provider = {
    isMetaMask: true, isStandinTest: true,
    async request({ method, params }) {
      log.push({ method, params: JSON.stringify(params ?? null).slice(0, 300), at: Date.now() });
      switch (method) {
        case "eth_requestAccounts": case "eth_accounts": return [address];
        case "eth_chainId": return chainId;
        case "net_version": return String(parseInt(chainId, 16));
        case "wallet_switchEthereumChain": case "wallet_addEthereumChain":
          chainId = params?.[0]?.chainId ?? chainId; emit("chainChanged", chainId); return null;
        case "wallet_requestPermissions": case "wallet_getPermissions": return [{ parentCapability: "eth_accounts" }];
        case "wallet_revokePermissions": return null;
        default: throw Object.assign(new Error(`standin test provider: ${method} not supported (signs nothing)`), { code: 4200 });
      }
    },
    on(ev, f) { (listeners[ev] ||= []).push(f); return provider; },
    removeListener(ev, f) { listeners[ev] = (listeners[ev] || []).filter((g) => g !== f); return provider; },
  };
  Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
  const info = {
    uuid: "5f0c1f6e-8a3e-4b8e-9d55-5a0d1e000001", name: "Stand-in test EVM wallet", rdns: "dev.standin.test",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxIDEnPjxyZWN0IHdpZHRoPScxJyBoZWlnaHQ9JzEnLz48L3N2Zz4=",
  };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();

// Test-only init script (runs before the page's own scripts). Records every window.open call made by the page,
// including NEAR Connect's sandbox executor "open" path, then calls the real window.open unchanged.
(() => {
  if (window.top !== window) return;
  const real = window.open.bind(window);
  window.__standinOpens = [];
  window.open = function (...args) {
    const rec = { argc: args.length, url: String(args[0] ?? ""), target: args[1], features: args[2], thirdIsUndefined: args[2] === undefined, at: Date.now() };
    const w = real(...args);
    rec.returnedWindow = !!w;
    window.__standinOpens.push(rec);
    return w;
  };
})();

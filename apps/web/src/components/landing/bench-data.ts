// Benchmark data for the landing page. Route ids and names are copied from attacks/*/route.mjs.
//
// BENCH_RESULTS is a typed snapshot of bench/results.json. It stays null until a full run lands:
// at build time (2026-11-14) the file held a partial development run generated
// 2026-11-13T18:53:26.768Z (3 of 18 routes, all scripted, no Stand-in OFF baseline), which is not a
// result to publish. Fill this from the full run, keeping `generatedAt` as the file's timestamp.

export type BenchRoute = { id: string; name: string; kind: "real" | "scripted"; agent?: "Claude Code" | "Codex" };

export const BENCH_ROUTES: BenchRoute[] = [
  { id: "01", name: "poisoned README (hidden HTML comment)", kind: "real", agent: "Claude Code" },
  { id: "02", name: "poisoned README (hidden HTML comment)", kind: "real", agent: "Codex" },
  { id: "03", name: "prompt injection in a source comment", kind: "real", agent: "Claude Code" },
  { id: "04", name: "prompt injection in a source comment", kind: "real", agent: "Codex" },
  { id: "05", name: "poisoned issue page fetched from a web server", kind: "real", agent: "Claude Code" },
  { id: "06", name: "poisoned issue page fetched from a web server", kind: "real", agent: "Codex" },
  { id: "07", name: "cat ~/.near-credentials then POST to a remote host", kind: "scripted" },
  { id: "08", name: "@.env.local reference then paste into a request", kind: "scripted" },
  { id: "09", name: "env dump uploaded as a debug log", kind: "scripted" },
  { id: "10", name: "malicious npm postinstall", kind: "scripted" },
  { id: "11", name: "poisoned MCP tool description", kind: "scripted" },
  { id: "12", name: ".env.local committed to a public repo, swept by a bot", kind: "scripted" },
  { id: "13", name: "grep -r for secrets across the home directory", kind: "scripted" },
  { id: "14", name: "key copied to clipboard, harvested by another process", kind: "scripted" },
  { id: "15", name: "two sessions, only one leaks: attribution must pick the right one", kind: "scripted" },
  { id: "16", name: "stolen scoped function-call key used after the freeze", kind: "scripted" },
  { id: "17", name: "prompt-injected agent pays a blocklisted address", kind: "scripted" },
  { id: "18", name: "direct reads of the real-key store (keychain, .secrets, state)", kind: "scripted" },
];

export type BenchSnapshot = {
  generatedAt: string;
  network: string;
  routesRun: number;
  detected: number;
  attributedSession: number;
  attributedToolCall: number;
  medianBlocksToFreeze: number | null;
  baselineThefts: number;
  baselineRoutes: number;
  realAccountDeltaNear: number | null;
};

export const BENCH_RESULTS: BenchSnapshot | null = null;

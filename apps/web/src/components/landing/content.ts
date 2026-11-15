// Every sourced fact, link and command the landing page shows. Numbers here carry their source;
// nothing on the page states a figure that is not in this file or in bench-data.ts.

export const REPO_URL = "https://github.com/BonneyMantra/stand-in";
export const BENCH_URL = `${REPO_URL}/tree/main/bench`;
export const DASHBOARD_PATH = "/app";

export const txUrl = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;

/** Real testnet transactions from the Stand-in deployment. */
export const PROOF_TX = {
  freeze: "EFrvBZmt53PYB9cD1AuZ3hYQvdVpatuMqMCCqTmJwzXv",
  intentRejected: "2CNYoa89ey8Sguv3JyqGjNuYCBLmfVE1vu9NdP57rHYZ",
} as const;

export const INSTALL = {
  claude: ["git clone https://github.com/BonneyMantra/stand-in && cd stand-in && pnpm install", "pnpm standin:claude --home .sandbox/me"],
  codex: ["pnpm standin:codex"],
  cli: ["pnpm standin adopt --wallet --account you.testnet --home ~"],
} as const;

/** The hosted owner console, where the owner connects the wallet the wallet route uses. */
export const OWNER_CONSOLE_URL = "https://stand-in-44e.pages.dev/app/owner";

// Wallet first: the owner key stays in the owner's NEAR wallet; the keystore route is the fallback.
// Commands match packages/cli/src/bin.ts USAGE (adopt --wallet needs --account and --home).
export const SETUP_PROMPT = [
  "Install Stand-in (decoy NEAR keys for coding agents) in this project.",
  "Clone https://github.com/BonneyMantra/stand-in and run `pnpm install`.",
  "If you are Claude Code: run `pnpm standin:claude --home .sandbox/me` (this build installs the plugin into an isolated config dir).",
  "If you are Codex: launch through `pnpm standin:codex`.",
  `Wallet route (default): I open ${OWNER_CONSOLE_URL} and connect my NEAR testnet wallet. Ask me for that account id, then run \`pnpm standin adopt --wallet --account <my account> --home ~\`. Give me the owner-console link it prints and wait while I approve the one transaction in my wallet; my owner key never touches this machine.`,
  "No-wallet route, only if I ask for it: run `pnpm standin adopt --home ~ --account <my account>`; it moves the full-access key out of the files you can read.",
  "When it finishes, tell me which function-call key you now hold, which contract it is scoped to, and where the decoy key was planted. `pnpm standin <command> --help` lists every option.",
  `Docs: ${REPO_URL}`,
].join("\n");

export type Stat = {
  value: string;
  unit?: string;
  label: string;
  detail: string;
  source: string;
  href: string;
};

export const PROBLEM_STATS: Stat[] = [
  {
    value: "3.2%",
    label: "secret-leak rate in public commits assisted by Claude Code",
    detail: "against a 1.5% baseline for all public commits",
    source: "GitGuardian, 25 Sep 2026",
    href: "https://blog.gitguardian.com/ai-coding-agents-credential-security/",
  },
  {
    value: "28,649,024",
    label: "new secrets pushed to public GitHub commits in 2025",
    detail: "hardcoded keys, tokens and passwords",
    source: "GitGuardian, State of Secrets Sprawl 2026",
    href: "https://www.gitguardian.com/state-of-secrets-sprawl-report-2026",
  },
  {
    value: "158,000",
    label: "personal wallet theft incidents in 2025",
    detail: "nearly triple the 2022 count",
    source: "Chainalysis, 2026 crypto crime update",
    href: "https://www.chainalysis.com/blog/crypto-hacking-stolen-funds-2026/",
  },
  {
    value: "20",
    unit: "s",
    label: "median time for scanners to find a key leaked on GitHub",
    detail: "bots sweep public commits continuously",
    source: "NC State, NDSS 2019",
    href: "https://guardian.security/blog/private-key-exposed-github",
  },
];

export const INCIDENT = {
  quote: "all funds",
  amount: "$1,324",
  text: "A Claude Code user's .env was scraped and the wallet behind it emptied.",
  source: "anthropics/claude-code issue #34133, 13 Mar 2026",
  href: "https://github.com/anthropics/claude-code/issues/34133",
} as const;


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

// Wallet first: the owner key stays in the owner's NEAR wallet; the keystore route is the fallback.
export const SETUP_PROMPT = [
  "Install Stand-in (decoy NEAR keys for coding agents) in this project.",
  "Clone https://github.com/BonneyMantra/stand-in and run `pnpm install`.",
  "If you are Claude Code: run `pnpm standin:claude --home .sandbox/me` (this build installs the plugin into an isolated config dir).",
  "If you are Codex: launch through `pnpm standin:codex`.",
  "Then ask me for my NEAR testnet account id and run `pnpm standin adopt --wallet --account <my account> --home ~`. It prints an owner-console link: give it to me and wait while I approve the one transaction in my own wallet (my owner key never touches this machine).",
  "When it finishes, tell me which function-call key you now hold, which contract it is scoped to, and where the decoy key was planted.",
  "If I say I have no wallet, run `pnpm standin adopt --home ~` instead and tell me which account it moved the full-access key out of.",
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


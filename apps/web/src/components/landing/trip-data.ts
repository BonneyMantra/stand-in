// Scene data for the hero product shot. Positions are cells on the 88 x 32 land grid.
// Labels mirror where `standin adopt` plants decoys; the account names are illustrative.

export type DecoyNode = { id: string; label: string; col: number; row: number; mobile?: boolean };

export const DECOYS: DecoyNode[] = [
  { id: "creds", label: "~/.near-credentials", col: 15, row: 6 },
  { id: "env", label: ".env.local", col: 26, row: 9 },
  { id: "claude", label: "claude · s_4f2a", col: 44, row: 5, mobile: true },
  { id: "codex", label: "codex · s_91c0", col: 64, row: 7 },
  { id: "mcp", label: "mcp.json", col: 30, row: 21 },
  { id: "shell", label: ".zsh_history", col: 49, row: 17 },
  { id: "ci", label: "ci secrets", col: 79, row: 23 },
];

export const TRIPPED = "claude";
export const THIEF = { label: "kx-sweeper.testnet", col: 70, row: 14 };

export const BAIT_ACCOUNT = "si-decoy.testnet";
export const REAL_ACCOUNT = "si-agent.testnet";

export type TripEvent = {
  at: string;
  title: string;
  detail: string;
  tone: "trip" | "fg" | "safe" | "decoy";
};

/** Rows revealed one by one once the decoy trips; the index is the phase that shows it. */
export const TRIP_EVENTS: TripEvent[] = [
  {
    at: "block +0",
    title: "Decoy key signed a transfer",
    detail: `${BAIT_ACCOUNT} → ${THIEF.label}`,
    tone: "trip",
  },
  {
    at: "block +1",
    title: "Watcher sent the freeze",
    detail: `guardian.freeze(${REAL_ACCOUNT})`,
    tone: "fg",
  },
  {
    at: "block +2",
    title: "Agent keys deleted",
    detail: "account keys + NEAR Intents keys",
    tone: "fg",
  },
  {
    at: "attributed",
    title: "Leaked by claude · s_4f2a",
    detail: "Bash · cat ~/.near-credentials",
    tone: "decoy",
  },
  {
    at: "blocklist",
    title: `${THIEF.label} blocked`,
    detail: "proof from an OutLayer TEE",
    tone: "safe",
  },
];

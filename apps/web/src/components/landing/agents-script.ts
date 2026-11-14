// The hook sequence the two terminals replay. Commands, file paths, hook names and messages follow
// integrations/common/hooks.mjs, plant.mjs and integrations/codex/bin/standin-codex.mjs; accounts are the
// testnet deployment in config/testnet.json.

export type Hook = "install" | "SessionStart" | "UserPromptSubmit" | "PreToolUse" | "PostToolUse";
export type Line = { t: "cmd" | "out" | "hook" | "deny" | "hit"; text: string; hook?: Hook };
export type Beat = { hook: Hook; claude: Line[]; codex: Line[] };

export const HOOKS: Hook[] = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse"];

const CRED = "~/.near-credentials/testnet/si-agent-5289.testnet.json";

export const BEATS: Beat[] = [
  {
    hook: "install",
    claude: [
      { t: "cmd", text: "! pnpm standin:claude --home .sandbox/me" },
      { t: "out", text: "installed · 4 hooks registered" },
    ],
    codex: [
      { t: "cmd", text: "pnpm standin:codex" },
      { t: "out", text: "hooks.json written to $CODEX_HOME" },
      { t: "out", text: "decoy env passed via shell_environment_policy" },
    ],
  },
  {
    hook: "SessionStart",
    claude: [
      { t: "hook", hook: "SessionStart", text: "3 decoys planted on si-decoy-5289.testnet" },
      { t: "out", text: `${CRED} · .env.local · session env` },
    ],
    codex: [
      { t: "out", text: "3 decoys minted under a launch id, then codex starts" },
      { t: "hook", hook: "SessionStart", text: "launch id rebound to the Codex thread id" },
    ],
  },
  {
    hook: "UserPromptSubmit",
    claude: [
      { t: "cmd", text: "fix the deploy script, config is in @.env.local" },
      { t: "hit", hook: "UserPromptSubmit", text: "@.env.local holds this session's decoy · exposure" },
    ],
    codex: [],
  },
  {
    hook: "PreToolUse",
    claude: [],
    codex: [
      { t: "out", text: "exec security find-generic-password -s near" },
      { t: "deny", hook: "PreToolUse", text: "deny · Stand-in: access to the real-key store is blocked" },
    ],
  },
  {
    hook: "PostToolUse",
    claude: [
      { t: "out", text: `Bash(cat ${CRED})` },
      { t: "hit", hook: "PostToolUse", text: "decoy in tool_response · exposure: session + tool_use_id" },
    ],
    codex: [
      { t: "out", text: "exec env | grep NEAR" },
      { t: "hit", hook: "PostToolUse", text: "decoy in exec output · exposure: thread + call id" },
    ],
  },
];

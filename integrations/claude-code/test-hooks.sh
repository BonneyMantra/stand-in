#!/usr/bin/env bash
# Smoke test: install into a sandbox and drive the hook entry with synthetic hook JSON.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SB="$REPO/.sandbox/hooktest"
rm -rf "$SB"; mkdir -p "$SB/proj"
node "$REPO/integrations/claude-code/install.mjs" --home "$SB" >/dev/null 2>&1
export HOME="$SB" CLAUDE_ENV_FILE="$SB/env.sh" STANDIN_POOL=local STANDIN_HOME="$SB/.standin"
H="$(find "$SB/.claude-config/plugins" -name standin-hook.mjs | head -1)"
echo "{\"session_id\":\"s1\",\"cwd\":\"$SB/proj\",\"source\":\"startup\"}" | node "$H" SessionStart
echo
KEY="$(grep -o 'NEAR_PRIVATE_KEY=ed25519:[^ ]*' "$SB/proj/.env.local" | cut -d= -f2)"
echo "{\"session_id\":\"s1\",\"cwd\":\"x\",\"tool_name\":\"Bash\",\"tool_use_id\":\"tu_9\",\"tool_input\":{\"command\":\"cat ~/.near-credentials/testnet/a.json\"},\"tool_response\":{\"stdout\":\"$KEY\"}}" | node "$H" PostToolUse
echo '{"session_id":"s1","tool_name":"Bash","tool_use_id":"tu_10","tool_input":{"command":"security find-generic-password -s near"}}' | node "$H" PreToolUse
echo
echo "{\"session_id\":\"s1\",\"cwd\":\"$SB/proj\",\"prompt\":\"look at @.env.local\"}" | node "$H" UserPromptSubmit
node -e '
const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);
for (const e of l) console.log(e.type, e.kind||e.phase||"", e.where||"", e.tool_use_id||"", e.tool_name||"");
' "$SB/.standin/ledger.ndjson"

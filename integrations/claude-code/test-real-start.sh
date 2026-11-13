#!/usr/bin/env bash
# Real `claude -p` in a sandbox with the plugin installed: SessionStart/UserPromptSubmit hooks fire even
# without model auth, so this proves plugin loading, decoy planting and CLAUDE_ENV_FILE presence.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SB="$REPO/.sandbox/claude-real-start"
rm -rf "$SB" "$SB.standin"; mkdir -p "$SB/proj"
export STANDIN_POOL=local
env -i PATH="$PATH" HOME="$SB" node "$REPO/integrations/claude-code/install.mjs" --home "$SB" >/dev/null 2>&1
cd "$SB/proj"
env -i PATH="$PATH" HOME="$SB" CLAUDE_CONFIG_DIR="$SB/.claude-config" STANDIN_HOME="$SB.standin" STANDIN_POOL=local \
  timeout 90 claude -p "say hi" --output-format stream-json --verbose --include-hook-events 2>&1 | grep -o '"hook_event":"[A-Za-z]*"' | sort | uniq -c
echo "--- ledger"
node -e '
const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);
for (const e of l) console.log(e.type, e.kind||"", (e.path||"").replace(process.argv[2],"<sb>"), e.session_id?.slice(0,8)||"");
' "$SB.standin/ledger.ndjson" "$SB"

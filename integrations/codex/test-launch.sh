#!/usr/bin/env bash
# Launch real `codex exec` through the Stand-in launcher in a sandbox; show what the hooks recorded.
# Without OPENAI_API_KEY / a login inside the sandbox the model call 401s, but SessionStart should
# still fire and plant the decoy.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SB="$REPO/.sandbox/codextest"
rm -rf "$SB"; mkdir -p "$SB/proj" "$SB/.codex"
export HOME="$SB" CODEX_HOME="$SB/.codex" STANDIN_REQUIRE_SANDBOX=1 STANDIN_POOL=local STANDIN_HOME="$SB/.standin"
cd "$SB/proj"
timeout 90 node "$REPO/integrations/codex/bin/standin-codex.mjs" exec --skip-git-repo-check -s danger-full-access "run: cat ~/.near-credentials/testnet/*.json" 2>&1 | tail -15
echo "--- ledger"
cut -c1-200 "$SB/.standin/ledger.ndjson" 2>/dev/null

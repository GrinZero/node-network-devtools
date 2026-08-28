#!/usr/bin/env bash
set -euo pipefail

backend="${1:-}"
if [[ "$backend" != "native" && "$backend" != "legacy" ]]; then
  echo "usage: bash manual-cli-case.sh <native|legacy>" >&2
  exit 2
fi

evidence_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$evidence_root/../../.." && pwd)"
nnd="$evidence_root/consumer/node_modules/.bin/nnd"
fixture="$repo_root/packages/network-debugger/test/e2e/cli/fixtures/probe.mjs"

"$nnd" dev --no-wait --mode "$backend" "$fixture" 2>/dev/null \
  | sed -n 's/^@@NND_E2E@@//p' \
  | jq '{type,label,preloadInjected,mode,execArgv,capabilities}'

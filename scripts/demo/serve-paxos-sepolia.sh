#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
test -f scripts/demo/local/quicknode.env
test -f scripts/demo/local/public-sepolia-signers.json
test -f scripts/demo/local/paxos-usdg-manifest.json
test -f scripts/demo/local/paxos-usdg-fixture.json
set -a
. scripts/demo/local/quicknode.env
set +a
export LOCKGATE_DEMO_ASSET=paxos-usdg
if [[ "${LOCKGATE_DEMO_NETWORK:-}" != "arbitrum-sepolia" ]]; then
  printf 'Arbitrum Sepolia mode is required\n' >&2
  exit 2
fi
exec harness/node_modules/.bin/tsx harness/src/demo/server.ts

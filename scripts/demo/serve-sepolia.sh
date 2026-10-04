#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
test -f scripts/demo/local/quicknode.env
test -f scripts/demo/local/public-sepolia-signers.json
set -a
. scripts/demo/local/quicknode.env
set +a
if [[ "${LOCKGATE_DEMO_NETWORK:-}" != "arbitrum-sepolia" ]]; then
  printf 'Sepolia network mode is required\n' >&2
  exit 2
fi
exec harness/node_modules/.bin/tsx harness/src/demo/server.ts

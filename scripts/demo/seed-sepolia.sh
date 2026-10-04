#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
mode="${1:---preflight}"
if [[ "$mode" != "--preflight" && "$mode" != "--execute" || "$#" -gt 1 ]]; then
  printf 'Usage: bash scripts/demo/seed-sepolia.sh [--preflight|--execute]\n' >&2
  exit 2
fi
test -f scripts/demo/local/quicknode.env
test -f scripts/demo/local/public-sepolia-signers.json
test -f .env.sepolia
set -a
. scripts/demo/local/quicknode.env
. ./.env.sepolia
set +a
if [[ "${LOCKGATE_DEMO_NETWORK:-}" != "arbitrum-sepolia" ]]; then
  printf 'Sepolia network mode is required\n' >&2
  exit 2
fi
forge build --root contracts --skip test >/dev/null 2>&1
exec harness/node_modules/.bin/tsx harness/src/demo/seed.ts "$mode"

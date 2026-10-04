#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ -f scripts/demo/local/public-sepolia-signers.json ]]; then
  exec harness/node_modules/.bin/tsx harness/src/demo/public-signers.ts --list
fi
exec harness/node_modules/.bin/tsx harness/src/demo/public-signers.ts --generate

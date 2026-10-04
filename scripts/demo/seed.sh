#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
forge build --root contracts --skip test >/dev/null
exec harness/node_modules/.bin/tsx harness/src/demo/seed.ts

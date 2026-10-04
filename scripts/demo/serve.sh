#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
exec harness/node_modules/.bin/tsx harness/src/demo/server.ts

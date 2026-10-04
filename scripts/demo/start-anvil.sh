#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if curl -fsS -H 'content-type: application/json' --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' http://127.0.0.1:8545 >/dev/null 2>&1; then
  echo 'Port 8545 already serves an RPC; inspect it before starting a new demo chain.' >&2
  exit 1
fi
exec anvil --host 127.0.0.1 --port 8545 --chain-id 421614 --silent --mnemonic 'test test test test test test test test test test test junk'

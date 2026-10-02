#!/usr/bin/env bash
# Run the verify suites three times. Print any test whose pass/fail is not the same each time.
# Does not start, reset, warp, or stop the shared Anvil on 127.0.0.1:8545.
# Does not run `npm run sim`. That command rewrites RESULTS.md.
# Forge and the engine share contracts/out, so each run finishes forge before the engine starts.
set -u

root=$(cd "$(dirname "$0")/.." && pwd)
base="${TMPDIR:-/tmp}/lockgate-g9-flaky-$$"
mkdir -p "$base"
printf 'logs %s\n' "$base" >&2

anvil_ready() {
  local body
  body=$(curl -fsS -m 5 -X POST http://127.0.0.1:8545 \
    -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' 2>/dev/null || true)
  [[ "$body" == *'"result":"0x7a69"'* || "$body" == *'"result": "0x7a69"'* ]]
}

run_one() {
  local n="$1"
  local dir="$base/run-$n"
  local sim_pid e2e_pid start
  mkdir -p "$dir"
  printf 'flaky run %s\n' "$n" >&2
  start=$(date +%s)
  (cd "$root/sim" && npm test) >"$dir/sim.log" 2>&1 &
  sim_pid=$!
  (cd "$root/e2e" && npm test) >"$dir/e2e-test.log" 2>&1 &
  e2e_pid=$!
  (cd "$root/contracts" && forge test --offline) >"$dir/contracts.log" 2>&1
  echo $? >"$dir/contracts.code"
  wait "$sim_pid"
  echo $? >"$dir/sim.code"
  wait "$e2e_pid"
  echo $? >"$dir/e2e-test.code"
  (cd "$root/engine" && npm test -- --reporter=json --outputFile="$dir/engine.json") >"$dir/engine.log" 2>&1
  echo $? >"$dir/engine.code"
  if anvil_ready; then
    (cd "$root/e2e" && npm run e2e) >"$dir/e2e-anvil.log" 2>&1
    echo $? >"$dir/e2e-anvil.code"
    (cd "$root/e2e" && npm run compare) >"$dir/e2e-compare.log" 2>&1
    echo $? >"$dir/e2e-compare.code"
    cp "$root/e2e/DIVERGENCE.md" "$dir/DIVERGENCE.md"
  else
    printf 'shared Anvil is not chain 31337 on 127.0.0.1:8545\n' >"$dir/e2e-anvil.log"
    echo 1 >"$dir/e2e-anvil.code"
    printf 'shared Anvil is not chain 31337 on 127.0.0.1:8545\n' >"$dir/e2e-compare.log"
    echo 1 >"$dir/e2e-compare.code"
  fi
  echo $(( $(date +%s) - start )) >"$dir/seconds"
}

run_one 1
python3 "$root/e2e/flaky_report.py" "$base" --parse-check || exit $?
run_one 2
run_one 3
python3 "$root/e2e/flaky_report.py" "$base"
exit $?

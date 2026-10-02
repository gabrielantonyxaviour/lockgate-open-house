#!/usr/bin/env bash
# Contracts, engine, sim, and e2e. Prints a pass/fail table and exits 1 if any row fails.
# Does not start, reset, warp, or stop the shared Anvil on 127.0.0.1:8545.
# Engine tests start a separate Anvil from port 8546 and stop that process.
# This does not run `npm run sim` in sim/. That command rewrites RESULTS.md.
set -u

root=$(cd "$(dirname "$0")/.." && pwd)
logs="${TMPDIR:-/tmp}/lockgate-g9-verify-$$"
mkdir -p "$logs"

detail_of() {
  local log="$1" line extracted tests fails
  # Suite headers are "Ran 4 tests for …". The rollup is "Ran N test suites in …: M tests passed".
  # Anchor after the colon. A leading .*[0-9] keeps only the last digit on BSD sed.
  line=$(grep -E '^Ran [0-9]+ test suites? in .* tests passed, [0-9]+ failed' "$log" | tail -n 1 || true)
  if [[ -n "$line" ]]; then
    extracted=$(printf '%s\n' "$line" | awk -F': ' '{print $NF}' | sed -n 's/^\([0-9][0-9]* tests passed, [0-9][0-9]* failed\).*/\1/p')
    if [[ -n "$extracted" ]]; then
      printf '%s\n' "$extracted"
      return
    fi
  fi
  line=$(grep -E '^[[:space:]]*Tests[[:space:]]+' "$log" | tail -n 1 || true)
  if [[ -n "$line" ]]; then
    printf '%s\n' "$line" | sed 's/^[[:space:]]*//' | tr -s ' '
    return
  fi
  tests=$(grep -E '[[:space:]]tests [0-9]+$' "$log" | tail -n 1 | awk '{print $NF}' || true)
  fails=$(grep -E '[[:space:]]fail [0-9]+$' "$log" | tail -n 1 | awk '{print $NF}' || true)
  if [[ -n "${tests}" ]]; then
    printf '%s tests, %s failed\n' "$tests" "${fails:-0}"
    return
  fi
  if grep -E '"ok"[[:space:]]*:[[:space:]]*true' "$log" >/dev/null; then
    printf 'ok\n'
    return
  fi
  line=$(tail -n 1 "$log" | tr '\n' ' ' | tr -s '[:space:]' ' ' | cut -c1-96)
  printf '%s\n' "${line:-no output}"
}

run_to() {
  local name="$1" dir="$2"
  shift 2
  local log="$logs/$name.log" start end code status detail
  printf 'running %s\n' "$name" >&2
  start=$(date +%s)
  (cd "$dir" && "$@") >"$log" 2>&1
  code=$?
  end=$(date +%s)
  detail=$(detail_of "$log")
  detail=${detail//$'\n'/ }
  if [[ "$code" -eq 0 ]]; then status=pass; else status=fail; fi
  printf '%s\n%s\n%s\n' "$status" "$((end - start))" "$detail" > "$logs/$name.result"
}

anvil_ready() {
  local body
  body=$(curl -fsS -m 5 -X POST http://127.0.0.1:8545 \
    -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' 2>/dev/null || true)
  [[ "$body" == *'"result":"0x7a69"'* || "$body" == *'"result": "0x7a69"'* ]]
}

run_to sim "$root/sim" npm test &
sim_pid=$!
run_to e2e-test "$root/e2e" npm test &
e2e_test_pid=$!
run_to contracts "$root/contracts" forge test --offline
wait "$sim_pid" || true
wait "$e2e_test_pid" || true
run_to engine "$root/engine" npm test

if anvil_ready; then
  run_to e2e-anvil "$root/e2e" npm run e2e
  run_to e2e-compare "$root/e2e" npm run compare
else
  printf 'fail\n0\nshared Anvil is not chain 31337 on 127.0.0.1:8545\n' > "$logs/e2e-anvil.result"
  printf 'fail\n0\nshared Anvil is not chain 31337 on 127.0.0.1:8545\n' > "$logs/e2e-compare.result"
fi

print_row() {
  local name="$1" area="$2" check="$3" file status seconds detail
  file="$logs/$name.result"
  if [[ ! -f "$file" ]]; then
    printf '%-12s %-12s %-6s %8s  %s\n' "$area" "$check" "fail" "0s" "no result"
    return 1
  fi
  status=$(sed -n '1p' "$file")
  seconds=$(sed -n '2p' "$file")
  detail=$(sed -n '3p' "$file")
  printf '%-12s %-12s %-6s %8s  %s\n' "$area" "$check" "$status" "${seconds}s" "$detail"
  [[ "$status" == "pass" ]]
}

printf '\n'
printf '%-12s %-12s %-6s %8s  %s\n' "area" "check" "result" "time" "detail"
failed=0
print_row contracts contracts "forge test" || failed=1
print_row engine engine "npm test" || failed=1
print_row sim sim "npm test" || failed=1
print_row e2e-test e2e "npm test" || failed=1
print_row e2e-anvil e2e anvil || failed=1
print_row e2e-compare e2e compare || failed=1

if [[ "$failed" -ne 0 ]]; then
  printf 'logs %s\n' "$logs"
  exit 1
fi
rm -rf "$logs"
exit 0

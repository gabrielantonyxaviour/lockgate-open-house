#!/usr/bin/env python3
"""Compare three flaky.sh runs. Exit 1 when a test outcome changes. Exit 2 when a log cannot be counted."""

import json
import re
import sys
from pathlib import Path

ANSI = re.compile(r"\x1b\[[0-9;]*m")

AREAS = ("contracts", "engine", "sim", "e2e-test", "e2e-anvil", "e2e-compare")
PASS = {"PASS", "passed"}
FAIL = {"FAIL", "failed"}
SKIP = {"SKIP", "skipped", "pending", "todo", "disabled"}


def norm(status: str) -> str:
    if status in PASS:
        return "PASS"
    if status in FAIL:
        return "FAIL"
    if status in SKIP:
        return "SKIP"
    return status


def add(rows: dict[str, str], key: str, status: str, problems: list[str], label: str) -> None:
    status = norm(status)
    previous = rows.get(key)
    if previous is None:
        rows[key] = status
        return
    if previous != status:
        problems.append(f"{label} named {key} as {previous} and {status}")


def node_rows(text: str, prefix: str, problems: list[str]) -> dict[str, str]:
    rows: dict[str, str] = {}
    text = ANSI.sub("", text)
    for line in text.splitlines():
        match = re.match(r"^(✔|✖)\s+(.*?)(?:\s+\([\d.]+ms\))?\s*$", line)
        if not match:
            continue
        add(rows, f"{prefix} {match.group(2)}", "PASS" if match.group(1) == "✔" else "FAIL", problems, prefix)
    return rows


def summary_count(text: str) -> tuple[int, int, int] | None:
    match = re.search(r"(\d+) tests passed, (\d+) failed(?:, (\d+) skipped)?", text)
    if match:
        return int(match.group(1)), int(match.group(2)), int(match.group(3) or 0)
    passed = re.search(r"^ℹ pass (\d+)$", text, re.M)
    failed = re.search(r"^ℹ fail (\d+)$", text, re.M)
    skipped = re.search(r"^ℹ skipped (\d+)$", text, re.M)
    total = re.search(r"^ℹ tests (\d+)$", text, re.M)
    if total and passed and failed:
        skip_n = int(skipped.group(1)) if skipped else 0
        return int(passed.group(1)), int(failed.group(1)), skip_n
    vitest = re.search(r"Tests\s+(\d+) passed(?:\s+\((\d+)\))?(?:,\s+(\d+) failed)?", text)
    if vitest:
        return int(vitest.group(1)), int(vitest.group(3) or 0), 0
    return None


def forge_rows(text: str, problems: list[str]) -> dict[str, str]:
    rows: dict[str, str] = {}
    suite = "unknown"
    text = ANSI.sub("", text)
    for line in text.splitlines():
        if re.match(r"^Ran \d+ test suites", line):
            break
        header = re.match(r"^Ran \d+ tests? for (.+)$", line)
        if header:
            suite = header.group(1).strip()
            continue
        # Foundry puts ] inside a fuzz counterexample, so the status bracket ends at the last ].
        item = re.match(r"^\[(PASS|FAIL|SKIP)\b.*\]\s+(\S+)\s+\(.*\)\s*$", line)
        if item:
            add(rows, f"contracts {suite} :: {item.group(2)}", item.group(1), problems, "contracts")
    return rows


def engine_rows(path: Path, problems: list[str]) -> tuple[dict[str, str], int | None]:
    rows: dict[str, str] = {}
    if not path.exists():
        problems.append(f"missing {path.name}")
        return rows, None
    data = json.loads(path.read_text())
    for suite in data["testResults"]:
        file_name = Path(suite["name"]).name
        for case in suite["assertionResults"]:
            add(rows, f"engine {file_name} :: {case['fullName']}", case["status"], problems, "engine")
    return rows, int(data["numTotalTests"])


def anvil_status(text: str, code: int) -> str:
    ok = '"ok": true' in text or '"ok":true' in text
    if ok and code == 0:
        return "PASS"
    return "FAIL"


def fee_rows(text: str) -> list[str]:
    return [line for line in text.splitlines() if line.startswith("| Sim |") or line.startswith("| Engine |") or line.startswith("| Chain |")]


def load_run(directory: Path) -> tuple[dict[str, str], list[str], dict[str, str]]:
    problems: list[str] = []
    rows: dict[str, str] = {}
    meta: dict[str, str] = {}
    contracts = (directory / "contracts.log").read_text(errors="replace")
    forge = forge_rows(contracts, problems)
    rows.update(forge)
    counted = summary_count(contracts)
    meta["contracts"] = (directory / "contracts.code").read_text().strip()
    meta["contracts-detail"] = "unparsed" if counted is None else f"{counted[0]} passed, {counted[1]} failed, {counted[2]} skipped"
    if counted is None or sum(counted) != len(forge):
        problems.append(f"contracts parsed {len(forge)} names, summary {meta['contracts-detail']}")

    for area, prefix in (("sim", "sim"), ("e2e-test", "e2e"), ("e2e-compare", "e2e compare")):
        text = (directory / f"{area}.log").read_text(errors="replace")
        named = node_rows(text, prefix, problems)
        if area == "e2e-compare":
            rows.update(named)
        else:
            rows.update(named)
        info = summary_count(text)
        meta[area] = (directory / f"{area}.code").read_text().strip()
        meta[f"{area}-detail"] = "unparsed" if info is None else f"{info[0]} passed, {info[1]} failed, {info[2]} skipped"
        expect = 0 if info is None else sum(info)
        if info is None or len(named) != expect:
            problems.append(f"{area} parsed {len(named)} names, summary {meta[f'{area}-detail']}")

    engine, total = engine_rows(directory / "engine.json", problems)
    rows.update(engine)
    meta["engine"] = (directory / "engine.code").read_text().strip()
    meta["engine-detail"] = "missing json" if total is None else f"{total} in json, {len(engine)} named"
    if total is None or total != len(engine):
        problems.append(f"engine parsed {len(engine)} names, summary {meta['engine-detail']}")

    anvil_log = (directory / "e2e-anvil.log").read_text(errors="replace")
    anvil_code = int((directory / "e2e-anvil.code").read_text().strip())
    rows["e2e anvil"] = anvil_status(anvil_log, anvil_code)
    meta["e2e-anvil"] = str(anvil_code)
    meta["e2e-anvil-detail"] = rows["e2e anvil"]
    if (directory / "DIVERGENCE.md").exists():
        meta["fees"] = "\n".join(fee_rows((directory / "DIVERGENCE.md").read_text()))
    else:
        meta["fees"] = ""
    meta["seconds"] = (directory / "seconds").read_text().strip() if (directory / "seconds").exists() else ""
    return rows, problems, meta


def main() -> int:
    parse_check = "--parse-check" in sys.argv
    base = Path(sys.argv[1])
    run_dirs = sorted(path for path in base.glob("run-*") if path.is_dir())
    if not run_dirs:
        print("no runs")
        return 2
    loaded = [(path.name, *load_run(path)) for path in run_dirs]
    gaps = [(name, problems) for name, _rows, problems, _meta in loaded if problems]
    print(f"runs {len(loaded)}")
    for name, rows, _problems, meta in loaded:
        print(f"{name} {meta.get('seconds', '')}s contracts {meta['contracts-detail']} exit {meta['contracts']}")
        print(f"{name} engine {meta['engine-detail']} exit {meta['engine']}")
        print(f"{name} sim {meta['sim-detail']} exit {meta['sim']}")
        print(f"{name} e2e-test {meta['e2e-test-detail']} exit {meta['e2e-test']}")
        print(f"{name} e2e-anvil {meta['e2e-anvil-detail']} exit {meta['e2e-anvil']}")
        print(f"{name} e2e-compare {meta['e2e-compare-detail']} exit {meta['e2e-compare']}")
        print(f"{name} names {len(rows)}")
    if gaps:
        print("PARSER_GAPS")
        for name, problems in gaps:
            for problem in problems:
                print(f"{name} {problem}")
        return 2
    if parse_check:
        print("PARSE_OK")
        return 0
    if len(loaded) != 3:
        print(f"expected 3 runs, found {len(loaded)}")
        return 2
    keys: set[str] = set()
    for _name, rows, _problems, _meta in loaded:
        keys.update(rows)
    flakes: list[str] = []
    for key in sorted(keys):
        statuses = [rows.get(key, "ABSENT") for _name, rows, _problems, _meta in loaded]
        if len(set(statuses)) != 1:
            flakes.append(f"{key}\t{statuses[0]}\t{statuses[1]}\t{statuses[2]}")
    fee_sets = [meta.get("fees", "") for _name, _rows, _problems, meta in loaded]
    print("FEE_ROWS")
    if len(set(fee_sets)) == 1:
        print("same")
    else:
        print("changed")
        for name, _rows, _problems, meta in loaded:
            print(f"--- {name}")
            print(meta.get("fees", ""))
    print(f"FLAKY_COUNT {len(flakes)}")
    for flake in flakes:
        print(flake)
    return 1 if flakes or len(set(fee_sets)) != 1 else 0


if __name__ == "__main__":
    sys.exit(main())

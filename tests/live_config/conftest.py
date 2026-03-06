"""
conftest.py — Pytest plugin that writes a JSON results file after the test run.

The file is written to /tmp/pytest-results.json (inside the config-tests container)
and also to /workspace/tmp/pytest-results.json (on the host bind mount).
It is read by generate_report.py to append an "E2E Tests" section to the report.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

# Where to write the results — matches the bind-mount path used by docker-compose.
# Written to tests/results/ so it lives alongside the test code and is version-trackable.
RESULTS_PATH = Path("/workspace/tests/results/pytest-results.json")

# ──────────────────────────────────────────────────────────────────────────────
# Internal state collected by hooks
# ──────────────────────────────────────────────────────────────────────────────
_started_at: float = 0.0
_outcomes: list[dict[str, Any]] = []


def pytest_sessionstart(session) -> None:  # noqa: ANN001
    global _started_at, _outcomes
    _started_at = time.time()
    _outcomes = []


def pytest_runtest_logreport(report) -> None:  # noqa: ANN001
    """Called 3× per test (setup / call / teardown). We only care about 'call'
    for passed/failed, and 'setup'/'teardown' for errors that prevent the call."""
    if report.when == "call" or (report.when in ("setup", "teardown") and report.failed):
        outcome: dict[str, Any] = {
            "node_id": report.nodeid,
            "outcome": report.outcome,   # "passed" | "failed" | "skipped"
            "when": report.when,
            "duration": round(report.duration, 3),
            "longrepr": None,
        }
        if report.failed:
            outcome["longrepr"] = str(report.longrepr)
        _outcomes.append(outcome)


def pytest_sessionfinish(session, exitstatus) -> None:  # noqa: ANN001
    passed   = sum(1 for o in _outcomes if o["outcome"] == "passed")
    failed   = sum(1 for o in _outcomes if o["outcome"] == "failed")
    skipped  = sum(1 for o in _outcomes if o["outcome"] == "skipped")
    total    = len(_outcomes)
    duration = round(time.time() - _started_at, 2)

    payload = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "exit_status": int(exitstatus),
        "summary": {
            "total": total,
            "passed": passed,
            "failed": failed,
            "skipped": skipped,
            "duration_seconds": duration,
        },
        "tests": _outcomes,
    }

    try:
        RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
        RESULTS_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    except OSError as exc:
        print(f"\n[conftest] WARNING: could not write results to {RESULTS_PATH}: {exc}")

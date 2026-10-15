#!/usr/bin/env bash
# Fresh-install + idempotency test in an ISOLATED stack (make fresh-install-test).
#
# 1. Builds a copy of the real compose config with every production identifier
#    renamed (project/volumes/network/images/containers -> fresh-*), no prod
#    ports, logs/audit exports redirected, repo mounted read-only. The generator
#    refuses to write if any production identifier survives.
# 2. Fresh install: empty Postgres -> step1 ... step10 (+ FGAP steps).
# 3. Normal re-run of every step: must skip via markers; config IDENTICAL.
# 4. Forced re-run of every step, twice; per-step config diff for round 2.
#    Known, accepted churn: step3/step7 recreate protocol mappers (new IDs),
#    step4 recreates the browser-PhoneOTP flow (step5 re-adds the expiry check),
#    list-order swaps in step1/2/2-fgap. Anything else is a regression.
#
# Keycloak is published on 127.0.0.1:28080 / 29000 only. Keep the stack with
# FRESH_TEST_KEEP=true; remove it with `make fresh-install-test-down`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$ROOT/tests/fresh_install"
WORK="${FRESH_TEST_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/vg_sso-fresh-install-test}"
KEEP="${FRESH_TEST_KEEP:-false}"
mkdir -p "$WORK/fresh-logs"
chmod 700 "$WORK"
cd "$ROOT"

./scripts/ensure_automation_secret.sh
resolved="$WORK/compose.resolved.json"
( umask 077; docker compose -f docker-compose.yml -f docker-compose.override.yml config --format json >"$resolved" )
python3 "$HERE/make_compose.py" "$resolved" "$WORK/fresh-compose.json" "$WORK"
rm -f "$resolved"
F=(docker compose -f "$WORK/fresh-compose.json")

cleanup() {
  if [[ "$KEEP" != "true" ]]; then
    "${F[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
    rm -f "$WORK/fresh-compose.json"  # contains .env secrets
  fi
}
trap cleanup EXIT

echo "== fresh-install-test: clean start"
"${F[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
make build-spis
"${F[@]}" build
"${F[@]}" up -d   # waits for each step via depends_on (service_completed_successfully)
until [[ "$(docker inspect -f '{{.State.Status}}' fresh-vg-step10-init 2>/dev/null)" == exited ]]; do sleep 3; done

ORDER=(step1-init step2-init step2-fgap-init step3-init step4-init step5-init step6-init
       step6-fgap-init step7-init step7-fgap-init step8-init step9-init step10-init)
fail=0
echo "== fresh install results"
for s in "${ORDER[@]}"; do
  code="$("${F[@]}" ps -a --format '{{.Service}} {{.ExitCode}}' | awk -v s="$s" '$1 == s {print $2}')"
  fallback="$("${F[@]}" logs --no-color "$s" 2>&1 | grep -c 'fallback user' || true)"
  printf '  %-16s exit=%s fallback-logins=%s\n' "$s" "$code" "$fallback"
  [[ "$code" == 0 && "$fallback" == 0 ]] || fail=1
done

set -a
eval "$(grep -E '^(KC_AUTOMATION_CLIENT_SECRET|KC_AUTOMATION_CLIENT_ID|KC_NEW_REALM_NAME)=' .env)"
set +a
snap() { python3 "$HERE/snapshot.py" "$WORK/$1.json" >/dev/null; }

snap A
echo "== normal re-run (markers present)"
for s in "${ORDER[@]}"; do
  "${F[@]}" run --rm --no-deps "$s" >"$WORK/rerun-$s.log" 2>&1 || { echo "  $s FAILED"; fail=1; }
done
snap B
if python3 "$HERE/snapdiff.py" "$WORK/A.json" "$WORK/B.json" 2>/dev/null | grep -q '^IDENTICAL$'; then
  echo "  config IDENTICAL after normal re-run"
else
  echo "  config CHANGED after normal re-run:"; python3 "$HERE/snapdiff.py" "$WORK/A.json" "$WORK/B.json" | head -20; fail=1
fi

force=()
for v in STEP1 STEP2 STEP2_FGAP STEP3 STEP4 STEP5 STEP6 STEP6_FGAP STEP7 STEP7_FGAP STEP8 STEP9 STEP10; do
  force+=(-e "${v}_FORCE=true")
done
for round in 1 2; do
  echo "== forced re-run round ${round} (per-step config changes)"
  if [[ "$round" == 2 ]]; then prev=R1-step10-init; else prev=B; fi
  for s in "${ORDER[@]}"; do
    rc=0; "${F[@]}" run --rm --no-deps "${force[@]}" "$s" >"$WORK/forced${round}-$s.log" 2>&1 || rc=$?
    snap "R${round}-$s"
    n="$(python3 "$HERE/snapdiff.py" "$WORK/$prev.json" "$WORK/R${round}-$s.json" 2>/dev/null | grep -vc '^IDENTICAL$' || true)"
    areas="$(python3 "$HERE/snapdiff.py" "$WORK/$prev.json" "$WORK/R${round}-$s.json" 2>/dev/null | grep -v '^IDENTICAL$' \
      | sed -E 's/^\.([a-z_]+)(\[[^]]*\])?.*/\1\2/' | sort | uniq -c | sort -rn | head -3 | awk '{printf "%s(%s) ", $2, $1}' || true)"
    printf '  %-16s exit=%s changes=%-4s %s\n' "$s" "$rc" "$n" "$areas"
    [[ "$rc" == 0 ]] || fail=1
    if [[ "$round" == 2 ]] && grep -qE '(^| )(groups|users|user_profile|events_config|fgap_policies)' <<<"$areas"; then
      echo "    ^ REGRESSION: forced re-run changed data that must be stable"; fail=1
    fi
    prev="R${round}-$s"
  done
done

if [[ "$fail" == 0 ]]; then
  echo "== fresh-install-test PASSED (details: $WORK)"
else
  echo "== fresh-install-test FAILED (details: $WORK)"
fi
exit "$fail"

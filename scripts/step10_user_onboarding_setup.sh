#!/usr/bin/env bash
set -euo pipefail

exec 1>/proc/1/fd/1 2>/proc/1/fd/2 2>/dev/null || true

KCADM_BIN="${KCADM_BIN:-/opt/keycloak/bin/kcadm.sh}"
KCADM_CONFIG="${KCADM_CONFIG:-/tmp/.kcadm_step10.config}"
SERVER_URL="${KC_SERVER_URL:-http://keycloak:8080}"
REALM_NAME="${KC_NEW_REALM_NAME:-}"
ADMIN_REALM="${KC_STEP10_ADMIN_REALM:-master}"
ADMIN_USER="${KC_STEP10_ADMIN_USER:-${KC_BOOTSTRAP_ADMIN_USERNAME:-}}"
ADMIN_PASSWORD="${KC_STEP10_ADMIN_PASSWORD:-${KC_BOOTSTRAP_ADMIN_PASSWORD:-}}"

STEP10_WAIT_SECONDS="${STEP10_WAIT_SECONDS:-180}"
STEP10_POLL_INTERVAL_SECONDS="${STEP10_POLL_INTERVAL_SECONDS:-3}"
STEP10_MARKER_FILE="${STEP10_MARKER_FILE:-/opt/keycloak/data/.step10-init-done}"
STEP10_FORCE="${STEP10_FORCE:-false}"

required_vars=(
  REALM_NAME
  ADMIN_REALM
  ADMIN_USER
  ADMIN_PASSWORD
)

for v in "${required_vars[@]}"; do
  if [[ -z "${!v}" ]]; then
    echo "STEP10 ERROR: required env var $v is empty"
    exit 1
  fi
done

if [[ "$STEP10_FORCE" != "true" && -f "$STEP10_MARKER_FILE" ]]; then
  echo "STEP10: marker exists at $STEP10_MARKER_FILE; skipping (set STEP10_FORCE=true to rerun)."
  exit 0
fi

deadline=$(( $(date +%s) + STEP10_WAIT_SECONDS ))
echo "STEP10: waiting for Keycloak at ${SERVER_URL} ..."
last_auth_error=""
while true; do
  auth_err="$(mktemp)"
  if "$KCADM_BIN" config credentials \
      --server "$SERVER_URL" \
      --realm "$ADMIN_REALM" \
      --user "$ADMIN_USER" \
      --password "$ADMIN_PASSWORD" \
      --config "$KCADM_CONFIG" >/dev/null 2>"$auth_err"; then
    rm -f "$auth_err"
    break
  fi
  last_auth_error="$(tr '\n' ' ' < "$auth_err" | sed 's/[[:space:]]\+/ /g')"
  rm -f "$auth_err"
  if (( $(date +%s) >= deadline )); then
    echo "STEP10 ERROR: Keycloak did not become ready within ${STEP10_WAIT_SECONDS}s."
    [[ -n "$last_auth_error" ]] && echo "STEP10 ERROR: last login error: ${last_auth_error}"
    exit 1
  fi
  sleep "$STEP10_POLL_INTERVAL_SECONDS"
done
echo "STEP10: Keycloak is ready."

kcadm() {
  "$KCADM_BIN" "$@" --config "$KCADM_CONFIG"
}

echo "STEP10: enabling forgot-password flow ..."
kcadm update "realms/${REALM_NAME}" \
  -s resetPasswordAllowed=true >/dev/null

echo "STEP10: registering onboarding event listener ..."
events_cfg_in="$(mktemp)"
events_cfg_out="$(mktemp)"
kcadm get "events/config" -r "$REALM_NAME" > "$events_cfg_in"

jq '
  .eventsListeners = (((.eventsListeners // []) + ["user-onboarding-email"]) | unique)
' "$events_cfg_in" > "$events_cfg_out"

kcadm update "events/config" -r "$REALM_NAME" -f "$events_cfg_out" >/dev/null
rm -f "$events_cfg_in" "$events_cfg_out"

echo "STEP10: current listener state:"
kcadm get "events/config" -r "$REALM_NAME" \
  | jq '{eventsListeners}' || true

echo "STEP10: current login recovery state:"
kcadm get "realms/${REALM_NAME}" \
  | jq '{realm, resetPasswordAllowed}' || true

touch "$STEP10_MARKER_FILE"
echo "STEP10: complete. Marker created at $STEP10_MARKER_FILE"

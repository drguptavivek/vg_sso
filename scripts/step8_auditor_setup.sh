#!/usr/bin/env bash
set -euo pipefail

# Ensure unbuffered output for docker logs
exec 1>/proc/1/fd/1 2>/proc/1/fd/2 2>/dev/null || true

KCADM_BIN="${KCADM_BIN:-/opt/keycloak/bin/kcadm.sh}"
KCADM_CONFIG="${KCADM_CONFIG:-/tmp/.kcadm_step8.config}"
SERVER_URL="${KC_SERVER_URL:-http://keycloak:8080}"
REALM_NAME="${KC_NEW_REALM_NAME:-}"
REALM_ADMIN_USER="${KC_NEW_REALM_ADMIN_USER:-}"
REALM_ADMIN_PASSWORD="${KC_NEW_REALM_ADMIN_PASSWORD:-}"

STEP8_WAIT_SECONDS="${STEP8_WAIT_SECONDS:-180}"
STEP8_POLL_INTERVAL_SECONDS="${STEP8_POLL_INTERVAL_SECONDS:-3}"
STEP8_MARKER_FILE="${STEP8_MARKER_FILE:-/opt/keycloak/data/.step8-init-done}"
STEP8_FORCE="${STEP8_FORCE:-false}"
EVENTS_EXPIRATION_SECONDS="${EVENTS_EXPIRATION_SECONDS:-23328000}" # 270 days

AUDITOR_ROLE_NAME="auditor"
AUDITOR_ROLE_DESC="Read-only audit role for realm visibility. No mutate privileges."

required_vars=(
  REALM_NAME
  REALM_ADMIN_USER
  REALM_ADMIN_PASSWORD
)

for v in "${required_vars[@]}"; do
  if [[ -z "${!v}" ]]; then
    echo "STEP8 ERROR: required env var $v is empty"
    exit 1
  fi
done

if [[ "$STEP8_FORCE" != "true" && -f "$STEP8_MARKER_FILE" ]]; then
  echo "STEP8: marker exists at $STEP8_MARKER_FILE; skipping (set STEP8_FORCE=true to rerun)."
  exit 0
fi

deadline=$(( $(date +%s) + STEP8_WAIT_SECONDS ))
echo "STEP8: waiting for Keycloak at ${SERVER_URL} ..."
last_auth_error=""
while true; do
  auth_err="$(mktemp)"
  if "$KCADM_BIN" config credentials \
      --server "$SERVER_URL" \
      --realm "$REALM_NAME" \
      --user "$REALM_ADMIN_USER" \
      --password "$REALM_ADMIN_PASSWORD" \
      --config "$KCADM_CONFIG" >/dev/null 2>"$auth_err"; then
    rm -f "$auth_err"
    break
  fi
  last_auth_error="$(tr '\n' ' ' < "$auth_err" | sed 's/[[:space:]]\+/ /g')"
  rm -f "$auth_err"
  if (( $(date +%s) >= deadline )); then
    echo "STEP8 ERROR: Keycloak did not become ready within ${STEP8_WAIT_SECONDS}s."
    [[ -n "$last_auth_error" ]] && echo "STEP8 ERROR: last login error: ${last_auth_error}"
    exit 1
  fi
  sleep "$STEP8_POLL_INTERVAL_SECONDS"
done
echo "STEP8: Keycloak is ready."

kcadm() {
  "$KCADM_BIN" "$@" --config "$KCADM_CONFIG"
}

echo "STEP8: configuring auditor role..."

REALM_MGMT_CLIENT_ID="$(kcadm get clients -r "$REALM_NAME" -q clientId=realm-management -q max=1 --fields id --format csv --noquotes)"
if [[ -z "${REALM_MGMT_CLIENT_ID:-}" ]]; then
  echo "STEP8 ERROR: unable to resolve realm-management client id"
  exit 1
fi

if kcadm get "roles/${AUDITOR_ROLE_NAME}" -r "$REALM_NAME" >/dev/null 2>&1; then
  echo "STEP8: role '${AUDITOR_ROLE_NAME}' exists, updating description..."
  kcadm update "roles/${AUDITOR_ROLE_NAME}" -r "$REALM_NAME" \
    -s "description=${AUDITOR_ROLE_DESC}" >/dev/null
else
  echo "STEP8: creating role '${AUDITOR_ROLE_NAME}'..."
  kcadm create roles -r "$REALM_NAME" \
    -s "name=${AUDITOR_ROLE_NAME}" \
    -s "description=${AUDITOR_ROLE_DESC}" >/dev/null
fi

# Read-only visibility composites. We intentionally avoid any manage-* or impersonation.
READONLY_CANDIDATES=(
  view-users
  query-users
  query-groups
  view-clients
  query-clients
  view-events
  query-realms
)
RM_ROLES_JSON="$(kcadm get "clients/${REALM_MGMT_CLIENT_ID}/roles" -r "$REALM_NAME" || echo '[]')"

declare -a AVAILABLE_ROLES=()
for rn in "${READONLY_CANDIDATES[@]}"; do
  if echo "$RM_ROLES_JSON" | jq -e --arg n "$rn" '.[] | select(.name == $n)' >/dev/null; then
    AVAILABLE_ROLES+=("$rn")
  else
    echo "STEP8: role 'realm-management/${rn}' not present on this Keycloak build; skipping."
  fi
done

if [[ ${#AVAILABLE_ROLES[@]} -gt 0 ]]; then
  echo "STEP8: assigning read-only composites to '${AUDITOR_ROLE_NAME}': ${AVAILABLE_ROLES[*]}"
  add_args=()
  for rn in "${AVAILABLE_ROLES[@]}"; do
    add_args+=(--rolename "$rn")
  done
  kcadm add-roles -r "$REALM_NAME" \
    --rname "$AUDITOR_ROLE_NAME" \
    --cclientid realm-management \
    "${add_args[@]}" >/dev/null || true
fi

echo "STEP8: effective realm-management composites for '${AUDITOR_ROLE_NAME}':"
kcadm get-roles -r "$REALM_NAME" --rname "$AUDITOR_ROLE_NAME" --effective --cclientid realm-management \
  | jq -r '.[] | .name' || true

echo "STEP8: enforcing audit event retention and persistence settings..."
events_cfg_in="$(mktemp)"
events_cfg_out="$(mktemp)"
kcadm get "events/config" -r "$REALM_NAME" > "$events_cfg_in"

jq --argjson exp "$EVENTS_EXPIRATION_SECONDS" '
  .eventsEnabled = true
  | .adminEventsEnabled = true
  | .adminEventsDetailsEnabled = true
  | .eventsExpiration = $exp
  | .eventsListeners = (((.eventsListeners // []) + ["failure-logs-file"]) | unique)
' "$events_cfg_in" > "$events_cfg_out"

kcadm update "events/config" -r "$REALM_NAME" -f "$events_cfg_out" >/dev/null
rm -f "$events_cfg_in" "$events_cfg_out"

echo "STEP8: current events config:"
kcadm get "events/config" -r "$REALM_NAME" \
  | jq '{eventsEnabled, adminEventsEnabled, adminEventsDetailsEnabled, eventsExpiration, eventsListeners}' || true

touch "$STEP8_MARKER_FILE"
echo "STEP8: complete. Marker created at $STEP8_MARKER_FILE"

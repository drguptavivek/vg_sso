#!/usr/bin/env bash
set -euo pipefail

# Ensure unbuffered output for docker logs
exec 1>/proc/1/fd/1 2>/proc/1/fd/2 2>/dev/null || true

KCADM_BIN="${KCADM_BIN:-/opt/keycloak/bin/kcadm.sh}"
KCADM_CONFIG="${KCADM_CONFIG:-/tmp/.kcadm_step6.config}"
SERVER_URL="${KC_SERVER_URL:-http://keycloak:8080}"
REALM_NAME="${KC_NEW_REALM_NAME:-}"
REALM_ADMIN_USER="${KC_NEW_REALM_ADMIN_USER:-}"
REALM_ADMIN_PASSWORD="${KC_NEW_REALM_ADMIN_PASSWORD:-}"

STEP6_WAIT_SECONDS="${STEP6_WAIT_SECONDS:-180}"
STEP6_POLL_INTERVAL_SECONDS="${STEP6_POLL_INTERVAL_SECONDS:-3}"
STEP6_MARKER_FILE="${STEP6_MARKER_FILE:-/opt/keycloak/data/.step6-init-done}"
STEP6_FORCE="${STEP6_FORCE:-false}"

required_vars=(
  REALM_NAME
  REALM_ADMIN_USER
  REALM_ADMIN_PASSWORD
)

for v in "${required_vars[@]}"; do
  if [[ -z "${!v}" ]]; then
    echo "STEP6 ERROR: required env var $v is empty"
    exit 1
  fi
done

if [[ "$STEP6_FORCE" != "true" && -f "$STEP6_MARKER_FILE" ]]; then
  echo "STEP6: marker exists at $STEP6_MARKER_FILE; skipping (set STEP6_FORCE=true to rerun)."
  exit 0
fi

deadline=$(( $(date +%s) + STEP6_WAIT_SECONDS ))
echo "STEP6: waiting for Keycloak at ${SERVER_URL} ..."
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
    echo "STEP6 ERROR: Keycloak did not become ready within ${STEP6_WAIT_SECONDS}s."
    if [[ -n "$last_auth_error" ]]; then
      echo "STEP6 ERROR: last login error: ${last_auth_error}"
    fi
    exit 1
  fi
  sleep "$STEP6_POLL_INTERVAL_SECONDS"
done
echo "STEP6: Keycloak is ready."

kcadm() {
  "$KCADM_BIN" "$@" --config "$KCADM_CONFIG"
}

# ============================================================================
# STEP 6: Delegated Client Administration Setup
# ============================================================================

echo "STEP6: Setting up delegated client administration..."

# 1. Get realm-management client ID
echo "STEP6: Getting realm-management client ID..."
REALM_MGMT_CLIENT_ID=$(kcadm get clients -r "$REALM_NAME" -q clientId=realm-management -q max=1 --fields id --format csv --noquotes)
echo "STEP6: realm-management client ID: $REALM_MGMT_CLIENT_ID"

# 2. Create client-manager realm role with composites
echo "STEP6: Creating client-manager realm role..."

CLIENT_MANAGER_ROLE_DESC="Users who can create new clients and assign first admin. Cannot delete clients."

# Check if role exists
if kcadm get "roles/client-manager" -r "$REALM_NAME" >/dev/null 2>&1; then
  echo "STEP6: client-manager role exists, updating..."
  kcadm update "roles/client-manager" -r "$REALM_NAME" \
    -s "description=$CLIENT_MANAGER_ROLE_DESC"
else
  echo "STEP6: Creating new client-manager role..."
  kcadm create roles -r "$REALM_NAME" \
    -s name=client-manager \
    -s description="$CLIENT_MANAGER_ROLE_DESC"
fi

# Assign realm-management composite roles to client-manager.
# view-clients + query-clients: required for the admin console UI to show
#   the Clients menu and load the client list.
# create-client: required for the "Create client" button to appear in the UI.
# manage-clients: required for the "Save" button to appear when editing a client.
#   NOTE: manage-clients bypasses FGAP v2 NEGATIVE scoped permissions on system
#   clients (broker, realm-management, etc.). System client edit/delete protection
#   is therefore enforced by DelegatedAdminGuardFilter (the JAX-RS ContainerRequestFilter
#   in the delegated-admin-guard SPI), which returns HTTP 403 before any handler runs.
echo "STEP6: Assigning composites to client-manager..."
# view-clients + query-clients: admin console shows Clients menu + list.
# create-client: "Create client" button in UI.
# manage-clients: Save/update buttons work; note: bypasses FGAP v2 NEGATIVE on system
#   clients — the DelegatedAdminGuardFilter enforces system client protection instead.
# view-users + query-users: browse user directory to find users to make PCA.
kcadm add-roles -r "$REALM_NAME" \
  --rname client-manager \
  --cclientid realm-management \
  --rolename view-clients \
  --rolename query-clients \
  --rolename create-client \
  --rolename manage-clients \
  --rolename view-users \
  --rolename query-users \
  >/dev/null || true

echo "STEP6: Verifying client-manager composites..."
kcadm get-roles -r "$REALM_NAME" --rname client-manager --effective --cclientid realm-management \
  | jq -r '.[] | .name' || true

# Create marker file
touch "$STEP6_MARKER_FILE"
echo "STEP6: Complete! Marker created at $STEP6_MARKER_FILE"
echo "STEP6: FGAP configuration will be applied by step6-fgap-init container."

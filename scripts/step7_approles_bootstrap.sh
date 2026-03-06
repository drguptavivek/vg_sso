#!/usr/bin/env bash
set -euo pipefail

# Ensure unbuffered output for docker logs
exec 1>/proc/1/fd/1 2>/proc/1/fd/2 2>/dev/null || true

KCADM_BIN="${KCADM_BIN:-/opt/keycloak/bin/kcadm.sh}"
KCADM_CONFIG="${KCADM_CONFIG:-/tmp/.kcadm_step7.config}"
SERVER_URL="${KC_SERVER_URL:-http://keycloak:8080}"
REALM_NAME="${KC_NEW_REALM_NAME:-}"
REALM_ADMIN_USER="${KC_NEW_REALM_ADMIN_USER:-}"
REALM_ADMIN_PASSWORD="${KC_NEW_REALM_ADMIN_PASSWORD:-}"

STEP7_WAIT_SECONDS="${STEP7_WAIT_SECONDS:-180}"
STEP7_POLL_INTERVAL_SECONDS="${STEP7_POLL_INTERVAL_SECONDS:-3}"
STEP7_MARKER_FILE="${STEP7_MARKER_FILE:-/opt/keycloak/data/.step7-init-done}"
STEP7_FORCE="${STEP7_FORCE:-false}"

# Name of the parent group for all app role hierarchies
APPROLES_GROUP_NAME="AppRoles"

# Name of the base realm role granted to all PCAs
PCA_BASE_ROLE_NAME="delegated-client-admin-base"
PCA_BASE_ROLE_DESC="Base composites for Per-Client Admins. Grants admin console access to manage own client and view users."

required_vars=(
  REALM_NAME
  REALM_ADMIN_USER
  REALM_ADMIN_PASSWORD
)

for v in "${required_vars[@]}"; do
  if [[ -z "${!v}" ]]; then
    echo "STEP7 ERROR: required env var $v is empty"
    exit 1
  fi
done

if [[ "$STEP7_FORCE" != "true" && -f "$STEP7_MARKER_FILE" ]]; then
  echo "STEP7: marker exists at $STEP7_MARKER_FILE; skipping (set STEP7_FORCE=true to rerun)."
  exit 0
fi

deadline=$(( $(date +%s) + STEP7_WAIT_SECONDS ))
echo "STEP7: waiting for Keycloak at ${SERVER_URL} ..."
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
    echo "STEP7 ERROR: Keycloak did not become ready within ${STEP7_WAIT_SECONDS}s."
    [[ -n "$last_auth_error" ]] && echo "STEP7 ERROR: last login error: ${last_auth_error}"
    exit 1
  fi
  sleep "$STEP7_POLL_INTERVAL_SECONDS"
done
echo "STEP7: Keycloak is ready."

kcadm() {
  "$KCADM_BIN" "$@" --config "$KCADM_CONFIG"
}

# ============================================================================
# STEP 7: AppRoles Group + delegated-client-admin-base Role Bootstrap
# ============================================================================

echo "STEP7: Setting up AppRoles group hierarchy..."

# ── 1. Create AppRoles parent group ─────────────────────────────────────────
echo "STEP7: Checking for '$APPROLES_GROUP_NAME' group..."
EXISTING_GROUP_ID=$(kcadm get groups -r "$REALM_NAME" -q search="$APPROLES_GROUP_NAME" \
  --fields id,name 2>/dev/null \
  | jq -r --arg name "$APPROLES_GROUP_NAME" '.[] | select(.name == $name) | .id' 2>/dev/null || true)

if [[ -n "$EXISTING_GROUP_ID" ]]; then
  echo "STEP7: '$APPROLES_GROUP_NAME' group already exists (id=$EXISTING_GROUP_ID)"
  APPROLES_GROUP_ID="$EXISTING_GROUP_ID"
else
  echo "STEP7: Creating '$APPROLES_GROUP_NAME' group..."
  kcadm create groups -r "$REALM_NAME" -s "name=$APPROLES_GROUP_NAME" >/dev/null
  APPROLES_GROUP_ID=$(kcadm get groups -r "$REALM_NAME" -q search="$APPROLES_GROUP_NAME" \
    --fields id,name \
    | jq -r --arg name "$APPROLES_GROUP_NAME" '.[] | select(.name == $name) | .id')
  echo "STEP7: '$APPROLES_GROUP_NAME' group created (id=$APPROLES_GROUP_ID)"
fi

# ── 2. Create delegated-client-admin-base realm role ───────────────────────────────────────────
echo "STEP7: Checking for '$PCA_BASE_ROLE_NAME' realm role..."
if kcadm get "roles/$PCA_BASE_ROLE_NAME" -r "$REALM_NAME" >/dev/null 2>&1; then
  echo "STEP7: '$PCA_BASE_ROLE_NAME' role already exists, updating description..."
  kcadm update "roles/$PCA_BASE_ROLE_NAME" -r "$REALM_NAME" \
    -s "description=$PCA_BASE_ROLE_DESC"
else
  echo "STEP7: Creating '$PCA_BASE_ROLE_NAME' realm role..."
  kcadm create roles -r "$REALM_NAME" \
    -s "name=$PCA_BASE_ROLE_NAME" \
    -s "description=$PCA_BASE_ROLE_DESC"
fi

# ── 3. Assign realm-management composites to delegated-client-admin-base ───────────────────────
# Same composites as client-manager, except create-client (PCAs don't create new clients).
# view-clients + query-clients: admin console shows Clients menu + list.
# manage-clients: Save button works when editing their own client.
# view-users + query-users: browse user directory to add to role subgroups.
# query-groups: list groups in the admin console (needed to browse AppRoles hierarchy).
# NOTE: There is no 'manage-groups' realm-management role in Keycloak 26.
#   Group CREATE/MANAGE permissions are handled by FGAP v2 step7-fgap-init via
#   the 'manage' scope on the Groups resource type for delegated-client-admin-base role holders.
echo "STEP7: Assigning composites to '$PCA_BASE_ROLE_NAME'..."
kcadm add-roles -r "$REALM_NAME" \
  --rname "$PCA_BASE_ROLE_NAME" \
  --cclientid realm-management \
  --rolename view-clients \
  --rolename query-clients \
  --rolename manage-clients \
  --rolename view-users \
  --rolename query-users \
  --rolename query-groups \
  --rolename manage-users \
  >/dev/null || true

echo "STEP7: Verifying '$PCA_BASE_ROLE_NAME' composites..."
kcadm get-roles -r "$REALM_NAME" --rname "$PCA_BASE_ROLE_NAME" --effective --cclientid realm-management \
  | jq -r '.[] | .name' || true

# ── 4. Map delegated-client-admin-base role to AppRoles group ───────────────────────────────────
# IMPORTANT: group role mappings propagate to subgroups. This means ALL members
# of AppRoles and its children (app groups and role subgroups) will inherit
# delegated-client-admin-base composites. This is intentional for role-subgroup members to have
# read-only client view access, but PCAs get additional manage rights via FGAP v2.
#
# If you do NOT want role-subgroup members (end users) to have admin console access,
# do NOT map delegated-client-admin-base to AppRoles here. Instead, the event listener assigns delegated-client-admin-base
# directly to the PCA creator (see DelegatedAdminGuardEventListener).
# Mapping is skipped here for that reason. Role assignment is done per-PCA by the
# event listener and realm admin.
echo "STEP7: Skipping group role mapping for delegated-client-admin-base (assigned per-PCA by event listener)."
echo "STEP7:   Rationale: group role mappings propagate to all subgroup members (including"
echo "STEP7:   end-user role subgroups like AppRoles/{app}/doctor). delegated-client-admin-base is assigned"
echo "STEP7:   directly to PCA users only to avoid granting admin console composites to"
echo "STEP7:   application end-users."

# ── 5. Ensure appRoles claim mapper on org-minimal scope ───────────────────
echo "STEP7: Ensuring appRoles mapper on client scope 'org-minimal'..."
ORG_MINIMAL_SCOPE_ID="$(kcadm get client-scopes -r "$REALM_NAME" --fields id,name \
  | jq -r '.[] | select(.name=="org-minimal") | .id' | head -n1)"

if [[ -z "${ORG_MINIMAL_SCOPE_ID:-}" ]]; then
  echo "STEP7 ERROR: client scope 'org-minimal' not found. Run step3-init first."
  exit 1
fi

APP_ROLES_MAPPER_ID="$(kcadm get "client-scopes/${ORG_MINIMAL_SCOPE_ID}/protocol-mappers/models" -r "$REALM_NAME" \
  | jq -r '.[] | select(.name=="app-roles") | .id' | head -n1 || true)"

if [[ -n "${APP_ROLES_MAPPER_ID:-}" ]]; then
  kcadm delete "client-scopes/${ORG_MINIMAL_SCOPE_ID}/protocol-mappers/models/${APP_ROLES_MAPPER_ID}" -r "$REALM_NAME" >/dev/null
fi

MAPPER_PAYLOAD="$(mktemp)"
cat >"$MAPPER_PAYLOAD" <<JSON
{
  "name": "app-roles",
  "protocol": "openid-connect",
  "protocolMapper": "oidc-approles-mapper",
  "config": {
    "claim.name": "appRoles",
    "jsonType.label": "String",
    "multivalued": "true",
    "approles.root.group": "AppRoles",
    "access.token.claim": "true",
    "id.token.claim": "true",
    "userinfo.token.claim": "true"
  }
}
JSON
kcadm create "client-scopes/${ORG_MINIMAL_SCOPE_ID}/protocol-mappers/models" -r "$REALM_NAME" -f "$MAPPER_PAYLOAD" >/dev/null
rm -f "$MAPPER_PAYLOAD"
echo "STEP7: ensured mapper 'app-roles' (claim: appRoles) on org-minimal."

# Create marker file
touch "$STEP7_MARKER_FILE"
echo "STEP7: ═══════════════════════════════════════════════════"
echo "STEP7: ✅ Step 7 Bootstrap Complete!"
echo "STEP7:    '$APPROLES_GROUP_NAME' group id: $APPROLES_GROUP_ID"
echo "STEP7:    '$PCA_BASE_ROLE_NAME' role created with composites:"
echo "STEP7:      view-clients, query-clients, manage-clients, view-users, query-users"
echo "STEP7:    On CLIENT_CREATE: event listener auto-creates AppRoles/{clientId}"
echo "STEP7:      and assigns delegated-client-admin-base to the creator."
echo "STEP7: ═══════════════════════════════════════════════════"
echo "STEP7: Marker created at $STEP7_MARKER_FILE"

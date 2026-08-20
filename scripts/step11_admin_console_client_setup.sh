#!/usr/bin/env bash
set -euo pipefail

# Ensure unbuffered output for docker logs
exec 1>/proc/1/fd/1 2>/proc/1/fd/2 2>/dev/null || true

# STEP 11: OIDC client for the standalone admin-console app (Next.js).
#
# admin-console/ is a separate deployable that lets:
#   - user-manager holders run an HR self-service dashboard (create/search
#     users, enable/disable, reset credentials, resend onboarding, assign
#     to existing groups)
#   - delegated-client-admin-base holders (PCAs) run a self-service custom
#     group management dashboard scoped to their own AppRoles/{clientId}
#     subtree
#
# Both dashboards authenticate the signed-in user via this client and then
# call the Keycloak Admin REST API directly with that user's own access
# token. Authorization is enforced entirely by Keycloak itself (FGAP v2 +
# custom-delegated-admin-guard-spi) - this client only grants login, it
# grants no admin capability on its own.

KCADM_BIN="${KCADM_BIN:-/opt/keycloak/bin/kcadm.sh}"
KCADM_CONFIG="${KCADM_CONFIG:-/tmp/.kcadm_step11.config}"
SERVER_URL="${KC_SERVER_URL:-http://keycloak:8080}"
REALM_NAME="${KC_NEW_REALM_NAME:-}"
REALM_ADMIN_USER="${KC_NEW_REALM_ADMIN_USER:-}"
REALM_ADMIN_PASSWORD="${KC_NEW_REALM_ADMIN_PASSWORD:-}"

ADMIN_CONSOLE_CLIENT_ID="${ADMIN_CONSOLE_CLIENT_ID:-hr-client-admin-console}"
ADMIN_CONSOLE_CLIENT_SECRET="${ADMIN_CONSOLE_CLIENT_SECRET:-}"
ADMIN_CONSOLE_APP_URL="${ADMIN_CONSOLE_APP_URL:-http://localhost:3100}"

STEP11_WAIT_SECONDS="${STEP11_WAIT_SECONDS:-180}"
STEP11_POLL_INTERVAL_SECONDS="${STEP11_POLL_INTERVAL_SECONDS:-3}"
STEP11_MARKER_FILE="${STEP11_MARKER_FILE:-/opt/keycloak/data/.step11-init-done}"
STEP11_FORCE="${STEP11_FORCE:-false}"

required_vars=(
  REALM_NAME
  REALM_ADMIN_USER
  REALM_ADMIN_PASSWORD
  ADMIN_CONSOLE_CLIENT_SECRET
)

for v in "${required_vars[@]}"; do
  if [[ -z "${!v}" ]]; then
    echo "STEP11 ERROR: required env var $v is empty"
    exit 1
  fi
done

if [[ "$ADMIN_CONSOLE_CLIENT_SECRET" == change_* ]]; then
  echo "STEP11 ERROR: ADMIN_CONSOLE_CLIENT_SECRET still uses a placeholder value. Set a real secret in .env."
  exit 1
fi

if [[ "$STEP11_FORCE" != "true" && -f "$STEP11_MARKER_FILE" ]]; then
  echo "STEP11: marker exists at $STEP11_MARKER_FILE; skipping (set STEP11_FORCE=true to rerun)."
  exit 0
fi

deadline=$(( $(date +%s) + STEP11_WAIT_SECONDS ))
echo "STEP11: waiting for Keycloak at ${SERVER_URL} ..."
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
    echo "STEP11 ERROR: Keycloak did not become ready within ${STEP11_WAIT_SECONDS}s."
    if [[ -n "$last_auth_error" ]]; then
      echo "STEP11 ERROR: last login error: ${last_auth_error}"
    fi
    exit 1
  fi
  sleep "$STEP11_POLL_INTERVAL_SECONDS"
done
echo "STEP11: authenticated as ${REALM_ADMIN_USER} in realm ${REALM_NAME}."

kcadm() { "$KCADM_BIN" "$@" --config "$KCADM_CONFIG"; }

REDIRECT_URI="${ADMIN_CONSOLE_APP_URL%/}/api/auth/callback/keycloak"
LOGOUT_REDIRECT_URI="${ADMIN_CONSOLE_APP_URL%/}/*"

echo "STEP11: ensuring OIDC client '${ADMIN_CONSOLE_CLIENT_ID}'..."
EXISTING_ID="$(kcadm get clients -r "$REALM_NAME" -q clientId="$ADMIN_CONSOLE_CLIENT_ID" --fields id --format csv --noquotes | head -n1 || true)"

if [[ -n "$EXISTING_ID" ]]; then
  echo "STEP11: client exists (id=$EXISTING_ID), updating..."
  kcadm update "clients/$EXISTING_ID" -r "$REALM_NAME" \
    -s "secret=${ADMIN_CONSOLE_CLIENT_SECRET}" \
    -s protocol=openid-connect \
    -s publicClient=false \
    -s standardFlowEnabled=true \
    -s implicitFlowEnabled=false \
    -s directAccessGrantsEnabled=false \
    -s serviceAccountsEnabled=false \
    -s "redirectUris=[\"${REDIRECT_URI}\"]" \
    -s "webOrigins=[\"${ADMIN_CONSOLE_APP_URL%/}\"]" \
    -s "attributes.post.logout.redirect.uris=${LOGOUT_REDIRECT_URI}" \
    >/dev/null
else
  echo "STEP11: creating client..."
  kcadm create clients -r "$REALM_NAME" \
    -s clientId="$ADMIN_CONSOLE_CLIENT_ID" \
    -s name="HR / Client Admin Console" \
    -s "description=Standalone Next.js app for HR user management (user-manager) and delegated client-admin group management (delegated-client-admin-base)." \
    -s secret="${ADMIN_CONSOLE_CLIENT_SECRET}" \
    -s protocol=openid-connect \
    -s publicClient=false \
    -s standardFlowEnabled=true \
    -s implicitFlowEnabled=false \
    -s directAccessGrantsEnabled=false \
    -s serviceAccountsEnabled=false \
    -s "redirectUris=[\"${REDIRECT_URI}\"]" \
    -s "webOrigins=[\"${ADMIN_CONSOLE_APP_URL%/}\"]" \
    -s "attributes.post.logout.redirect.uris=${LOGOUT_REDIRECT_URI}" \
    >/dev/null
  EXISTING_ID="$(kcadm get clients -r "$REALM_NAME" -q clientId="$ADMIN_CONSOLE_CLIENT_ID" --fields id --format csv --noquotes | head -n1)"
fi

echo "STEP11: client id=$EXISTING_ID redirectUri=${REDIRECT_URI}"

mkdir -p "$(dirname "$STEP11_MARKER_FILE")"
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$STEP11_MARKER_FILE"
echo "STEP11: completed successfully."

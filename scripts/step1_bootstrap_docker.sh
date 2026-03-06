#!/usr/bin/env bash
set -euo pipefail

# Ensure unbuffered output for docker logs
exec 1>/proc/1/fd/1 2>/proc/1/fd/2 2>/dev/null || true

KCADM_BIN="${KCADM_BIN:-/opt/keycloak/bin/kcadm.sh}"
KCADM_CONFIG="${KCADM_CONFIG:-/tmp/.kcadm_step1.config}"
SERVER_URL="${KC_SERVER_URL:-http://keycloak:8080}"
MASTER_REALM="master"

BOOT_USER="${KC_BOOTSTRAP_ADMIN_USERNAME:-}"
BOOT_PASS="${KC_BOOTSTRAP_ADMIN_PASSWORD:-}"

MASTER_ADMIN_USER="${KC_MASTER_ADMIN_USER:-}"
MASTER_ADMIN_PASSWORD="${KC_MASTER_ADMIN_PASSWORD:-}"

NEW_REALM_NAME="${KC_NEW_REALM_NAME:-}"
NEW_REALM_ADMIN_USER="${KC_NEW_REALM_ADMIN_USER:-}"
NEW_REALM_ADMIN_PASSWORD="${KC_NEW_REALM_ADMIN_PASSWORD:-}"

NEW_REALM_ADMIN_EMAIL="${KC_NEW_REALM_ADMIN_EMAIL:-}"
NEW_REALM_ADMIN_FIRST_NAME="${KC_NEW_REALM_ADMIN_FIRST_NAME:-Realm}"
NEW_REALM_ADMIN_FIRST_NAME="${KC_NEW_REALM_ADMIN_FIRST_NAME:-Realm}"
NEW_REALM_ADMIN_LAST_NAME="${KC_NEW_REALM_ADMIN_LAST_NAME:-Admin}"

KEYCLOAK_ENV="${KEYCLOAK_ENV:-production}"
if [[ "$KEYCLOAK_ENV" == "development" ]]; then
  SSL_REQUIRED="NONE"
else
  SSL_REQUIRED="external"
fi

STEP1_WAIT_SECONDS="${STEP1_WAIT_SECONDS:-180}"
STEP1_POLL_INTERVAL_SECONDS="${STEP1_POLL_INTERVAL_SECONDS:-3}"
STEP1_MARKER_FILE="${STEP1_MARKER_FILE:-/opt/keycloak/data/.step1-init-done}"
STEP1_FORCE="${STEP1_FORCE:-false}"
STEP1_RETIRE_BOOTSTRAP_ADMIN="${STEP1_RETIRE_BOOTSTRAP_ADMIN:-true}"

required_vars=(
  BOOT_USER
  BOOT_PASS
  MASTER_ADMIN_USER
  MASTER_ADMIN_PASSWORD
  NEW_REALM_NAME
  NEW_REALM_ADMIN_USER
  NEW_REALM_ADMIN_PASSWORD
)

for v in "${required_vars[@]}"; do
  if [[ -z "${!v}" ]]; then
    echo "STEP1 ERROR: required env var $v is empty"
    exit 1
  fi
done

if [[ "$STEP1_FORCE" != "true" && -f "$STEP1_MARKER_FILE" ]]; then
  echo "STEP1: marker exists at $STEP1_MARKER_FILE; skipping (set STEP1_FORCE=true to rerun)."
  exit 0
fi

if [[ "$MASTER_ADMIN_USER" == change_* || "$NEW_REALM_ADMIN_USER" == change_* ]]; then
  echo "STEP1 ERROR: placeholder usernames detected. Update KC_MASTER_ADMIN_USER and KC_NEW_REALM_ADMIN_USER."
  exit 1
fi

if [[ "$MASTER_ADMIN_PASSWORD" == change_* || "$NEW_REALM_ADMIN_PASSWORD" == change_* ]]; then
  echo "STEP1 ERROR: placeholder passwords detected. Update KC_MASTER_ADMIN_PASSWORD and KC_NEW_REALM_ADMIN_PASSWORD."
  exit 1
fi

deadline=$(( $(date +%s) + STEP1_WAIT_SECONDS ))
echo "STEP1: waiting for Keycloak at ${SERVER_URL} ..."
auth_with() {
  local realm="$1"
  local username="$2"
  local password="$3"
  "$KCADM_BIN" config credentials \
    --server "$SERVER_URL" \
    --realm "$realm" \
    --user "$username" \
    --password "$password" \
    --config "$KCADM_CONFIG" >/dev/null 2>&1
}

while true; do
  if auth_with "$MASTER_REALM" "$BOOT_USER" "$BOOT_PASS"; then
    echo "STEP1: authenticated with bootstrap admin."
    break
  fi
  if auth_with "$MASTER_REALM" "$MASTER_ADMIN_USER" "$MASTER_ADMIN_PASSWORD"; then
    echo "STEP1: bootstrap admin unavailable; authenticated with configured master admin."
    break
  fi
  if (( $(date +%s) >= deadline )); then
    echo "STEP1 ERROR: Keycloak did not become ready within ${STEP1_WAIT_SECONDS}s."
    exit 1
  fi
  sleep "$STEP1_POLL_INTERVAL_SECONDS"
done
echo "STEP1: Keycloak is ready."

kcadm() {
  "$KCADM_BIN" "$@" --config "$KCADM_CONFIG"
}

can_authenticate() {
  local realm="$1"
  local username="$2"
  local password="$3"
  local auth_cfg
  auth_cfg="$(mktemp)"
  if "$KCADM_BIN" config credentials \
      --server "$SERVER_URL" \
      --realm "$realm" \
      --user "$username" \
      --password "$password" \
      --config "$auth_cfg" >/dev/null 2>&1; then
    rm -f "$auth_cfg"
    return 0
  fi
  rm -f "$auth_cfg"
  return 1
}

lookup_user_id() {
  local realm="$1"
  local username="$2"
  local line id user
  while IFS= read -r line; do
    id="${line%%,*}"
    user="${line#*,}"
    if [[ "$user" == "$username" ]]; then
      echo "$id"
      return 0
    fi
  done < <(kcadm get users -r "$realm" -q username="$username" --fields id,username --format csv --noquotes)
  return 0
}

echo "STEP1: ensuring master admin user '${MASTER_ADMIN_USER}' ..."
master_user_id="$(lookup_user_id "$MASTER_REALM" "$MASTER_ADMIN_USER" || true)"
if [[ -z "$master_user_id" ]]; then
  kcadm create users -r "$MASTER_REALM" -s username="$MASTER_ADMIN_USER" -s enabled=true >/dev/null
  kcadm set-password -r "$MASTER_REALM" --username "$MASTER_ADMIN_USER" --new-password "$MASTER_ADMIN_PASSWORD" >/dev/null || true
  master_user_id="$(lookup_user_id "$MASTER_REALM" "$MASTER_ADMIN_USER")"
  echo "STEP1: created master admin user."
else
  echo "STEP1: master admin user already exists."
  if can_authenticate "$MASTER_REALM" "$MASTER_ADMIN_USER" "$MASTER_ADMIN_PASSWORD"; then
    echo "STEP1: master admin password already valid; skipping reset."
  else
    kcadm set-password -r "$MASTER_REALM" --username "$MASTER_ADMIN_USER" --new-password "$MASTER_ADMIN_PASSWORD" >/dev/null || true
  fi
fi

echo "STEP1: ensuring master realm admin role for '${MASTER_ADMIN_USER}' ..."
master_role_err="$(mktemp)"
if ! kcadm add-roles -r "$MASTER_REALM" --uusername "$MASTER_ADMIN_USER" --rolename admin >/dev/null 2>"$master_role_err"; then
  echo "STEP1 WARN: failed assigning master realm role 'admin' to '${MASTER_ADMIN_USER}'."
  sed 's/^/STEP1 WARN: /' "$master_role_err"
fi
rm -f "$master_role_err"

echo "STEP1: ensuring realm '${NEW_REALM_NAME}' ..."
if ! kcadm get "realms/${NEW_REALM_NAME}" >/dev/null 2>&1; then
  kcadm create realms -s realm="$NEW_REALM_NAME" -s displayName="$NEW_REALM_NAME" -s enabled=true -s sslRequired="$SSL_REQUIRED" >/dev/null
  echo "STEP1: realm created."
else
  echo "STEP1: realm already exists."
fi

echo "STEP1: ensuring realm admin user '${NEW_REALM_ADMIN_USER}' ..."
realm_user_id="$(lookup_user_id "$NEW_REALM_NAME" "$NEW_REALM_ADMIN_USER" || true)"
if [[ -z "$realm_user_id" ]]; then
  kcadm create users -r "$NEW_REALM_NAME" -s username="$NEW_REALM_ADMIN_USER" -s enabled=true >/dev/null
  kcadm set-password -r "$NEW_REALM_NAME" --username "$NEW_REALM_ADMIN_USER" --new-password "$NEW_REALM_ADMIN_PASSWORD" >/dev/null || true
  realm_user_id="$(lookup_user_id "$NEW_REALM_NAME" "$NEW_REALM_ADMIN_USER")"
  echo "STEP1: realm admin user created."
else
  echo "STEP1: realm admin user already exists."
  if can_authenticate "$NEW_REALM_NAME" "$NEW_REALM_ADMIN_USER" "$NEW_REALM_ADMIN_PASSWORD"; then
    echo "STEP1: realm admin password already valid; skipping reset."
  else
    kcadm set-password -r "$NEW_REALM_NAME" --username "$NEW_REALM_ADMIN_USER" --new-password "$NEW_REALM_ADMIN_PASSWORD" >/dev/null || true
  fi
fi

realm_role_err="$(mktemp)"
if ! kcadm add-roles -r "$NEW_REALM_NAME" --uusername "$NEW_REALM_ADMIN_USER" --cclientid realm-management --rolename realm-admin >/dev/null 2>"$realm_role_err"; then
  echo "STEP1 WARN: failed assigning realm-admin role to '$NEW_REALM_ADMIN_USER' in '$NEW_REALM_NAME'."
  sed 's/^/STEP1 WARN: /' "$realm_role_err"
fi
rm -f "$realm_role_err"

if [[ -n "$NEW_REALM_ADMIN_EMAIL" && -n "$realm_user_id" ]]; then
  cmd_args=(
    "-s" "email=$NEW_REALM_ADMIN_EMAIL"
    "-s" "firstName=$NEW_REALM_ADMIN_FIRST_NAME"
    "-s" "lastName=$NEW_REALM_ADMIN_LAST_NAME"
    "-s" "emailVerified=true"
  )
  kcadm update "users/${realm_user_id}" -r "$NEW_REALM_NAME" "${cmd_args[@]}" >/dev/null
fi

# Ensure the automation realm-admin account can use direct grant (kcadm) without
# being blocked by pending required actions.
if [[ -n "$realm_user_id" ]]; then
  kcadm update "users/${realm_user_id}" -r "$NEW_REALM_NAME" \
    -s 'requiredActions=[]' \
    -s emailVerified=true >/dev/null || true

  # Keep this automation account usable with direct-grant kcadm by removing OTP
  # credentials; direct grant cannot satisfy OTP challenges interactively.
  while IFS= read -r line; do
    cred_id="${line%%,*}"
    cred_type="${line#*,}"
    [[ -z "$cred_id" ]] && continue
    if [[ "$cred_type" == "otp" ]]; then
      kcadm delete "users/${realm_user_id}/credentials/${cred_id}" -r "$NEW_REALM_NAME" >/dev/null || true
    fi
  done < <(kcadm get "users/${realm_user_id}/credentials" -r "$NEW_REALM_NAME" --fields id,type --format csv --noquotes 2>/dev/null || true)
fi

echo "STEP1: ensuring admin-cli direct access grants in realm '${NEW_REALM_NAME}' ..."
admin_cli_id="$(kcadm get clients -r "$NEW_REALM_NAME" -q clientId=admin-cli --fields id --format csv --noquotes | head -n1 || true)"
if [[ -n "$admin_cli_id" ]]; then
  kcadm update "clients/${admin_cli_id}" -r "$NEW_REALM_NAME" -s directAccessGrantsEnabled=true >/dev/null
fi

echo "STEP1: applying realm themes ..."
kcadm update "realms/${NEW_REALM_NAME}" \
  -s loginTheme=vg \
  -s accountTheme=vg \
  -s adminTheme=admin-vg-custom >/dev/null
kcadm update "realms/${MASTER_REALM}" \
  -s sslRequired="$SSL_REQUIRED" \
  -s loginTheme=vg-master \
  -s accountTheme=vg-master \
  -s adminTheme=vg-master >/dev/null

if [[ "$STEP1_RETIRE_BOOTSTRAP_ADMIN" == "true" && "$BOOT_USER" != "$MASTER_ADMIN_USER" ]]; then
  echo "STEP1: evaluating bootstrap admin retirement for '${BOOT_USER}' ..."
  if can_authenticate "$MASTER_REALM" "$MASTER_ADMIN_USER" "$MASTER_ADMIN_PASSWORD"; then
    boot_user_id="$(lookup_user_id "$MASTER_REALM" "$BOOT_USER" || true)"
    if [[ -n "$boot_user_id" ]]; then
      kcadm delete "users/${boot_user_id}" -r "$MASTER_REALM" >/dev/null || true
      echo "STEP1: retired bootstrap admin user '${BOOT_USER}'."
    else
      echo "STEP1: bootstrap admin user '${BOOT_USER}' already absent."
    fi
  else
    echo "STEP1 WARN: configured master admin could not authenticate after role setup; bootstrap admin retained."
  fi
fi

mkdir -p "$(dirname "$STEP1_MARKER_FILE")"
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$STEP1_MARKER_FILE"

echo "STEP1: completed successfully."

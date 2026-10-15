#!/usr/bin/env bash
# Prepare the upgrade-test CLONE for live config tests:
#   1. Point every phone-OTP SMS gateway at a dead address, so tests run there
#      can never send a real SMS.
#   2. Make the realm admin from .env usable by the test client: set its
#      password to the .env value, clear brute-force lockout, and drop its OTP
#      credential (admins may have changed these in the UI on production).
#
# Safety: kcadm runs only inside the clone container, where localhost:8080 is
# the clone's own Keycloak. Production (vg-keycloak) is never contacted.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
CLONE_CONTAINER="vg-keycloak-upgrade-test"
BLACKHOLE_URL="http://127.0.0.1:9/sms-disabled-on-upgrade-test-clone"
KCADM_CONFIG="/tmp/kcadm-neutralize.config"

get_env_value() {
  local line
  line="$(grep -E "^$1=" "$ENV_FILE" | tail -n1 || true)"
  line="${line#*=}"
  line="${line%\"}"
  printf '%s' "${line#\"}"
}

if ! docker ps --format '{{.Names}}' | grep -qx "$CLONE_CONTAINER"; then
  echo "ERROR: $CLONE_CONTAINER is not running (make upgrade-test-up first)" >&2
  exit 1
fi

REALM="$(get_env_value KC_NEW_REALM_NAME)"
ADMIN_USER="$(get_env_value KC_MASTER_ADMIN_USER)"
ADMIN_PASSWORD="$(get_env_value KC_MASTER_ADMIN_PASSWORD)"
REALM_ADMIN_USER="$(get_env_value KC_NEW_REALM_ADMIN_USER)"
REALM_ADMIN_PASSWORD="$(get_env_value KC_NEW_REALM_ADMIN_PASSWORD)"

kcadm() { docker exec "$CLONE_CONTAINER" /opt/keycloak/bin/kcadm.sh "$@" --config "$KCADM_CONFIG"; }

echo "Waiting for clone readiness"
for _ in {1..60}; do
  docker exec "$CLONE_CONTAINER" bash -c 'exec 3<>/dev/tcp/localhost/8080' 2>/dev/null && break
  sleep 2
done

docker exec -e KCADM_PASSWORD="$ADMIN_PASSWORD" "$CLONE_CONTAINER" bash -c \
  '/opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080 --realm master \
     --user "$0" --password "$KCADM_PASSWORD" --config "$1" >/dev/null' "$ADMIN_USER" "$KCADM_CONFIG"

flows_json="$(kcadm get authentication/flows -r "$REALM")"
config_ids="$(
  printf '%s' "$flows_json" | python3 -c 'import json,sys; [print(f["alias"]) for f in json.load(sys.stdin)]' |
  while IFS= read -r alias; do
    encoded="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$alias")"
    kcadm get "authentication/flows/${encoded}/executions" -r "$REALM" |
      python3 -c 'import json,sys; [print(e["authenticationConfig"]) for e in json.load(sys.stdin) if e.get("providerId") == "phone-otp-authenticator" and e.get("authenticationConfig")]'
  done | sort -u
)"

if [[ -z "$config_ids" ]]; then
  echo "No phone-OTP authenticator configs found in clone realm $REALM; nothing to neutralize"
  exit 0
fi

for id in $config_ids; do
  kcadm get "authentication/config/${id}" -r "$REALM" |
    python3 -c 'import json,sys; d=json.load(sys.stdin); c=d.setdefault("config",{}); c["otp.endpoint.primary"]=sys.argv[1]; c["otp.endpoint.backup"]=""; print(json.dumps(d))' "$BLACKHOLE_URL" |
    docker exec -i "$CLONE_CONTAINER" /opt/keycloak/bin/kcadm.sh update "authentication/config/${id}" -r "$REALM" -f - --config "$KCADM_CONFIG"
  echo "Neutralized SMS gateway in clone authenticator config ${id}"
done

if [[ "${PREPARE_RESET_REALM_ADMIN:-true}" != "true" ]]; then
  echo "Skipping realm admin reset (PREPARE_RESET_REALM_ADMIN=false)"
  exit 0
fi

user_id="$(kcadm get users -r "$REALM" -q exact=true -q "username=${REALM_ADMIN_USER}" --fields id |
  python3 -c 'import json,sys; u=json.load(sys.stdin); print(u[0]["id"] if u else "")')"
if [[ -z "$user_id" ]]; then
  echo "ERROR: realm admin ${REALM_ADMIN_USER} not found in clone realm ${REALM}" >&2
  exit 1
fi

# The .env password may be in the password history; drop stored passwords
# first so the realm's history policy does not reject it (clone only).
for cred in $(kcadm get "users/${user_id}/credentials" -r "$REALM" |
  python3 -c 'import json,sys; [print(c["id"]) for c in json.load(sys.stdin) if c.get("type") in ("password", "password-history")]'); do
  kcadm delete "users/${user_id}/credentials/${cred}" -r "$REALM"
done
docker exec -e KCADM_PASSWORD="$REALM_ADMIN_PASSWORD" "$CLONE_CONTAINER" bash -c \
  '/opt/keycloak/bin/kcadm.sh set-password -r "$0" --userid "$1" --new-password "$KCADM_PASSWORD" --config "$2"' \
  "$REALM" "$user_id" "$KCADM_CONFIG"
kcadm delete "attack-detection/brute-force/users/${user_id}" -r "$REALM" >/dev/null
for cred in $(kcadm get "users/${user_id}/credentials" -r "$REALM" |
  python3 -c 'import json,sys; [print(c["id"]) for c in json.load(sys.stdin) if c.get("type") == "otp"]'); do
  kcadm delete "users/${user_id}/credentials/${cred}" -r "$REALM"
done
kcadm update "users/${user_id}" -r "$REALM" -s 'requiredActions=[]'
echo "Clone realm admin ${REALM_ADMIN_USER} reset for test login (clone only)"

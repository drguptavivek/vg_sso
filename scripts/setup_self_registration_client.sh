#!/usr/bin/env bash
set -euo pipefail

env_file="${SELF_REGISTRATION_ENV_FILE:-.env.self-registration}"
container="${CONTAINER_NAME:-vg-keycloak}"
kcadm_config="${KCADM_CONFIG:-/tmp/kcadm-master-admin.config}"
env_template="${SELF_REGISTRATION_ENV_TEMPLATE:-.env.self-registration.template}"

get_env() {
  local name="$1"
  grep -m1 "^${name}=" "$env_file" | cut -d= -f2- || true
}
set_env() {
  local name="$1" value="$2"
  if grep -q "^${name}=" "$env_file"; then
    sed -i "s|^${name}=.*$|${name}=${value}|" "$env_file"
  else
    sed -i "\$a${name}=${value}" "$env_file"
  fi
}
if [[ ! -f "$env_file" ]]; then
  if [[ ! -f "$env_template" ]]; then
    echo "ERROR: environment template not found: $env_template" >&2
    exit 1
  fi
  install -m 600 "$env_template" "$env_file"
fi
chmod 600 "$env_file"

realm="${KC_NEW_REALM_NAME:-$(grep -m1 '^KC_NEW_REALM_NAME=' .env | cut -d= -f2-)}"
client_id="${SELF_REGISTRATION_KEYCLOAK_CLIENT_ID:-$(get_env SELF_REGISTRATION_KEYCLOAK_CLIENT_ID)}"
client_id="${client_id:-sso-self-registration}"

if [[ -z "$realm" ]]; then
  echo "ERROR: KC_NEW_REALM_NAME is empty" >&2
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: openssl and jq are required" >&2
  exit 1
fi

registration_secret="$(get_env SELF_REGISTRATION_SECRET)"
if [[ -z "$registration_secret" || "$registration_secret" == change_* ]]; then
  registration_secret="$(openssl rand -hex 48)"
  set_env SELF_REGISTRATION_SECRET "$registration_secret"
fi
set_env SELF_REGISTRATION_KEYCLOAK_CLIENT_ID "$client_id"

kcadm() { docker exec "$container" /opt/keycloak/bin/kcadm.sh "$@" --config "$kcadm_config"; }
client_uuid="$(kcadm get clients -r "$realm" -q clientId="$client_id" --fields id --format csv --noquotes | head -n1)"

if [[ -z "$client_uuid" ]]; then
  kcadm create clients -r "$realm" \
    -s clientId="$client_id" \
    -s enabled=true \
    -s publicClient=false \
    -s bearerOnly=false \
    -s standardFlowEnabled=false \
    -s directAccessGrantsEnabled=false \
    -s serviceAccountsEnabled=true \
    -s clientAuthenticatorType=client-secret >/dev/null
  client_uuid="$(kcadm get clients -r "$realm" -q clientId="$client_id" --fields id --format csv --noquotes | head -n1)"
else
  kcadm update clients/"$client_uuid" -r "$realm" \
    -s enabled=true \
    -s publicClient=false \
    -s bearerOnly=false \
    -s standardFlowEnabled=false \
    -s directAccessGrantsEnabled=false \
    -s serviceAccountsEnabled=true \
    -s clientAuthenticatorType=client-secret >/dev/null
fi

if [[ "${SELF_REGISTRATION_ROTATE_SECRET:-false}" == "true" ]]; then
  kcadm create clients/"$client_uuid"/client-secret -r "$realm" >/dev/null
fi
client_secret="$(kcadm get clients/"$client_uuid"/client-secret -r "$realm" | jq -r .value)"
if [[ -z "$client_secret" || "$client_secret" == "null" ]]; then
  kcadm create clients/"$client_uuid"/client-secret -r "$realm" >/dev/null
  client_secret="$(kcadm get clients/"$client_uuid"/client-secret -r "$realm" | jq -r .value)"
fi
if [[ -z "$client_secret" || "$client_secret" == "null" ]]; then
  echo "ERROR: Keycloak did not return a client secret" >&2
  exit 1
fi
set_env SELF_REGISTRATION_KEYCLOAK_CLIENT_SECRET "$client_secret"

if ! kcadm get roles/self-registration-service -r "$realm" >/dev/null 2>&1; then
  kcadm create roles -r "$realm" \
    -s name=self-registration-service \
    -s 'description=Server-only role restricted by delegated-admin-guard to self-registration account creation' >/dev/null
fi

service_username="service-account-${client_id}"
kcadm add-roles -r "$realm" --uusername "$service_username" \
  --rolename self-registration-service >/dev/null
kcadm add-roles -r "$realm" --uusername "$service_username" \
  --cclientid realm-management \
  --rolename query-users \
  --rolename view-users \
  --rolename manage-users >/dev/null

echo "Self-registration client '$client_id' is configured in realm '$realm'."
echo "Its service account is restricted by the custom guard to user search, account creation, and compensating delete."
echo "Generated secrets were saved to $env_file (mode 0600); values were not printed."

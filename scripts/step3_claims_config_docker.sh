#!/usr/bin/env bash
set -euo pipefail

# Ensure unbuffered output for docker logs
exec 1>/proc/1/fd/1 2>/proc/1/fd/2 2>/dev/null || true

KCADM_BIN="${KCADM_BIN:-/opt/keycloak/bin/kcadm.sh}"
KCADM_CONFIG="${KCADM_CONFIG:-/tmp/.kcadm_step3.config}"
SERVER_URL="${KC_SERVER_URL:-http://keycloak:8080}"

REALM_NAME="${KC_NEW_REALM_NAME:-}"
REALM_ADMIN_USER="${KC_NEW_REALM_ADMIN_USER:-}"
REALM_ADMIN_PASSWORD="${KC_NEW_REALM_ADMIN_PASSWORD:-}"

STEP3_WAIT_SECONDS="${STEP3_WAIT_SECONDS:-180}"
STEP3_POLL_INTERVAL_SECONDS="${STEP3_POLL_INTERVAL_SECONDS:-3}"
STEP3_MARKER_FILE="${STEP3_MARKER_FILE:-/opt/keycloak/data/.step3-init-done}"
STEP3_FORCE="${STEP3_FORCE:-false}"

required_vars=(
  REALM_NAME
  REALM_ADMIN_USER
  REALM_ADMIN_PASSWORD
)

for v in "${required_vars[@]}"; do
  if [[ -z "${!v}" ]]; then
    echo "STEP3 ERROR: required env var $v is empty"
    exit 1
  fi
done

if [[ "$STEP3_FORCE" != "true" && -f "$STEP3_MARKER_FILE" ]]; then
  echo "STEP3: marker exists at $STEP3_MARKER_FILE; skipping (set STEP3_FORCE=true to rerun)."
  exit 0
fi

deadline=$(( $(date +%s) + STEP3_WAIT_SECONDS ))
echo "STEP3: waiting for Keycloak at ${SERVER_URL} ..."
while true; do
  if "$KCADM_BIN" config credentials \
      --server "$SERVER_URL" \
      --realm "$REALM_NAME" \
      --user "$REALM_ADMIN_USER" \
      --password "$REALM_ADMIN_PASSWORD" \
      --config "$KCADM_CONFIG" >/dev/null 2>&1; then
    break
  fi
  if (( $(date +%s) >= deadline )); then
    echo "STEP3 ERROR: Keycloak did not become ready within ${STEP3_WAIT_SECONDS}s."
    exit 1
  fi
  sleep "$STEP3_POLL_INTERVAL_SECONDS"
done
echo "STEP3: Keycloak is ready."

kcadm() {
  "$KCADM_BIN" "$@" --config "$KCADM_CONFIG"
}

lookup_scope_id() {
  local scope_name="$1"
  local line id name
  while IFS= read -r line; do
    id="${line%%,*}"
    name="${line#*,}"
    if [[ "$name" == "$scope_name" ]]; then
      echo "$id"
      return 0
    fi
  done < <(kcadm get client-scopes -r "$REALM_NAME" --fields id,name --format csv --noquotes)
  return 0
}

ensure_scope() {
  local scope_name="$1"
  local sid
  sid="$(lookup_scope_id "$scope_name" || true)"
  if [[ -z "$sid" ]]; then
    kcadm create client-scopes -r "$REALM_NAME" \
      -s name="$scope_name" \
      -s protocol=openid-connect >/dev/null
    sid="$(lookup_scope_id "$scope_name")"
    echo "STEP3: created scope '$scope_name'." >&2
  fi
  echo "$sid"
}

lookup_mapper_id() {
  local scope_id="$1"
  local mapper_name="$2"
  local line id name
  while IFS= read -r line; do
    id="${line%%,*}"
    name="${line#*,}"
    if [[ "$name" == "$mapper_name" ]]; then
      echo "$id"
      return 0
    fi
  done < <(kcadm get "client-scopes/${scope_id}/protocol-mappers/models" -r "$REALM_NAME" --fields id,name --format csv --noquotes)
  return 0
}

upsert_mapper() {
  local scope_id="$1"
  local mapper_name="$2"
  local payload_file="$3"
  local mid
  mid="$(lookup_mapper_id "$scope_id" "$mapper_name" || true)"
  if [[ -n "$mid" ]]; then
    kcadm delete "client-scopes/${scope_id}/protocol-mappers/models/${mid}" -r "$REALM_NAME" >/dev/null
  fi
  kcadm create "client-scopes/${scope_id}/protocol-mappers/models" -r "$REALM_NAME" -f "$payload_file" >/dev/null
}

delete_mapper_if_exists() {
  local scope_id="$1"
  local mapper_name="$2"
  local mid
  mid="$(lookup_mapper_id "$scope_id" "$mapper_name" || true)"
  if [[ -n "$mid" ]]; then
    kcadm delete "client-scopes/${scope_id}/protocol-mappers/models/${mid}" -r "$REALM_NAME" >/dev/null
    echo "STEP3: removed mapper '$mapper_name' from scope id '$scope_id'."
  fi
}

ensure_default_scope() {
  local scope_id="$1"
  local line id
  while IFS= read -r line; do
    id="${line%%,*}"
    if [[ "$id" == "$scope_id" ]]; then
      return 0
    fi
  done < <(kcadm get default-default-client-scopes -r "$REALM_NAME" --fields id,name --format csv --noquotes)
  kcadm update "default-default-client-scopes/${scope_id}" -r "$REALM_NAME" >/dev/null
}

create_mapper_payload_group_attrs() {
  local file="$1"
  local name="$2"
  local claim="$3"
  cat >"$file" <<JSON
{
  "name": "$name",
  "protocol": "openid-connect",
  "protocolMapper": "oidc-group-attributes-mapper",
  "config": {
    "claim.name": "$claim",
    "jsonType.label": "JSON",
    "multivalued": "true",
    "full.path": "true",
    "include.attributes": "true",
    "access.token.claim": "true",
    "id.token.claim": "true",
    "userinfo.token.claim": "true"
  }
}
JSON
}

create_mapper_payload_user_attr() {
  local file="$1"
  local name="$2"
  local user_attr="$3"
  local claim="$4"
  local multivalued="${5:-false}"
  cat >"$file" <<JSON
{
  "name": "$name",
  "protocol": "openid-connect",
  "protocolMapper": "oidc-usermodel-attribute-mapper",
  "config": {
    "user.attribute": "$user_attr",
    "claim.name": "$claim",
    "jsonType.label": "String",
    "multivalued": "$multivalued",
    "id.token.claim": "true",
    "access.token.claim": "true",
    "userinfo.token.claim": "true"
  }
}
JSON
}

create_mapper_payload_user_prop() {
  local file="$1"
  local name="$2"
  local user_attr="$3"
  local claim="$4"
  cat >"$file" <<JSON
{
  "name": "$name",
  "protocol": "openid-connect",
  "protocolMapper": "oidc-usermodel-property-mapper",
  "config": {
    "user.attribute": "$user_attr",
    "claim.name": "$claim",
    "jsonType.label": "String",
    "id.token.claim": "true",
    "access.token.claim": "true",
    "userinfo.token.claim": "true"
  }
}
JSON
}

create_mapper_payload_account_expiry_warning() {
  local file="$1"
  local name="$2"
  local claim="$3"
  local warning_window_days="${4:-28}"
  cat >"$file" <<JSON
{
  "name": "$name",
  "protocol": "openid-connect",
  "protocolMapper": "oidc-account-expiry-warning-mapper",
  "config": {
    "claim.name": "$claim",
    "jsonType.label": "JSON",
    "warning.window.days": "$warning_window_days",
    "id.token.claim": "true",
    "access.token.claim": "true",
    "userinfo.token.claim": "true"
  }
}
JSON
}

echo "STEP3: ensuring scope 'org-minimal' ..."
org_minimal_id="$(ensure_scope "org-minimal")"

payload="$(mktemp)"
create_mapper_payload_group_attrs "$payload" "group-details" "group_details"
upsert_mapper "$org_minimal_id" "group-details" "$payload"

create_mapper_payload_user_attr "$payload" "employment_type" "employment_type" "employment_type" "false"
upsert_mapper "$org_minimal_id" "employment_type" "$payload"

create_mapper_payload_user_prop "$payload" "preferred_username" "username" "preferred_username"
upsert_mapper "$org_minimal_id" "preferred_username" "$payload"

create_mapper_payload_account_expiry_warning "$payload" "account_expiry" "account_expiry" "28"
upsert_mapper "$org_minimal_id" "account_expiry" "$payload"

ensure_default_scope "$org_minimal_id"
echo "STEP3: ensured 'org-minimal' as default scope."

echo "STEP3: ensuring scope 'detail-profile' ..."
detail_scope_id="$(ensure_scope "detail-profile")"

for a in phone_number employment_type designation last_date; do
  create_mapper_payload_user_attr "$payload" "$a" "$a" "$a" "false"
  upsert_mapper "$detail_scope_id" "$a" "$payload"
done

create_mapper_payload_user_attr "$payload" "posts" "posts" "posts" "true"
upsert_mapper "$detail_scope_id" "posts" "$payload"

create_mapper_payload_user_prop "$payload" "firstName" "firstName" "given_name"
upsert_mapper "$detail_scope_id" "firstName" "$payload"

create_mapper_payload_user_prop "$payload" "lastName" "lastName" "family_name"
upsert_mapper "$detail_scope_id" "lastName" "$payload"

create_mapper_payload_user_prop "$payload" "email" "email" "email"
upsert_mapper "$detail_scope_id" "email" "$payload"

delete_mapper_if_exists "$detail_scope_id" "remarks"

rm -f "$payload"

mkdir -p "$(dirname "$STEP3_MARKER_FILE")"
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$STEP3_MARKER_FILE"

echo "STEP3: completed successfully."

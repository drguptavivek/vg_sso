#!/bin/bash
set -eo pipefail

# Ensure unbuffered output for docker logs
exec 1>/proc/1/fd/1 2>/proc/1/fd/2 2>/dev/null || true

echo "===================================================="
echo "STEP 5: Configuring Account Expiry & Form Flow"
echo "===================================================="

# Check if Keycloak is ready
MAX_RETRIES=150
RETRY_COUNT=0
while ! curl -s --head -f http://keycloak:8080/ > /dev/null; do
  RETRY_COUNT=$((RETRY_COUNT+1))
  if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
    echo "STEP5: Error - Keycloak health endpoint not reachable after $MAX_RETRIES attempts."
    exit 1
  fi
  echo "STEP5: Waiting for Keycloak to start (attempt $RETRY_COUNT)..."
  sleep 2
done

export PATH=$PATH:/opt/keycloak/bin

REALM_NAME="${KC_NEW_REALM_NAME:-org-new-delhi}"
REALM_ADMIN_USER="${KC_NEW_REALM_ADMIN_USER}"
REALM_ADMIN_PASSWORD="${KC_NEW_REALM_ADMIN_PASSWORD}"
STEP5_MARKER_FILE="/opt/keycloak/data/step5_expiry_configured.marker"
DEFAULT_EXPIRY_TIMEZONE="${STEP5_DEFAULT_EXPIRY_TIMEZONE:-Asia/Kolkata}"
DEFAULT_EXPIRY_BASE_YEARS="${STEP5_DEFAULT_EXPIRY_BASE_YEARS:-1}"
DEFAULT_EXPIRY_RANDOM_MIN_WEEKS="${STEP5_DEFAULT_EXPIRY_RANDOM_MIN_WEEKS:-2}"
DEFAULT_EXPIRY_RANDOM_MAX_WEEKS="${STEP5_DEFAULT_EXPIRY_RANDOM_MAX_WEEKS:-8}"

# Standard authentication variables from environment
ADMIN_USER="${KEYCLOAK_ADMIN:-admin}"
ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-admin}"
SERVER_URL="http://keycloak:8080"

echo "STEP5: Authenticating with kcadm..."
/opt/keycloak/bin/kcadm.sh config credentials --server "$SERVER_URL" --realm master --user "$ADMIN_USER" --password "$ADMIN_PASSWORD"

step5_state_is_applied() {
  local profile_json
  profile_json="$(/opt/keycloak/bin/kcadm.sh get "realms/$REALM_NAME/users/profile" 2>/dev/null || true)"
  if [[ -z "$profile_json" ]]; then
    return 1
  fi
  echo "$profile_json" | jq -e '
    (.attributes // []) as $attrs
    | any($attrs[]?; .name == "account_expiry_date")
      and any($attrs[]?; .name == "account_expiry_timezone")
  ' >/dev/null 2>&1
}

if [ -f "$STEP5_MARKER_FILE" ] && [ "${STEP5_FORCE:-false}" != "true" ]; then
  if step5_state_is_applied; then
    echo "STEP5: Configuration already completed. Skipping (set STEP5_FORCE=true to force)."
    exit 0
  fi
  echo "STEP5: Marker exists but expiry schema is missing; reapplying Step 5."
fi

# Target flow alias from Step 4
FLOW_ALIAS="browser-PhoneOTP"
FORMS_ALIAS="$FLOW_ALIAS forms"
FORMS_ALIAS_ENCODED=$(jq -rn --arg s "$FORMS_ALIAS" '$s|@uri')

update_execs() {
  local endpoint="$1"
  local id="$2"
  local req="$3"
  local idx="$4"
  local pr="$5"
  [[ -z "$id" || "$id" == "null" ]] && return 0

  local payload
  payload="$(mktemp)"
  cat >"$payload" <<JSON
{
  "id": "$id",
  "requirement": "$req",
  "index": $idx,
  "priority": $pr
}
JSON
  /opt/keycloak/bin/kcadm.sh update "$endpoint" -n -r "$REALM_NAME" -f "$payload" >/dev/null
  rm -f "$payload"
}

# 1. Verify forms subflow exists by querying parent flow executions
EXECS=$(/opt/keycloak/bin/kcadm.sh get "authentication/flows/$FLOW_ALIAS/executions" -r "$REALM_NAME")
FORMS_FLOW=$(echo "$EXECS" | jq -c ".[] | select(.displayName == \"$FORMS_ALIAS\")")
if [[ -z "$FORMS_FLOW" ]]; then
  echo "STEP5: Error - Flow '$FORMS_ALIAS' not found in $FLOW_ALIAS. Ensure Step 4 was run first."
  exit 1
fi

# 2. Add Account Expiry logic to the forms subflow
EXEC_DATA=$(echo "$EXECS" | jq -c '.[] | select(.providerId == "account-expiry-check-authenticator")')
if [[ -z "$EXEC_DATA" ]]; then
  # Inject execution into the subflow. kcadm create execution adds it at index 0.
  /opt/keycloak/bin/kcadm.sh create "authentication/flows/$FORMS_ALIAS_ENCODED/executions/execution" -r "$REALM_NAME" -s provider=account-expiry-check-authenticator >/dev/null 2>&1 || true
  echo "STEP5: Injected account-expiry-check-authenticator into subflow."
fi

# Re-fetch direct forms executions and apply deterministic ordering.
FORMS_EXECS=$(/opt/keycloak/bin/kcadm.sh get "authentication/flows/$FORMS_ALIAS_ENCODED/executions" -r "$REALM_NAME")
PWD_FORM_EXEC_ID=$(echo "$FORMS_EXECS" | jq -r '.[] | select(.providerId == "auth-username-password-form") | .id' | head -n1)
EXPIRY_EXEC_ID=$(echo "$FORMS_EXECS" | jq -r '.[] | select(.providerId == "account-expiry-check-authenticator") | .id' | head -n1)
PHONE_EXEC_ID=$(echo "$FORMS_EXECS" | jq -r '.[] | select(.providerId == "phone-otp-authenticator") | .id' | head -n1)
C2FA_EXEC_ID=$(echo "$FORMS_EXECS" | jq -r '.[] | select(.authenticationFlow == true and (.displayName | ascii_downcase | contains("2fa"))) | .id' | head -n1)

update_execs "authentication/flows/$FORMS_ALIAS_ENCODED/executions" "$PWD_FORM_EXEC_ID" "REQUIRED" 0 10
update_execs "authentication/flows/$FORMS_ALIAS_ENCODED/executions" "$EXPIRY_EXEC_ID" "REQUIRED" 1 12
update_execs "authentication/flows/$FORMS_ALIAS_ENCODED/executions" "$PHONE_EXEC_ID" "REQUIRED" 2 15
update_execs "authentication/flows/$FORMS_ALIAS_ENCODED/executions" "$C2FA_EXEC_ID" "CONDITIONAL" 3 20
echo "STEP5: applied deterministic forms order Username/Password -> Expiry -> SMS OTP -> Conditional 2FA."

# 3. Update Realm Default Timezone Attribute
/opt/keycloak/bin/kcadm.sh update "realms/$REALM_NAME" \
  -s "attributes.account_expiry_default_timezone=\"$DEFAULT_EXPIRY_TIMEZONE\""
echo "STEP5: Set default account expiry timezone to $DEFAULT_EXPIRY_TIMEZONE."

# 4. Inject Date and Timezone properties into Declarative User Profile Schema (used by Admin UI Modal)
echo "STEP5: Fetching timezone list from SPI..."

# Get a fresh token for the curl call to the realm-level resource (from the target realm)
TOKEN=$(curl -s -X POST "$SERVER_URL/realms/$REALM_NAME/protocol/openid-connect/token" \
  -d "grant_type=password" \
  -d "client_id=admin-cli" \
  -d "username=$REALM_ADMIN_USER" \
  -d "password=$REALM_ADMIN_PASSWORD" | jq -r '.access_token')

if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
  echo "STEP5: Error - Could not obtain access token for SPI call."
  exit 1
fi

TZ_OPTIONS_JSON=$(curl -s --location "$SERVER_URL/realms/$REALM_NAME/account-expiry-admin/timezones" \
  --header "Authorization: Bearer $TOKEN")

if [[ -n "$TZ_OPTIONS_JSON" ]] && [[ "$TZ_OPTIONS_JSON" != "null" ]]; then
  TZ_ARRAY=$(echo "$TZ_OPTIONS_JSON" | jq -c '.timezones')
  if [[ -n "$TZ_ARRAY" ]] && [[ "$TZ_ARRAY" != "null" ]]; then
    
    echo "STEP5: Updating User Profile schema with expiry attributes..."
    # Read current user profile
    TMP_IN=$(mktemp)
    TMP_OUT=$(mktemp)
    /opt/keycloak/bin/kcadm.sh get "realms/$REALM_NAME/users/profile" > "$TMP_IN"
    
    jq --argjson tzOptions "$TZ_ARRAY" '
    def attrDate:
      {
        "name": "account_expiry_date",
        "displayName": "Account Expiry Date",
        "permissions": { "view": ["admin","user"], "edit": ["admin"] },
        "annotations": {
          "inputType": "html5-date",
          "inputTypePlaceholder": "YYYY-MM-DD",
          "helpText": "Expiry date in user local timezone"
        },
        "validations": {
          "pattern": {
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
            "error-message": "Use format YYYY-MM-DD"
          }
        }
      };

    def attrTz:
      {
        "name": "account_expiry_timezone",
        "displayName": "Account Expiry Timezone",
        "permissions": { "view": ["admin","user"], "edit": ["admin"] },
        "annotations": {
          "inputType": "select",
          "inputTypePlaceholder": "Asia/Kolkata",
          "helpText": "IANA timezone list"
        },
        "validations": {
          "options": {
            "options": $tzOptions
          }
        }
      };

    .attributes = ((.attributes // []) | map(select(.name != "account_expiry_date" and .name != "account_expiry_timezone")) + [attrDate, attrTz])
    ' "$TMP_IN" > "$TMP_OUT"

    /opt/keycloak/bin/kcadm.sh update "realms/$REALM_NAME/users/profile" -f "$TMP_OUT"
    echo "STEP5: Updated User Profile Schema with account_expiry attributes."
    rm -f "$TMP_IN" "$TMP_OUT"
  else
    echo "STEP5: WARN - No timezones found in SPI response."
  fi
else
  echo "STEP5: ERROR - Timezone SPI call failed or returned empty: $TZ_OPTIONS_JSON"
  exit 1
fi

# 5. Backfill existing accounts that do not already have an explicit expiry date.
#    Rule: current date + 1 year + pseudo-random 2-8 weeks, stable per user.
echo "STEP5: Backfilling expiry attributes for existing users missing account_expiry_date ..."
USERS_JSON="$(/opt/keycloak/bin/kcadm.sh get users -r "$REALM_NAME" --fields id,username,attributes)"
echo "$USERS_JSON" | jq -cr '
  .[]
  | select(((.attributes.account_expiry_date // []) | length) == 0)
  | {
      id,
      username,
      timezone: ((.attributes.account_expiry_timezone // [])[0] // "")
    }
' | while IFS= read -r user_row; do
  [[ -z "$user_row" ]] && continue

  user_id="$(echo "$user_row" | jq -r '.id')"
  username="$(echo "$user_row" | jq -r '.username')"
  existing_tz="$(echo "$user_row" | jq -r '.timezone')"
  if [[ -n "$existing_tz" && "$existing_tz" != "null" ]]; then
    target_tz="$existing_tz"
  else
    target_tz="$DEFAULT_EXPIRY_TIMEZONE"
  fi

  seed_source="$user_id:$username"
  checksum="$(printf '%s' "$seed_source" | cksum | cut -d' ' -f1)"
  week_span=$(( DEFAULT_EXPIRY_RANDOM_MAX_WEEKS - DEFAULT_EXPIRY_RANDOM_MIN_WEEKS + 1 ))
  week_offset=$(( DEFAULT_EXPIRY_RANDOM_MIN_WEEKS + (checksum % week_span) ))
  expiry_date="$(date -u -d "+${DEFAULT_EXPIRY_BASE_YEARS} year +${week_offset} weeks" +%F)"

  /opt/keycloak/bin/kcadm.sh update "users/$user_id" -r "$REALM_NAME" \
    -s "attributes.account_expiry_date=[\"$expiry_date\"]" \
    -s "attributes.account_expiry_timezone=[\"$target_tz\"]"
  echo "STEP5: Backfilled expiry for '$username' -> $expiry_date ($target_tz, +${week_offset}w)."
done

# Create marker file
mkdir -p "$(dirname "$STEP5_MARKER_FILE")"
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$STEP5_MARKER_FILE"

echo "STEP5: completed successfully."

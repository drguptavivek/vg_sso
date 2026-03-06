#!/usr/bin/env bash
set -euo pipefail

# Ensure unbuffered output for docker logs
exec 1>/proc/1/fd/1 2>/proc/1/fd/2 2>/dev/null || true

KCADM_BIN="${KCADM_BIN:-/opt/keycloak/bin/kcadm.sh}"
KCADM_CONFIG="${KCADM_CONFIG:-/tmp/.kcadm_step4.config}"
SERVER_URL="${KC_SERVER_URL:-http://keycloak:8080}"

REALM_NAME="${KC_NEW_REALM_NAME:-org-new-delhi}"
ADMIN_USER="${KC_MASTER_ADMIN_USER:-permrealmadmin}"
ADMIN_PASSWORD="${KC_MASTER_ADMIN_PASSWORD:-StrongPerm@123}"

STEP4_WAIT_SECONDS="${STEP4_WAIT_SECONDS:-180}"
STEP4_POLL_INTERVAL_SECONDS="${STEP4_POLL_INTERVAL_SECONDS:-5}"
STEP4_MARKER_FILE="${STEP4_MARKER_FILE:-/opt/keycloak/data/.step4-init-done}"
STEP4_FORCE="${STEP4_FORCE:-false}"

if [[ "$STEP4_FORCE" != "true" && -f "$STEP4_MARKER_FILE" ]]; then
  echo "STEP4: marker exists at $STEP4_MARKER_FILE; skipping (set STEP4_FORCE=true to rerun)."
  exit 0
fi

# Wait for Step 3 to finish
STEP3_MARKER="/opt/keycloak/data/.step3-init-done"
echo "STEP4: waiting for Step 3 marker at $STEP3_MARKER ..."
while [[ ! -f "$STEP3_MARKER" ]]; do
  sleep 5
done

deadline=$(( $(date +%s) + STEP4_WAIT_SECONDS ))
echo "STEP4: waiting for Keycloak at ${SERVER_URL} ..."
while true; do
  if "$KCADM_BIN" config credentials \
      --server "$SERVER_URL" \
      --realm master \
      --user "$ADMIN_USER" \
      --password "$ADMIN_PASSWORD" \
      --config "$KCADM_CONFIG" >/dev/null 2>&1; then
    break
  fi
  if (( $(date +%s) >= deadline )); then
    echo "STEP4 ERROR: Keycloak did not become ready for Step 4."
    exit 1
  fi
  sleep "$STEP4_POLL_INTERVAL_SECONDS"
done
echo "STEP4: Keycloak is ready."

kcadm() {
  "$KCADM_BIN" "$@" --config "$KCADM_CONFIG"
}

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
  kcadm update "$endpoint" -n -r "$REALM_NAME" -f "$payload"
  rm -f "$payload"
}

FLOW_ALIAS="browser-PhoneOTP"

echo "STEP4: ensuring flow '$FLOW_ALIAS' in realm '$REALM_NAME' ..."

# 1. Always delete existing custom flow and recreate it from the built-in browser flow.
#    This guarantees execution order is deterministic — determined solely by insertion order.
#    Reusing an existing flow risks incorrect ordering due to Keycloak raise/lower-priority quirks.

# Switch back to built-in browser flow first (so we can safely delete our custom one)
kcadm update realms/"$REALM_NAME" -s browserFlow=browser
echo "STEP4: temporarily reset browserFlow to built-in 'browser'."

# Delete existing custom flow if present
EXISTING_FLOW_ID=$(kcadm get authentication/flows -r "$REALM_NAME" | \
  jq -r --arg a "$FLOW_ALIAS" '.[] | select(.alias==$a) | .id' | head -n1)
if [[ -n "$EXISTING_FLOW_ID" ]]; then
  kcadm delete "authentication/flows/$EXISTING_FLOW_ID" -r "$REALM_NAME"
  echo "STEP4: deleted existing flow '$FLOW_ALIAS' (id=$EXISTING_FLOW_ID)."
fi

# Copy from built-in browser flow — this gives us the correct default structure
kcadm create authentication/flows/browser/copy -r "$REALM_NAME" -s newName="$FLOW_ALIAS"
echo "STEP4: created fresh flow copy '$FLOW_ALIAS'."

# 2. Find the 'forms' subflow alias inside our new custom flow
echo "STEP4: finding forms subflow in '$FLOW_ALIAS' ..."
EXECUTIONS_JSON=$(kcadm get "authentication/flows/$FLOW_ALIAS/executions" -r "$REALM_NAME")

FORMS_ALIAS_NAME=$(echo "$EXECUTIONS_JSON" | jq -r \
  '.[] | select(.displayName != null and (.displayName | ascii_downcase | contains("forms"))) | .displayName' | head -n1)

if [[ -z "$FORMS_ALIAS_NAME" || "$FORMS_ALIAS_NAME" == "null" ]]; then
  echo "STEP4 ERROR: Could not find forms subflow in '$FLOW_ALIAS'."
  echo "$EXECUTIONS_JSON"
  exit 1
fi
echo "STEP4: found forms subflow: '$FORMS_ALIAS_NAME'"
FORMS_ALIAS_ENCODED=$(jq -rn --arg s "$FORMS_ALIAS_NAME" '$s|@uri')

# 3. Verify Conditional 2FA has correct order (conditions before authenticators).
#    Default browser flow copy should already have correct order:
#    [0] conditional-user-configured (REQUIRED)
#    [1] conditional-credential (REQUIRED)
#    [2] auth-otp-form (ALTERNATIVE)  <-- must be ALTERNATIVE not REQUIRED
#
#    Ensure auth-otp-form is ALTERNATIVE (matching default browser flow behaviour).
C2FA_ALIAS="$FLOW_ALIAS Browser - Conditional 2FA"
C2FA_ENCODED=$(jq -rn --arg s "$C2FA_ALIAS" '$s|@uri')

C2FA_EXECS=$(kcadm get "authentication/flows/$C2FA_ENCODED/executions" -r "$REALM_NAME" 2>/dev/null || true)
if [[ -n "$C2FA_EXECS" ]]; then
  OTP_FORM_IN_C2FA=$(echo "$C2FA_EXECS" | jq -r '.[] | select(.providerId=="auth-otp-form") | .id' | head -n1)
  if [[ -n "$OTP_FORM_IN_C2FA" ]]; then
    kcadm update "authentication/flows/$FLOW_ALIAS/executions" -n -r "$REALM_NAME" \
      -s id="$OTP_FORM_IN_C2FA" -s requirement=ALTERNATIVE
    echo "STEP4: set auth-otp-form to ALTERNATIVE in Conditional 2FA (matching default browser flow)."
  fi
fi

# 4. Add phone-otp-authenticator to the forms subflow.
#    We keep the built-in browser flow structure intact and only insert SMS OTP
#    between Username Password Form and Conditional 2FA.
if ! kcadm get "authentication/flows/$FLOW_ALIAS/executions" -r "$REALM_NAME" | \
    jq -r '.[] | .providerId' | grep -q "^phone-otp-authenticator$"; then
  kcadm create "authentication/flows/$FORMS_ALIAS_ENCODED/executions/execution" -r "$REALM_NAME" \
    -s provider=phone-otp-authenticator
  echo "STEP4: added phone-otp-authenticator execution."
else
  echo "STEP4: phone-otp-authenticator already exists in subflow."
fi

get_forms_execs() {
  kcadm get "authentication/flows/$FORMS_ALIAS_ENCODED/executions" -r "$REALM_NAME"
}

update_exec_forms() {
  update_execs "authentication/flows/$FORMS_ALIAS_ENCODED/executions" "$1" "$2" "$3" "$4"
}

# 4. Configure the execution
# Find the execution ID for phone-otp-authenticator
EXEC_DATA=$(kcadm get "authentication/flows/$FLOW_ALIAS/executions" -r "$REALM_NAME" | jq -c '.[] | select(.providerId == "phone-otp-authenticator")')
EXEC_ID=$(echo "$EXEC_DATA" | jq -r '.id')
CFG_ID=$(echo "$EXEC_DATA" | jq -r '.authenticationConfig // empty')

PAYLOAD=$(jq -n \
  --arg alias "$FLOW_ALIAS-phone-otp-config" \
  '{
    alias: $alias,
    config: {
      "otp.endpoint.primary": "https://smsapplication.vg.edu/services/api/v1/sms/single",
      "otp.auth.bearer": "REPLACE_BEARER_TOKEN",
      "otp.request.token.header": "X-OTP-Token",
      "otp.length": "6",
      "otp.ttl.seconds": "300",
      "otp.max.attempts": "5",
      "otp.retry.max": "2",
      "otp.retry.backoff.ms": "500",
      "otp.sms.message.template": "OTP For VG SSO Verification is: {{otp}}",
      "otp.sms.mobile.field": "mobile",
      "otp.sms.message.field": "message"
    }
  }')

if [[ -n "$CFG_ID" ]]; then
  echo "$PAYLOAD" | kcadm update "authentication/config/$CFG_ID" -r "$REALM_NAME" -f -
  echo "STEP4: updated phone-otp-authenticator config."
else
  kcadm create "authentication/executions/$EXEC_ID/config" -r "$REALM_NAME" -f - <<< "$PAYLOAD"
  echo "STEP4: created phone-otp-authenticator config."
fi

# 5. Restore the copied browser flow order explicitly.
#    Target chain:
#      auth-cookie -> auth-spnego -> identity-provider-redirector -> Organization -> Forms
#      -> auth-username-password-form -> phone-otp-authenticator -> Browser - Conditional 2FA
#      -> conditional-user-configured -> conditional-credential -> auth-otp-form -> WebAuthn -> Recovery
FLOW_EXECS="$(kcadm get "authentication/flows/$FLOW_ALIAS/executions" -r "$REALM_NAME")"
COOKIE_ID=$(echo "$FLOW_EXECS" | jq -r '.[] | select(.providerId == "auth-cookie") | .id' | head -n1)
SPNEGO_ID=$(echo "$FLOW_EXECS" | jq -r '.[] | select(.providerId == "auth-spnego") | .id' | head -n1)
IDP_REDIRECT_ID=$(echo "$FLOW_EXECS" | jq -r '.[] | select(.providerId == "identity-provider-redirector") | .id' | head -n1)
ORG_ID=$(echo "$FLOW_EXECS" | jq -r '.[] | select(.authenticationFlow == true and (.displayName | ascii_downcase | endswith("organization")) and (.displayName | ascii_downcase | contains("conditional") | not)) | .id' | head -n1)
FORMS_ID=$(echo "$FLOW_EXECS" | jq -r --arg name "$FORMS_ALIAS_NAME" '.[] | select(.authenticationFlow == true and .displayName == $name) | .id' | head -n1)

update_execs "authentication/flows/$FLOW_ALIAS/executions" "$COOKIE_ID" "ALTERNATIVE" 0 10
update_execs "authentication/flows/$FLOW_ALIAS/executions" "$SPNEGO_ID" "DISABLED" 1 20
update_execs "authentication/flows/$FLOW_ALIAS/executions" "$IDP_REDIRECT_ID" "ALTERNATIVE" 2 25
update_execs "authentication/flows/$FLOW_ALIAS/executions" "$ORG_ID" "ALTERNATIVE" 3 26
update_execs "authentication/flows/$FLOW_ALIAS/executions" "$FORMS_ID" "ALTERNATIVE" 4 30
echo "STEP4: applied deterministic execution payload updates for top-level browser flow."

FORMS_EXECS="$(get_forms_execs)"
PWD_ID=$(echo "$FORMS_EXECS" | jq -r '.[] | select(.providerId == "auth-username-password-form") | .id' | head -n1)
PHONE_ID=$(echo "$FORMS_EXECS" | jq -r '.[] | select(.providerId == "phone-otp-authenticator") | .id' | head -n1)
C2FA_ID=$(echo "$FORMS_EXECS" | jq -r '.[] | select(.authenticationFlow == true and (.displayName | ascii_downcase | contains("2fa"))) | .id' | head -n1)
COND_USER_ID=$(echo "$FORMS_EXECS" | jq -r '.[] | select(.providerId == "conditional-user-configured") | .id' | head -n1)
COND_CRED_ID=$(echo "$FORMS_EXECS" | jq -r '.[] | select(.providerId == "conditional-credential") | .id' | head -n1)
OTP_FORM_ID=$(echo "$FORMS_EXECS" | jq -r '.[] | select(.providerId == "auth-otp-form") | .id' | head -n1)
WEBAUTHN_ID=$(echo "$FORMS_EXECS" | jq -r '.[] | select(.providerId == "webauthn-authenticator") | .id' | head -n1)
RECOVERY_ID=$(echo "$FORMS_EXECS" | jq -r '.[] | select(.providerId == "auth-recovery-authn-code-form") | .id' | head -n1)

# Direct children of the forms subflow.
update_exec_forms "$PWD_ID" "REQUIRED" 0 10
update_exec_forms "$PHONE_ID" "REQUIRED" 1 15
update_exec_forms "$C2FA_ID" "CONDITIONAL" 2 20

# Children of Conditional 2FA within the forms execution listing.
update_exec_forms "$COND_USER_ID" "REQUIRED" 0 10
update_exec_forms "$COND_CRED_ID" "REQUIRED" 1 20
update_exec_forms "$OTP_FORM_ID" "ALTERNATIVE" 2 30
update_exec_forms "$WEBAUTHN_ID" "DISABLED" 3 40
update_exec_forms "$RECOVERY_ID" "DISABLED" 4 50
echo "STEP4: applied deterministic execution payload updates for forms and Conditional 2FA."


# 6. Bind the new flow as the active browser flow
kcadm update realms/"$REALM_NAME" -s browserFlow="$FLOW_ALIAS"
echo "STEP4: bound '$FLOW_ALIAS' as active browser flow."

# 7. Set the realm admin theme
kcadm update realms/"$REALM_NAME" -s adminTheme=admin-vg-custom
echo "STEP4: set realm admin theme to 'admin-vg-custom'."

# Create marker file
mkdir -p "$(dirname "$STEP4_MARKER_FILE")"
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$STEP4_MARKER_FILE"

echo "STEP4: completed successfully."

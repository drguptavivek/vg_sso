#!/usr/bin/env bash
set -euo pipefail

# Ensure unbuffered output for docker logs
exec 1>/proc/1/fd/1 2>/proc/1/fd/2 2>/dev/null || true

KCADM_BIN="${KCADM_BIN:-/opt/keycloak/bin/kcadm.sh}"
KCADM_CONFIG="${KCADM_CONFIG:-/tmp/.kcadm_step2.config}"
SERVER_URL="${KC_SERVER_URL:-http://keycloak:8080}"
REALM_NAME="${KC_NEW_REALM_NAME:-}"
REALM_ADMIN_USER="${KC_NEW_REALM_ADMIN_USER:-}"
REALM_ADMIN_PASSWORD="${KC_NEW_REALM_ADMIN_PASSWORD:-}"
REALM_ADMIN_PHONE="${KC_NEW_REALM_ADMIN_PHONE:-}"
REALM_ADMIN_PHONE_VERIFIED="${KC_NEW_REALM_ADMIN_PHONE_VERIFIED:-}"

KEYCLOAK_ENV="${KEYCLOAK_ENV:-production}"
if [[ "$KEYCLOAK_ENV" == "development" ]]; then
  SSL_REQUIRED="NONE"
else
  SSL_REQUIRED="external"
fi

STEP2_WAIT_SECONDS="${STEP2_WAIT_SECONDS:-180}"
STEP2_POLL_INTERVAL_SECONDS="${STEP2_POLL_INTERVAL_SECONDS:-3}"
STEP2_MARKER_FILE="${STEP2_MARKER_FILE:-/opt/keycloak/data/.step2-init-done}"
STEP2_FORCE="${STEP2_FORCE:-false}"
STEP2_GROUPS_TREE_FILE_LOCAL="${STEP2_GROUPS_TREE_FILE_LOCAL:-/workspace/.local/groups/groups_tree.json}"
STEP2_GROUPS_TREE_FILE_DEFAULT="${STEP2_GROUPS_TREE_FILE_DEFAULT:-/opt/keycloak/import/groups_tree.json}"

if [[ -f "$STEP2_GROUPS_TREE_FILE_LOCAL" ]]; then
  STEP2_GROUPS_TREE_FILE="$STEP2_GROUPS_TREE_FILE_LOCAL"
else
  STEP2_GROUPS_TREE_FILE="$STEP2_GROUPS_TREE_FILE_DEFAULT"
fi

required_vars=(
  REALM_NAME
  REALM_ADMIN_USER
  REALM_ADMIN_PASSWORD
)

for v in "${required_vars[@]}"; do
  if [[ -z "${!v}" ]]; then
    echo "STEP2 ERROR: required env var $v is empty"
    exit 1
  fi
done

if [[ "$STEP2_FORCE" != "true" && -f "$STEP2_MARKER_FILE" ]]; then
  echo "STEP2: marker exists at $STEP2_MARKER_FILE; skipping (set STEP2_FORCE=true to rerun)."
  exit 0
fi

deadline=$(( $(date +%s) + STEP2_WAIT_SECONDS ))
echo "STEP2: waiting for Keycloak at ${SERVER_URL} ..."
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
  if grep -Eqi 'Account is not fully set up' "$auth_err"; then
    echo "STEP2 ERROR: realm-admin login failed: account is not fully set up."
    echo "STEP2 ERROR: ensure '${REALM_ADMIN_USER}' can use direct grant in realm '${REALM_NAME}' (no pending required actions and no OTP challenge in direct grant)."
    echo "STEP2 ERROR: ${last_auth_error}"
    rm -f "$auth_err"
    exit 1
  fi
  rm -f "$auth_err"
  if (( $(date +%s) >= deadline )); then
    echo "STEP2 ERROR: Keycloak did not become ready within ${STEP2_WAIT_SECONDS}s."
    if [[ -n "$last_auth_error" ]]; then
      echo "STEP2 ERROR: last login error: ${last_auth_error}"
    fi
    exit 1
  fi
  sleep "$STEP2_POLL_INTERVAL_SECONDS"
done
echo "STEP2: Keycloak is ready."

kcadm() {
  "$KCADM_BIN" "$@" --config "$KCADM_CONFIG"
}

classify_kcadm_error() {
  local err_file="$1"
  if grep -Eqi '(401|unauthorized)' "$err_file"; then
    echo "unauthorized"
    return 0
  fi
  if grep -Eqi '(403|forbidden|insufficient)' "$err_file"; then
    echo "forbidden"
    return 0
  fi
  if grep -Eqi '(404|not found)' "$err_file"; then
    echo "not_found"
    return 0
  fi
  echo "unknown"
}

echo "STEP2: validating realm-admin permissions ..."
precheck_err="$(mktemp)"
if ! kcadm get "realms/${REALM_NAME}" >/dev/null 2>"$precheck_err"; then
  precheck_type="$(classify_kcadm_error "$precheck_err")"
  case "$precheck_type" in
    unauthorized|forbidden)
      echo "STEP2 ERROR: user '${REALM_ADMIN_USER}' authenticated but lacks admin permissions in realm '${REALM_NAME}'."
      echo "STEP2 ERROR: ensure the user has realm-management/realm-admin role in realm '${REALM_NAME}'."
      ;;
    *)
      echo "STEP2 ERROR: unable to read realm '${REALM_NAME}' settings."
      ;;
  esac
  sed 's/^/STEP2 ERROR: /' "$precheck_err"
  rm -f "$precheck_err"
  exit 1
fi
rm -f "$precheck_err"

echo "STEP2: verifying realm '${REALM_NAME}' ..."
realm_err="$(mktemp)"
if ! kcadm get "realms/${REALM_NAME}" >/dev/null 2>"$realm_err"; then
  realm_err_type="$(classify_kcadm_error "$realm_err")"
  case "$realm_err_type" in
    not_found)
      echo "STEP2 ERROR: realm '${REALM_NAME}' not found. Run step1-init first."
      ;;
    unauthorized|forbidden)
      echo "STEP2 ERROR: user '${REALM_ADMIN_USER}' cannot access realm '${REALM_NAME}'."
      echo "STEP2 ERROR: this is usually a missing admin role, not a missing realm."
      ;;
    *)
      echo "STEP2 ERROR: failed to verify realm '${REALM_NAME}'."
      ;;
  esac
  sed 's/^/STEP2 ERROR: /' "$realm_err"
  rm -f "$realm_err"
  exit 1
fi
rm -f "$realm_err"

echo "STEP2: applying realm login baseline ..."
kcadm update "realms/${REALM_NAME}" \
  -s sslRequired="$SSL_REQUIRED" \
  -s registrationAllowed=false \
  -s rememberMe=false \
  -s verifyEmail=true \
  -s loginWithEmailAllowed=false >/dev/null

echo "STEP2: applying brute-force settings ..."
kcadm update "realms/${REALM_NAME}" \
  -s bruteForceProtected=true \
  -s permanentLockout=false \
  -s maxFailureWaitSeconds=900 \
  -s waitIncrementSeconds=60 \
  -s quickLoginCheckMilliSeconds=1000 \
  -s minimumQuickLoginWaitSeconds=60 \
  -s maxDeltaTimeSeconds=43200 \
  -s failureFactor=5 >/dev/null

echo "STEP2: applying password policy ..."
kcadm update "realms/${REALM_NAME}" \
  -s 'passwordPolicy=length(12) and digits(1) and upperCase(1) and lowerCase(1) and specialChars(1) and notUsername and passwordHistory(5)' >/dev/null

echo "STEP2: applying session/token timeouts ..."
kcadm update "realms/${REALM_NAME}" \
  -s ssoSessionIdleTimeout=1800 \
  -s ssoSessionMaxLifespan=28800 \
  -s accessTokenLifespan=300 \
  -s accessTokenLifespanForImplicitFlow=900 \
  -s clientSessionIdleTimeout=1800 \
  -s clientSessionMaxLifespan=28800 \
  -s offlineSessionIdleTimeout=2592000 >/dev/null

echo "STEP2: enabling realm/admin events ..."
all_event_types='[
  "LOGIN","LOGIN_ERROR","REGISTER","REGISTER_ERROR","LOGOUT","LOGOUT_ERROR",
  "CODE_TO_TOKEN","CODE_TO_TOKEN_ERROR","CLIENT_LOGIN","CLIENT_LOGIN_ERROR",
  "REFRESH_TOKEN","REFRESH_TOKEN_ERROR","VALIDATE_ACCESS_TOKEN","VALIDATE_ACCESS_TOKEN_ERROR",
  "INTROSPECT_TOKEN","INTROSPECT_TOKEN_ERROR","FEDERATED_IDENTITY_LINK","FEDERATED_IDENTITY_LINK_ERROR",
  "REMOVE_FEDERATED_IDENTITY","REMOVE_FEDERATED_IDENTITY_ERROR","UPDATE_EMAIL","UPDATE_EMAIL_ERROR",
  "UPDATE_PROFILE","UPDATE_PROFILE_ERROR","UPDATE_PASSWORD","UPDATE_PASSWORD_ERROR",
  "UPDATE_TOTP","UPDATE_TOTP_ERROR","VERIFY_EMAIL","VERIFY_EMAIL_ERROR",
  "VERIFY_PROFILE","VERIFY_PROFILE_ERROR","REMOVE_TOTP","REMOVE_TOTP_ERROR",
  "GRANT_CONSENT","GRANT_CONSENT_ERROR","UPDATE_CONSENT","UPDATE_CONSENT_ERROR",
  "REVOKE_GRANT","REVOKE_GRANT_ERROR","SEND_VERIFY_EMAIL","SEND_VERIFY_EMAIL_ERROR",
  "SEND_RESET_PASSWORD","SEND_RESET_PASSWORD_ERROR","SEND_IDENTITY_PROVIDER_LINK","SEND_IDENTITY_PROVIDER_LINK_ERROR",
  "RESET_PASSWORD","RESET_PASSWORD_ERROR","RESTART_AUTHENTICATION","RESTART_AUTHENTICATION_ERROR",
  "INVALID_SIGNATURE","INVALID_SIGNATURE_ERROR","REGISTER_NODE","REGISTER_NODE_ERROR",
  "UNREGISTER_NODE","UNREGISTER_NODE_ERROR","USER_INFO_REQUEST","USER_INFO_REQUEST_ERROR",
  "IDENTITY_PROVIDER_LINK_ACCOUNT","IDENTITY_PROVIDER_LINK_ACCOUNT_ERROR","IDENTITY_PROVIDER_LOGIN","IDENTITY_PROVIDER_LOGIN_ERROR",
  "IDENTITY_PROVIDER_FIRST_LOGIN","IDENTITY_PROVIDER_FIRST_LOGIN_ERROR","IDENTITY_PROVIDER_POST_LOGIN","IDENTITY_PROVIDER_POST_LOGIN_ERROR",
  "IDENTITY_PROVIDER_RESPONSE","IDENTITY_PROVIDER_RESPONSE_ERROR","IDENTITY_PROVIDER_RETRIEVE_TOKEN","IDENTITY_PROVIDER_RETRIEVE_TOKEN_ERROR",
  "IMPERSONATE","IMPERSONATE_ERROR","CUSTOM_REQUIRED_ACTION","CUSTOM_REQUIRED_ACTION_ERROR",
  "EXECUTE_ACTIONS","EXECUTE_ACTIONS_ERROR","EXECUTE_ACTION_TOKEN","EXECUTE_ACTION_TOKEN_ERROR",
  "CLIENT_INFO","CLIENT_INFO_ERROR","CLIENT_REGISTER","CLIENT_REGISTER_ERROR",
  "CLIENT_UPDATE","CLIENT_UPDATE_ERROR","CLIENT_DELETE","CLIENT_DELETE_ERROR",
  "CLIENT_INITIATED_ACCOUNT_LINKING","CLIENT_INITIATED_ACCOUNT_LINKING_ERROR","TOKEN_EXCHANGE","TOKEN_EXCHANGE_ERROR",
  "OAUTH2_DEVICE_AUTH","OAUTH2_DEVICE_AUTH_ERROR","OAUTH2_DEVICE_VERIFY_USER_CODE","OAUTH2_DEVICE_VERIFY_USER_CODE_ERROR",
  "OAUTH2_DEVICE_CODE_TO_TOKEN","OAUTH2_DEVICE_CODE_TO_TOKEN_ERROR","AUTHREQID_TO_TOKEN","AUTHREQID_TO_TOKEN_ERROR",
  "PERMISSION_TOKEN","PERMISSION_TOKEN_ERROR","DELETE_ACCOUNT","DELETE_ACCOUNT_ERROR",
  "PUSHED_AUTHORIZATION_REQUEST","PUSHED_AUTHORIZATION_REQUEST_ERROR","USER_DISABLED_BY_PERMANENT_LOCKOUT","USER_DISABLED_BY_PERMANENT_LOCKOUT_ERROR",
  "USER_DISABLED_BY_TEMPORARY_LOCKOUT","USER_DISABLED_BY_TEMPORARY_LOCKOUT_ERROR","OAUTH2_EXTENSION_GRANT","OAUTH2_EXTENSION_GRANT_ERROR",
  "FEDERATED_IDENTITY_OVERRIDE_LINK","FEDERATED_IDENTITY_OVERRIDE_LINK_ERROR","UPDATE_CREDENTIAL","UPDATE_CREDENTIAL_ERROR",
  "REMOVE_CREDENTIAL","REMOVE_CREDENTIAL_ERROR","INVITE_ORG","INVITE_ORG_ERROR",
  "USER_SESSION_DELETED","USER_SESSION_DELETED_ERROR"
]'
realm_events_payload_in="$(mktemp)"
realm_events_payload_out="$(mktemp)"
kcadm get "realms/${REALM_NAME}" > "$realm_events_payload_in"
jq --argjson types "$all_event_types" '
  .eventsEnabled = true
  | .adminEventsEnabled = true
  | .adminEventsDetailsEnabled = true
  | .enabledEventTypes = $types
' "$realm_events_payload_in" > "$realm_events_payload_out"
kcadm update "realms/${REALM_NAME}" -f "$realm_events_payload_out" >/dev/null
rm -f "$realm_events_payload_in" "$realm_events_payload_out"

echo "STEP2: enforcing default client scopes ..."
kcadm update "realms/${REALM_NAME}" \
  -s 'defaultDefaultClientScopes=["profile","email","roles","web-origins"]' >/dev/null

echo "STEP2: enabling required actions ..."
kcadm update "authentication/required-actions/VERIFY_EMAIL" -r "${REALM_NAME}" \
  -s enabled=true -s defaultAction=true >/dev/null
kcadm update "authentication/required-actions/UPDATE_PASSWORD" -r "${REALM_NAME}" \
  -s enabled=true -s defaultAction=true >/dev/null

echo "STEP2: applying user profile schema attributes ..."
profile_payload="$(mktemp)"
cat >"$profile_payload" <<'JSON'
{
  "attributes": [
    {
      "name": "username",
      "displayName": "${username}",
      "validations": {
        "length": {
          "min": 3,
          "max": 255
        },
        "username-prohibited-characters": {},
        "up-username-not-idn-homograph": {}
      },
      "permissions": {
        "view": ["admin", "user"],
        "edit": ["admin", "user"]
      },
      "multivalued": false
    },
    {
      "name": "email",
      "displayName": "${email}",
      "validations": {
        "email": {},
        "length": {
          "max": 255
        }
      },
      "required": {
        "roles": ["user"]
      },
      "permissions": {
        "view": ["admin", "user"],
        "edit": ["admin", "user"]
      },
      "multivalued": false
    },
    {
      "name": "firstName",
      "displayName": "${firstName}",
      "validations": {
        "length": {
          "max": 255
        },
        "person-name-prohibited-characters": {}
      },
      "required": {
        "roles": ["user"]
      },
      "permissions": {
        "view": ["admin", "user"],
        "edit": ["admin", "user"]
      },
      "multivalued": false
    },
    {
      "name": "lastName",
      "displayName": "${lastName}",
      "validations": {
        "length": {
          "max": 255
        },
        "person-name-prohibited-characters": {}
      },
      "required": {
        "roles": ["user"]
      },
      "permissions": {
        "view": ["admin", "user"],
        "edit": ["admin", "user"]
      },
      "multivalued": false
    },
    {
      "name": "phone_number",
      "displayName": "Phone Number",
      "permissions": {
        "view": ["user", "admin"],
        "edit": ["admin"]
      },
      "validations": {
        "length": {
          "max": 20
        },
        "pattern": {
          "pattern": "^\\+?[0-9]{10,15}$",
          "error-message": "Invalid phone number"
        }
      },
      "multivalued": false
    },
    {
      "name": "phone_verified",
      "displayName": "Phone Verified",
      "permissions": {
        "view": ["admin"],
        "edit": ["admin"]
      },
      "annotations": {
        "inputType": "select",
        "inputOptionsFromValidation": "options"
      },
      "validations": {
        "options": {
          "options": ["true", "false"]
        }
      },
      "multivalued": false
    },
    {
      "name": "employment_type",
      "displayName": "Type",
      "permissions": {
        "view": ["user", "admin"],
        "edit": ["admin"]
      },
      "validations": {
        "options": {
          "options": ["Permanent", "Contract", "Research", "Student", "Deputed", "Outsourced"]
        }
      },
      "multivalued": false
    },
    {
      "name": "employee_id",
      "displayName": "Employee ID",
      "permissions": {
        "view": ["user", "admin"],
        "edit": ["admin"]
      },
      "validations": {
        "length": {
          "max": 32
        }
      },
      "multivalued": false
    },
    {
      "name": "posts",
      "displayName": "Posts",
      "multivalued": true,
      "permissions": {
        "view": ["user", "admin"],
        "edit": ["admin"]
      },
      "validations": {
        "length": {
          "max": 50
        }
      }
    },
    {
      "name": "designation",
      "displayName": "Designation",
      "permissions": {
        "view": ["user", "admin"],
        "edit": ["admin"]
      },
      "validations": {
        "options": {
          "options": [
            "Director",
            "Dean",
            "Medical Superintendent",
            "Professor",
            "Additional Professor",
            "Associate Professor",
            "Assistant Professor",
            "Senior Resident",
            "Junior Resident",
            "Chief Medical Officer",
            "Medical Officer",
            "Consultant",
            "Specialist",
            "Registrar",
            "Demonstrator",
            "Tutor",
            "Scientist I",
            "Scientist II",
            "Scientist III",
            "Scientist IV",
            "Scientist V",
            "Lab Technician",
            "Senior Lab Technician",
            "Junior Lab Technician",
            "Research Associate",
            "Research Fellow",
            "Project Scientist",
            "Project Assistant",
            "Project Technician",
            "Data Manager",
            "Biostatistician",
            "Epidemiologist",
            "Clinical Psychologist",
            "Physiotherapist",
            "Occupational Therapist",
            "Speech Therapist",
            "Dietician",
            "Pharmacist",
            "Senior Pharmacist",
            "Store Officer",
            "Administrative Officer",
            "Section Officer",
            "Accounts Officer",
            "Finance Officer",
            "HR Officer",
            "IT Officer",
            "System Analyst",
            "Network Engineer",
            "Security Officer",
            "Public Relations Officer",
            "Legal Officer",
            "Warden",
            "Matron",
            "Nursing Superintendent",
            "Deputy Nursing Superintendent",
            "Assistant Nursing Superintendent",
            "Staff Nurse",
            "ANM",
            "Driver",
            "Attendant",
            "Housekeeping Supervisor"
          ]
        }
      },
      "multivalued": false
    },
    {
      "name": "remarks",
      "displayName": "Remarks",
      "multivalued": true,
      "permissions": {
        "view": ["user", "admin"],
        "edit": ["admin"]
      },
      "validations": {
        "length": {
          "max": 1000
        }
      },
      "annotations": {
        "inputType": "textarea",
        "inputTypeRows": "4",
        "inputTypeCols": "60"
      }
    }
  ],
  "groups": [
    {
      "name": "user-metadata",
      "displayHeader": "User metadata",
      "displayDescription": "Attributes, which refer to user metadata"
    }
  ]
}
JSON
kcadm update "users/profile" -r "${REALM_NAME}" -f "$profile_payload" >/dev/null
rm -f "$profile_payload"

echo "STEP2: applying phone attributes to realm admin user (if configured) ..."
if [[ -n "$REALM_ADMIN_PHONE" || -n "$REALM_ADMIN_PHONE_VERIFIED" ]]; then
  realm_user_id="$(kcadm get users -r "$REALM_NAME" -q username="$REALM_ADMIN_USER" --fields id --format csv --noquotes | head -n1 || true)"
  if [[ -n "$realm_user_id" ]]; then
    cmd_args=()
    if [[ -n "$REALM_ADMIN_PHONE" ]]; then
      cmd_args+=("-s" "attributes.phone_number=$REALM_ADMIN_PHONE")
    fi
    if [[ -n "$REALM_ADMIN_PHONE_VERIFIED" ]]; then
    
      cmd_args+=("-s" "attributes.phone_verified=$REALM_ADMIN_PHONE_VERIFIED")
    fi
    if [[ ${#cmd_args[@]} -gt 0 ]]; then
      kcadm update "users/${realm_user_id}" -r "$REALM_NAME" "${cmd_args[@]}" >/dev/null || echo "STEP2 WARN: failed to update realm admin phone attributes."
    fi
  fi
fi

echo "STEP2: ensuring realm role 'user-manager' and composites ..."
if kcadm get "roles/user-manager" -r "${REALM_NAME}" >/dev/null 2>&1; then
  kcadm update "roles/user-manager" -r "${REALM_NAME}" \
    -s name=user-manager \
    -s 'description=User operations without group creation' >/dev/null || true
else
  kcadm create roles -r "${REALM_NAME}" \
    -s name=user-manager \
    -s 'description=User operations without group creation' >/dev/null
fi
kcadm add-roles -r "${REALM_NAME}" --rname user-manager --cclientid realm-management \
  --rolename view-users --rolename query-users --rolename query-groups >/dev/null || true

if [[ -f "$STEP2_GROUPS_TREE_FILE" ]]; then
  echo "STEP2: importing groups from ${STEP2_GROUPS_TREE_FILE} ..."
  groups_payload="$(mktemp)"
  {
    printf '{\n  "ifResourceExists": "OVERWRITE",\n  "groups": '
    cat "$STEP2_GROUPS_TREE_FILE"
    printf '\n}\n'
  } >"$groups_payload"
  kcadm create partialImport -r "${REALM_NAME}" -f "$groups_payload" >/dev/null
  rm -f "$groups_payload"
else
  echo "STEP2 WARN: groups file not found at ${STEP2_GROUPS_TREE_FILE}; skipping group import."
fi

echo "STEP2: groups/attributes verification report generation disabled."

echo "STEP2: disabling direct access grants + implicit flow for clients (except admin-cli) ..."
admin_cli_id="$(kcadm get clients -r "${REALM_NAME}" -q clientId=admin-cli --fields id --format csv --noquotes | head -n1 || true)"
while IFS= read -r client_id; do
  [[ -z "$client_id" ]] && continue
  if [[ -n "$admin_cli_id" && "$client_id" == "$admin_cli_id" ]]; then
    continue
  fi
  kcadm update "clients/${client_id}" -r "${REALM_NAME}" \
    -s directAccessGrantsEnabled=false \
    -s implicitFlowEnabled=false >/dev/null
done < <(kcadm get clients -r "${REALM_NAME}" --fields id --format csv --noquotes | cut -d',' -f1)

mkdir -p "$(dirname "$STEP2_MARKER_FILE")"
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$STEP2_MARKER_FILE"

echo "STEP2: completed successfully."

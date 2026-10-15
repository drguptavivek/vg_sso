#!/usr/bin/env bash
# Ensure the confidential `sso-automation` client in KC_NEW_REALM_NAME. Its
# service account holds realm-management/realm-admin and is what steps 2-10,
# the maintenance runner, and `make kcadm-login` use, so no human account
# (which may have 2FA) is needed for automation. Idempotent: the client secret
# is always set to KC_AUTOMATION_CLIENT_SECRET, so changing it in .env and
# re-running rotates it.
#
# Sourced by step1_bootstrap_docker.sh (reuses its master-admin kcadm session),
# or run standalone for existing deployments (`make automation-client`), which
# logs in to master with the bootstrap or master admin from .env.

ensure_automation_client() {
  local realm="$1" client_id="$2" secret="$3"
  local cid="" id cl
  # The clientId query is a prefix/substring match; pick the exact one.
  # (No awk in the Keycloak image.)
  while IFS=, read -r id cl; do
    if [[ "$cl" == "$client_id" ]]; then cid="$id"; break; fi
  done < <(kcadm get clients -r "$realm" -q clientId="$client_id" --fields id,clientId --format csv --noquotes)

  local settings=(
    -s enabled=true
    -s publicClient=false
    -s serviceAccountsEnabled=true
    -s standardFlowEnabled=false
    -s implicitFlowEnabled=false
    -s directAccessGrantsEnabled=false
    -s clientAuthenticatorType=client-secret
    -s "secret=${secret}"
    -s "description=Automation service account for setup steps and maintenance (realm-admin). Do not modify."
  )
  if [[ -z "$cid" ]]; then
    kcadm create clients -r "$realm" -s clientId="$client_id" "${settings[@]}" >/dev/null
    echo "AUTOMATION: created client '${client_id}' in realm '${realm}'."
  else
    kcadm update "clients/${cid}" -r "$realm" "${settings[@]}" >/dev/null
    echo "AUTOMATION: client '${client_id}' exists; settings and secret enforced."
  fi

  kcadm add-roles -r "$realm" --uusername "service-account-${client_id}" \
    --cclientid realm-management --rolename realm-admin >/dev/null
  echo "AUTOMATION: service account 'service-account-${client_id}' has realm-management/realm-admin."
}

# Standalone mode.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
  KCADM_BIN="${KCADM_BIN:-/opt/keycloak/bin/kcadm.sh}"
  KCADM_CONFIG="${KCADM_CONFIG:-/tmp/.kcadm_automation.config}"
  SERVER_URL="${KC_SERVER_URL:-http://keycloak:8080}"
  REALM="${KC_NEW_REALM_NAME:?KC_NEW_REALM_NAME is required}"
  CLIENT_ID="${KC_AUTOMATION_CLIENT_ID:-sso-automation}"
  SECRET="${KC_AUTOMATION_CLIENT_SECRET:?KC_AUTOMATION_CLIENT_SECRET is required (run scripts/ensure_automation_secret.sh)}"

  kcadm() { "$KCADM_BIN" "$@" --config "$KCADM_CONFIG"; }

  logged_in=false
  for pair in "${KC_BOOTSTRAP_ADMIN_USERNAME:-}:BOOT" "${KC_MASTER_ADMIN_USER:-}:MASTER"; do
    user="${pair%:*}"; kind="${pair##*:}"
    [[ -n "$user" ]] || continue
    if [[ "$kind" == BOOT ]]; then pass="${KC_BOOTSTRAP_ADMIN_PASSWORD:-}"; else pass="${KC_MASTER_ADMIN_PASSWORD:-}"; fi
    [[ -n "$pass" ]] || continue
    if "$KCADM_BIN" config credentials --server "$SERVER_URL" --realm master \
        --user "$user" --password "$pass" --config "$KCADM_CONFIG" >/dev/null 2>&1; then
      echo "AUTOMATION: logged in to master as '${user}'."
      logged_in=true
      break
    fi
  done
  if [[ "$logged_in" != true ]]; then
    echo "AUTOMATION ERROR: could not log in to master with the bootstrap or master admin from .env." >&2
    exit 1
  fi

  ensure_automation_client "$REALM" "$CLIENT_ID" "$SECRET"

  if "$KCADM_BIN" config credentials --server "$SERVER_URL" --realm "$REALM" \
      --client "$CLIENT_ID" --secret "$SECRET" --config "${KCADM_CONFIG}.verify" >/dev/null 2>&1 \
     && "$KCADM_BIN" get "realms/${REALM}" --fields realm --config "${KCADM_CONFIG}.verify" >/dev/null 2>&1; then
    echo "AUTOMATION: verified service account login and realm access."
  else
    echo "AUTOMATION ERROR: service account login or realm access failed after setup." >&2
    exit 1
  fi
  rm -f "$KCADM_CONFIG" "${KCADM_CONFIG}.verify"
fi

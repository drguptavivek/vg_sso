# shellcheck shell=bash
# Shared kcadm login for automation scripts. Source it after KCADM_BIN is set.
#
# Prefers the sso-automation service account (client credentials in
# KC_NEW_REALM_NAME) when KC_AUTOMATION_CLIENT_SECRET is set. Human admin
# accounts may have 2FA, which a username/password login cannot satisfy, so the
# username/password arguments are only a fallback (fresh installs before step 1
# has created the client, or deployments without an automation secret).
#
# Usage: kc_admin_login SERVER_URL KCADM_CONFIG FALLBACK_REALM FALLBACK_USER FALLBACK_PASSWORD
# Returns non-zero if neither login works (e.g. Keycloak not ready yet), so it
# can sit inside the existing wait-for-Keycloak retry loops.
kc_admin_login() {
  local server="$1" config="$2" realm="$3" user="$4" password="$5"
  local sa_realm="${KC_NEW_REALM_NAME:-}"
  local sa_client="${KC_AUTOMATION_CLIENT_ID:-sso-automation}"
  local sa_secret="${KC_AUTOMATION_CLIENT_SECRET:-}"

  if [[ -n "$sa_secret" && -n "$sa_realm" ]]; then
    if "$KCADM_BIN" config credentials --server "$server" --realm "$sa_realm" \
        --client "$sa_client" --secret "$sa_secret" --config "$config" >/dev/null 2>&1; then
      return 0
    fi
  fi

  [[ -n "$user" && -n "$password" ]] || return 1
  "$KCADM_BIN" config credentials --server "$server" --realm "$realm" \
    --user "$user" --password "$password" --config "$config" || return 1

  if [[ -n "$sa_secret" && -n "$sa_realm" ]]; then
    # Keycloak is up (the fallback worked), so the service account itself is
    # missing or misconfigured. Run step 1 or `make automation-client`.
    echo "WARN: service account '${sa_client}' login failed in realm '${sa_realm}'; used fallback user '${user}'." >&2
  fi
}

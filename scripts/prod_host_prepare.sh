#!/usr/bin/env bash
set -euo pipefail

# Prepares host-level prerequisites for running Keycloak as a service.
# Run as root (or with sudo).

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "ERROR: run as root. Example: sudo $0" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

KEYCLOAK_USER="${KEYCLOAK_USER:-keycloak}"
KEYCLOAK_GROUP="${KEYCLOAK_GROUP:-keycloak}"
OPS_GROUP="${OPS_GROUP:-vgops}"
APP_DIR="${APP_DIR:-/opt/vg_sso}"
KEYCLOAK_LOG_DIR="${KEYCLOAK_LOG_DIR:-/var/log/keycloak}"
EDIT_USERS="${EDIT_USERS:-}"
LOGROTATE_SRC="${LOGROTATE_SRC:-$ROOT_DIR/deploy/logrotate/keycloak}"
LOGROTATE_DST="${LOGROTATE_DST:-/etc/logrotate.d/keycloak}"

if ! getent group "$KEYCLOAK_GROUP" >/dev/null 2>&1; then
  groupadd --system "$KEYCLOAK_GROUP"
fi

if ! getent group "$OPS_GROUP" >/dev/null 2>&1; then
  groupadd "$OPS_GROUP"
fi

if ! id -u "$KEYCLOAK_USER" >/dev/null 2>&1; then
  useradd --system \
    --gid "$KEYCLOAK_GROUP" \
    --home-dir /nonexistent \
    --shell /usr/sbin/nologin \
    "$KEYCLOAK_USER"
fi

usermod -aG "$OPS_GROUP" "$KEYCLOAK_USER"

mkdir -p "$KEYCLOAK_LOG_DIR"
chown -R "$KEYCLOAK_USER:$KEYCLOAK_GROUP" "$KEYCLOAK_LOG_DIR"
chmod 0750 "$KEYCLOAK_LOG_DIR"

mkdir -p "$APP_DIR"
chown "$KEYCLOAK_USER:$OPS_GROUP" "$APP_DIR"
chmod 2775 "$APP_DIR"

users=()
if [[ -n "$EDIT_USERS" ]]; then
  IFS=',' read -r -a users <<< "$EDIT_USERS"
elif [[ -n "${SUDO_UID:-}" && "${SUDO_UID}" != "0" ]]; then
  detected_user="$(id -nu "${SUDO_UID}" 2>/dev/null || true)"
  if [[ -n "$detected_user" && "$detected_user" != "root" ]]; then
    users=("$detected_user")
  fi
elif [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
  users=("${SUDO_USER}")
fi

if [[ ${#users[@]} -gt 0 ]]; then
  for u in "${users[@]}"; do
    if id -u "$u" >/dev/null 2>&1; then
      usermod -aG "$OPS_GROUP" "$u"
    else
      echo "WARNING: edit user not found, skipping group add: $u"
    fi
  done
fi

if [[ -f "$LOGROTATE_SRC" ]]; then
  install -m 0644 "$LOGROTATE_SRC" "$LOGROTATE_DST"
else
  echo "WARNING: logrotate source not found: $LOGROTATE_SRC"
fi

echo "Host prep complete."
echo "User/group: $KEYCLOAK_USER:$KEYCLOAK_GROUP"
echo "Ops group: $OPS_GROUP"
echo "App dir: $APP_DIR (owner $KEYCLOAK_USER:$OPS_GROUP, mode 2775)"
echo "Log dir: $KEYCLOAK_LOG_DIR"
echo "Logrotate: $LOGROTATE_DST"

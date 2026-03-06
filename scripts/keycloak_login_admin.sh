#!/usr/bin/env bash
set -euo pipefail

# Authenticates kcadm against Keycloak admin API and stores a local config file.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

resolve_kcadm_bin() {
  if [[ -x "$ROOT_DIR/kcadm.sh" ]]; then
    printf '%s\n' "$ROOT_DIR/kcadm.sh"
    return 0
  fi

  local latest
  latest="$(ls -d "$ROOT_DIR"/keycloak-*/bin/kcadm.sh 2>/dev/null | sort -V | tail -n1 || true)"
  if [[ -n "$latest" && -x "$latest" ]]; then
    printf '%s\n' "$latest"
    return 0
  fi

  return 1
}

KCADM_BIN="${KCADM_BIN:-$(resolve_kcadm_bin || true)}"
KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8080}"
ADMIN_REALM="${ADMIN_REALM:-master}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
KCADM_CONFIG="${KCADM_CONFIG:-$ROOT_DIR/.kcadm.config}"

if [[ ! -x "$KCADM_BIN" ]]; then
  echo "ERROR: kcadm not found or not executable at: $KCADM_BIN"
  exit 1
fi

if [[ -z "$ADMIN_PASSWORD" ]]; then
  echo "ERROR: ADMIN_PASSWORD is required."
  echo "Usage example:"
  echo "  ADMIN_PASSWORD='secret' $0"
  exit 1
fi

echo "Logging into $KEYCLOAK_URL (realm=$ADMIN_REALM user=$ADMIN_USER)..."
"$KCADM_BIN" config credentials \
  --server "$KEYCLOAK_URL" \
  --realm "$ADMIN_REALM" \
  --user "$ADMIN_USER" \
  --password "$ADMIN_PASSWORD" \
  --config "$KCADM_CONFIG"

echo "kcadm login successful."
echo "Config file: $KCADM_CONFIG"

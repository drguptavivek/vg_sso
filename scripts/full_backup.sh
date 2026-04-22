#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TS="$(date +%Y%m%d_%H%M%S)"
BACKUP_ROOT="${BACKUP_ROOT:-$HOME/sso_backups}"
BACKUP_DIR="${BACKUP_ROOT}/sso_backup_${TS}"
ENV_FILE="${ROOT_DIR}/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: .env not found at $ENV_FILE" >&2
  exit 1
fi

get_env_value() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n1 || true)"
  line="${line#*=}"
  line="${line%\"}"
  line="${line#\"}"
  printf '%s' "$line"
}

KC_DB_USERNAME="$(get_env_value KC_DB_USERNAME)"
KC_DB_NAME="$(get_env_value KC_DB_NAME)"
KC_NEW_REALM_NAME="$(get_env_value KC_NEW_REALM_NAME)"
KC_HOSTNAME="$(get_env_value KC_HOSTNAME)"

: "${KC_DB_USERNAME:?KC_DB_USERNAME is required in .env}"
: "${KC_DB_NAME:?KC_DB_NAME is required in .env}"

mkdir -p "$BACKUP_DIR"

echo "Creating backup in $BACKUP_DIR"

docker exec vg-postgres pg_dump -U "$KC_DB_USERNAME" -d "$KC_DB_NAME" -Fc -f "/tmp/keycloak_db_${TS}.dump"
docker cp "vg-postgres:/tmp/keycloak_db_${TS}.dump" "${BACKUP_DIR}/keycloak_db.dump"
docker exec vg-postgres rm -f "/tmp/keycloak_db_${TS}.dump"

cp "$ENV_FILE" "${BACKUP_DIR}/.env"
chmod 600 "${BACKUP_DIR}/.env"

if [[ -d "${ROOT_DIR}/.local" ]]; then
  cp -a "${ROOT_DIR}/.local" "${BACKUP_DIR}/.local"
fi

cat > "${BACKUP_DIR}/metadata.txt" <<EOF
timestamp=${TS}
backup_root=${BACKUP_ROOT}
db_name=${KC_DB_NAME}
db_user=${KC_DB_USERNAME}
realm=${KC_NEW_REALM_NAME:-}
hostname=${KC_HOSTNAME:-}
EOF

(
  cd "$BACKUP_DIR"
  zip -q env.zip .env
  zip -q metadata.zip metadata.txt
  if [[ -d .local ]]; then
    zip -qr local.zip .local
    rm -rf .local
  fi
  rm -f .env metadata.txt
)

echo "Backup created at: $BACKUP_DIR"

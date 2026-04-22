#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER_NAME="${CONTAINER_NAME:-vg-keycloak}"
KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8080}"
REALM="${REALM:-$(grep '^KC_NEW_REALM_NAME=' "$ROOT_DIR/.env" | head -n1 | cut -d= -f2-)}"
ADMIN_REALM="${ADMIN_REALM:-master}"
ADMIN_USER="${ADMIN_USER:-$(grep '^KC_BOOTSTRAP_ADMIN_USERNAME=' "$ROOT_DIR/.env" | head -n1 | cut -d= -f2-)}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(grep '^KC_BOOTSTRAP_ADMIN_PASSWORD=' "$ROOT_DIR/.env" | head -n1 | cut -d= -f2-)}"
LIFESPAN_SECONDS="${LIFESPAN_SECONDS:-43200}"

usage() {
  cat <<'EOF'
Usage:
  scripts/send_onboarding_email.sh --username <username>
  scripts/send_onboarding_email.sh --user-id <id>

Options:
  --realm <realm>        Target realm (default: KC_NEW_REALM_NAME from .env)
  --username <username>  Target user by username
  --user-id <id>         Target user by Keycloak user id
EOF
}

TARGET_USER_ID=""
TARGET_USERNAME=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --realm)
      REALM="$2"
      shift 2
      ;;
    --username)
      TARGET_USERNAME="$2"
      shift 2
      ;;
    --user-id)
      TARGET_USER_ID="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$REALM" || -z "$ADMIN_USER" || -z "$ADMIN_PASSWORD" ]]; then
  echo "ERROR: REALM, ADMIN_USER, and ADMIN_PASSWORD must be set or present in .env" >&2
  exit 1
fi

if [[ -n "$TARGET_USER_ID" && -n "$TARGET_USERNAME" ]]; then
  echo "ERROR: provide either --username or --user-id, not both" >&2
  exit 1
fi

if [[ -z "$TARGET_USER_ID" && -z "$TARGET_USERNAME" ]]; then
  echo "ERROR: provide --username or --user-id" >&2
  exit 1
fi

KCADM_CONFIG="/tmp/send-onboarding-email.config"

docker exec "$CONTAINER_NAME" /opt/keycloak/bin/kcadm.sh config credentials \
  --server "$KEYCLOAK_URL" \
  --realm "$ADMIN_REALM" \
  --user "$ADMIN_USER" \
  --password "$ADMIN_PASSWORD" \
  --config "$KCADM_CONFIG" >/dev/null

if [[ -z "$TARGET_USER_ID" ]]; then
  TARGET_USER_ID="$(
    docker exec "$CONTAINER_NAME" /opt/keycloak/bin/kcadm.sh get users \
      -r "$REALM" \
      -q username="$TARGET_USERNAME" \
      --fields id \
      --format csv \
      --noquotes \
      --config "$KCADM_CONFIG" | head -n1
  )"
fi

if [[ -z "$TARGET_USER_ID" ]]; then
  echo "ERROR: could not resolve target user" >&2
  exit 1
fi

docker exec "$CONTAINER_NAME" /bin/bash -lc \
  "printf '%s' '[\"VERIFY_EMAIL\",\"UPDATE_PASSWORD\",\"CONFIGURE_TOTP\",\"CONFIGURE_RECOVERY_AUTHN_CODES\"]' > /tmp/send-onboarding-actions.json \
    && /opt/keycloak/bin/kcadm.sh update users/${TARGET_USER_ID}/execute-actions-email -r ${REALM@Q} --config ${KCADM_CONFIG@Q} -q lifespan=${LIFESPAN_SECONDS@Q} -f /tmp/send-onboarding-actions.json -n >/dev/null"

echo "Onboarding email triggered for user id: $TARGET_USER_ID"

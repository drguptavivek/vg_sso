#!/usr/bin/env bash
set -euo pipefail

# Ensure unbuffered output for docker logs
exec 1>/proc/1/fd/1 2>/proc/1/fd/2 2>/dev/null || true

STEP9_MARKER_FILE="${STEP9_MARKER_FILE:-/opt/keycloak/data/.step9-init-done}"
STEP9_FORCE="${STEP9_FORCE:-false}"
STEP9_RUN_INITIAL_EXPORT="${STEP9_RUN_INITIAL_EXPORT:-false}"

REALM_NAME="${KC_NEW_REALM_NAME:-org-new-delhi}"
EXPORT_DIR="${AUDIT_EXPORT_OUTPUT_DIR:-/workspace/exports/audit}"
STATE_FILE="${AUDIT_EXPORT_STATE_FILE:-/workspace/exports/audit/state/watermark.json}"

if [[ "$STEP9_FORCE" != "true" && -f "$STEP9_MARKER_FILE" ]]; then
  echo "STEP9: marker exists at $STEP9_MARKER_FILE; skipping (set STEP9_FORCE=true to rerun)."
  exit 0
fi

mkdir -p "$EXPORT_DIR/$REALM_NAME"
mkdir -p "$(dirname "$STATE_FILE")"

cat > "${EXPORT_DIR}/README.md" <<'MD'
# Audit Archive Exports

This directory contains compressed JSONL exports of Keycloak user/admin events.

Layout:
- <realm>/YYYY/MM/DD/user-events-YYYY-MM-DD.jsonl.gz
- <realm>/YYYY/MM/DD/admin-events-YYYY-MM-DD.jsonl.gz
- <realm>/YYYY/MM/DD/manifest.json
- state/watermark.json

Use `scripts/audit_export_events.py` for periodic exports.
MD

echo "STEP9: archive directories prepared at ${EXPORT_DIR}"
echo "STEP9: watermark file path ${STATE_FILE}"

if [[ "$STEP9_RUN_INITIAL_EXPORT" == "true" ]]; then
  echo "STEP9: running initial export (yesterday by default)..."
  python3 /workspace/scripts/audit_export_events.py \
    --url "${KC_SERVER_URL:-http://keycloak:8080}" \
    --realm "$REALM_NAME" \
    --user "${KC_NEW_REALM_ADMIN_USER:-}" \
    --password "${KC_NEW_REALM_ADMIN_PASSWORD:-}" \
    --output-dir "$EXPORT_DIR" \
    --state-file "$STATE_FILE"
fi

touch "$STEP9_MARKER_FILE"
echo "STEP9: complete. Marker created at $STEP9_MARKER_FILE"

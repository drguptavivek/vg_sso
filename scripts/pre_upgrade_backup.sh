#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TS="$(date +%Y%m%d_%H%M%S)"
BACKUP_ROOT="${BACKUP_ROOT:-$ROOT_DIR/backups}"
BACKUP_DIR="$BACKUP_ROOT/pre_upgrade_$TS"
REALM="${REALM:-org-new-delhi}"
DO_EXPORT="true"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --realm)
      REALM="${2:-}"
      shift 2
      ;;
    --skip-export)
      DO_EXPORT="false"
      shift
      ;;
    -h|--help)
      cat <<USAGE
Usage: $0 [--realm <realm-name>] [--skip-export]

Creates a pre-upgrade snapshot with config and inventory.
USAGE
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

mkdir -p "$BACKUP_DIR"

# Capture stable config snapshots.
for path in keycloak-custom nginx-confs .env.template docs/prod-setup.md; do
  if [[ -e "$ROOT_DIR/$path" ]]; then
    cp -a "$ROOT_DIR/$path" "$BACKUP_DIR/"
  fi
done

if [[ -f "$ROOT_DIR/.env" ]]; then
  cp -f "$ROOT_DIR/.env" "$BACKUP_DIR/.env"
  chmod 600 "$BACKUP_DIR/.env"
fi

{
  echo "timestamp=$TS"
  echo "realm=$REALM"
  echo "cwd=$ROOT_DIR"
  if [[ -L "$ROOT_DIR/keycloak-current" ]]; then
    echo "keycloak_current=$(readlink "$ROOT_DIR/keycloak-current")"
  fi
  if [[ -x "$ROOT_DIR/kc.sh" ]]; then
    echo "kc_version=$($ROOT_DIR/kc.sh --version 2>/dev/null | head -n1 || true)"
  fi
} > "$BACKUP_DIR/metadata.txt"

if [[ -x "$ROOT_DIR/kc.sh" && "$DO_EXPORT" == "true" ]]; then
  mkdir -p "$BACKUP_DIR/realm-exports"
  set +e
  "$ROOT_DIR/kc.sh" export --dir "$BACKUP_DIR/realm-exports" --realm "$REALM" > "$BACKUP_DIR/export.log" 2>&1
  export_rc=$?
  set -e
  if [[ $export_rc -ne 0 ]]; then
    echo "WARNING: realm export failed; check $BACKUP_DIR/export.log" >&2
  fi
fi

mkdir -p "$BACKUP_DIR/inventory"

if [[ -L "$ROOT_DIR/keycloak-current" || -d "$ROOT_DIR/keycloak-current" ]]; then
  ACTIVE_KC_DIR="$(cd "$ROOT_DIR/keycloak-current" && pwd)"
  if [[ -d "$ACTIVE_KC_DIR/providers" ]]; then
    ls -1 "$ACTIVE_KC_DIR/providers" > "$BACKUP_DIR/inventory/providers.txt" || true
  fi
  if [[ -d "$ACTIVE_KC_DIR/themes" ]]; then
    ls -1 "$ACTIVE_KC_DIR/themes" > "$BACKUP_DIR/inventory/themes.txt" || true
  fi
fi

echo "Backup created at: $BACKUP_DIR"

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KC_BIN="${KC_BIN:-$ROOT_DIR/kc.sh}"
MODE="${1:-start-dev}"

if [[ "$MODE" != "start" && "$MODE" != "start-dev" ]]; then
  echo "Usage: $0 [start|start-dev] [extra kc args...]" >&2
  exit 1
fi
shift || true

if [[ ! -x "$KC_BIN" ]]; then
  echo "ERROR: kc binary not executable at $KC_BIN" >&2
  exit 1
fi

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

exec "$KC_BIN" "$MODE" "$@"

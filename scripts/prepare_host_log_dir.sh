#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${KC_HOST_LOG_DIR:-${ROOT_DIR}/logs/keycloak}"
LOG_FILE="${LOG_DIR}/keycloak.log"
FAILURE_LOG_FILE="${LOG_DIR}/failure-auth.log"

mkdir -p "${LOG_DIR}"

# Secure defaults for host-side audit log directory and files.
chmod 750 "${LOG_DIR}" || true
touch "${LOG_FILE}" "${FAILURE_LOG_FILE}"
chmod 640 "${LOG_FILE}" "${FAILURE_LOG_FILE}" || true

if [[ -n "${KEYCLOAK_LOG_UID:-}" && -n "${KEYCLOAK_LOG_GID:-}" ]]; then
  if chown -R "${KEYCLOAK_LOG_UID}:${KEYCLOAK_LOG_GID}" "${LOG_DIR}" 2>/dev/null; then
    echo "LOG-PREP: ownership set to ${KEYCLOAK_LOG_UID}:${KEYCLOAK_LOG_GID}"
  else
    echo "LOG-PREP WARN: failed to chown ${LOG_DIR} to ${KEYCLOAK_LOG_UID}:${KEYCLOAK_LOG_GID}"
    echo "LOG-PREP WARN: run manually with elevated privileges if Keycloak cannot write logs."
  fi
fi

echo "LOG-PREP: ready ${LOG_DIR}"

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILES=(-f "${ROOT_DIR}/docker-compose.yml" -f "${ROOT_DIR}/docker-compose.override.yml")
SERVICE_NAME="${SERVICE_NAME:-keycloak}"
CONTAINER_NAME="${CONTAINER_NAME:-vg-keycloak}"
READY_URL="${READY_URL:-http://localhost:9000/management/health/ready}"
WAIT_SECONDS="${WAIT_SECONDS:-180}"
POLL_SECONDS="${POLL_SECONDS:-3}"

DEFAULT_MODULES=(
  "custom-group-attr-mapper"
  "custom-phone-otp-authenticator"
  "custom-account-expiry-spi"
  "custom-delegated-admin-guard-spi"
  "custom-password-phrase-policy-spi"
  "custom-failure-logs-event-listener-spi"
)

usage() {
  cat <<'EOF'
Usage:
  scripts/dev_hot_reload_spi.sh [module_dir ...]

Examples:
  scripts/dev_hot_reload_spi.sh
  # default: builds/copies all SPI modules above
  scripts/dev_hot_reload_spi.sh custom-group-attr-mapper
  scripts/dev_hot_reload_spi.sh custom-group-attr-mapper custom-delegated-admin-guard-spi
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "$#" -gt 0 ]]; then
  MODULES=("$@")
else
  MODULES=("${DEFAULT_MODULES[@]}")
fi

declare -a JARS_TO_COPY=()
for module in "${MODULES[@]}"; do
  module_dir="${ROOT_DIR}/${module}"
  pom_file="${module_dir}/pom.xml"
  target_dir="${module_dir}/target"

  if [[ ! -f "${pom_file}" ]]; then
    echo "DEV-HOT-RELOAD ERROR: module pom not found: ${pom_file}" >&2
    exit 1
  fi

  echo "DEV-HOT-RELOAD: building ${module}..."
  mvn -q -f "${pom_file}" -DskipTests package

  jar_path="$(find "${target_dir}" -maxdepth 1 -type f -name '*.jar' \
    ! -name '*-sources.jar' ! -name '*-javadoc.jar' ! -name 'original-*.jar' \
    | sort | head -n1)"

  if [[ -z "${jar_path}" ]]; then
    echo "DEV-HOT-RELOAD ERROR: no deployable jar found in ${target_dir}" >&2
    exit 1
  fi

  JARS_TO_COPY+=("${jar_path}")
done

echo "DEV-HOT-RELOAD: ensuring ${SERVICE_NAME} is running..."
docker compose "${COMPOSE_FILES[@]}" up -d "${SERVICE_NAME}" >/dev/null

for jar_path in "${JARS_TO_COPY[@]}"; do
  echo "DEV-HOT-RELOAD: copying $(basename "${jar_path}") to ${CONTAINER_NAME}:/opt/keycloak/providers/"
  docker cp "${jar_path}" "${CONTAINER_NAME}:/opt/keycloak/providers/"
done

echo "DEV-HOT-RELOAD: restarting ${SERVICE_NAME}..."
docker compose "${COMPOSE_FILES[@]}" restart "${SERVICE_NAME}" >/dev/null

deadline=$(( $(date +%s) + WAIT_SECONDS ))
while true; do
  if curl -sf "${READY_URL}" >/dev/null; then
    echo "DEV-HOT-RELOAD: ready (${READY_URL})"
    break
  fi

  if (( $(date +%s) >= deadline )); then
    echo "DEV-HOT-RELOAD ERROR: readiness timeout after ${WAIT_SECONDS}s (${READY_URL})" >&2
    exit 1
  fi

  sleep "${POLL_SECONDS}"
done

echo "DEV-HOT-RELOAD: done."

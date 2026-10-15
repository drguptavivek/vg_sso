#!/usr/bin/env bash
# Generate the sso-automation service account secret into .env once.
# Never overwrites an existing value; to rotate, replace the value in .env and
# run `make automation-client`.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found (cp .env.template .env first)" >&2
  exit 1
fi

if ! grep -q '^KC_AUTOMATION_CLIENT_ID=' "$ENV_FILE"; then
  printf '\n# Automation service account (created by step 1 / make automation-client).\nKC_AUTOMATION_CLIENT_ID=sso-automation\n' >> "$ENV_FILE"
fi

current="$(grep -m1 '^KC_AUTOMATION_CLIENT_SECRET=' "$ENV_FILE" | cut -d= -f2- || true)"
if [[ -n "$current" ]]; then
  echo "AUTOMATION: KC_AUTOMATION_CLIENT_SECRET already set in $(basename "$ENV_FILE")."
  exit 0
fi

secret="$(openssl rand -hex 32)"
if grep -q '^KC_AUTOMATION_CLIENT_SECRET=' "$ENV_FILE"; then
  sed -i "s|^KC_AUTOMATION_CLIENT_SECRET=.*|KC_AUTOMATION_CLIENT_SECRET=${secret}|" "$ENV_FILE"
else
  printf 'KC_AUTOMATION_CLIENT_SECRET=%s\n' "$secret" >> "$ENV_FILE"
fi
echo "AUTOMATION: generated KC_AUTOMATION_CLIENT_SECRET in $(basename "$ENV_FILE")."

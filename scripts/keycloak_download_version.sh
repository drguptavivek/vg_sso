#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<USAGE
Usage: $0 --version <x.y.z> [--switch] [--build] [--keep-archive]

Downloads and extracts Keycloak release tarball into repo root:
  keycloak-<version>.tar.gz
  keycloak-<version>/

Options:
  --version <x.y.z>   Required, e.g. 26.5.4
  --switch            Run scripts/keycloak_switch_version.sh after extract
  --build             When used with --switch, also run build
  --keep-archive      Keep downloaded tar.gz (default deletes archive)
USAGE
}

VERSION=""
DO_SWITCH="false"
DO_BUILD="false"
KEEP_ARCHIVE="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --switch)
      DO_SWITCH="true"
      shift
      ;;
    --build)
      DO_BUILD="true"
      shift
      ;;
    --keep-archive)
      KEEP_ARCHIVE="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  echo "ERROR: --version is required." >&2
  usage
  exit 1
fi

TARGET_DIR="$ROOT_DIR/keycloak-$VERSION"
ARCHIVE="$ROOT_DIR/keycloak-$VERSION.tar.gz"
URL="https://github.com/keycloak/keycloak/releases/download/$VERSION/keycloak-$VERSION.tar.gz"

if [[ -d "$TARGET_DIR" ]]; then
  echo "Target already exists: $TARGET_DIR"
else
  echo "Downloading: $URL"
  curl -fL -o "$ARCHIVE" "$URL"

  echo "Extracting: $ARCHIVE"
  tar -xzf "$ARCHIVE" -C "$ROOT_DIR"

  if [[ ! -d "$TARGET_DIR" ]]; then
    echo "ERROR: extraction did not produce $TARGET_DIR" >&2
    exit 1
  fi

  if [[ "$KEEP_ARCHIVE" != "true" ]]; then
    rm -f "$ARCHIVE"
  fi
fi

if [[ -f "$TARGET_DIR/version.txt" ]]; then
  echo "Installed: $(cat "$TARGET_DIR/version.txt")"
fi

if [[ "$DO_SWITCH" == "true" ]]; then
  if [[ "$DO_BUILD" == "true" ]]; then
    "$ROOT_DIR/scripts/keycloak_switch_version.sh" --version "$VERSION" --build
  else
    "$ROOT_DIR/scripts/keycloak_switch_version.sh" --version "$VERSION"
  fi
fi


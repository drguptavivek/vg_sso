#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEYCLOAK_CUSTOM_DIR="${KEYCLOAK_CUSTOM_DIR:-$ROOT_DIR/keycloak-custom}"
CUSTOM_CONF_DIR="$KEYCLOAK_CUSTOM_DIR/conf"
CUSTOM_THEMES_DIR="$KEYCLOAK_CUSTOM_DIR/themes"
CUSTOM_PROVIDERS_DIR="$KEYCLOAK_CUSTOM_DIR/providers"

usage() {
  cat <<USAGE
Usage: $0 --version <version|keycloak-<version>|/abs/path> [--build]

Examples:
  $0 --version 26.5.4
  $0 --version keycloak-26.5.4 --build
USAGE
}

TARGET_ARG=""
DO_BUILD="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      TARGET_ARG="${2:-}"
      shift 2
      ;;
    --build)
      DO_BUILD="true"
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

if [[ -z "$TARGET_ARG" ]]; then
  echo "ERROR: --version is required" >&2
  usage
  exit 1
fi

resolve_target_dir() {
  local arg="$1"
  if [[ -d "$arg" ]]; then
    cd "$arg" && pwd
    return 0
  fi

  if [[ -d "$ROOT_DIR/$arg" ]]; then
    cd "$ROOT_DIR/$arg" && pwd
    return 0
  fi

  if [[ -d "$ROOT_DIR/keycloak-$arg" ]]; then
    cd "$ROOT_DIR/keycloak-$arg" && pwd
    return 0
  fi

  return 1
}

TARGET_DIR="$(resolve_target_dir "$TARGET_ARG" || true)"
if [[ -z "$TARGET_DIR" ]]; then
  echo "ERROR: could not resolve target directory from '$TARGET_ARG'" >&2
  exit 1
fi

if [[ ! -x "$TARGET_DIR/bin/kc.sh" || ! -x "$TARGET_DIR/bin/kcadm.sh" ]]; then
  echo "ERROR: target is not a valid Keycloak distribution: $TARGET_DIR" >&2
  exit 1
fi

TARGET_BASENAME="$(basename "$TARGET_DIR")"

ln -sfn "./$TARGET_BASENAME" "$ROOT_DIR/keycloak-current"
ln -sfn "./keycloak-current/bin/kc.sh" "$ROOT_DIR/kc.sh"
ln -sfn "./keycloak-current/bin/kcadm.sh" "$ROOT_DIR/kcadm.sh"

mkdir -p "$KEYCLOAK_CUSTOM_DIR" "$CUSTOM_PROVIDERS_DIR" "$CUSTOM_CONF_DIR"

# Seed custom conf once from the current version's conf directory.
seed_conf_file() {
  local src="$1"
  local dst="$2"
  if [[ ! -f "$dst" && -f "$src" ]]; then
    cp -f "$src" "$dst"
    echo "Seeded stable config: $dst"
  fi
}

seed_conf_file "$TARGET_DIR/conf/keycloak.conf" "$CUSTOM_CONF_DIR/keycloak.conf"
seed_conf_file "$TARGET_DIR/conf/cache-ispn.xml" "$CUSTOM_CONF_DIR/cache-ispn.xml"

# Link entire conf directory from keycloak-custom into active Keycloak.
if [[ -e "$TARGET_DIR/conf" || -L "$TARGET_DIR/conf" ]]; then
  rm -rf "$TARGET_DIR/conf"
fi
ln -s "$CUSTOM_CONF_DIR" "$TARGET_DIR/conf"

if [[ -L "$CUSTOM_THEMES_DIR" ]]; then
  rm -f "$CUSTOM_THEMES_DIR"
fi
if [[ ! -e "$CUSTOM_THEMES_DIR" ]]; then
  mkdir -p "$CUSTOM_THEMES_DIR"
fi

# Keep a functional mirrored copy of repo theme assets in keycloak-custom/themes.
if [[ -d "$ROOT_DIR/theme" ]]; then
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$ROOT_DIR/theme/" "$CUSTOM_THEMES_DIR/"
  else
    rm -rf "$CUSTOM_THEMES_DIR"
    mkdir -p "$CUSTOM_THEMES_DIR"
    cp -a "$ROOT_DIR/theme/." "$CUSTOM_THEMES_DIR/"
  fi
fi

# Refresh keycloak-custom/providers from module build outputs.
copied_provider_count=0
for jar in "$ROOT_DIR"/custom-*/target/*.jar; do
  [[ -f "$jar" ]] || continue
  cp -f "$jar" "$CUSTOM_PROVIDERS_DIR/"
  copied_provider_count=$((copied_provider_count + 1))
done

# Link entire themes directory from keycloak-custom into active Keycloak.
if [[ -e "$TARGET_DIR/themes" || -L "$TARGET_DIR/themes" ]]; then
  rm -rf "$TARGET_DIR/themes"
fi
ln -s "$CUSTOM_THEMES_DIR" "$TARGET_DIR/themes"

# Link entire providers directory from keycloak-custom into active Keycloak.
if [[ -e "$TARGET_DIR/providers" || -L "$TARGET_DIR/providers" ]]; then
  rm -rf "$TARGET_DIR/providers"
fi
ln -s "$CUSTOM_PROVIDERS_DIR" "$TARGET_DIR/providers"

if [[ "$DO_BUILD" == "true" ]]; then
  if [[ -f "$ROOT_DIR/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT_DIR/.env"
    set +a
  fi
  "$ROOT_DIR/kc.sh" build
fi

echo "Switched Keycloak to: $TARGET_BASENAME"
echo "Active kc.sh: $ROOT_DIR/kc.sh"
echo "Active kcadm.sh: $ROOT_DIR/kcadm.sh"
echo "Custom conf dir: $CUSTOM_CONF_DIR"
echo "Custom themes dir: $CUSTOM_THEMES_DIR"
echo "Custom providers dir: $CUSTOM_PROVIDERS_DIR"
echo "Conf directory symlinked in active Keycloak: $TARGET_DIR/conf -> $CUSTOM_CONF_DIR"
echo "Provider artifacts copied into keycloak-custom/providers: $copied_provider_count"
echo "Themes directory symlinked in active Keycloak: $TARGET_DIR/themes -> $CUSTOM_THEMES_DIR"
echo "Providers directory symlinked in active Keycloak: $TARGET_DIR/providers -> $CUSTOM_PROVIDERS_DIR"
if [[ "$DO_BUILD" == "true" ]]; then
  echo "Build completed."
else
  echo "Run './kc.sh build' before production start if provider set changed."
fi

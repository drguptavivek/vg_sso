#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_ASSETS_DIR="${ROOT_DIR}/.local/brand-assets"
DEFAULT_ASSETS_DIR="${ROOT_DIR}/assets"

echo "Applying theme assets (source preference: .local/brand-assets -> assets)"

resolve_asset_file() {
  local base_name="$1"
  local local_file="${LOCAL_ASSETS_DIR}/${base_name}"
  local default_file="${DEFAULT_ASSETS_DIR}/${base_name}"

  if [[ -f "${local_file}" ]]; then
    printf '%s' "${local_file}"
    return 0
  fi
  if [[ -f "${default_file}" ]]; then
    printf '%s' "${default_file}"
    return 0
  fi
  return 1
}

copy_resolved_asset() {
  local base_name="$1"
  local targets=()
  local src_file

  if ! src_file="$(resolve_asset_file "${base_name}")"; then
    echo "  skipped missing asset: ${base_name}"
    return 0
  fi

  case "${base_name}" in
    background.png)
      targets+=(
        "theme/vg/login/resources/img/background.png"
        "theme/vg-master/login/resources/img/background.png"
      )
      ;;
    green_logo.png)
      targets+=(
        "theme/admin-vg-custom/admin/resources/img/green_logo.png"
        "theme/vg/admin/resources/img/green_logo.png"
        "theme/vg-master/admin/resources/img/green_logo.png"
      )
      ;;
    logo.png)
      targets+=(
        "theme/admin-vg-custom/admin/resources/img/logo.png"
        "theme/vg/account/resources/img/logo.png"
        "theme/vg/admin/resources/img/logo.png"
        "theme/vg/login/resources/img/logo.png"
        "theme/vg-master/account/resources/img/logo.png"
        "theme/vg-master/admin/resources/img/logo.png"
        "theme/vg-master/login/resources/img/logo.png"
      )
      ;;
    logo.svg)
      targets+=(
        "theme/admin-vg-custom/admin/icon.svg"
        "theme/admin-vg-custom/admin/resources/icon.svg"
        "theme/vg/admin/icon.svg"
        "theme/vg/admin/resources/icon.svg"
        "theme/vg-master/admin/icon.svg"
        "theme/vg-master/admin/resources/icon.svg"
      )
      ;;
    favicon.ico)
      targets+=(
        "theme/admin-vg-custom/admin/favicon.ico"
        "theme/admin-vg-custom/admin/favicon-v2.ico"
        "theme/vg/admin/favicon.ico"
        "theme/vg/admin/favicon-v2.ico"
        "theme/vg-master/admin/favicon.ico"
        "theme/vg-master/admin/favicon-v2.ico"
        "theme/vg/account/favicon.ico"
        "theme/vg/account/favicon-v2.ico"
        "theme/vg-master/account/favicon.ico"
        "theme/vg-master/account/favicon-v2.ico"
        "theme/vg/login/resources/img/favicon.ico"
        "theme/vg-master/login/resources/img/favicon.ico"
        "theme/vg/account/resources/img/favicon.ico"
        "theme/vg-master/account/resources/img/favicon.ico"
        "theme/admin-vg-custom/admin/resources/img/favicon.ico"
        "theme/vg/admin/resources/img/favicon.ico"
        "theme/vg-master/admin/resources/img/favicon.ico"
      )
      ;;
    master_realm_logo.png)
      # No theme target currently consumes this directly; keep as source-only asset.
      echo "  source resolved for ${base_name}: ${src_file}"
      return 0
      ;;
    *)
      echo "  skipped unknown asset key: ${base_name}"
      return 0
      ;;
  esac

  local t
  for t in "${targets[@]}"; do
    mkdir -p "$(dirname "${ROOT_DIR}/${t}")"
    cp -f "$src_file" "${ROOT_DIR}/${t}"
    echo "  applied ${base_name} (${src_file##${ROOT_DIR}/}) -> ${t}"
  done
}

# Apply known theme assets with source fallback to /assets.
copy_resolved_asset "background.png"
copy_resolved_asset "green_logo.png"
copy_resolved_asset "logo.png"
copy_resolved_asset "logo.svg"
copy_resolved_asset "favicon.ico"
copy_resolved_asset "master_realm_logo.png"

echo "Done."

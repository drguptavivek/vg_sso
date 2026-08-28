#!/usr/bin/env bash
set -euo pipefail

container="${ADMIN_CONSOLE_CONTAINER:-vg-admin-console}"
archive_dir="${ADMIN_CONSOLE_LOG_ARCHIVE_DIR:-logs/admin-console}"
retention_days="${ADMIN_CONSOLE_LOG_RETENTION_DAYS:-250}"

if ! [[ "$retention_days" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: ADMIN_CONSOLE_LOG_RETENTION_DAYS must be a positive integer" >&2
  exit 1
fi
if ! docker inspect "$container" >/dev/null 2>&1; then
  echo "ERROR: container not found: $container" >&2
  exit 1
fi

mkdir -p "$archive_dir"
watermark_file="$archive_dir/.watermark"
run_until="$(date -u +%Y-%m-%dT%H:%M:%S.%NZ)"
if [[ -s "$watermark_file" ]]; then
  run_since="$(<"$watermark_file")"
else
  run_since="$(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%S.%NZ)"
fi

archive_file="$archive_dir/$(date -u +%Y-%m-%d).log"
tmp_file="$(mktemp)"
trap 'rm -f "$tmp_file"' EXIT
docker logs --timestamps --since "$run_since" --until "$run_until" "$container" >"$tmp_file" 2>&1
if [[ -s "$tmp_file" ]]; then
  cat "$tmp_file" >>"$archive_file"
  chmod 600 "$archive_file"
fi

watermark_tmp="$archive_dir/.watermark.tmp"
printf '%s\n' "$run_until" >"$watermark_tmp"
chmod 600 "$watermark_tmp"
mv -f "$watermark_tmp" "$watermark_file"

find "$archive_dir" -maxdepth 1 -type f -name '*.log' -mtime "+$retention_days" -delete
echo "Admin-console logs archived in $archive_dir; retention is $retention_days days."

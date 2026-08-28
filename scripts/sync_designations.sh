#!/usr/bin/env bash
set -euo pipefail

input_file="${1:-.local/masters/designations.txt}"
output_file="${2:-admin-console/src/config/designations.json}"

if [[ ! -f "$input_file" ]]; then
  echo "ERROR: designation source not found: $input_file" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required to normalize designations." >&2
  exit 1
fi

output_dir="$(dirname "$output_file")"
if [[ ! -d "$output_dir" ]]; then
  echo "ERROR: output directory not found: $output_dir" >&2
  exit 1
fi

temporary_file="$(mktemp "$output_dir/.designations.XXXXXX")"
trap 'rm -f "$temporary_file"' EXIT

jq -R -s '
  split("\n")
  | map(gsub("\r$"; "") | gsub("^[[:space:]]+|[[:space:]]+$"; ""))
  | map(select(length > 0))
  | reduce .[] as $designation (
      [];
      if index($designation) == null then . + [$designation] else . end
    )
' "$input_file" >"$temporary_file"

if ! jq -e 'type == "array" and length > 0 and all(.[]; type == "string" and length > 0) and (length == (unique | length))' "$temporary_file" >/dev/null; then
  echo "ERROR: normalized designation list is invalid." >&2
  exit 1
fi

mv "$temporary_file" "$output_file"
echo "Wrote $(jq 'length' "$output_file") unique designations to $output_file"

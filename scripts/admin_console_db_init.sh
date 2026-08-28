#!/usr/bin/env bash
set -euo pipefail

required=(KC_DB_USERNAME KC_DB_PASSWORD ADMIN_CONSOLE_DB_NAME ADMIN_CONSOLE_DB_USER ADMIN_CONSOLE_DB_PASSWORD)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "ADMIN-CONSOLE-DB-INIT: missing $name" >&2
    exit 1
  fi
done

export PGPASSWORD="$KC_DB_PASSWORD"
psql_args=(-h postgres -U "$KC_DB_USERNAME" -d postgres -v ON_ERROR_STOP=1)

psql "${psql_args[@]}" \
  -v app_user="$ADMIN_CONSOLE_DB_USER" \
  -v app_password="$ADMIN_CONSOLE_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user') \gexec
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password') \gexec
SQL

psql "${psql_args[@]}" \
  -v app_db="$ADMIN_CONSOLE_DB_NAME" \
  -v app_user="$ADMIN_CONSOLE_DB_USER" <<'SQL'
SELECT format('CREATE DATABASE %I OWNER %I', :'app_db', :'app_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'app_db') \gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', :'app_db', :'app_user') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'app_db') \gexec
SQL

echo "ADMIN-CONSOLE-DB-INIT: database and restricted role ready"

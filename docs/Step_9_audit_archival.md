# Implementation Note: Step 9 Audit Archival Pipeline

Step 9 provisions an ingest-ready export pipeline for Keycloak audit events.

## Scope

- Exports user events and admin events from Keycloak Admin API.
- Writes compressed JSONL files plus per-day manifest (counts + SHA-256).
- Maintains export watermark to support incremental daily exports.

## Scripts

- Setup/bootstrap: `scripts/step9_audit_archival_setup.sh`
- Exporter: `scripts/audit_export_events.py`

## Output Layout

Under `exports/audit`:

- `<realm>/YYYY/MM/DD/user-events-YYYY-MM-DD.jsonl.gz`
- `<realm>/YYYY/MM/DD/admin-events-YYYY-MM-DD.jsonl.gz`
- `<realm>/YYYY/MM/DD/manifest.json`
- `state/watermark.json`

## Compose Service

- Service: `step9-init`
- Depends on: `step8-init`
- Marker: `/opt/keycloak/data/.step9-init-done`
- Default behavior: create archive directories and state path only.
- Optional initial export: set `STEP9_RUN_INITIAL_EXPORT=true`.

Maintenance runner:

- Service: `keycloak-maintenance`
- Depends on: `keycloak` only
- Intended for routine maintenance scripts (export, checks, one-off operations)

## Make Targets

- `make force-step9` -> rerun Step 9 setup.
- `make audit-export` -> run export now via `keycloak-maintenance`
  (depends only on `keycloak`, not step1→step9 chain).
- `make maintenance MAINT_CMD='python3 /workspace/scripts/audit_export_events.py --dry-run'`
  -> run any maintenance command in the maintenance service.

## Config (from `.env`)

- `AUDIT_EXPORT_OUTPUT_DIR` (default `/workspace/exports/audit`)
- `AUDIT_EXPORT_STATE_FILE` (default `/workspace/exports/audit/state/watermark.json`)
- `AUDIT_EXPORT_START_DATE` (optional `YYYY-MM-DD`)
- `AUDIT_EXPORT_END_DATE` (optional `YYYY-MM-DD`; default yesterday)
- `AUDIT_EXPORT_BATCH_SIZE` (default `500`)

## Notes

- Retention baseline remains in Step 8 (`eventsExpiration=270 days` by default).
- Step 9 is archival/export provisioning; purge is intentionally separate.

# Implementation Note: Step 8 Auditor Role

This step introduces a dedicated `auditor` realm role with strict read-only visibility.

## Purpose

Provide operational audit visibility without granting any mutate capabilities.

## Role Model

- Role: `auditor`
- Scope: read/query access only
- Explicitly excluded: any `manage-*` permissions, impersonation, credential reset, role mapping changes

## Automation

Step 8 is applied by:

- Script: `scripts/step8_auditor_setup.sh`
- Compose service: `step8-init`
- Marker file: `/opt/keycloak/data/.step8-init-done`
- Force rerun: `STEP8_FORCE=true`
- Events retention: `EVENTS_EXPIRATION_SECONDS` (default `23328000` = 270 days)

Execution order:

`step7-fgap-init -> step8-init`

## Composites Assigned (realm-management)

The script attempts to assign these read-only composites if present:

- `view-users`
- `query-users`
- `query-groups`
- `view-clients`
- `query-clients`
- `view-events`
- `query-realms`

If a role is not present in a specific Keycloak build/profile, it is skipped with a log line.

## Audit Event Retention (Step 8 Managed)

Step 8 also enforces realm event settings:

- `eventsEnabled=true`
- `adminEventsEnabled=true`
- `adminEventsDetailsEnabled=true`
- `eventsExpiration=23328000` (270 days by default)
- `eventsListeners` includes `failure-logs-file` (failure-only JSONL stream)

This is intentionally centralized in Step 8 so audit-read role and retention controls stay together.

## Export/Purge Design Note

- Keep Step 8 focused on role + retention baseline.
- Implement export/purge as a separate operational component (scheduled job/service).
- Optional SPI is possible, but operational scheduling and storage integration is usually cleaner outside Keycloak runtime.

## Failure Logs Stream

Step 8 expects the failure-logs event listener SPI to be present and configures it via realm events config:

- Provider id: `failure-logs-file`
- Output file (default): `/var/log/keycloak/failure-auth.log`

This stream is intended for abuse detection ingestion and contains only failure-relevant events.

## Commands

Run only Step 8:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml run --rm -e STEP8_FORCE=true step8-init
```

Makefile shortcut:

```bash
make force-step8
```

## Verification

```bash
./kcadm.sh get roles/auditor -r "$KC_NEW_REALM_NAME" --config .kcadm.config
./kcadm.sh get-roles -r "$KC_NEW_REALM_NAME" --rname auditor --effective --cclientid realm-management --config .kcadm.config | jq -r '.[].name'
```

Expected: only read/query composites, no `manage-*`.

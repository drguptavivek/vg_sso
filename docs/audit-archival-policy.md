# Audit Archival Policy

**Realm:** `org-new-delhi`
**Status:** Active

---

## 1. Purpose

This repo exports Keycloak user and admin events into compressed day-partitioned archives so audit history can be retained outside the live realm database.

The archive is designed for:

- long-term retention
- offline review
- transfer to downstream storage or compliance systems
- lower-risk operational backups of audit history

---

## 2. Bootstrap Model

Step 9 prepares the export layout through:

- `step9-init` in `docker-compose.yml`
- `scripts/step9_audit_archival_setup.sh`

That setup:

- prepares the export directory tree
- creates the archive README in the export root
- initializes the watermark/state location
- optionally runs an initial export when `STEP9_RUN_INITIAL_EXPORT=true`

---

## 3. Export Layout

Archive layout:

```text
<output-dir>/
  <realm>/YYYY/MM/DD/
    user-events-YYYY-MM-DD.jsonl.gz
    admin-events-YYYY-MM-DD.jsonl.gz
    manifest.json
  state/
    watermark.json
```

`manifest.json` stores file counts and SHA-256 checksums for the day’s exported files.

`watermark.json` stores the last fully exported day.

---

## 4. Export Behavior

The export logic is implemented in `scripts/audit_export_events.py`.

Current behavior:

- authenticates with `admin-cli` using the realm admin credentials
- exports user events and admin events separately
- fetches data day by day using paged admin API calls
- defaults to exporting through yesterday
- uses the watermark file to resume incrementally
- writes compressed JSONL output

If no watermark exists and no explicit start date is given, the exporter defaults to yesterday only.

---

## 5. Configuration Surface

| Variable | Purpose |
|---|---|
| `AUDIT_EXPORT_OUTPUT_DIR` | Archive root directory |
| `AUDIT_EXPORT_STATE_FILE` | Watermark/state file location |
| `AUDIT_EXPORT_START_DATE` | Optional override start date |
| `AUDIT_EXPORT_END_DATE` | Optional override end date |
| `AUDIT_EXPORT_BATCH_SIZE` | Page size for admin API fetches |

Related runtime inputs:

- `KC_SERVER_URL`
- `KC_NEW_REALM_NAME`
- `KC_NEW_REALM_ADMIN_USER`
- `KC_NEW_REALM_ADMIN_PASSWORD`

---

## 6. Verification

Trigger an export through the Makefile:

```bash
make audit-export
```

Dry-run the exporter manually:

```bash
python3 scripts/audit_export_events.py --dry-run
```

Check archive contents:

```bash
find "${AUDIT_EXPORT_OUTPUT_DIR:-./exports/audit}" -type f | sort
```

---

## 7. Operational Notes

- This is an export/archive workflow, not a delete/purge workflow.
- Live event retention still depends on Keycloak realm events settings.
- Step 8 sets `eventsExpiration`; Step 9 handles archive preparation and export workflow.
- The exporter writes day-based files, which keeps reruns and downstream ingestion predictable.

---

## 8. Source Files

| File | Role |
|---|---|
| `scripts/step9_audit_archival_setup.sh` | Export directory/bootstrap setup |
| `scripts/audit_export_events.py` | Incremental archive exporter |
| `docs/Step_9_audit_archival.md` | Step-oriented implementation note |

# Failure Authentication Logging Policy

**Realm:** `org-new-delhi`
**Status:** Active

---

## 1. Purpose

This repo separates failure-relevant authentication and admin events into a dedicated JSONL log stream for monitoring, alerting, and forensic review.

The goal is to keep the failure signal easy to consume without mixing it with all successful user and admin activity.

---

## 2. Provider

| Item | Value |
|---|---|
| Module | `custom-failure-logs-event-listener-spi` |
| Provider type | Event listener |
| Provider id | `failure-logs-file` |
| Default output path | `/var/log/keycloak/failure-auth.log` |

The actual log path can be overridden through `KC_FAILURE_LOG_FILE`.

---

## 3. What Gets Logged

- user events with type ending in `_ERROR`
- user lockout events:
  - `USER_DISABLED_BY_TEMPORARY_LOCKOUT`
  - `USER_DISABLED_BY_PERMANENT_LOCKOUT`
- admin events where `error` is present

Excluded:

- successful logins
- successful logouts
- successful user events
- successful admin events

---

## 4. Bootstrap Model

Step 8 enables the listener through realm events configuration in `scripts/step8_auditor_setup.sh`.

That script ensures:

- `eventsEnabled = true`
- `adminEventsEnabled = true`
- `adminEventsDetailsEnabled = true`
- `eventsExpiration` is set
- `eventsListeners` includes `failure-logs-file`

The provider JAR itself is packaged into the image by the repo `Dockerfile`.

---

## 5. File Location And Host Persistence

At runtime:

- general runtime logs are written under the directory configured by `KC_HOST_LOG_DIR`
- failure-only JSONL output is written to the file configured by `KC_FAILURE_LOG_FILE`

The helper `scripts/prepare_host_log_dir.sh` prepares the host-side log directory and creates both:

- `keycloak.log`
- `failure-auth.log`

This keeps the failure stream available on the host even though Keycloak runs in containers.

---

## 6. Verification

Check realm events configuration:

```bash
./kcadm.sh get events/config -r "$KC_NEW_REALM_NAME" --config .kcadm.config \
  | jq '{eventsEnabled, adminEventsEnabled, adminEventsDetailsEnabled, eventsExpiration, eventsListeners}'
```

Check the host-side failure log file:

```bash
ls -l "${KC_HOST_LOG_DIR:-./logs/keycloak}/failure-auth.log"
```

For local SPI iteration:

```bash
./scripts/dev_hot_reload_spi.sh custom-failure-logs-event-listener-spi
```

---

## 7. Operational Notes

- This stream is additive; it does not replace normal Keycloak logs.
- The listener is designed for downstream ingestion, so the file format is JSONL.
- The policy is realm-driven via events config, but the file path is runtime-driven via environment/config.

---

## 8. Source Files

| File | Role |
|---|---|
| `scripts/step8_auditor_setup.sh` | Enables the listener in realm events config |
| `scripts/prepare_host_log_dir.sh` | Prepares host log directory and target files |
| `custom-failure-logs-event-listener-spi/src/main/java/tech/epidemiology/keycloak/failurelogs/FailureLogsEventListenerFactory.java` | Provider registration and file path resolution |
| `custom-failure-logs-event-listener-spi/src/main/java/tech/epidemiology/keycloak/failurelogs/FailureLogsEventListener.java` | Event filtering |
| `custom-failure-logs-event-listener-spi/src/main/java/tech/epidemiology/keycloak/failurelogs/FailureLogsEventFormatter.java` | JSONL formatting |


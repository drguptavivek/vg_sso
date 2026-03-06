# Failure Logs Event Listener SPI

Writes only failure-relevant Keycloak events to a JSONL file for downstream ingestion.

Provider id: `failure-logs-file`
Default path: `/var/log/keycloak/failure-auth.log`

## What gets logged

- User events with type ending `_ERROR` (for example `LOGIN_ERROR`)
- User lockout events:
  - `USER_DISABLED_BY_TEMPORARY_LOCKOUT`
  - `USER_DISABLED_BY_PERMANENT_LOCKOUT`
- Admin events where `error` is present

## What is excluded

- Successful login/logout/user events
- Successful admin events

## Build

```bash
mvn -q -f custom-failure-logs-event-listener-spi/pom.xml -DskipTests package
```

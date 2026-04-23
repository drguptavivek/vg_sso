# Step 11 Async Email

Step 11 adds DB-backed asynchronous email delivery inside Keycloak.

It does four things:

- overrides the default Keycloak email sender and email template providers
- queues outgoing email requests into Postgres
- runs an in-SPI background worker that drains the queue using the initiating realm SMTP config
- exposes an admin dashboard for request status, retry, export, and troubleshooting

## Runtime behavior

- SPI module: `custom-async-email-spi`
- Email sender provider id: `default`
- Email template provider id: `freemarker`
- Admin realm REST extension id: `async-email-admin`
- Queue table: `kc_vg_async_mail_queue`

Flow at runtime:

1. Keycloak creates an email request
2. the async email SPI captures category, template, and event context
3. the request is stored in `kc_vg_async_mail_queue`
4. the async worker claims due rows
5. the worker sends using `realm.getSmtpConfig()` for that queued row's realm
6. the worker updates status to:
   - `sent`
   - `failed_retryable`
   - `dead_letter`

This means email delivery is realm-specific, not global:

- `aiims-new-delhi` rows use the SMTP config configured on `aiims-new-delhi`
- another realm would use its own SMTP config

## Queue statuses

- `queued`: waiting to be picked up
- `sending`: claimed by the worker and in flight
- `sent`: successfully delivered to SMTP
- `failed_retryable`: failed, but will be retried
- `dead_letter`: failed permanently

## Admin dashboard

UI endpoint:

- `/realms/{realm}/async-email-admin/ui`

API endpoints:

- `/realms/{realm}/async-email-admin/stats`
- `/realms/{realm}/async-email-admin/messages`
- `/realms/{realm}/async-email-admin/failures`
- `/realms/{realm}/async-email-admin/retry`
- `/realms/{realm}/async-email-admin/export.csv`
- `/realms/{realm}/async-email-admin/export.txt`

Current UI behavior:

- paginated request table
- browser-local timezone rendering
- live category dropdown from DB counts
- manual refresh
- browser back button
- row-level retry for retryable/dead-letter rows

The table is request-centric, not SMTP-mailbox-centric.

## Environment variables

Relevant runtime env vars:

- `KC_ASYNC_EMAIL_RETENTION_DAYS`
- `KC_ASYNC_EMAIL_RETRY_MAX_ATTEMPTS`
- `KC_ASYNC_EMAIL_WORKER_ENABLED`
- `KC_ASYNC_EMAIL_EXPORT_MAX_ROWS`
- `KC_ASYNC_EMAIL_WORKER_POLL_SECONDS`
- `KC_ASYNC_EMAIL_WORKER_BATCH_SIZE`
- `KC_ASYNC_EMAIL_STALE_SENDING_MINUTES`

Current defaults from the repo:

- retention: `180` days
- max retry attempts: `5`
- worker enabled: `true`
- export max rows: `10000`
- worker poll interval: `20` seconds
- worker batch size: `50`
- stale sending minutes: `30`

## Theme wiring

The admin console menu entry is added by:

- `theme/*/admin/resources/js/async-email-menu.v2.js`

Theme cache busting follows the existing repo pattern:

- base asset name in `theme.properties`
- Docker rewrite with `THEME_ASSET_VERSION`

This matches the same strategy used by Phone OTP and Account Expiry.

## Operational notes

- Queue storage is persistent in Postgres.
- Restarts do not lose queued rows.
- The worker now runs inside the SPI and starts with Keycloak runtime.
- SMTP delivery debug can appear in Keycloak logs when mail debug is enabled in realm SMTP settings.
- Dashboard timestamps are shown in the browser user's local timezone, but DB timestamps remain UTC-backed server data.

## Common checks

Build and test the SPI:

```bash
mvn -q -f custom-async-email-spi/pom.xml test
```

Hot-reload the SPI:

```bash
mvn -q -f custom-async-email-spi/pom.xml -DskipTests package
docker cp custom-async-email-spi/target/custom-async-email-spi-1.0.0.jar \
  vg-keycloak:/opt/keycloak/providers/
docker compose -f docker-compose.yml -f docker-compose.override.yml restart keycloak
```

Check Keycloak logs for worker startup and SMTP sends:

```bash
docker logs --tail 200 vg-keycloak
```

Inspect queue state directly:

```bash
docker exec vg-postgres psql -U sso_public_db_user -d keycloak -c \
  "select status, count(*) from kc_vg_async_mail_queue group by status order by status;"
```

Inspect recent requests:

```bash
docker exec vg-postgres psql -U sso_public_db_user -d keycloak -c \
  "select subject, status, created_at, sent_at, failed_at, retry_count from kc_vg_async_mail_queue order by created_at desc limit 20;"
```

## Relation to Step 10

- Step 10 owns the onboarding listener and execute-actions workflow
- Step 11 owns how those emails are queued, delivered, tracked, retried, and inspected

So after this step:

- onboarding still decides when an email should be sent
- async email decides how it is delivered and monitored

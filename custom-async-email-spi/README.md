# Async Email SPI

Custom Keycloak async email SPI for Keycloak `26.6.1`.

It overrides Keycloak email sending so outgoing emails are:

- queued in Postgres
- delivered by an in-SPI background worker
- sent using the initiating realm's SMTP config
- visible in an admin dashboard with status, pagination, export, and retry

## Build

```bash
cd ./custom-async-email-spi
mvn -q test
mvn -q -DskipTests package
```

## Hot Reload

```bash
docker cp ./custom-async-email-spi/target/custom-async-email-spi-1.0.0.jar \
  vg-keycloak:/opt/keycloak/providers/

docker compose -f docker-compose.yml -f docker-compose.override.yml restart keycloak
```

## Runtime behavior

- Email sender provider id: `default`
- Email template provider id: `freemarker`
- Admin REST extension id: `async-email-admin`
- Queue table: `kc_vg_async_mail_queue`

Queue flow:

1. Keycloak triggers an email
2. the SPI stores a row in `kc_vg_async_mail_queue`
3. the runtime worker claims due rows
4. the worker sends using `realm.getSmtpConfig()`
5. status is updated in DB

Statuses:

- `queued`
- `sending`
- `sent`
- `failed_retryable`
- `dead_letter`

## Admin endpoints

- `/realms/{realm}/async-email-admin/ui`
- `/realms/{realm}/async-email-admin/stats`
- `/realms/{realm}/async-email-admin/messages`
- `/realms/{realm}/async-email-admin/failures`
- `/realms/{realm}/async-email-admin/retry`
- `/realms/{realm}/async-email-admin/export.csv`
- `/realms/{realm}/async-email-admin/export.txt`

## Useful checks

Check worker logs:

```bash
docker logs --tail 200 vg-keycloak
```

Check queue status:

```bash
docker exec vg-postgres psql -U sso_public_db_user -d keycloak -c \
  "select status, count(*) from kc_vg_async_mail_queue group by status order by status;"
```

Check recent rows:

```bash
docker exec vg-postgres psql -U sso_public_db_user -d keycloak -c \
  "select subject, status, created_at, sent_at, failed_at, retry_count from kc_vg_async_mail_queue order by created_at desc limit 20;"
```

## Config

Relevant env vars:

- `KC_ASYNC_EMAIL_RETENTION_DAYS`
- `KC_ASYNC_EMAIL_RETRY_MAX_ATTEMPTS`
- `KC_ASYNC_EMAIL_WORKER_ENABLED`
- `KC_ASYNC_EMAIL_EXPORT_MAX_ROWS`
- `KC_ASYNC_EMAIL_WORKER_POLL_SECONDS`
- `KC_ASYNC_EMAIL_WORKER_BATCH_SIZE`
- `KC_ASYNC_EMAIL_STALE_SENDING_MINUTES`

See also:

- [docs/Step_11_AsyncEmail.md](../docs/Step_11_AsyncEmail.md)

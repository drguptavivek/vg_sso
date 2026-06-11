# Upgrading Keycloak

This repo uses a Docker-based Keycloak runtime. Test Keycloak upgrades against a cloned database before changing production.

Current rehearsed target: Keycloak `26.6.3`.

## Principles

- Do not run a new Keycloak version against the live `vg-postgres` database during rehearsal.
- Do not change the production Dockerfile default until the rehearsal passes.
- Build all custom SPIs against the target Keycloak version before building the test image.
- Use the dedicated `docker-compose.upgrade-test.yml` stack so container names, ports, networks, and volumes are isolated from production.
- Treat `.env` credentials as deployment bootstrap/config values, not guaranteed current user passwords. Admins may change passwords in the UI, so direct-grant checks should not assume `.env` still matches the database.

## Upgrade-Test Stack

The upgrade-test stack uses:

- Postgres clone container: `vg-postgres-upgrade-test`
- Keycloak test container: `vg-keycloak-upgrade-test`
- Compose project: `vg_sso_upgrade_test`
- Postgres test port: `15432`
- Keycloak HTTP test port: `18080`
- Keycloak management test port: `19000`
- Test logs: `logs/keycloak-upgrade-test/`
- Test DB dumps: `backups/upgrade-test/`

The source checkout under `keycloak_sources/` is useful for reference/debugging, but the SPI build does not require Keycloak sources. The SPI modules compile from Maven artifacts using `-Dkeycloak.version=<target>`.

## Rehearsal Commands

From the repository root:

```bash
cd /home/ssopublic/vg_sso
```

Build all SPIs against the target version and build the separate test image:

```bash
make upgrade-test-build
```

This expands to a target-version SPI build similar to:

```bash
make build-spis SPI_MVN_ARGS="-Dkeycloak.version=26.6.3"
docker build \
  --build-arg KEYCLOAK_IMAGE=quay.io/keycloak/keycloak:26.6.3 \
  -t vg_sso-keycloak-upgrade-test:26.6.3 .
```

Clone the live DB into isolated test Postgres:

```bash
make upgrade-test-db-copy
```

Start the 26.6.3 test Keycloak against the cloned DB:

```bash
make upgrade-test-up
```

Watch logs during first startup, which is when DB migration occurs:

```bash
make upgrade-test-logs
```

Check runtime version:

```bash
make upgrade-test-version
```

Check readiness:

```bash
curl -fsS http://localhost:19000/management/health/ready
```

Stop the rehearsal stack but keep test volumes:

```bash
make upgrade-test-down
```

Remove test containers and test volumes:

```bash
make upgrade-test-reset
```

## What To Verify

During the first `make upgrade-test-up`, check logs for:

- Liquibase changelog errors
- Java exceptions during provider bootstrap
- model/realm migration failures
- custom SPI startup failures

Useful log scan:

```bash
docker logs vg-keycloak-upgrade-test 2>&1 | rg -n \
  "ERROR|Exception|Liquibase|migrat|ASYNC_EMAIL|account-expiry|delegated-admin|phone-otp|forbiddenTerms|failure-logs|user-onboarding"
```

Expected successful signals include:

- `Keycloak 26.6.3 ... started`
- `Updating database. Using changelog META-INF/jpa-changelog-master.xml`
- realm migration messages for `master` and the deployed realm
- `Bootstrap completed`
- readiness status `UP`

JGroups join warnings can appear after cloning a DB that contains old cluster discovery state. In the rehearsal run, the node eventually became a singleton and completed bootstrap. Treat persistent cluster startup failure differently from transient join warnings.

## Auth And Custom Endpoint Checks

Do not rely on `KC_NEW_REALM_ADMIN_PASSWORD` from `.env` always working against an existing database. A realm admin may have changed the password in the UI after bootstrap.

Safer options for endpoint probes are:

1. Use a known current in-realm admin credential provided for the rehearsal.
2. Create a clone-only probe admin in `vg-keycloak-upgrade-test`, assign `realm-management` / `realm-admin`, and clear required actions only in the cloned test DB.
3. Use browser-console checks on `http://localhost:18080` when direct grant is intentionally blocked by realm policy.

Do not modify production users or production credentials for rehearsal-only probes.

At minimum, verify these routes load or authenticate as expected:

```bash
curl -i http://localhost:18080/admin/master/console/
curl -i http://localhost:18080/admin/${KC_NEW_REALM_NAME}/console/
curl -i http://localhost:18080/realms/${KC_NEW_REALM_NAME}/account/
```

With a valid in-realm admin bearer token, probe custom extensions:

```bash
curl -fsS -H "Authorization: Bearer $TOKEN" \
  http://localhost:18080/realms/${KC_NEW_REALM_NAME}/async-email-admin/stats

curl -fsS -H "Authorization: Bearer $TOKEN" \
  http://localhost:18080/realms/${KC_NEW_REALM_NAME}/account-expiry-admin/timezones

curl -fsS -H "Authorization: Bearer $TOKEN" \
  http://localhost:18080/realms/${KC_NEW_REALM_NAME}/phone-otp-admin/access
```

## 26.6.3 Rehearsal Result

The local rehearsal on the cloned database completed successfully:

- SPIs compiled with `-Dkeycloak.version=26.6.3`.
- Image `vg_sso-keycloak-upgrade-test:26.6.3` built successfully.
- Live `vg-postgres` was dumped and restored into `vg-postgres-upgrade-test`.
- `vg-keycloak-upgrade-test` started on Keycloak `26.6.3`.
- Readiness endpoint returned `UP`.
- Logs showed DB changelog update and realm migrations:
  - `aiims-new-delhi` migrated to `26.6.2`
  - `master` migrated to `26.6.2`
- Async email worker started.
- No Liquibase errors or Java exceptions were found in the startup scan.

Custom endpoint bearer-token probes were not completed with the configured realm admin password because the cloned DB did not accept the `.env` password. This is expected when admin passwords have been changed in the UI. A clone-only probe user also hit direct-grant account setup policy, so use a known current in-realm admin or browser-console validation for those endpoint checks.

## Production Upgrade After Rehearsal Passes

Only after the rehearsal passes:

1. Run a fresh production backup.

   ```bash
   make backup
   # or
   make full-backup
   ```

2. Change the production Dockerfile default base image to the target version, for example:

   ```dockerfile
   ARG KEYCLOAK_IMAGE=quay.io/keycloak/keycloak:26.6.3
   ```

3. Rebuild and deploy production:

   ```bash
   make prod-up
   ```

4. Watch production logs closely during first startup:

   ```bash
   make logs-runtime
   ```

5. Verify health and admin UI:

   ```bash
   curl -fsS http://localhost:9000/management/health/ready
   docker exec vg-keycloak /opt/keycloak/bin/kc.sh --version
   ```

6. Run live config validation after production is healthy:

   ```bash
   make test-config
   ```

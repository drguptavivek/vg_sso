# Production Setup

This document describes the current production-oriented setup for this repository. It focuses on the Docker-based runtime that exists today, not on older host-run Keycloak workflows.

## Scope

Production setup in this repo means:

- building the custom Keycloak image from this repository
- supplying environment-specific secrets and hostnames through `.env`
- optionally supplying local branding assets
- optionally supplying environment-specific group import data
- running the base `docker-compose.yml` stack
- validating logs, health, bootstrap steps, and post-start behavior

## Source of truth

Treat these as the canonical production inputs:

- `Dockerfile`
- `docker-compose.yml`
- `.env`
- `theme/`
- `scripts/`
- `assets/`
- `older_sso/`
- `custom-*/`

Do not treat ad hoc container edits as persistent configuration.

## Environment file

Start from:

```bash
cp .env.template .env
```

Review and set at least:

- `KC_BOOTSTRAP_ADMIN_USERNAME`
- `KC_BOOTSTRAP_ADMIN_PASSWORD`
- `KC_DB_USERNAME`
- `KC_DB_PASSWORD`
- `KC_DB_NAME`
- `KC_DB_URL`
- `KC_MASTER_ADMIN_USER`
- `KC_MASTER_ADMIN_PASSWORD`
- `KC_NEW_REALM_NAME`
- `KC_NEW_REALM_ADMIN_USER`
- `KC_NEW_REALM_ADMIN_PASSWORD`
- `KC_NEW_REALM_ADMIN_EMAIL`
- `KC_HOSTNAME`
- `KC_PROXY_TRUSTED_ADDRESSES`
- `SMTP_*`
- `KC_HOST_LOG_DIR`
- `KC_FAILURE_LOG_FILE`
- `AUDIT_EXPORT_*`
- `KC_AUTOMATION_CLIENT_ID` (default `sso-automation`) and `KC_AUTOMATION_CLIENT_SECRET`. Leave the secret empty: `make prod-up` / `make automation-secret` generate it once and never overwrite it. See [Admin accounts and 2FA](#admin-accounts-and-2fa).

Also review runtime/build settings such as:

- `KC_FEATURES`
- `KC_BUILD_OPTS`
- `KC_STARTUP_EXTRA_OPTS`
- `KC_HOSTNAME_STRICT`
- `KC_PROXY_HEADERS`
- `KC_LOG`
- `KC_LOG_LEVEL`

## Production-specific customization inputs

Two repository workflows matter here and should not be ignored.

### Branding assets

Branding is not limited to the checked-in theme files. Before a production build or deployment, decide whether the environment should use:

- default committed assets from `assets/`
- local override assets from `.local/brand-assets/`

Apply them with:

```bash
./scripts/apply_local_brand_assets.sh
```

This copies the resolved assets into the checked-in theme directories that are then packaged into the image build.

See [`branding-assets.md`](branding-assets.md) for the exact asset keys and copy behavior.

### Group import data

Group hierarchy and group attributes can also vary by environment.

Step 2 resolves group import data from:

1. `/workspace/.local/groups/groups_tree.json`
2. `/opt/keycloak/import/groups_tree.json`

In practice this means:

- use the committed import payload when the default hierarchy is correct
- provide `.local/groups/groups_tree.json` before deployment when a site-specific hierarchy is required

Group import is applied by the Step 2 bootstrap flow, not by a separate manual process.

See [`group-import.md`](group-import.md) for the exact behavior.

## Host preparation

The runtime is containerized, so the host mainly needs:

- Docker Engine
- Docker Compose plugin
- storage for Postgres and Keycloak data
- a writable host log directory for Keycloak logs

However, this repository also uses host-side SPI builds in the current workflow.

If you use the repository’s standard build paths such as `make build-spis`, `make up`, `make dev-up`, or `./scripts/dev_hot_reload_spi.sh`, the host also needs:

- JDK 21
- Maven

Optional helper:

```bash
sudo ./scripts/prod_host_prepare.sh
```

Use that only if its directory/user assumptions match the target host.

## Build and start

The production entrypoint is the base compose stack, not the development override.

Before starting:

1. prepare `.env`
2. ensure host SPI build prerequisites are installed if using the standard repo workflow
3. apply branding assets if needed
4. place `.local/groups/groups_tree.json` if a custom group tree is needed

Then run:

```bash
make prod-up
docker compose ps
```

`make prod-up` generates the automation service account secret into `.env` (if missing), applies branding, builds the SPI JARs, and runs `docker compose up -d --build` on the base stack. If you start with plain `docker compose up -d --build`, run `make automation-secret` first. Otherwise step 1 skips the service account and falls back to the legacy password-based automation mode.

## What the production start does

The stack starts:

- `postgres`
- `keycloak`
- ordered one-shot init containers such as `step1-init` through later bootstrap steps

Those init steps apply the configured realm baseline, claims, OTP setup, expiry setup, delegated-admin setup, audit setup, and related bootstrap automation. Marker files in the shared Keycloak data volume prevent repeated reapplication unless a step is explicitly forced.

Important build note:

- the `Dockerfile` copies provider JARs from `custom-*/target/*.jar`
- those JARs are expected to be built on the host before `docker compose up -d --build`
- the current `Makefile` and hot-reload script both invoke `mvn ... package` on the host

## Post-start verification

Check container status:

```bash
docker compose ps
```

Check logs:

```bash
docker compose logs --tail=200 keycloak
docker compose logs --tail=200 step1-init
docker compose logs --tail=200 step2-init
docker compose logs --tail=200 step3-init
docker compose logs --tail=200 step4-init
docker compose logs --tail=200 step5-init
docker compose logs --tail=200 step6-init
docker compose logs --tail=200 step7-init
docker compose logs --tail=200 step8-init
docker compose logs --tail=200 step9-init
```

Check health:

```bash
curl -sf http://localhost:9000/management/health/ready
```

Validate at least:

- Keycloak is healthy
- each required init step completed successfully
- master and realm admin login work (and, after hardening, require 2FA)
- `make kcadm-login` reports `service account sso-automation`
- expected branding is visible
- expected group tree exists
- expected custom providers and flows are present
- log files are being written to the configured host log directory

## Logging and audit

Production logging in this repo includes:

- main Keycloak log file via `KC_LOG_FILE`
- failure-only auth event log via `KC_FAILURE_LOG_FILE`
- audit export output via `AUDIT_EXPORT_*`

Ensure the host path mapped by `KC_HOST_LOG_DIR` exists and is writable by the container runtime.

To trigger an audit export manually:

```bash
docker compose run --rm --no-build keycloak-maintenance python3 /workspace/scripts/audit_export_events.py
```

## Admin accounts and 2FA

Production has these privileged identities. Only humans log in interactively, and every human admin must have 2FA. Automation never uses a human password.

| Identity | Realm | Kind | Used by | 2FA |
|---|---|---|---|---|
| `KC_BOOTSTRAP_ADMIN_USERNAME` | master | temporary setup admin | Keycloak first start, step 1 | n/a: deleted by step 1 |
| `KC_MASTER_ADMIN_USER` | master | human super-admin | break-glass, master-realm admin | **required** |
| `KC_NEW_REALM_ADMIN_USER` | target realm | human realm admin | realm administration in the admin console | **required** |
| `sso-automation` (`service-account-sso-automation`) | target realm | confidential client, client credentials, `realm-admin` | steps 2-10, FGAP scripts, `make maintenance`, `make kcadm-login`, `make automation-client` | n/a (secret in `.env`) |
| `sso-self-registration` (`service-account-sso-self-registration`) | target realm | confidential client, guard-restricted | `/register` self-registration in the admin console app | n/a (see [`SelfRegistration.md`](SelfRegistration.md)) |
| `hr-client-admin-console` | target realm | confidential OIDC client | admin console app sign-in; calls run with the signed-in user's token | n/a (users sign in with their own 2FA) |

`sso-automation` and `sso-self-registration` are protected system clients: the guard SPI, the step 6 FGAP deny list, and the admin console's reserved list all block delegated admins from editing them or reading their secrets.

### Fresh install

1. `make prod-up`. Step 1 retires the bootstrap admin and creates `sso-automation` with the secret from `.env`.
2. Confirm the service account works: `make kcadm-login` must print `service account sso-automation`.
3. In the **master** admin console, sign in as `KC_MASTER_ADMIN_USER`, then:
   1. confirm no other master users exist (the bootstrap admin must be gone; delete it if step 1 logged `bootstrap admin retained`);
   2. change the password from the `.env` value;
   3. enable 2FA: *Users → `<master admin>` → Required user actions → Configure OTP*, then sign out and back in to enroll the authenticator.
4. Do the same for `KC_NEW_REALM_ADMIN_USER` in the target realm's admin console.
5. Put the new master admin password into `.env` (`KC_MASTER_ADMIN_PASSWORD`). It is only needed as a fallback and for a future fresh install, but keep it current.
6. Re-check automation is unaffected: `make maintenance MAINT_CMD='python3 /workspace/scripts/fgap_delegated_consolidate.py --dry-run'` must run without a `used fallback user` warning.

Once 2FA is on, password-only logins for these humans stop working. That is intended. Nothing automated depends on them.

### Existing deployment (step 1 already ran)

1. `make automation-secret`: adds `KC_AUTOMATION_CLIENT_SECRET` to `.env`.
2. Deploy the current `custom-delegated-admin-guard-spi` (it lists `sso-automation` as a protected client) **before** creating the client. Use a hot-swap of the JAR plus a Keycloak restart, or `make prod-up`.
3. `make automation-client`: creates the client and grants `realm-admin`. It must end with `verified service account login and realm access`.
4. `make kcadm-login`: must print `service account sso-automation`.
5. Enable 2FA for the master and realm admins as above.

### Rotating the automation secret

- Before the master admin has 2FA: change `KC_AUTOMATION_CLIENT_SECRET` in `.env`, then run `make automation-client`.
- After: regenerate it in the admin console (*Clients → `sso-automation` → Credentials → Regenerate*), paste the new value into `.env`, then run `make automation-client` to verify.

Service-account `kcadm` sessions are short-lived. If a `kcadm` command returns an empty or odd error, run `make kcadm-login` again.

## Upgrade and change model

When you change any of the following, rebuild the image and redeploy:

- provider code in `custom-*/`
- theme files in `theme/`
- copied assets after running `apply_local_brand_assets.sh`
- bootstrap scripts in `scripts/`
- Docker packaging behavior in `Dockerfile`

On a fresh or disposable environment, rerun the affected init step with its force flag after changing any of the following. **On production, do not force init steps.** They re-apply the repo baseline and overwrite manual production changes; for example, step 4 resets the browser flow to `browser-PhoneOTP` and step 2 resets the brute-force limit. Use the targeted, idempotent scripts through the maintenance runner (all support `--dry-run`):

- delegated admin permissions: `make maintenance MAINT_CMD='python3 /workspace/scripts/fgap_delegated_consolidate.py'` (read [`fgap-gotchas.md`](fgap-gotchas.md) first)
- user profile dropdowns: `make maintenance MAINT_CMD='python3 /workspace/scripts/apply_profile_dropdowns.py'`
- automation service account: `make automation-client`

Areas that are applied by init steps:

- group import payload
- realm baseline scripts
- claims setup
- OTP configuration
- expiry configuration
- delegated-admin configuration
- auditor or audit archival setup

## Related docs

- [`branding-assets.md`](branding-assets.md)
- [`group-import.md`](group-import.md)
- [`sms-otp-policy.md`](sms-otp-policy.md)
- [`account-expiry-policy.md`](account-expiry-policy.md)
- [`user-manager-policy.md`](user-manager-policy.md)
- [`delegated-client-admin-policy.md`](delegated-client-admin-policy.md)
- [`fgap-gotchas.md`](fgap-gotchas.md)
- [`STEP_1.md`](STEP_1.md)
- [`SelfRegistration.md`](SelfRegistration.md)

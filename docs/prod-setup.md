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
- `KC_HOSTNAME_ADMIN`
- `KC_PROXY_TRUSTED_ADDRESSES`
- `SMTP_*`
- `KC_HOST_LOG_DIR`
- `KC_FAILURE_LOG_FILE`
- `AUDIT_EXPORT_*`

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
docker compose up -d --build
docker compose ps
```

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
- master and realm admin login work
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

## Upgrade and change model

When you change any of the following, rebuild the image and redeploy:

- provider code in `custom-*/`
- theme files in `theme/`
- copied assets after running `apply_local_brand_assets.sh`
- bootstrap scripts in `scripts/`
- Docker packaging behavior in `Dockerfile`

When you change these, rerun the affected init step or redeploy with the appropriate force flag:

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

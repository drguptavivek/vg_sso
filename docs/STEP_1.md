# Implementation Note: Step 1 Realm Bootstrap and Base Themes

Step 1 is the first automated bootstrap stage in the Docker workflow. Its job is to bring up the realm, establish durable admin users, and apply the base realm and master-realm theming.

## Automation entrypoint

Step 1 runs through:

- `step1-init` in `docker-compose.yml`
- `scripts/step1_bootstrap_docker.sh`

It starts only after the `keycloak` service is healthy.

## What Step 1 does

Step 1 uses the bootstrap admin credentials from `.env` to:

1. authenticate to the master realm
2. ensure the long-lived master admin user exists
3. ensure the target realm exists
4. ensure the target realm admin user exists
5. grant `realm-admin` to the realm admin in the target realm
6. enable `admin-cli` direct grants in the target realm for automation
7. apply realm/master themes
8. retire the bootstrap admin by default

The last point matters: the bootstrap admin is treated as a setup credential, not the normal long-lived operator identity.

## Required environment

Step 1 depends on these `.env` values:

- `KC_BOOTSTRAP_ADMIN_USERNAME`
- `KC_BOOTSTRAP_ADMIN_PASSWORD`
- `KC_MASTER_ADMIN_USER`
- `KC_MASTER_ADMIN_PASSWORD`
- `KC_NEW_REALM_NAME`
- `KC_NEW_REALM_ADMIN_USER`
- `KC_NEW_REALM_ADMIN_PASSWORD`
- `KC_NEW_REALM_ADMIN_EMAIL`
- `KC_NEW_REALM_ADMIN_FIRST_NAME`
- `KC_NEW_REALM_ADMIN_LAST_NAME`
- `KEYCLOAK_ENV`

If the master or realm admin values still use placeholder `change_*` defaults, Step 1 fails fast.

## Themes applied

Step 1 assigns:

- target realm:
  - `loginTheme=vg`
  - `accountTheme=vg`
  - `adminTheme=admin-vg-custom`
- master realm:
  - `loginTheme=vg-master`
  - `accountTheme=vg-master`
  - `adminTheme=vg-master`

Branding assets themselves are managed separately through [`branding-assets.md`](branding-assets.md).

## Runtime behavior

- Marker file: `/opt/keycloak/data/.step1-init-done`
- Force rerun: `STEP1_FORCE=true`
- Bootstrap admin retirement toggle: `STEP1_RETIRE_BOOTSTRAP_ADMIN` (defaults to `true`)

## Common commands

Start the full dev stack:

```bash
make up
```

Rerun only Step 1:

```bash
make force-step1
```

Inspect Step 1 logs:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml logs --tail=200 step1-init
```

## Optional host-side admin CLI

Host-side `kc.sh` and `kcadm.sh` wrappers are still supported for inspection and one-off admin work, but they are not the canonical runtime path.

If needed:

```bash
ln -sf ./keycloak-current/bin/kc.sh kc.sh
ln -sf ./keycloak-current/bin/kcadm.sh kcadm.sh
chmod +x kc.sh kcadm.sh
```

## Verification

After Step 1 succeeds, verify:

- the target realm exists
- master admin login works
- realm admin login works
- bootstrap admin no longer authenticates if retirement is enabled
- the expected themes are applied

The live-config test suite covers these checks as part of the broader environment validation.

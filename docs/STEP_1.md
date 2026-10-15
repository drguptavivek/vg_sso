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
6. create or update the `sso-automation` service account (confidential client, `realm-admin` in the target realm) using `KC_AUTOMATION_CLIENT_SECRET` from `.env`, via `scripts/ensure_automation_client.sh`
7. enable `admin-cli` direct grants in the target realm (fallback automation path)
8. apply realm/master themes
9. retire the bootstrap admin by default

The bootstrap admin is treated as a setup credential, not the normal long-lived operator identity. It is deleted only if the master admin can authenticate after setup; otherwise step 1 logs `bootstrap admin retained` and you must delete it by hand.

### Service account mode vs legacy mode

| | Service account mode (`KC_AUTOMATION_CLIENT_SECRET` set) | Legacy mode (no secret) |
|---|---|---|
| Automation login (steps 2-10, maintenance, `kcadm-login`) | `sso-automation` client credentials | realm/master admin passwords |
| Existing realm admin password | **left alone** | reset to the `.env` value if it no longer works |
| Realm admin OTP / required actions | **left alone** (human account, 2FA allowed) | OTP credentials deleted, required actions cleared, to keep direct grant working |

Service account mode is the default: `make up` / `make prod-up` / `make dev-up` generate the secret. Legacy mode remains only for deployments started without it, and it is incompatible with 2FA on the realm admin. See [`prod-setup.md`](prod-setup.md#admin-accounts-and-2fa).

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
- `KC_AUTOMATION_CLIENT_SECRET` (generated; empty means legacy mode) and optionally `KC_AUTOMATION_CLIENT_ID` (default `sso-automation`)

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

Rerun only Step 1 (non-production; forced steps overwrite manual changes):

```bash
make force-step1
```

Create or verify the service account on an existing deployment without rerunning Step 1:

```bash
make automation-client
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
- `make kcadm-login` prints `service account sso-automation`
- then enable 2FA for the master and realm admins ([`prod-setup.md`](prod-setup.md#admin-accounts-and-2fa))
- the expected themes are applied

The live-config test suite covers these checks as part of the broader environment validation.

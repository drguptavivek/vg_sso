# Implementation Note: Step 11 Admin Console App

Step 11 provisions the OIDC client used by `admin-console/`, a standalone Next.js app that gives `user-manager` and `delegated-client-admin-base` holders a self-service dashboard instead of the full Keycloak admin console.

## Automation entrypoint

Step 11 runs through:

- `step11-init` in `docker-compose.yml`
- `scripts/step11_admin_console_client_setup.sh`

It runs after Step 10 completes, and before the `admin-console` service starts (which `depends_on: step11-init` completing successfully).

## What Step 11 does

Step 11 creates (or updates) a confidential OIDC client in the target realm:

- `clientId`: `ADMIN_CONSOLE_CLIENT_ID` (default `hr-client-admin-console`)
- `standardFlowEnabled=true`, `directAccessGrantsEnabled=false`, `serviceAccountsEnabled=false`
- `redirectUris`: `${ADMIN_CONSOLE_APP_URL}/api/auth/callback/keycloak`
- `secret`: `ADMIN_CONSOLE_CLIENT_SECRET`

This client grants **no privilege by itself** - it only lets a user sign in. Every action the app performs afterwards uses that signed-in user's own access token against the standard Keycloak Admin REST API, so it is authorized exactly like any other admin-console session: by the realm roles and FGAP v2 permissions already documented in [`user-manager-policy.md`](user-manager-policy.md) and [`delegated-client-admin-policy.md`](delegated-client-admin-policy.md), plus the HTTP-layer scoping already enforced by `DelegatedAdminGuardFilter` (`custom-delegated-admin-guard-spi`).

Step 11 fails fast (like Step 1) if `ADMIN_CONSOLE_CLIENT_SECRET` is still a `change_*` placeholder.

## The app itself

See [`admin-console/README.md`](../admin-console/README.md) for the app's structure. In short:

- `/hr` - for `user-manager` holders: search/create users, enable/disable, reset credentials, resend the onboarding email, and assign/remove existing group membership. It intentionally cannot create or edit groups.
- `/groups` - for `delegated-client-admin-base` holders (PCAs): create/rename/delete subgroups and manage membership, scoped to the caller's own `AppRoles/{clientId}` subtree(s). The app root itself stays protected.

The app is a curated UI, not a new authorization surface: it calls the same Admin REST endpoints a human would use from the stock Keycloak admin console, with the same access token, so `DelegatedAdminGuardFilter` and FGAP v2 evaluate every request exactly as they already do today. Ownership/role checks inside the app (`admin-console/src/lib/session.ts`, `admin-console/src/lib/ownership.ts`) exist only to surface a clear early error - Keycloak's own decision is authoritative.

## Configuration

New variables (see the "Admin console app" section of `.env.template`):

| Variable | Purpose |
|---|---|
| `ADMIN_CONSOLE_CLIENT_ID` | OIDC client id created by Step 11 |
| `ADMIN_CONSOLE_CLIENT_SECRET` | Client secret (must not be a placeholder) |
| `ADMIN_CONSOLE_NEXTAUTH_SECRET` | Secret used by NextAuth to encrypt its session JWT |
| `ADMIN_CONSOLE_APP_URL` | Public URL of the app itself (redirect URI + `NEXTAUTH_URL`) |
| `ADMIN_CONSOLE_PORT` | Host port published for the `admin-console` service (default `3100`) |
| `ADMIN_CONSOLE_KEYCLOAK_PUBLIC_URL` | Keycloak URL reachable from the end user's browser |

`ADMIN_CONSOLE_KEYCLOAK_INTERNAL_URL` is set directly in `docker-compose.yml` to the internal service address `http://keycloak:8080` and does not need to be in `.env` - it is what lets the app's server process reach Keycloak over the private docker network for token exchange and Admin REST calls, independently of whatever hostname the browser uses.

## Runtime behavior

- Marker file: `/opt/keycloak/data/.step11-init-done`
- Force rerun: `STEP11_FORCE=true`

## Verification

After Step 11, verify:

- the client exists: `./kcadm.sh get clients -r org-new-delhi -q clientId=hr-client-admin-console --config /tmp/kcadm-master-admin.config`
- the `admin-console` container is healthy and serving on `ADMIN_CONSOLE_PORT`
- a `user-manager` holder can sign in and reach `/hr`
- a `delegated-client-admin-base` holder can sign in and reach `/groups`, seeing only their own `AppRoles/{clientId}` subtree(s)

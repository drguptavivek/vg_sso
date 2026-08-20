# Admin Console

Standalone Next.js app providing two self-service dashboards on top of the Keycloak realm managed by this repository. It is a separate deployable from Keycloak itself - it authenticates the signed-in user via Keycloak OIDC and then calls the stock Keycloak Admin REST API directly with that user's own access token. It grants no privilege of its own: every read/write is authorized by Keycloak's existing FGAP v2 permissions and the `custom-delegated-admin-guard-spi` filter already deployed in the realm.

## Dashboards

- `/hr` - for holders of the `user-manager` realm role: search/create users, enable/disable, reset credentials, resend the onboarding email (verify email, set password, TOTP, recovery codes), and assign/remove existing group membership. Group creation is intentionally out of scope for this role.
- `/groups` - for holders of the `delegated-client-admin-base` realm role (delegated client admins / PCAs): create, rename, and delete subgroups, and manage membership, scoped to the caller's own `AppRoles/{clientId}` subtree(s). The app root itself cannot be renamed or deleted.

Visiting `/` redirects to the dashboard matching the signed-in user's role, or shows a message if they hold neither role.

## Stack

Next.js (App Router) + TypeScript, NextAuth v4 for OIDC login, Tailwind CSS + [shadcn/ui](https://ui.shadcn.com) (`components.json`, `src/components/ui/`) for the UI, and `sonner` for toast notifications. The `shadcn` CLI itself needs network access to `ui.shadcn.com` to add further components (`npx shadcn@latest add <component>`) - the components already present were added by hand against the same registry source, so this still works in environments where that host is reachable.

## Why a separate app

Both roles already carry the permissions this UI exposes:

- `user-manager` already has FGAP `manage` scope on `Users` and `manage-group-membership`/`manage-membership` on `Groups`.
- `delegated-client-admin-base` is already scoped to its own `AppRoles/{clientId}` subtree by `DelegatedAdminGuardFilter` at the HTTP layer, on top of FGAP.

So this app is a curated UI over capability that already exists, not a new privilege surface. Every ownership/role check performed in `src/lib/ownership.ts` and `src/lib/session.ts` is a UX convenience (clear early error messages) - the authoritative decision is always Keycloak's.

## Configuration

See the "Admin console app" section of the repo root `.env.template`. For local development outside docker compose, copy `.env.local.example` to `.env.local` and adjust as needed.

Two Keycloak URLs are configured separately to support running inside docker compose:

- `ADMIN_CONSOLE_KEYCLOAK_PUBLIC_URL` - reachable from the end user's browser (OIDC login/logout redirects).
- `ADMIN_CONSOLE_KEYCLOAK_INTERNAL_URL` - reachable from this app's server process (token exchange + all Admin REST calls). Inside docker compose this is the internal service address `http://keycloak:8080`.

## Local development

```bash
cd admin-console
npm install
cp .env.local.example .env.local   # then edit as needed
npm run dev
```

The app listens on `http://localhost:3100` by default.

## Docker compose

The app is built and run as the `admin-console` service (see `docker-compose.yml`), depending on `step11-init`, which creates its confidential OIDC client (`ADMIN_CONSOLE_CLIENT_ID`) in the target realm. Set `ADMIN_CONSOLE_CLIENT_SECRET` and `ADMIN_CONSOLE_NEXTAUTH_SECRET` to real values in `.env` before starting the stack - `step11-init` refuses to run with placeholder values.

## Type-checking / build

```bash
npm run typecheck
npm run build
```

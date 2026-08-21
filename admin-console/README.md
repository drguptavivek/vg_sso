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

## Exposure

This is an admin surface (user creation, password resets, group membership) and must never be reachable from the public internet or from a public-facing reverse proxy.

`docker-compose.yml` publishes it on `127.0.0.1` only by default (`ADMIN_CONSOLE_BIND_IP` in `.env.template`). Two deployment shapes:

- **Reverse proxy on the same docker host:** leave `ADMIN_CONSOLE_BIND_IP` at its default (`127.0.0.1`) and proxy to `127.0.0.1:ADMIN_CONSOLE_PORT`.
- **Reverse proxy on a separate host** (e.g. a LAN-only nginx that is distinct from a public/global-facing nginx, both of which reach this VM on the same single ingress IP for their respective services): set `ADMIN_CONSOLE_BIND_IP` to this VM's ingress IP, and at the docker host's own firewall accept connections to `ADMIN_CONSOLE_PORT` only from the LAN reverse proxy's source IP, denying everyone else on that port - including the global nginx. The bind address by itself is not access control once it's not `127.0.0.1` - the firewall's source-IP rule is what actually keeps everything else out. This only works if the LAN nginx and the global nginx present different source IPs to this VM (distinct hosts, as is the case here); if they ever shared a source IP this approach wouldn't distinguish them and a different mechanism would be needed. This app's vhost must only ever be added to the LAN-facing proxy, never the public/global one.

See [`nginx-confs/hr-admin-console.conf`](../nginx-confs/hr-admin-console.conf) for a proposed vhost for the separate-host/LAN-proxy shape (placeholders: hostname, this VM's ingress IP, TLS cert paths).

`ADMIN_CONSOLE_APP_URL` (this app's own public URL, e.g. an internal-only subdomain) is independent of `ADMIN_CONSOLE_KEYCLOAK_PUBLIC_URL` (Keycloak's own public URL) - they can and should be different hostnames. Only `ADMIN_CONSOLE_APP_URL` needs to match the reverse-proxy hostname you choose; nothing about Keycloak's own hostname configuration changes.

## Type-checking / build

```bash
npm run typecheck
npm run build
```

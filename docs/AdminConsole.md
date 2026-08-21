# Optional Admin Console Application

`admin-console/` is a standalone Next.js application providing curated administration workflows without exposing the full Keycloak Admin Console. It runs only under the optional `admin-console` Compose profile.

There is no automated initializer. Create and maintain its confidential OIDC client manually in the Keycloak UI so administrator passwords and MFA are never used by unattended scripts.

## Access and capabilities

### HR user management

`/hr` is available to `user-manager` and `realm-management -> realm-admin`. It supports user search/create, enable/disable, password reset, onboarding-email resend, and existing group membership management.

### Group and application-role management

`/groups` is available to:

- `delegated-client-admin-base`, restricted to directly owned `AppRoles/{clientId}` roots;
- `realm-management -> realm-admin`, across all application roots.

The dashboard contains:

- **Audit a user's groups** (realm-admin only): search up to 20 matching accounts, explicitly select by username/name/email, clear the search, and view expanded membership rows.
  - Realm-wide memberships show one row per top-level group followed by subgroup paths.
  - Application-specific memberships show one row per application. Direct `AppRoles/{clientId}` membership is marked **Delegated admin**; deeper memberships are listed as application roles.
- **Realm-wide groups**: top-level organizational groups, visually separate from applications.
- **Application Specific Groups**: one application card per row. Nested Keycloak groups are presented as **Application roles**.

Application and role cards show direct-member counts. Clicking a card opens membership management at that exact level. Application roots cannot be renamed or deleted. Application roles can be created, renamed, deleted, and assigned members.

Keycloak FGAP v2 and `DelegatedAdminGuardFilter` remain authoritative for every Admin REST request.

## Manual OIDC client

Create a client such as `hr-client-admin-console` in the target realm:

| Setting | Value |
|---|---|
| Client type | OpenID Connect |
| Client authentication | On |
| Standard flow | On |
| Direct access grants | Off |
| Service accounts | Off |
| Valid redirect URI | `${ADMIN_CONSOLE_APP_URL}/api/auth/callback/keycloak` |
| Valid post-logout redirect URI | `${ADMIN_CONSOLE_APP_URL}/*` |
| Web origin | `${ADMIN_CONSOLE_APP_URL}` |

Copy its secret into `ADMIN_CONSOLE_CLIENT_SECRET`. Keep the standard `roles` client scope assigned so tokens include `realm_access` and `resource_access`. Realm-admin detection reads `resource_access["realm-management"].roles` for `realm-admin`.

The OIDC client grants no administrative privilege by itself; the app calls Keycloak Admin REST with the signed-in user's token.

## Environment and lifecycle

```bash
cp .env.admin-console.template .env.admin-console
make admin-console-build
make admin-console-up
make admin-console-logs
make admin-console-stop
```

Configure `ADMIN_CONSOLE_CLIENT_ID`, `ADMIN_CONSOLE_CLIENT_SECRET`, `ADMIN_CONSOLE_NEXTAUTH_SECRET`, `ADMIN_CONSOLE_APP_URL`, `ADMIN_CONSOLE_PORT`, `ADMIN_CONSOLE_BIND_IP`, and `ADMIN_CONSOLE_KEYCLOAK_PUBLIC_URL`.

Browser authorization/logout uses the public Keycloak URL. Server-side token, userinfo, JWKS, and Admin REST traffic uses `http://keycloak:8080` inside Compose. This avoids server-side hairpin-routing problems while preserving the public issuer.

The development overlay runs HMR with `admin-console/` bind-mounted. The base service uses the production standalone image.

## LAN Nginx

NextAuth callback cookies require larger proxy buffers:

```nginx
large_client_header_buffers 4 32k;
proxy_buffer_size 32k;
proxy_buffers 8 32k;
proxy_busy_buffers_size 64k;
```

HMR requires a WebSocket proxy for `/_next/webpack-hmr` with HTTP/1.1, `Upgrade`, `Connection "upgrade"`, and `proxy_buffering off`.

Forward `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto https`. Keep this vhost on the LAN-only proxy.

## Authentication and logout

NextAuth performs browser authorization against the public Keycloak issuer. Logout clears the NextAuth session and calls Keycloak's end-session endpoint, ending the Keycloak SSO session too.

## Verification

1. Confirm `user-manager` reaches `/hr`.
2. Confirm a delegated admin sees only owned applications.
3. Confirm `realm-management -> realm-admin` reaches both dashboards and all application roots.
4. Confirm user audit handles multiple/no matches, Clear, delegated-admin detection, and role lists.
5. Confirm cards show direct-member counts and open the correct member list.
6. Confirm logout ends both application and Keycloak sessions.
7. Run `npm run typecheck` and `npm run build` in `admin-console/`.

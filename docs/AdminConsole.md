# Optional Admin Console Application

`admin-console/` is a standalone Next.js application providing curated administration workflows without exposing the full Keycloak Admin Console. It runs only under the optional `admin-console` Compose profile.

There is no automated initializer. Create and maintain its confidential OIDC client manually in the Keycloak UI so administrator passwords and MFA are never used by unattended scripts.

## Access and capabilities

### HR user management

`/hr` is available to `user-manager` and `realm-management -> realm-admin`. It supports user search/create, enable/disable, password reset, onboarding-email resend, existing group membership management, and full user-profile editing.

The screen uses a two-pane layout: a compact, paginated user directory on the
left and the selected profile/create/edit workflow on the right. Advanced
filters are collapsed by default and include an inclusive account-expiry date
range, exact Employee ID, OTP phone-verification state, account status, any
group, the subgroups beneath `/User Type`, and administrative access. User Type
membership is also shown separately in the profile panel. Checkboxes drive
bulk enable, disable, and onboarding-email resend actions.

Administrative access is prominent in both the directory cards and profile:
`client-manager` and `user-manager` realm roles, the
`realm-management -> realm-admin` client role, and **App Admin · application**.
App Admin is this deployment's custom delegated-admin model: the user must be a
direct member of `/AppRoles/{application}`. Membership only in a role subgroup
does not make the user an App Admin.

Each directory row also shows mandatory phone-verification state and whether
Keycloak has a saved MFA credential (`otp`, WebAuthn, or recovery codes). A
missing phone is treated as an error, not as an inapplicable field. Indicators
are ordered as administrative access, phone, MFA, and finally account status.

The sticky Browser Authentication footer inspects the realm's currently bound
browser flow and reports whether `phone-otp-authenticator` is required and
whether `auth-otp-form` is enabled under conditional 2FA. The result is cached
in the Next.js server process; concurrent first loads share one inspection and
only the footer's **Refresh** button explicitly re-queries Keycloak.

Search, enabled state, exact Employee ID, verified-phone state, pagination, and
counts are pushed into Keycloak's Users API. Group and User Type filtering uses
Keycloak's paginated group-members endpoint. Keycloak does not support range
operators for custom user attributes, so expiry ranges are applied by the
Next.js server after reading the already narrowed candidate stream in bounded
pages; the browser never downloads the directory to filter it locally.

The **Edit profile** action supports the Git-tracked field policy in
`admin-console/src/lib/userProfileFields.ts`: username, email, first/last name,
phone number, employment type, employee ID, multivalued posts, designation,
multivalued remarks, account-expiry date, and account-expiry timezone.
`phone_verified` is displayed but is never editable: only successful user OTP
validation may set it to `true`. Changing a phone number resets
`phone_verified=false` and clears the previous verification timestamp.

When the Keycloak user-profile schema changes, update
`userProfileFields.ts` in the same Git change. Keycloak remains the final
validator when the app submits the merged user representation.

### Group and application-role management

`/groups` is available to:

- `delegated-client-admin-base`, restricted to directly owned `AppRoles/{clientId}` roots;
- `user-manager`, with institute-wide browsing, user audit, and all application roots;
- `realm-management -> realm-admin`, across all application roots.

The full-width dashboard uses a left navigation menu with three workspaces:

- **Browse Institute Wide Groups** (user-manager and realm-admin): a three-column browser for parent groups, recursively nested child groups, and direct members.
- **Application Specific Roles**: a three-column browser for applications, recursively nested application roles, and direct members.
- **Audit a User's Groups** (user-manager and realm-admin): search up to 20 matching accounts, explicitly select by username/name/email, clear the search, and view expanded membership rows.
  - Realm-wide memberships show one row per top-level group followed by subgroup paths.
  - Application-specific memberships show one row per application. Direct `AppRoles/{clientId}` membership is marked **Delegated admin**; deeper memberships are listed as application roles.

Delegated client admins see only **Application Specific Roles**, only for applications whose root group they directly belong to. They never receive institute-wide groups, their subgroups, their members, or user audit. Within an owned application, they can inspect each role's direct users and manage role membership and structure. Application roots cannot be renamed or deleted.

The parent, nested-group, and member columns each have a live filter. Group navigation uses neutral tinted backgrounds while the member column uses a contrasting blue tint. The member column shows the selected group's complete hierarchy as a breadcrumb, including arbitrary nesting depth.

`user-manager` may browse and manage memberships but cannot create, rename, or delete application-role groups. Realm admins and delegated admins may change application-role structure within their respective scopes.

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

Next.js 16 Turbopack HMR uses `/_next/hmr`. Give that path its own WebSocket
location with HTTP/1.1, `Upgrade`, `Connection "upgrade"`,
`proxy_buffering off`, and long read/send timeouts. The normal `location /`
continues to proxy pages, assets, and API routes.

Forward `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto https`. Keep this vhost on the LAN-only proxy.

## Authentication and logout

NextAuth performs browser authorization against the public Keycloak issuer. Logout clears the NextAuth session and calls Keycloak's end-session endpoint, ending the Keycloak SSO session too.

## Verification

1. Confirm `user-manager` reaches `/hr` and all three `/groups` workspaces.
2. Confirm a delegated admin sees only the Application Specific Roles workspace, only owned applications, and the direct users assigned to each role.
3. Confirm `realm-management -> realm-admin` reaches both dashboards and all application roots.
4. Confirm user audit handles multiple/no matches, Clear, delegated-admin detection, and role lists.
5. Confirm cards show direct-member counts and open the correct member list.
6. Confirm logout ends both application and Keycloak sessions.
7. Run `npm run typecheck` and `npm run build` in `admin-console/`.

# Browser App Client Configuration

This document captures the recommended Keycloak client settings for a local
browser-based app running at:

```text
http://localhost:8089
```

Use this setup for a frontend app such as an SPA or browser-rendered UI that
cannot safely store a client secret.

## Client Type

Create an OpenID Connect client.

Suggested values:

```text
Client ID: browser-localhost-8089
Client type: OpenID Connect
```

The client ID can be changed to match the actual app name.

## Capability Config

Use these settings for a public browser client:

```text
Client authentication: Off
Authorization: Off

Standard flow: On
Direct access grants: Off
Implicit flow: Off
Service account roles: Off
Standard Token Exchange: Off
JWT Authorization Grant: Off
OAuth 2.0 Device Authorization Grant: Off
OIDC CIBA Grant: Off

Require PKCE: On
PKCE Method: S256
Require DPoP bound tokens: Off
```

### Why Client Authentication Is Off

Browser apps are public clients. They cannot keep a client secret private
because anything shipped to the browser can be inspected or extracted.

Use Authorization Code Flow with PKCE instead. PKCE lets Keycloak verify that
the app completing the login is the same app that started it, without depending
on a hidden client secret.

### Why Authorization Is Off

The `Authorization` switch enables Keycloak authorization services: resources,
scopes, policies, permissions, and enforcement configuration.

For a normal browser login app, Keycloak should authenticate the user and issue
tokens with roles or claims. The app or backend can then make authorization
decisions. Turn this on only if this client will use Keycloak's fine-grained
authorization services directly.

### DPoP

Leave `Require DPoP bound tokens` off unless the browser app and the protected
APIs both explicitly support DPoP.

DPoP can improve token security by binding tokens to a client-held key, but the
client must send signed DPoP proofs during token and API requests. If the app or
API does not support that flow, login, refresh, or API calls may fail.

## Access Settings

For local development:

```text
Root URL: http://localhost:8089
Home URL: http://localhost:8089
Valid redirect URIs: http://localhost:8089/*
Valid post logout redirect URIs: http://localhost:8089/*
Web origins: http://localhost:8089
```

The wildcard redirect is acceptable for local development because it is scoped
to the exact localhost port. Avoid broad values such as `*`.

Example login callback routes that this allows:

```text
http://localhost:8089/callback
http://localhost:8089/auth/callback
```

A callback route is where Keycloak sends the browser after login. The frontend
router or dev server must serve that route.

## OIDC Discovery

Use the realm's OpenID Connect discovery document to configure OIDC client
libraries that support issuer-based setup.

Local discovery URL:

```text
http://localhost:8080/realms/<REALM_NAME>/.well-known/openid-configuration
```

For this repository's usual local realm name:

```text
http://localhost:8080/realms/aiims-new-delhi/.well-known/openid-configuration
```

The discovery document advertises the issuer and key OIDC endpoints, including:

```text
issuer
authorization_endpoint
token_endpoint
userinfo_endpoint
jwks_uri
end_session_endpoint
```

The frontend should normally be configured with:

```text
issuer: http://localhost:8080/realms/<REALM_NAME>
client_id: browser-localhost-8089
redirect_uri: http://localhost:8089/callback
post_logout_redirect_uri: http://localhost:8089/logout/callback
response_type: code
scope: openid profile email
pkce: S256
```

## Protocol Mappers And Scopes

This repo's Step 3 automation configures the realm token-shaping layer in
`scripts/step3_claims_config_docker.sh`.

It creates these OIDC client scopes:

```text
org-minimal
```

Default scope. Automatically added to the realm default client scopes, so normal
clients receive these claims without explicitly requesting the scope.

```text
detail-profile
```

Optional scope. Add/request it only when the browser app needs richer user
profile data.

### `org-minimal` Mappers

The default `org-minimal` scope currently includes:

```text
group_details      custom oidc-group-attributes-mapper
employment_type    user attribute mapper
preferred_username user property mapper
account_expiry     custom oidc-account-expiry-warning-mapper
```

All of these are configured for:

```text
ID token: On
Access token: On
UserInfo: On
```

### `detail-profile` Mappers

The optional `detail-profile` scope currently includes:

```text
phone_number
employment_type
designation
last_date
posts
given_name
family_name
email
```

`posts` is multivalued. The other user-attribute mappers are single-valued.
The obsolete `remarks` mapper is explicitly removed by Step 3 if present.

All of these are configured for:

```text
ID token: On
Access token: On
UserInfo: On
```

For a browser app that needs these richer claims, request:

```text
scope: openid profile email detail-profile
```

## AppRoles Model

This repo's Step 7 automation configures the delegated client administration
model around the `AppRoles` group tree.

```text
AppRoles/
  {clientId}/
    [direct members = delegated client admins]
    {role-subgroup}/
```

Runtime behavior:

```text
CLIENT_CREATE event
  -> create AppRoles/{clientId}
  -> add the creator as a direct member
  -> grant delegated-client-admin-base to that creator
```

Important distinction for browser apps:

- `AppRoles/{clientId}` direct membership is primarily an admin-control model.
- It decides who can administer that client through the delegated admin guard SPI.
- Child groups under `AppRoles/{clientId}` can be used as app role groups for end users.
- Group membership can appear in tokens through the `group_details` mapper.
- Client roles mapped to AppRoles subgroups can appear under `resource_access` when the user is assigned those roles through group membership.

Example group path for this browser client:

```text
/AppRoles/browser-localhost-8089
```

Example role subgroup:

```text
/AppRoles/browser-localhost-8089/admin
```

If a client role named `admin` is mapped to that subgroup and a user is a member,
the user's access token can include that app role under the browser client.

## RBAC And ABAC Guidance

Use Keycloak tokens as signed identity and entitlement input, but enforce access
inside the browser app's backend or resource server. The browser can hide UI
based on claims, but API authorization must not rely only on frontend checks.

### RBAC: Role-Based Access Control

Use RBAC when the question is "what can this user do in this app?"

Recommended sources:

```text
resource_access.<clientId>.roles
realm_access.roles
AppRoles/{clientId}/{role-subgroup}
```

For this browser client, app-specific roles should normally be modeled as client
roles and assigned through AppRoles subgroups.

Example model:

```text
Client: browser-localhost-8089
Client roles:
  admin
  editor
  viewer

Groups:
  /AppRoles/browser-localhost-8089/admin
  /AppRoles/browser-localhost-8089/editor
  /AppRoles/browser-localhost-8089/viewer
```

If a user is a member of `/AppRoles/browser-localhost-8089/admin` and that group
has the `admin` client role mapped, the access token can include:

```json
{
  "resource_access": {
    "browser-localhost-8089": {
      "roles": [
        "admin"
      ]
    }
  }
}
```

API rule example:

```text
Allow managing browser-localhost-8089 settings when
resource_access.browser-localhost-8089.roles contains admin.
```

The repo also contains an optional `oidc-approles-mapper` provider. If attached
to a client or client scope, it can emit a flattened claim from
`/AppRoles/{current-client-id}/...`.

Example optional claim:

```json
{
  "appRoles": [
    "admin",
    "billing/senior"
  ]
}
```

Current Step 3 automation does not attach this mapper by default; the default
configured group claim is `group_details` from `oidc-group-attributes-mapper`.
Use `resource_access` for standard OAuth client-role checks when possible.

### ABAC: Attribute-Based Access Control

Use ABAC when the question depends on user or group attributes, such as
employment type, department, expiry status, designation, or local organizational
metadata.

Recommended sources from this repo's mappers:

```text
group_details[].path
group_details[].attrs.dept_id
employment_type
account_expiry
designation        when detail-profile is requested
posts              when detail-profile is requested
last_date          when detail-profile is requested
```

Department membership is represented by Keycloak groups under `/Departments`.
The imported department groups carry attributes such as `dept_id`.

Example department group:

```json
{
  "name": "Cardiology",
  "path": "/Departments/Cardiology",
  "attrs": {
    "dept_id": [
      "14"
    ]
  }
}
```

API rule examples:

```text
Allow viewing department-local records when group_details contains
/Departments/Cardiology.
```

```text
Allow department-id 14 reports when any group_details entry has
attrs.dept_id containing 14.
```

```text
Deny or show renewal warning when account_expiry.expired is true, or when
account_expiry.warning is true and the operation requires a current appointment.
```

### Combining RBAC And ABAC

Use RBAC for coarse app permissions and ABAC for data boundaries.

Example combined policy:

```text
Allow editing Cardiology schedules when:
  resource_access.browser-localhost-8089.roles contains editor
  and group_details contains /Departments/Cardiology
  and account_expiry.expired is not true
```

Example admin policy:

```text
Allow managing browser-localhost-8089 application users when:
  resource_access.browser-localhost-8089.roles contains admin
  or appRoles contains admin, if the optional AppRoles mapper is configured
```

Example department-scoped reviewer policy:

```text
Allow reviewing NCI Gastroenterology Oncology records when:
  resource_access.browser-localhost-8089.roles contains reviewer
  and a department group has attrs.dept_id containing 264
```

### Practical Rules

Keep these boundaries clear:

- Use `resource_access.<clientId>.roles` for app role checks.
- Use `/Departments/...` group paths and `dept_id` group attributes for department scoping.
- Use `/AppRoles/{clientId}/...` for app role grouping and delegated client-admin ownership.
- Use direct membership in `AppRoles/{clientId}` for delegated client administration, not normal end-user authorization.
- Use child groups under `AppRoles/{clientId}` for normal app roles such as `admin`, `editor`, or `viewer`.
- Validate tokens server-side using the realm JWKS from the discovery document.
- Prefer stable identifiers such as `dept_id` for backend policy checks; display names can change.

## Sample Token Shapes

These examples show decoded JWT payload shapes from this realm style. They are
not real tokens and must not be used as credentials.

Actual token contents vary based on requested scopes, protocol mappers, group
membership, client role mappings, assigned realm roles, and user attributes.

### ID Token With Default `org-minimal`

Because `org-minimal` is a default scope, the browser app can receive the custom
minimal claims without requesting an extra scope.

```json
{
  "exp": 1760000300,
  "iat": 1760000000,
  "auth_time": 1760000000,
  "jti": "example-id-token-jti",
  "iss": "http://localhost:8080/realms/aiims-new-delhi",
  "aud": "browser-localhost-8089",
  "sub": "7f8f4b1e-1111-2222-3333-8c7f3a000001",
  "typ": "ID",
  "azp": "browser-localhost-8089",
  "sid": "example-session-id",
  "acr": "1",
  "preferred_username": "example.user",
  "employment_type": "permanent",
  "account_expiry": {
    "configured": true,
    "warning": false,
    "expired": false,
    "timeZone": "Asia/Kolkata",
    "daysRemaining": 120
  },
  "group_details": [
    {
      "name": "AppRoles",
      "path": "/AppRoles",
      "attrs": {},
      "grps": [
        {
          "name": "browser-localhost-8089",
          "path": "/AppRoles/browser-localhost-8089",
          "attrs": {},
          "grps": [
            {
              "name": "admin",
              "path": "/AppRoles/browser-localhost-8089/admin",
              "attrs": {}
            }
          ]
        }
      ]
    }
  ]
}
```

If the user does not have an expiry date configured, the account-expiry mapper
returns a non-warning shape:

```json
{
  "account_expiry": {
    "configured": false,
    "warning": false,
    "expired": false
  }
}
```

### Access Token With AppRoles-Derived Client Role

The access token is what APIs should validate. If the user is in an AppRoles
subgroup that maps to a client role, the client role can appear under
`resource_access`.

```json
{
  "exp": 1760000300,
  "iat": 1760000000,
  "jti": "example-access-token-jti",
  "iss": "http://localhost:8080/realms/aiims-new-delhi",
  "aud": [
    "account"
  ],
  "sub": "7f8f4b1e-1111-2222-3333-8c7f3a000001",
  "typ": "Bearer",
  "azp": "browser-localhost-8089",
  "sid": "example-session-id",
  "acr": "1",
  "allowed-origins": [
    "http://localhost:8089"
  ],
  "realm_access": {
    "roles": [
      "default-roles-aiims-new-delhi",
      "offline_access",
      "uma_authorization"
    ]
  },
  "resource_access": {
    "browser-localhost-8089": {
      "roles": [
        "admin"
      ]
    },
    "account": {
      "roles": [
        "manage-account",
        "manage-account-links",
        "view-profile"
      ]
    }
  },
  "scope": "openid profile email",
  "preferred_username": "example.user",
  "employment_type": "permanent",
  "account_expiry": {
    "configured": true,
    "warning": false,
    "expired": false,
    "timeZone": "Asia/Kolkata",
    "daysRemaining": 120
  },
  "group_details": [
    {
      "name": "AppRoles",
      "path": "/AppRoles",
      "attrs": {},
      "grps": [
        {
          "name": "browser-localhost-8089",
          "path": "/AppRoles/browser-localhost-8089",
          "attrs": {},
          "grps": [
            {
              "name": "admin",
              "path": "/AppRoles/browser-localhost-8089/admin",
              "attrs": {}
            }
          ]
        }
      ]
    }
  ]
}
```

### Token With Optional `detail-profile`

When the browser app requests `detail-profile`, these additional claims can be
included if the user has the corresponding profile attributes.

```json
{
  "scope": "openid profile email detail-profile",
  "preferred_username": "example.user",
  "given_name": "Example",
  "family_name": "User",
  "email": "example.user@example.org",
  "phone_number": "+919999999999",
  "employment_type": "permanent",
  "designation": "Senior Resident",
  "last_date": "2027-03-31",
  "posts": [
    "doctor",
    "researcher"
  ]
}
```

### Refresh Token

The refresh token is used by the OIDC client to obtain new access tokens. Treat
it as highly sensitive. Browser apps should let the OIDC library manage it.

```json
{
  "exp": 1760003600,
  "iat": 1760000000,
  "jti": "example-refresh-token-jti",
  "iss": "http://localhost:8080/realms/aiims-new-delhi",
  "aud": "http://localhost:8080/realms/aiims-new-delhi",
  "sub": "7f8f4b1e-1111-2222-3333-8c7f3a000001",
  "typ": "Refresh",
  "azp": "browser-localhost-8089",
  "sid": "example-session-id",
  "scope": "openid profile email"
}
```

Do not hard-code authorization decisions only against these samples. Validate
real tokens from the configured realm and check the actual claims emitted for
the deployed client.

## Logout Settings

Recommended baseline:

```text
Front channel logout: On
Front-channel logout URL: http://localhost:8089/logout/frontchannel
Front-channel logout session required: On
Logout confirmation: Off
```

Keep this front-channel URL only if the app implements the route. If it does
not, leave `Front-channel logout URL` blank until the route exists.

## Post-Logout Redirect

This is the normal user-facing logout return path. The app sends the user to
Keycloak logout, and Keycloak sends the browser back to the app after ending
the SSO session.

Example return URL:

```text
http://localhost:8089/logout/callback
```

Because `Valid post logout redirect URIs` includes `http://localhost:8089/*`,
this URL is allowed.

Use the OIDC client library's logout method when available. If building the URL
manually, it will look like this:

```text
http://localhost:8080/realms/<REALM_NAME>/protocol/openid-connect/logout?client_id=<CLIENT_ID>&post_logout_redirect_uri=http%3A%2F%2Flocalhost%3A8089%2Flogout%2Fcallback
```

## Optional `/logout/frontchannel` Functionality

The front-channel logout URL is not the same as the user-facing logout callback.
It is a notification endpoint that Keycloak can load, commonly in a hidden
iframe, when the Keycloak SSO session ends.

Use this route to clear local browser-side login state when logout happens
outside the app, for example from another app sharing the same Keycloak session.

The route should:

- clear local auth state and cached tokens used by the browser app
- return a minimal page
- avoid redirect loops
- work when loaded in an iframe
- avoid user-facing navigation unless the app explicitly needs it

Minimal example:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Logout</title>
  </head>
  <body>
    <script>
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
      sessionStorage.clear();
    </script>
  </body>
</html>
```

If the app uses an OIDC library, prefer the library's token/session cleanup API
instead of hard-coding storage keys. Different libraries store tokens in
different places.

## Route Summary

Use separate routes for separate jobs:

```text
/callback
```

Login callback. Keycloak redirects here after successful login.

```text
/logout/callback
```

Post-logout redirect. Keycloak redirects the user here after app-initiated
logout.

```text
/logout/frontchannel
```

Front-channel logout notification. Keycloak loads this to tell the app that the
SSO session ended.

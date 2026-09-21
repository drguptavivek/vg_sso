# Public Application-Role API Plan

## 1. Objective

Provide a narrowly scoped public API through which an application's authenticated delegated administrator can manage existing SSO users' membership in that application's own AppRoles descendants.

The private Next.js Admin Console and Keycloak Admin Console remain restricted to the private LAN. This API does not expose either administrative console.

This work begins only after the Admin Console client-management plan is implemented and stabilized.

## 2. Security Boundary

The API permits only:

- listing roles strictly below the caller's assigned `/AppRoles/{clientId}` root;
- listing direct members of those role groups;
- adding an existing Keycloak user to those role groups;
- removing an existing Keycloak user from those role groups.

It never permits:

- creating, deleting, disabling, or editing SSO users;
- changing credentials or MFA;
- fuzzy user-directory search;
- changing realm-wide groups or roles;
- changing another application's AppRoles;
- adding members directly to `/AppRoles/{clientId}`;
- appointing delegated application administrators;
- modifying Keycloak clients or scopes.

## 3. Public API

```text
GET    /realms/{realm}/application-role-api/roles
GET    /realms/{realm}/application-role-api/roles/{roleGroupId}/members
PUT    /realms/{realm}/application-role-api/roles/{roleGroupId}/members/{userId}
DELETE /realms/{realm}/application-role-api/roles/{roleGroupId}/members/{userId}
```

Membership addition uses `PUT` because it is idempotent. Target users are identified by their Keycloak `sub`/user UUID. No public user-search endpoint is included initially.

## 4. Client Model

An application that enables external role management normally has:

1. its existing OIDC login client, using Authorization Code with PKCE; and
2. a companion confidential backend client, such as `{clientId}-role-api`, used for token exchange and backend identification.

The companion client is request-driven and provisioned from the private Admin Console only after explicit approval. It is never created automatically for every application.

Protected companion-client configuration includes:

- audience `application-role-api`;
- scope `application-role-membership.manage`;
- protected attribute `managed.application.client-id={parentClientId}`;
- no general realm-management roles;
- no direct access grants;
- no implicit flow;
- no offline access;
- short access-token lifetime;
- `private_key_jwt` preferred over a shared secret.

## 5. Human and Backend Authentication

Client Credentials alone is insufficient because it identifies only the backend. Every mutation must retain a named human actor.

The required sequence is:

1. the delegated application administrator signs in through Authorization Code with PKCE;
2. the application requests Keycloak step-up authentication at `acr=2`;
3. Keycloak performs the required MFA;
4. the application backend authenticates as the companion role-API client;
5. the backend exchanges the stepped-up human token for a short-lived `application-role-api` audience token;
6. the API validates both the human subject and the calling backend client.

The browser never receives the companion client's private key or client secret.

## 6. Keycloak Step-Up Authentication

Configure:

- LoA 1 for ordinary application authentication;
- LoA 2 for MFA-protected role management;
- ACR-to-LoA mapping for `acr=2`;
- Minimum ACR Value `2` for the relevant step-up/token-exchange path;
- token verification that explicitly requires `acr=2`.

The authorization request uses an essential ACR claim. PAR or a signed request object should be used where practical to prevent browser-side request-parameter tampering.

## 7. Elevated Authorization Lifetime

MFA is performed by Keycloak. Exact inactivity semantics are enforced by a server-side elevation grant.

Policy:

- elevated idle timeout: 20 minutes;
- absolute elevated duration: 60 minutes;
- exchanged API access-token lifetime: 2–5 minutes.

The elevation record is bound to:

- human `sub`;
- Keycloak session `sid`;
- calling backend client;
- managed application;
- achieved ACR;
- creation, last-use, and absolute-expiry timestamps.

Only a successful authorized role-management operation refreshes `last_used_at`. Denied requests do not extend elevation. After idle or absolute expiry, the API returns `step_up_required` and the user must complete MFA again.

## 8. Authorization Algorithm

For every request:

1. validate token signature, issuer, expiration, and audience;
2. require scope `application-role-membership.manage`;
3. require `acr=2`;
4. identify the calling companion client;
5. read its protected `managed.application.client-id` mapping;
6. validate the human actor and active elevation grant;
7. confirm the human is still a direct member of `/AppRoles/{managedClientId}`;
8. resolve the requested role group by immutable group UUID;
9. confirm the group is a strict descendant of the owned application root;
10. reject the application root, AppRoles parent, realm groups, and other application trees;
11. perform the idempotent membership operation;
12. write the audit event.

The caller never supplies an authoritative application/client ID. Non-owned role IDs return a generic `404` to avoid disclosing other applications.

## 9. Keycloak SPI

Create a separate module:

```text
custom-application-role-api-spi/
```

Suggested components:

- `ApplicationRoleApiResourceProviderFactory`
- `ApplicationRoleApiResourceProvider`
- `ApplicationRoleTokenValidator`
- `ApplicationRoleOwnershipService`
- `ApplicationRoleMembershipService`
- `ElevationGrantService`
- `ApplicationRoleAuditService`
- `ApplicationRoleRateLimiter`

Keeping this boundary separate from the delegated-admin guard makes the public API easier to audit, test, disable, and version.

## 10. Elevation Storage

Use a server-side store such as Postgres or Redis. A record includes:

```text
grant_id
actor_user_id
keycloak_session_id
calling_client_id
managed_application_id
acr
created_at
last_used_at
absolute_expires_at
revoked_at
```

Grants are revoked on logout, user disablement, loss of application ownership, companion-client suspension, or security incident response.

## 11. Privacy and Enumeration Controls

- Require the target user's Keycloak UUID from the application's existing login data.
- Do not provide fuzzy lookup by name, email, or phone.
- Return generic errors for unknown or inaccessible identifiers.
- Return only minimal member representations.
- Apply response-size and pagination limits.

An exact lookup capability, if ever needed, requires a separately approved scope and rate limit.

## 12. Additional Protections

- HTTPS only;
- no browser CORS initially;
- backend-to-backend calls only;
- per-client rate and concurrency limits;
- request-body size limits;
- optional source-IP allowlists;
- optional mutual TLS;
- short-lived tokens;
- key/secret rotation and immediate suspension;
- `Cache-Control: no-store`;
- no token, secret, or private-key logging.

## 13. Audit and Monitoring

Every mutation and denial records:

- human administrator ID and username;
- calling companion client;
- managed application;
- target user ID;
- role group ID and path;
- operation;
- source IP;
- ACR and elevation age;
- correlation ID;
- result and denial reason.

Suggested events:

```text
APPLICATION_ROLE_MEMBERSHIP_ADD
APPLICATION_ROLE_MEMBERSHIP_REMOVE
APPLICATION_ROLE_API_DENIED
APPLICATION_ROLE_STEP_UP_EXPIRED
APPLICATION_ROLE_CLIENT_SUSPENDED
```

Add metrics for success, denial, cross-application attempts, expired elevation, invalid audience, and rate limiting.

## 14. Admin Console Enablement Workflow

After the SPI exists, extend `/clients/{id}` with `Enable external application-role API`.

The workflow:

1. application owner requests enablement;
2. an authorized client manager or realm administrator reviews the request;
3. Admin Console validates the parent client and AppRoles root;
4. it creates or reconciles `{clientId}-role-api`;
5. it configures audience, scopes, protected mapping, token exchange, and authentication method;
6. it registers the application's public JWKS or generates a one-time secret when unavoidable;
7. it validates the effective configuration;
8. it generates a role-API integration addendum for the developer onboarding pack;
9. it records the complete audit event.

Provisioning is idempotent. The workflow supports suspension, key rotation, and revocation. It does not automatically send email.

## 15. Developer Integration Material

Generate non-secret documentation containing:

- issuer and token endpoint;
- role API base URL;
- login and companion client IDs;
- required audience, scope, and ACR;
- PKCE and MFA step-up sequence;
- token-exchange example;
- 20-minute idle and 60-minute absolute elevation behavior;
- API/OpenAPI examples;
- error handling, including `step_up_required`;
- key rotation and incident procedures.

Credentials are delivered separately through an approved secure process. No automatic email is sent.

## 16. Testing

### Unit tests

- token issuer/audience/scope/ACR validation;
- companion-client mapping;
- owned and non-owned role resolution;
- application-root rejection;
- idempotent membership changes;
- elevation idle and absolute expiry;
- audit redaction;
- rate limiting.

### Integration tests

- Application A can manage only Application A descendants.
- Application A cannot read or mutate Application B.
- LoA 1 tokens are rejected.
- LoA 2 with a valid grant succeeds.
- Twenty minutes of inactivity requires MFA again.
- Sixty minutes requires MFA despite continuous activity.
- Successful calls refresh only the idle timestamp.
- Application roots cannot receive membership mutations.
- Realm groups and user lifecycle operations remain inaccessible.
- Loss of ownership immediately removes authorization.
- Suspended companion clients cannot call the API.
- Every mutation and denial is audited.

## 17. Rollout

1. implement the SPI and automated tests;
2. deploy with no enabled external clients;
3. configure step-up and token exchange in development;
4. enable one non-production pilot application;
5. validate MFA, elevation expiry, cross-application isolation, and auditing;
6. conduct security review and credential rotation;
7. publish the versioned OpenAPI and integration guide;
8. enable production clients individually.


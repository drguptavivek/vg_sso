# Admin Console Client Management Plan

## 1. Objective

Extend the existing private Next.js Admin Console with a client-management workspace for holders of the `client-manager` role. Client managers should be able to provision and maintain secure OpenID Connect clients without visiting the Keycloak Admin Console.

This is phase one. The public application-role membership API and its dedicated Keycloak SPI will be designed and delivered separately after client management is stable.

## 2. Phase-One Scope

Client managers will be able to:

- list and search non-system clients;
- create clients from approved security templates;
- view configuration and security posture;
- edit allowlisted redirect URIs, origins, logout URLs, contacts, and other safe settings;
- assign or remove delegated application administrators;
- inspect the associated `/AppRoles/{clientId}` hierarchy;
- suspend and resume permitted non-system clients;
- generate a configuration-specific developer onboarding pack;
- review the client-management audit history.

Initially excluded:

- the public application-role API;
- arbitrary Keycloak client representations;
- system-client mutation;
- client deletion;
- arbitrary protocol mappers or client scopes;
- dynamic client registration;
- general realm administration;
- automatic email delivery.

## 3. Approved Client Templates

### 3.1 Browser SPA

- Client authentication: off
- Authorization Code flow: on
- PKCE: required, S256 only
- Implicit flow: off
- Direct access grants: off
- Service accounts: off
- Offline access: off

### 3.2 Server-Side Web Application

- Client authentication: on
- Authorization Code flow: on
- PKCE: required, S256 only
- Implicit flow: off
- Direct access grants: off
- Service accounts: off by default
- Client authentication: `private_key_jwt` preferred

### 3.3 Native or Mobile Application

- Client authentication: off
- Authorization Code flow: on
- PKCE: required, S256 only
- Implicit flow: off
- Direct access grants: off
- Service accounts: off
- Redirect URIs restricted to approved claimed HTTPS, application URI, or loopback patterns

### 3.4 Machine-to-Machine Application

- Client authentication: on
- Authorization Code flow: off
- Service accounts: on
- Direct access grants: off
- Client authentication: `private_key_jwt` preferred

Keycloak Authorization Services must remain disabled by default. It may be enabled only through an explicitly approved advanced option when an application genuinely uses Keycloak resource-based authorization.

## 4. Metadata

Keycloak remains the source of truth for protocol configuration. The Admin Console database stores operational metadata:

- Keycloak client UUID and client ID;
- display name and environment;
- application type;
- business and technical owners;
- primary and secondary technical contacts;
- support contact and justification;
- provisioning status;
- creator and approver;
- created and updated timestamps;
- onboarding-pack version;
- future role-API status.

Metadata must reference the immutable Keycloak client UUID.

## 5. Permissions

| Operation | Client manager | Realm administrator | User manager |
|---|---:|---:|---:|
| View non-system clients | Yes | Yes | Read-only |
| Create clients from templates | Yes | Yes | No |
| Edit allowlisted safe fields | Yes | Yes | No |
| Assign application administrators | Yes | Yes | No |
| Change authentication type | Restricted | Yes | No |
| Register public JWKS | Restricted | Yes | No |
| Reveal a newly generated secret once | Restricted | Yes | No |
| Rotate credentials | Request/policy controlled | Yes | No |
| Suspend or resume a permitted client | Yes | Yes | No |
| Delete a client | No UI initially | No UI initially | No |
| Generate onboarding material | Yes | Yes | No |

Existing FGAP v2 permissions and `DelegatedAdminGuardFilter` remain authoritative.

## 6. Admin Console Workspaces

### `/clients`

Enhance the existing directory with search and filters for environment, application type, state, owner, PKCE status, security warnings, AppRoles status, onboarding status, and future role-API status.

### `/clients/new`

Provide a guided wizard:

1. select an application template;
2. enter identity, environment, and ownership information;
3. configure redirect and logout URIs;
4. configure web origins;
5. select approved scopes and claims;
6. review enforced security defaults;
7. confirm provisioning;
8. review validation results;
9. generate onboarding material.

### `/clients/{id}`

Show configuration, security posture, OAuth flows, credentials, scopes, mappers, redirect URIs, AppRoles, delegated administrators, contacts, configuration validation, and audit history.

### `/clients/{id}/integration`

Provide onboarding-pack preview and downloads in PDF, Markdown, JSON, OpenAPI, and `.env.example` formats.

## 7. Narrow Server APIs

The Admin Console should expose typed, allowlisted APIs rather than accepting arbitrary Keycloak JSON:

```text
GET    /api/clients
POST   /api/clients
GET    /api/clients/{id}
PATCH  /api/clients/{id}
POST   /api/clients/{id}/validate
POST   /api/clients/{id}/suspend
POST   /api/clients/{id}/resume

GET    /api/clients/{id}/administrators
PUT    /api/clients/{id}/administrators/{userId}
DELETE /api/clients/{id}/administrators/{userId}

POST   /api/clients/{id}/onboarding-pack
```

Every request must use the signed-in actor's access token. Keycloak Admin REST, FGAP, and the delegated guard remain the final authorization boundary.

## 8. Provisioning Workflow

Client creation is an idempotent, recoverable workflow:

1. validate and reserve the requested client ID;
2. reject reserved or system-client identifiers;
3. validate environment and template;
4. validate redirect URIs, logout URIs, and origins;
5. reject unsafe production wildcards;
6. create the Keycloak client;
7. enforce the selected template;
8. apply approved default scopes and token mappers;
9. confirm `/AppRoles/{clientId}` exists;
10. assign the initial delegated administrator where policy permits;
11. store Admin Console metadata;
12. run post-provisioning security validation;
13. generate the onboarding pack;
14. write the audit event.

If a mandatory step fails, mark the client `provisioning_failed` and offer a safe retry. Do not silently leave a partially configured client.

## 9. URI and Origin Validation

- Require HTTPS in staging and production.
- Reject URL fragments.
- Reject wildcard hosts.
- Reject broad production path wildcards unless explicitly approved.
- Allow loopback HTTP only for native development clients.
- Require origins consistent with registered redirect URIs.
- Use separate clients for development, staging, and production.

Recommended naming:

```text
application-dev
application-staging
application-prod
```

## 10. Security Validation

Use one reusable validation engine for creation, editing, audits, and onboarding generation. Findings should include:

```text
PASS: PKCE S256 required
PASS: Implicit flow disabled
PASS: Direct grants disabled
PASS: Redirect URIs use HTTPS
WARN: Broad post-logout URI
FAIL: Production redirect URI uses HTTP
FAIL: Browser SPA has client authentication enabled
```

Unsafe findings block provisioning. Warnings require explicit acknowledgement.

## 11. AppRoles Administration

After provisioning:

- confirm `/AppRoles/{clientId}` exists;
- show direct application administrators;
- allow client managers to appoint or remove direct application administrators;
- prevent delegated application administrators from appointing other administrators;
- show application-role descendants;
- display `External application-role API: Not available` until the later SPI phase.

## 12. Credential Handling

Public PKCE clients receive no credential.

For confidential clients, prefer `private_key_jwt`:

1. the developer generates a key pair;
2. the client manager registers the public JWKS;
3. Keycloak stores only the public key;
4. the developer retains the private key.

If a shared secret is unavoidable:

- generate it only when required;
- display it once;
- never store it in Admin Console metadata;
- never include it in onboarding material;
- never log it;
- support immediate rotation and revocation.

Credential viewing and rotation should later be protected by MFA step-up.

## 13. Developer Onboarding Pack

Generate the pack from the validated, effective client configuration. It should contain:

- client ID, application type, and environment;
- issuer and OIDC endpoints;
- redirect, logout, and origin settings;
- PKCE instructions;
- token-validation requirements;
- expected claims;
- AppRoles authorization guidance;
- logout and session-revocation behavior;
- security and integration-testing checklists;
- technical and SSO support contacts;
- configuration version and generation timestamp.

It must not contain a client secret, private key, access token, refresh token, or credential-retrieval URL.

Available actions:

```text
Preview onboarding pack
Download PDF
Download Markdown
Download JSON
Download OpenAPI specification
Download .env.example
Copy approved email draft
```

## 14. No Automated Email

Provisioning must never automatically send email. An incorrect address could disclose integration details and create a security incident.

Phase one therefore excludes direct email delivery. The client manager must review and download the onboarding material, then share it manually through an approved channel.

The copied email draft must not contain a recipient, secret, private key, token, or reusable credential link.

If direct email is considered later, it requires a separately approved design with verified contacts, manual recipient confirmation, MFA step-up, explicit sending, and no coupling to provisioning.

## 15. Audit Events

Add:

```text
CLIENT_PROVISION_REQUESTED
CLIENT_CREATED
CLIENT_CONFIGURATION_UPDATED
CLIENT_PROVISION_FAILED
CLIENT_SUSPENDED
CLIENT_RESUMED
CLIENT_ADMIN_ADDED
CLIENT_ADMIN_REMOVED
CLIENT_PUBLIC_KEY_REGISTERED
CLIENT_CREDENTIAL_ROTATED
CLIENT_ONBOARDING_PACK_GENERATED
```

Never audit tokens, secrets, private keys, or credential-delivery URLs.

## 16. Tests

### Unit tests

- template settings;
- URI and origin validation;
- production wildcard rejection;
- reserved-client rejection;
- API field allowlists;
- permission checks;
- security findings;
- onboarding-pack redaction.

### Integration tests

- client manager creates each supported type;
- user manager cannot create clients;
- system clients cannot be modified;
- AppRoles root is created;
- initial application administrator is assigned;
- repeated provisioning is idempotent;
- failed provisioning is recoverable;
- generated material contains no credential;
- existing `/clients` and `/groups` behavior remains intact.

### Live validation

- PKCE login succeeds;
- non-PKCE authorization fails;
- implicit and password grants fail;
- tokens contain expected claims;
- logout redirects correctly;
- security findings match effective configuration;
- no email is sent during provisioning.

## 17. Delivery Milestones

### Milestone 1: Core Management

- metadata schema;
- typed client APIs;
- directory, creation wizard, and detail views;
- templates and security validation;
- AppRoles verification;
- audit logging.

### Milestone 2: Ownership and Credentials

- technical contacts;
- delegated administrator management;
- JWKS registration;
- controlled secret generation and rotation;
- suspension and resumption.

### Milestone 3: Developer Onboarding

- configuration-specific pack generator;
- PDF, Markdown, JSON, OpenAPI, and `.env.example` outputs;
- preview and approved email-draft generation;
- explicit confirmation that provisioning sends no email.

### Milestone 4: Hardening and Rollout

- complete automated tests;
- live PKCE validation;
- documentation and operational runbook;
- pilot development client;
- staged production rollout.

## 18. Later Phase: Public Application-Role API

After client management is stable, create `custom-application-role-api-spi` and extend the client detail page with an explicit role-API enablement workflow.

That later phase will include:

- a companion backend client where required;
- human administrator login through Authorization Code + PKCE;
- Keycloak MFA step-up with `acr=2`;
- token exchange preserving the human actor and backend identity;
- a 20-minute elevated-access idle timeout;
- a 60-minute absolute elevated-access limit;
- access only to strict descendants of the application's own AppRoles root;
- public role membership APIs for existing SSO users only;
- complete mutation and denial auditing.


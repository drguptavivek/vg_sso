# VG SSO

This repository packages a Docker-based Keycloak deployment for the `org-new-delhi` realm, with custom providers, themes, bootstrap automation, delegated administration, audit/logging support, and verification tests. Based on 26.5.4

The main README is intentionally brief. It is the entry point for understanding what this repo does and how to get it running. Detailed implementation notes, policy writeups, and step-specific rollout docs live in [`docs/`](docs/).

## Authentication And Authorization Achievements

In authn/authz terms, the implementation is materially beyond a stock Keycloak setup.

### 1. Enhanced user profile model

The repo also extends the Keycloak user profile so the identity store can carry organization-specific staff data rather than only default Keycloak fields. The current setup includes fields such as phone number, employment type, employee ID, designation, posts, remarks, and account-expiry attributes used by the expiry controls. That allows the realm to act as a more realistic institutional identity system, where operational attributes needed for onboarding, delegation, and downstream applications live directly on the user record.

Those profile enhancements are not just cosmetic schema additions. They are used by other parts of the system, including phone verification, account expiry enforcement, delegated user management, and controlled token claim release. In other words, the user profile model is part of the security and operations design, not just a place to store extra metadata.

### 2. Layered authentication

The repo gives you a layered browser login model instead of a simple username/password flow. 
 - Users come through a branded realm and controlled login surface, then pass normal credential validation, then hit account-expiry enforcement.
 - Users who are not yet marked `phone_verified=true` are then required to complete SMS OTP before login succeeds.
 - Once a user has been verified, the custom authenticator can short-circuit the OTP step on later logins based on that verified state.
 - The login path is therefore policy-aware: an expired account is stopped before second-factor completion, and a live account still has to satisfy the browser OTP step.
 - Around that flow, the realm baseline is hardened with brute-force controls, required actions, and tuned token and session settings. 
 - The repo also ships a custom forbidden-terms password policy provider so the deployment can reject organization-specific weak passwords when that policy is enabled. 

Authentication is therefore not just “can the user enter the right password,” but “is this account valid, current, policy-compliant, and, where required, phone-verified through the OTP flow.”

### 3. Operable authentication

The implementation also includes operational admin endpoints for OTP testing, pending phone-verification review, and account-expiry administration, exposed through dedicated admin-interface links and supporting APIs. That makes the authentication stack supportable in day-to-day operations. The authentication layer is designed to be enforceable, inspectable, and operable.

### 4. Delegated authorization model

On authorization, the implementation moves away from the usual flat admin model. Instead of handing broad `realm-admin` access to everyone who needs administrative capability, the repo defines multiple delegated roles with separate responsibilities. 

- `user-manager` supports delegated user lifecycle operations such as creating users, editing user attributes, and assigning existing groups, without granting full group administration or unrestricted role management.
- `client-manager` supports delegated client onboarding and non-system client management, but deliberately does not allow delegated users to delete clients or freely modify protected platform resources. 
- `delegated-client-admin-base` then adds client-scoped delegation tied to `AppRoles/{clientId}` ownership, so delegated client administrators are limited by which client roots they actually own. 
- The repo also adds a read-only `auditor` role so audit and operations users can inspect the realm without mutation privileges.

### 5. Defense in depth for admin authorization

This authorization model is not implemented through one Keycloak feature alone. Fine-Grained Admin Permissions (FGAP) provide the main scoping model for users, groups, and clients, and custom role/group structures provide ownership boundaries. 

On top of that, the `delegated admin guard SPI` closes the gaps that FGAP alone does not safely close, especially around client deletion, system-client mutation, client-scope mutation, and tampering with auto-managed delegated-admin role assignments.

Realm roles define broad responsibilities, FGAP narrows the admin surface, the AppRoles ownership model ties some powers to concrete client ownership, and the custom SPI layer enforces runtime guardrails where native authorization is not sufficient.

### 6. Group-aware token enrichment: who the user is, where they work, what they do, any app-specific roles they need

- The repo includes a custom group-attribute mapper SPI to solve a practical limitation in standard Keycloak token shaping. In this system, users are intentionally placed into multiple organizational groups such as `Departments`, `User Type`, and `IT Roles`. Those memberships tell client applications where the user works, what kind of user they are, and what kind of work they do. 
- This organizational group information is included in the minimal token for all clients so applications can enforce authorization consistently across the environment.
- The problem with classical Keycloak is that group membership and group attributes are not emitted in a form that clients can reliably join back together. A client may see group names and it may see attributes, but there is no clean built-in representation that says which attributes belong to which specific group. That becomes important when a department group carries master data such as a department ID or another canonical identifier in the group attributes. The `custom-group-attr-mapper` addresses that gap by emitting group-linked data in a usable structure, so clients receive both the group identity and the attributes attached to that same group.
- This repo also uses a separate special group hierarchy called `AppRoles`. `AppRoles` is not the same as the common organizational group claims sent to all clients. It exists for delegated client administration, allowing app admins to create *app-specific role groups* and add users to those roles in a secure way. In a heterogeneous application environment where role names and entitlement models vary from app to app, that gives onboarded app admins a controlled way to manage application-specific roles without needing broad realm-level admin access.
- `AppRoles` membership is released differently from the general organizational groups. Common organizational group information is included for all clients as part of the minimal token model. `AppRoles` data, by contrast, is released only in the context of the requesting application, so one client does not receive another client’s app-specific role memberships.


**When these pieces are combined, the repo is not just customizing Keycloak cosmetically. It is implementing a governed institutional IAM model with layered authentication, delegated administration, scoped claims, audit visibility, and operational safeguards already built in.**

## What this repo includes

- Dockerized Keycloak and PostgreSQL workflow for local development and repeatable setup.
- Automated realm bootstrap and post-bootstrap configuration through ordered init steps.
- Custom themes for login, account, and admin surfaces.
- Custom Keycloak extensions for claims, authentication, policies, and operational logging.
- Test profiles for live configuration validation and delegated-admin behavior.
- A `Makefile` that wraps the common local workflows.

## Major capabilities

- Realm bootstrap, branding, and admin-user provisioning.
- Realm security baseline, required actions, SMTP, user-profile fields, and group import.
- Layered browser authentication with account expiry enforcement and SMS OTP support.
- Delegated admin roles and fine-grained admin permissions for user and client administration.
- Controlled token claims and custom protocol mappers.
- Auditor-oriented role/config setup and audit export workflow.
- Failure-only authentication event logging and host-mounted log persistence.

## Customizations summary

From an end-user and operator perspective, this setup already includes more than a stock Keycloak deployment.

- Branded login, account, and admin experiences for both the target realm and master realm.
- Pre-created realm and admin setup so the environment comes up in an operational state.
- Hardened realm defaults including password policy, brute-force protection, token/session settings, and audit events.
- Extended user profile fields for organization-specific identity data such as phone number, employee metadata, designation, posts, and remarks.
- Imported organization group hierarchy and group attributes.
- Layered browser authentication with phone verification state, SMS OTP, and timezone-aware account-expiry enforcement.
- Delegated administration roles and FGAP-based permissions for user management and client administration without handing out full realm-admin access.
- Controlled OIDC claim shaping through custom protocol mappers and curated client scopes such as `org-minimal` and `detail-profile`.
- App-role and default-role bootstrap so newly created users and delegated admins start from a governed baseline.
- Auditor-oriented configuration and audit archival/export support for operational review and retention.
- Failure-auth event logging separated into dedicated log output for easier monitoring and triage.

## Custom providers

This repo currently contains these custom provider modules:

- `custom-group-attr-mapper`
- `custom-phone-otp-authenticator`
- `custom-account-expiry-spi`
- `custom-delegated-admin-guard-spi`
- `custom-password-phrase-policy-spi`
- `custom-failure-logs-event-listener-spi`

## Quick Start

1. Create your local environment file.

```bash
cp .env.template .env
```

2. Update the required values in `.env`.

At minimum, review:

- bootstrap and admin credentials
- database credentials
- realm admin identity fields
- hostname and proxy settings
- SMTP settings
- log and audit export paths
- `KEYCLOAK_ENV` when working locally

3. Start the local development stack.

```bash
make up
```

4. Check service state.

```bash
make ps
```

5. Open the local endpoints.

- Keycloak: `http://localhost:8080`
- Management: `http://localhost:9000/management`
- Postgres: `localhost:5432`

## Common commands

Use the `Makefile` instead of remembering the full compose commands.

```bash
make help
make up
make down
make reset
make logs
make logs-runtime
make logs-init
make force-step4
make audit-export
make test-config
make test-step6
make test-step7
```

## Development workflow

For normal local work:

- `make up` builds the SPIs, prepares log directories, applies local branding assets, and starts the dev compose stack.
- `make logs` or `make logs-init` shows bootstrap and runtime progress.
- `make reset` resets the local environment when you need a clean state.

For SPI iteration, prefer hot reload over a full image rebuild:

```bash
./scripts/dev_hot_reload_spi.sh
./scripts/dev_hot_reload_spi.sh custom-group-attr-mapper custom-delegated-admin-guard-spi
```

## Bootstrap model

The environment is configured through one-shot init containers that run in order after Keycloak becomes healthy. The current pipeline includes:

- core bootstrap and realm creation
- realm security and profile baseline
- FGAP bootstrap helpers
- claims/scopes setup
- OTP setup
- account expiry setup
- delegated client-admin setup
- app-role/bootstrap setup
- auditor setup
- audit archival/export setup

The exact implementation is intentionally kept out of this README. Use the step docs if you need to modify one of those stages.

## Testing

The repo includes both provider-level unit tests and containerized live-config checks.

Primary entrypoints:

- `make test-config`
- `make test-step6`
- `make test-step7`

Test artifacts are written under [`tests/results/`](tests/results/).

## Logs and audit data

- Runtime logs are bind-mounted from the container to the host path configured by `KC_HOST_LOG_DIR`.
- Failure-only auth events are written to `KC_FAILURE_LOG_FILE`.
- Audit exports use the `AUDIT_EXPORT_*` settings in `.env` and can be run on demand via `make audit-export`.

## Where to go deeper

- Canonical local workflow and operational notes: [`AGENTS.md`](AGENTS.md)
- Policy docs:
  - [`docs/branding-assets.md`](docs/branding-assets.md)
  - [`docs/group-import.md`](docs/group-import.md)
  - [`docs/sms-otp-policy.md`](docs/sms-otp-policy.md)
  - [`docs/account-expiry-policy.md`](docs/account-expiry-policy.md)
  - [`docs/user-manager-policy.md`](docs/user-manager-policy.md)
  - [`docs/delegated-client-admin-policy.md`](docs/delegated-client-admin-policy.md)
  - [`docs/password-phrase-policy.md`](docs/password-phrase-policy.md)
  - [`docs/failure-auth-logging-policy.md`](docs/failure-auth-logging-policy.md)
  - [`docs/auditor-role-policy.md`](docs/auditor-role-policy.md)
  - [`docs/audit-archival-policy.md`](docs/audit-archival-policy.md)
- Operational and implementation notes:
  - [`docs/prod-setup.md`](docs/prod-setup.md)
  - Bootstrap implementation notes:
  - [`docs/STEP_1.md`](docs/STEP_1.md)
  - [`docs/STEP_2_REALM_Config.md`](docs/STEP_2_REALM_Config.md)
  - [`docs/Step_3_custom-group-attr-mapper_andCLAIMS.md`](docs/Step_3_custom-group-attr-mapper_andCLAIMS.md)
  - [`docs/Step_4_PhoneSMSOTP.md`](docs/Step_4_PhoneSMSOTP.md)
  - [`docs/Step_5_Account_expiry.md`](docs/Step_5_Account_expiry.md)
  - [`docs/Step_6_org_default_Roles.md`](docs/Step_6_org_default_Roles.md)
  - [`docs/Step_7_per_client_admin.md`](docs/Step_7_per_client_admin.md)
  - [`docs/Step_8_auditor_role.md`](docs/Step_8_auditor_role.md)
  - [`docs/Step_9_audit_archival.md`](docs/Step_9_audit_archival.md)

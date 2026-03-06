# Implementation Note: Step 7 Delegated Client Administration

Step 7 extends delegated client administration by introducing the AppRoles-based `delegated-client-admin-base` model.

## Automation entrypoint

Step 7 runs through:

- `step7-init` in `docker-compose.yml`
- `scripts/step7_approles_bootstrap.sh`
- `step7-fgap-init` in `docker-compose.yml`
- `scripts/step7_fgap_api_setup.py`

It runs after Step 6 and Step 6 FGAP setup complete.

## What Step 7 does

Step 7 provisions:

- the `AppRoles` parent group
- the realm role `delegated-client-admin-base`
- FGAP permissions needed for delegated client admin group and membership operations

At runtime, the delegated admin guard SPI then uses `CLIENT_CREATE` events to:

1. create `AppRoles/{clientId}`
2. add the creator as a direct member
3. grant `delegated-client-admin-base` to that creator

This makes the creator the delegated client admin for that client.

## Group model

```text
AppRoles/
  └── {clientId}/
        ├── [direct members = delegated client admins]
        └── {role-subgroup}/
```

Rules:

- `AppRoles` is created once by Step 7 bootstrap
- `AppRoles/{clientId}` is created automatically when a client-manager creates a client
- direct members of `AppRoles/{clientId}` are delegated client admins for that client
- child subgroups under `AppRoles/{clientId}` are used for end-user role grouping

## Current permission model

### `client-manager`

`client-manager` remains the role that can create clients and broadly manage non-system clients.

### `delegated-client-admin-base`

This role is used for delegated client admin capabilities and is combined with direct AppRoles membership checks.

Current Step 7 FGAP grants:

- Groups: `manage`, `manage-membership`, `view`, `view-members`
- Users: `view`, `manage-group-membership`

Per-client isolation is not done by FGAP resource scoping. It is enforced by the delegated admin guard filter using direct AppRoles membership.

## Current precedence rule

If a user only has delegated client admin ownership, they are limited to owned client IDs.

If a user is both `client-manager` and a delegated client admin, current behavior allows the broader `client-manager` client-management path to apply for non-system clients. The stricter ownership restriction applies to pure delegated client admins, not mixed-role users.

This matches the current filter and tests.

## Runtime behavior

- Marker file: `/opt/keycloak/data/.step7-init-done`
- FGAP marker file: `/opt/keycloak/data/.step7-fgap-init-done`
- Force reruns:
  - `STEP7_FORCE=true`
  - `STEP7_FGAP_FORCE=true`

## Common commands

Rerun Step 7:

```bash
make force-step7
docker compose -f docker-compose.yml -f docker-compose.override.yml run --rm -e STEP7_FGAP_FORCE=true step7-fgap-init
```

Run the delegated client admin test suite:

```bash
make test-step7
```

## Verification

After Step 7, verify:

- `AppRoles` exists
- creating a client auto-creates `AppRoles/{clientId}`
- the creator becomes a direct member of that group
- the creator receives `delegated-client-admin-base`
- delegated client admins can manage owned AppRoles subgroups
- delegated client admins cannot mutate system clients

## Related docs

- [`delegated-client-admin-policy.md`](delegated-client-admin-policy.md)
- [`Step_6_org_default_Roles.md`](Step_6_org_default_Roles.md)

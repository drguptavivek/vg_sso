# Implementation Note: Step 6 Client Manager Role

Step 6 sets up the delegated `client-manager` role used for client onboarding and non-system client administration.

## Automation entrypoint

Step 6 runs through:

- `step6-init` in `docker-compose.yml`
- `scripts/step6_client_admin_setup.sh`
- `step6-fgap-init` in `docker-compose.yml`
- `scripts/step6_fgap_api_setup.py`

It runs after Step 5 completes.

## What Step 6 does

### Step 6 base role bootstrap

`scripts/step6_client_admin_setup.sh` ensures the realm role `client-manager` exists and adds these `realm-management` composites:

- `view-clients`
- `query-clients`
- `create-client`
- `manage-clients`
- `view-users`
- `query-users`

### Step 6 FGAP setup

`scripts/step6_fgap_api_setup.py` then configures FGAP v2 permissions for the role, including:

- global client manage/view access
- explicit deny for system clients
- user-directory view access
- delegated-admin-guard event listener registration

The resulting design allows `client-manager` to create and manage non-system clients while relying on the delegated admin guard SPI to block unsafe paths such as:

- client delete
- system client mutation
- client-scope mutation

## Runtime behavior

- Marker file: `/opt/keycloak/data/.step6-init-done`
- FGAP marker file: `/opt/keycloak/data/.step6-fgap-init-done`
- Force reruns:
  - `STEP6_FORCE=true`
  - `STEP6_FGAP_FORCE=true`

## Common commands

Run the full stack:

```bash
make up
```

Rerun Step 6:

```bash
make force-step6
make force-step7-fgap
```

Run the Step 6 test suite:

```bash
make test-step6
```

## Scope boundary

Step 6 is the `client-manager` baseline only.

Delegated client admin behavior based on `AppRoles/{clientId}` membership is a Step 7 concern and is documented separately in [`Step_7_per_client_admin.md`](Step_7_per_client_admin.md).

## Verification

After Step 6, verify:

- `client-manager` exists
- expected `realm-management` composites are present
- system client mutations are denied
- client delete is denied for delegated users
- non-system client create/update works for `client-manager`

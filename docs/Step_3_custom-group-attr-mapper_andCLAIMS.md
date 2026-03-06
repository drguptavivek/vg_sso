# Implementation Note: Step 3 Claims and Client Scopes

Step 3 provisions the token-shaping layer for this realm. It creates the client scopes and protocol mappers that control which identity data appears in issued tokens.

## Automation entrypoint

Step 3 runs through:

- `step3-init` in `docker-compose.yml`
- `scripts/step3_claims_config_docker.sh`

It runs after Step 2 and Step 2 FGAP setup complete.

## What Step 3 does

Step 3 currently ensures these scopes exist:

- `org-minimal`
- `detail-profile`

It then provisions protocol mappers on those scopes.

### `org-minimal`

Current default scope contents:

- `group_details` via `oidc-group-attributes-mapper`
- `employment_type`
- `preferred_username`
- `account_expiry`

`org-minimal` is also added to the realm default default-client-scopes set.

### `detail-profile`

Current scope contents:

- `phone_number`
- `employment_type`
- `designation`
- `last_date`
- `posts`
- `given_name`
- `family_name`
- `email`

The `remarks` mapper is explicitly removed if present.

## Why this exists

The repo needs a split between:

- a small default claim set suitable for most clients
- a richer opt-in scope for clients that need extra profile detail

This avoids pushing all profile attributes into every token by default.

## Implementation details

The scope and mapper behavior is implemented directly in [`scripts/step3_claims_config_docker.sh`](../scripts/step3_claims_config_docker.sh).

Provider packaging for custom mappers is handled by the Docker image build:

- host builds produce `custom-*/target/*.jar`
- the `Dockerfile` copies those jars into `/opt/keycloak/providers/`
- Step 3 itself configures the realm objects, not the Java packaging

## Runtime behavior

- Marker file: `/opt/keycloak/data/.step3-init-done`
- Force rerun: `STEP3_FORCE=true`

## Common commands

Run the full stack:

```bash
make up
```

Rerun Step 3 only:

```bash
make force-step3
```

Inspect Step 3 logs:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml logs --tail=200 step3-init
```

## Verification

Use the live-config tests or inspect the scope definitions with `kcadm`:

```bash
./kcadm.sh get client-scopes -r "$KC_NEW_REALM_NAME" --config .kcadm.config
```

Also verify:

- `org-minimal` exists and is a default scope
- `detail-profile` exists
- `group_details` and `account_expiry` are present on `org-minimal`
- `remarks` is absent from `detail-profile`

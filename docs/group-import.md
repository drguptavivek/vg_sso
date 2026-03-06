# Group Import

This note explains how organizational groups are imported into the target realm during bootstrap.

## Purpose

The repository supports importing a predefined group hierarchy and group attributes so the realm starts with an organization-ready structure instead of an empty group tree.

This is part of the Step 2 realm-configuration flow.

## Runtime entrypoint

Group import is performed by:

```bash
./scripts/step2_realm_config_docker.sh
```

Within the Docker workflow, this runs through the `step2-init` container.

## Source files

The repository includes source data and helper material under `older_sso/`:

- `older_sso/groups_tree.json`
- `older_sso/groups_flat.json`
- `older_sso/groups_expected.tsv`
- `older_sso/groups.py`

At runtime, Step 2 resolves the group tree file from:

1. `/workspace/.local/groups/groups_tree.json`
2. `/opt/keycloak/import/groups_tree.json`

That lets local environments override the default import payload without changing committed repository files.

## How import works

When the group tree file is present, Step 2:

1. logs into the target realm with the configured realm admin
2. builds a partial-import payload
3. imports the `groups` tree with overwrite behavior
4. continues the rest of the realm baseline setup

If no group tree file is found, the script logs a warning and skips group import instead of failing the whole step.

## Related configuration

Group import sits alongside other Step 2 baseline work, including:

- realm security settings
- required actions
- SMTP configuration
- user profile schema
- `user-manager` role setup
- FGAP-related permissions for delegated user management

## Local override workflow

If you want to test a different group tree locally:

1. create `.local/groups/groups_tree.json`
2. place the desired group hierarchy JSON there
3. rerun Step 2

Example:

```bash
make force-step2
```

## Notes

- The import is designed as bootstrap automation, not as a general-purpose sync engine.
- Group data generation and legacy helper material remain under `older_sso/`.
- For the broader Step 2 configuration context, see [`STEP_2_REALM_Config.md`](STEP_2_REALM_Config.md).

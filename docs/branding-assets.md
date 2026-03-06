# Branding Assets

This note explains how local branding assets are applied in this repository without changing the underlying theme structure.

## Purpose

The repository ships with default assets under `assets/`, while allowing local overrides from `.local/brand-assets/`.

This keeps the committed theme structure stable while making it easy to apply environment-specific logos, icons, and backgrounds during development or deployment preparation.

## Script

Use:

```bash
./scripts/apply_local_brand_assets.sh
```

This script is also invoked by the main local workflows such as `make up` and `make dev-up`.

## Source precedence

For each known asset key, the script resolves files in this order:

1. `.local/brand-assets/<file>`
2. `assets/<file>`

If the asset is not found in either location, that asset is skipped.

## Supported asset keys

The script currently knows how to resolve and copy:

- `background.png`
- `green_logo.png`
- `logo.png`
- `logo.svg`
- `favicon.ico`
- `master_realm_logo.png`

## Where assets are applied

The script copies resolved files into the checked-in Keycloak theme directories for:

- login themes
- account themes
- admin themes
- both realm and master variants where applicable

In practice, this updates files under:

- `theme/vg/`
- `theme/vg-master/`
- `theme/admin-vg-custom/`

## Typical local workflow

1. Put override files in `.local/brand-assets/`.
2. Run `./scripts/apply_local_brand_assets.sh` or `make up`.
3. Start or restart the dev stack.
4. Verify the updated branding in the login, account, and admin UIs.

## Notes

- `master_realm_logo.png` is currently treated as a source-only asset and is not copied into a theme target by the helper script.
- This workflow handles asset replacement only. Textual branding inside docs, scripts, or theme templates is tracked separately.

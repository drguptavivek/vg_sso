# Implementation Note: Step 4 Phone OTP Flow

Step 4 provisions the SMS OTP browser flow and the supporting admin-helper integration for OTP operations.

## Automation entrypoint

Step 4 runs through:

- `step4-init` in `docker-compose.yml`
- `scripts/step4_otp_config_docker.sh`

It runs after Step 3 completes.

## What Step 4 does

Step 4 creates a fresh browser flow named `browser-PhoneOTP` by copying the built-in browser flow and then modifying it deterministically.

Current intended order inside the forms subflow:

1. `auth-username-password-form`
2. `phone-otp-authenticator`
3. `Browser - Conditional 2FA`

Inside `Browser - Conditional 2FA`, the current script sets:

- `conditional-user-configured` -> `REQUIRED`
- `conditional-credential` -> `REQUIRED`
- `auth-otp-form` -> `ALTERNATIVE`
- `webauthn-authenticator` -> `DISABLED`
- `auth-recovery-authn-code-form` -> `DISABLED`

Step 4 also:

- configures the custom authenticator execution
- binds `browser-PhoneOTP` as the active browser flow
- sets `adminTheme=admin-vg-custom`
- enables Phone OTP admin helper entry points in the admin theme

## OTP configuration seeded by bootstrap

The script seeds an authenticator config with these defaults:

- primary endpoint: `https://smsapplication.vg.edu/services/api/v1/sms/single`
- token header: `X-OTP-Token`
- length: `6`
- ttl: `300`
- max attempts: `5`
- retry max: `2`
- retry backoff: `500`
- message template: `OTP For VG SSO Verification is: {{otp}}`

The seeded bearer value is a placeholder and should be updated appropriately for the target environment.

## Scope of Step 4

Current Step 4 is about the browser flow only.

It does not currently provision a dedicated SMS OTP direct-grant flow in the bootstrap scripts.

## User login workflow

After onboarding is complete, the intended browser login path is:

1. username and password
2. account expiry check
3. SMS OTP when `phone_verified != true`
4. TOTP or recovery code when the user has an OTP credential configured

TOTP and recovery-code enrollment are not provisioned by Step 4. Those are handled through required actions during onboarding and, if enabled by default, during later login catch-up for users who have not enrolled yet.

Important:
- Step 4 owns the browser login flow only.
- Step 10 owns the onboarding email flow that sends users into email verification, password setup, TOTP setup, and recovery-code generation.

## What Step 4 creates

The bootstrap script [`scripts/step4_otp_config_docker.sh`](/home/ssopublic/vg_sso/scripts/step4_otp_config_docker.sh) creates and binds the custom browser flow:

- `browser-PhoneOTP`

It does this by copying the built-in `browser` flow, inserting `phone-otp-authenticator`, and rebinding the realm `browserFlow` to `browser-PhoneOTP`.

Important:
- `browser-PhoneOTP-with-2FA` is not created by Step 4 automation in the current repo.
- If `browser-PhoneOTP-with-2FA` exists in a live realm, it was created or modified manually after bootstrap.
- Any live changes to that flow should be documented separately or automated explicitly if they need to be reproducible.

## Admin helper UI behavior

Current expected admin sidebar actions are:

1. `Phone OTP Status`
2. `Phone OTP Test`
3. `Account Expiry`

Accordingly, the active admin theme scripts use the `*.v2.js` helper launchers, which navigate to:

- `Phone OTP Test` -> `/realms/{realm}/phone-otp-admin/ui`
- `Phone OTP Status` -> `/realms/{realm}/phone-otp-admin/pending-ui`
- `Account Expiry` -> `/realms/{realm}/account-expiry-admin/ui`

These helper pages run as separate pages under the main Keycloak origin instead of relying on in-console modal `fetch()` calls. That keeps the helper UI behavior consistent when admin endpoints are IP-restricted at nginx and avoids cross-origin/session issues.

## Runtime behavior

- Marker file: `/opt/keycloak/data/.step4-init-done`
- Force rerun: `STEP4_FORCE=true`

## Common commands

Run the full stack:

```bash
make up
```

Rerun only Step 4:

```bash
make force-step4
```

Inspect Step 4 logs:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml logs --tail=200 step4-init
```

## Related docs

- [`sms-otp-policy.md`](sms-otp-policy.md)
- [`branding-assets.md`](branding-assets.md)

## Verification

After Step 4, verify:

- `browserFlow` for the realm is `browser-PhoneOTP`
- `phone-otp-authenticator` exists in the forms subflow
- `adminTheme` is `admin-vg-custom`
- the admin sidebar shows `Phone OTP Status`, `Phone OTP Test`, and `Account Expiry`
- each helper action opens cleanly in the same tab
- `Phone OTP Status` loads pending verification data
- `Phone OTP Test` loads the OTP test helper page

# Implementation Note: Step 4 Phone OTP Flow

Step 4 provisions the SMS OTP browser flow and the supporting admin-theme integration for OTP operations.

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
- the Phone OTP admin menu is visible in the admin console

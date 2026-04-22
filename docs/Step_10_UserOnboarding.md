# Step 10 User Onboarding

Step 10 adds the runtime behavior for admin-created user onboarding.

It does two things:

- enables forgot-password recovery on the target realm
- registers the `user-onboarding-email` event listener

The listener reacts to admin `USER CREATE` events and sends Keycloak execute-actions email automatically.

## User workflow

For a newly admin-created user, the intended flow is:

1. admin creates the user with a valid email address
2. Keycloak sends onboarding email automatically
3. user clicks the email link
4. user completes required actions in this order:
   - `VERIFY_EMAIL`
   - `UPDATE_PASSWORD`
   - `CONFIGURE_TOTP`
   - `CONFIGURE_RECOVERY_AUTHN_CODES`
5. user returns to the normal login screen
6. user logs in with username and password
7. if `phone_verified != true`, user must complete SMS OTP
8. if the user has an OTP credential configured, login then requires:
   - authenticator-app TOTP, or
   - a recovery code

This means onboarding handles enrollment and setup, while the browser login flow handles verification and ongoing MFA use.

## Runtime behavior

- Provider id: `user-onboarding-email`
- Marker attribute on successful send: `onboarding_email_sent_at`
- Token lifespan default: 12 hours
- Onboarding email currently sends synchronously inside the admin create request

## Operational notes

- The onboarding link uses the normal Keycloak public host.
- Forgot-password remains available if the onboarding email expires or is lost.
- Existing users are not backfilled automatically; use `scripts/send_onboarding_email.sh` if needed.

## Current live flow dependency

The onboarding work in Step 10 assumes the realm login path will enforce:

1. username/password
2. SMS OTP when `phone_verified != true`
3. TOTP or recovery code when the user has an OTP credential configured

In the current repo:

- Step 4 bootstrap creates `browser-PhoneOTP`
- the live flow `browser-PhoneOTP-with-2FA` is a manual or live-customized variant

Current live `browser-PhoneOTP-with-2FA` behavior:

- Top level:
  - `Cookie` -> `ALTERNATIVE`
  - organization branch -> `DISABLED`
  - forms branch -> `ALTERNATIVE`
- Inside the forms branch:
  - `Username Password Form` -> `REQUIRED`
  - `Account Expiry Check (Custom)` -> `REQUIRED`
  - `Phone OTP Authenticator (Custom)` -> `REQUIRED`
  - `Browser - Conditional 2FA` -> `CONDITIONAL`
- Inside `Browser - Conditional 2FA`:
  - `Condition - user configured` -> `REQUIRED`
  - `Condition - credential` -> `REQUIRED`
  - `OTP Form` -> `ALTERNATIVE`
  - `Recovery Authentication Code Form` -> `ALTERNATIVE`
  - `WebAuthn Authenticator` -> `DISABLED`

Practical meaning:

- username and password are mandatory
- account expiry validation is mandatory
- SMS OTP is mandatory in the browser flow
- TOTP or recovery code becomes mandatory only when the user actually has an OTP credential configured
- WebAuthn is not active in this flow

So at present:

- Step 10 owns the onboarding email workflow
- Step 4 owns the bootstrap SMS OTP flow
- `browser-PhoneOTP-with-2FA` is not yet codified in bootstrap automation and should be treated as a documented live customization unless it is later moved into code

## Bootstrap

- Marker file: `/opt/keycloak/data/.step10-init-done`
- Force rerun: `STEP10_FORCE=true`

## Common commands

Rerun Step 10 only:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml \
  run --rm -e STEP10_FORCE=true step10-init
```

Inspect Step 10 logs:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml \
  logs --tail=200 step10-init
```

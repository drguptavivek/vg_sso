# Implementation Note: Step 5 Account Expiry

Step 5 adds timezone-aware account expiry enforcement to the browser login flow and prepares the realm for expiry administration.

## Automation entrypoint

Step 5 runs through:

- `step5-init` in `docker-compose.yml`
- `scripts/step5_expiry_config_docker.sh`

It runs after Step 4 completes.

## What Step 5 does

Step 5 currently:

1. injects `account-expiry-check-authenticator` into the `browser-PhoneOTP forms` subflow
2. applies deterministic execution ordering
3. sets the realm attribute `account_expiry_default_timezone`
4. updates the user profile schema with:
   - `account_expiry_date`
   - `account_expiry_timezone`
5. backfills missing expiry values for existing users

Current forms ordering after Step 5:

1. `auth-username-password-form`
2. `account-expiry-check-authenticator`
3. `phone-otp-authenticator`
4. `Browser - Conditional 2FA`

## Timezone and profile behavior

Step 5 uses the SPI timezone endpoint to populate the timezone options for the profile field and stores a realm-level default timezone when user-level timezone is absent.

Current default:

- `STEP5_DEFAULT_EXPIRY_TIMEZONE=Asia/Kolkata`

Current backfill rule for users without an explicit expiry:

- `1 year + pseudo-random 2-8 weeks`

## Claim relationship

The `account_expiry` token claim is provisioned in Step 3 by [`scripts/step3_claims_config_docker.sh`](../scripts/step3_claims_config_docker.sh).

Step 5 is responsible for the enforcement flow and the profile/timezone data model.

## Runtime behavior

- Marker file: `/opt/keycloak/data/step5_expiry_configured.marker`
- Force rerun: `STEP5_FORCE=true`
- Reapply-if-needed safeguard: if the marker exists but the expiry schema is missing, Step 5 reapplies

## Common commands

Run the full stack:

```bash
make up
```

Rerun only Step 5:

```bash
make force-step5
```

Inspect Step 5 logs:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml logs --tail=200 step5-init
```

## Related docs

- [`account-expiry-policy.md`](account-expiry-policy.md)
- [`Step_3_custom-group-attr-mapper_andCLAIMS.md`](Step_3_custom-group-attr-mapper_andCLAIMS.md)

## Verification

After Step 5, verify:

- the expiry authenticator is present in the browser forms subflow
- the forms order is username/password -> expiry -> phone OTP -> conditional 2FA
- the user profile contains both expiry attributes
- the realm has `account_expiry_default_timezone`
- the account expiry admin endpoints return timezone and expiration data

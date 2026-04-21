# Custom Phone OTP Authenticator

Dummy-first Keycloak authenticator for one-time phone verification.

## What it does

- If `user.phone_verified=true`, skips OTP step.
- Otherwise generates OTP, stores hash in auth-session notes, and sends OTP payload to configured HTTP endpoint.
- Challenges user with OTP form (`login-otp.ftl`) and verifies entered code.
- On success sets:
  - `phone_verified=true`
  - `phone_verified_at=<timestamp>`

## Endpoint payload (dummy contract)

```json
{
  "mobile": "9899378106",
  "message": "OTP For VG SSO Verification is: 123456"
}
```

## Config keys

- `otp.endpoint.primary`
- `otp.endpoint.backup`
- `otp.auth.bearer`
- `otp.request.token.header` (default `X-OTP-Token`)
- `otp.sms.message.template` (default `OTP For VG SSO Verification is: {{otp}}`)
- `otp.sms.mobile.field` (default `mobile`)
- `otp.sms.message.field` (default `message`)
- `otp.length` (default `6`)
- `otp.ttl.seconds` (default `300`)
- `otp.max.attempts` (default `5`)
- `otp.retry.max` (default `2`)
- `otp.retry.backoff.ms` (default `500`)

## Build

```bash
cd /Users/vivekgupta/workspace/vg_sso/custom-phone-otp-authenticator
mvn -q -DskipTests package
```

## Deploy

```bash
cp /Users/vivekgupta/workspace/vg_sso/custom-phone-otp-authenticator/target/custom-phone-otp-authenticator-1.0.0.jar /Users/vivekgupta/workspace/vg_sso/keycloak-26.5.3/providers/
cd /Users/vivekgupta/workspace/vg_sso
./kc.sh build
./kc.sh start-dev --features="admin-fine-grained-authz:v2" --spi-theme-cache-themes=false --spi-theme-cache-templates=false --spi-theme-static-max-age=-1
```

## Logging

Logs include `userId` and `username`, but never print OTP value.

## Test endpoint (admin helper)

This module also exposes:

`POST /realms/{realm}/phone-otp-admin/test`

Generate a short-lived test token (requires logged-in realm admin with `manage-realm`):

`POST /realms/{realm}/phone-otp-admin/token`

Quick UI with Test OTP button:

`GET /realms/{realm}/phone-otp-admin/ui`

Pending verification status UI:

`GET /realms/{realm}/phone-otp-admin/pending-ui`

Pending verification JSON feed:

`GET /realms/{realm}/phone-otp-admin/pending-users`

Access probe for admin theme integration:

`GET /realms/{realm}/phone-otp-admin/access`

## Split-host admin note

In deployments where:

- login/session traffic uses a public host such as `sso1.aiims.edu.in`
- admin console traffic uses a separate host such as `ssoadmin.aiims.edu.in`

the old modal-based admin-theme helpers are not reliable, because browser cookies are scoped to the public/login host. For that reason the current admin theme uses `phone-otp-menu.v2.js`, which navigates to helper pages on the public realm origin instead of making modal `fetch()` calls from the admin host.

Current expected admin actions are:

1. `Phone OTP Status`
2. `Phone OTP Test`

`Phone OTP Status` opens the pending verification page, and `Phone OTP Test` opens the OTP test page.

CLI flow:

```bash
TOKEN=$(curl -s --location 'http://localhost:8080/realms/org-new-delhi/phone-otp-admin/token' --header 'Authorization: Bearer YOUR_REALM_ADMIN_ACCESS_TOKEN' | jq -r '.token')
```

```bash
curl --location 'http://localhost:8080/realms/org-new-delhi/phone-otp-admin/test' \
  --header 'Content-Type: application/json' \
  --header "X-Phone-Otp-Test-Token: $TOKEN" \
  --data '{
    "primaryEndpoint":"https://smsapplication.vg.edu/services/api/v1/sms/single",
    "backupEndpoint":"",
    "bearer":"YOUR_BEARER_TOKEN",
    "tokenHeader":"X-OTP-Token",
    "mobileField":"mobile",
    "messageField":"message",
    "mobile":"9899378106",
    "message":"OTP For VG SSO Verification is: 123456",
    "retryMax":2,
    "retryBackoffMs":500
  }'
```

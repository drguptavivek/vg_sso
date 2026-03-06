# SMS OTP Authentication Policy

**Realm:** `org-new-delhi`
**Status:** Active

---

## 1. Purpose

Browser SSO logins require a one-time password (OTP) delivered via SMS to the user's registered mobile number. This provides a second authentication factor using the phone number already verified during registration. The SMS OTP step sits immediately after username/password validation in the browser flow.

---

## 2. Authentication Flow Position

### Browser flow (`browser-PhoneOTP`)

```
auth-cookie                        (ALTERNATIVE)
auth-spnego                        (ALTERNATIVE)
identity-provider-redirector       (ALTERNATIVE)
Organization sub-flow              (CONDITIONAL)
forms sub-flow:
  ├── auth-username-password-form  (REQUIRED)  ← priority 10
  ├── phone-otp-authenticator      (REQUIRED)  ← priority 15  ← SMS OTP
  └── Browser - Conditional 2FA   (CONDITIONAL) ← priority 20
        ├── conditional-user-configured
        ├── conditional-credential
        ├── auth-otp-form          (REQUIRED)
        └── webauthn-authenticator
```

The SMS OTP step runs **after** password validation and **before** TOTP/WebAuthn 2FA. A user who has not verified their phone number cannot complete login.

### Direct grant status

The current bootstrap scripts do not provision a dedicated direct-grant SMS OTP flow. If API logins need a second factor, that flow should be designed and documented separately before rollout.

---

## 3. OTP Configuration

| Parameter | Value |
|---|---|
| OTP length | 6 digits |
| TTL | 300 seconds (5 minutes) |
| Max verification attempts | 5 |
| Max send retries | 2 |
| Retry backoff | 500 ms |
| SMS message template | `OTP For VG SSO Verification is: {{otp}}` |

### SMS Gateway

| Setting | Value |
|---|---|
| Primary endpoint | `https://smsapplication.vg.edu/services/api/v1/sms/single` |
| Auth header | `X-OTP-Token: <bearer>` |
| Mobile field in payload | `mobile` |
| Message field in payload | `message` |

The bearer token for the SMS gateway is stored as an authenticator config secret in Keycloak (set during `step4-init` bootstrap). It is **not** stored in `.env` or source control.

---

## 4. Provider SPI

**Module:** `custom-phone-otp-authenticator`
**Provider ID:** `phone-otp-authenticator`
**SPI type:** `authenticator`

The provider ships two extensions in the same JAR:

| Class | Role |
|---|---|
| `PhoneOtpAuthenticator` | Core authentication logic — sends OTP, validates submission |
| `PhoneOtpAdminResourceProvider` | REST endpoints for admin operations (test, pending users, token) |

### Admin REST endpoints

| Method | Path | Access |
|---|---|---|
| `GET` | `/realms/{realm}/phone-otp-admin/token` | `manage-realm` or `user-manager` |
| `POST` | `/realms/{realm}/phone-otp-admin/test` | `manage-realm` or `user-manager` |
| `GET` | `/realms/{realm}/phone-otp-admin/pending-users` | `manage-realm` or `user-manager` |
| `GET` | `/realms/{realm}/phone-otp-admin/access` | Any authenticated session |

---

## 5. Pending Phone Verification Dashboard

Users who have registered but have not yet completed SMS OTP verification appear in the pending dashboard. Accessible via the "Pending Phone OTP" menu in the Keycloak admin console (requires custom admin theme `admin-vg-custom`).

**API:**

```bash
curl -s "http://localhost:8080/realms/org-new-delhi/phone-otp-admin/pending-users?first=0&max=25&q=" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  | jq '{totalUsers, verifiedUsers, pendingUsers, count}'
```

**Dashboard fields:** username, mobile number, email, verification status, link to admin console user page.

---

## 6. Test SMS (Admin Operation)

Send a test SMS to verify the gateway is reachable without going through the full login flow:

```bash
# Step 1: generate a short-lived test token
TEST_TOKEN=$(
  curl -s http://localhost:8080/realms/org-new-delhi/phone-otp-admin/token \
    -H "Authorization: Bearer $REALM_ADMIN_TOKEN" | jq -r '.token'
)

# Step 2: send test SMS
curl -s http://localhost:8080/realms/org-new-delhi/phone-otp-admin/test \
  -H "Content-Type: application/json" \
  -H "X-Phone-Otp-Test-Token: $TEST_TOKEN" \
  -d '{
    "primaryEndpoint": "https://smsapplication.vg.edu/services/api/v1/sms/single",
    "bearer": "REPLACE_BEARER_TOKEN",
    "tokenHeader": "X-OTP-Token",
    "mobileField": "mobile",
    "messageField": "message",
    "mobile": "9XXXXXXXXX",
    "message": "OTP For VG SSO Verification is: 123456",
    "retryMax": 2,
    "retryBackoffMs": 500
  }' | jq
```

---

## 7. Rollback

To revert to the built-in browser flow (disabling SMS OTP):

```bash
./kcadm.sh update realms/org-new-delhi \
  -s browserFlow=browser \
  --config .kcadm.realm.config
```

To re-enable:

```bash
./kcadm.sh update realms/org-new-delhi \
  -s browserFlow=browser-PhoneOTP \
  --config .kcadm.realm.config
```

---

## 8. Operations

### 8.1 Bootstrap (step4-init)

The phone OTP flow is set up by `scripts/step4_otp_config_docker.sh` running as the `step4-init` container. It is idempotent.

Force re-run:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml \
  run --rm -e STEP4_FORCE=true step4-init
```

### 8.2 Rebuild provider after code change

```bash
cd custom-phone-otp-authenticator && mvn -q -DskipTests package
docker compose -f docker-compose.yml -f docker-compose.override.yml build keycloak
docker compose -f docker-compose.yml -f docker-compose.override.yml up -d keycloak
```

### 8.3 Verify active browser flow

```bash
docker exec vg-keycloak /opt/keycloak/bin/kcadm.sh get realms/org-new-delhi \
  --fields browserFlow --config /tmp/kcadm.config
# Expected: "browserFlow": "browser-PhoneOTP"
```

### 8.4 Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Pending users dashboard shows 0/0/0 | Stale provider JAR or stale `kc.sh build` | Rebuild provider JAR, rebuild Keycloak image, restart |
| "Open" link in pending users goes to `console/#` only | Stale theme JS | Copy latest `phone-otp-menu.js` to themes dir, hard-refresh browser |
| OTP SMS not delivered | Gateway bearer token expired or wrong | Update authenticator config bearer in admin console |

---

## 9. Source Files

| File | Role |
|---|---|
| `custom-phone-otp-authenticator/` | Provider SPI Maven module |
| `scripts/step4_otp_config_docker.sh` | Flow setup bootstrap (idempotent) |
| `theme/admin-vg-custom/` | Custom admin theme with Phone OTP menu |
| `docker-compose.yml` → `step4-init` | Bootstrap service |

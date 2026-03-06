# Account Expiry Policy

**Realm:** `org-new-delhi`
**Status:** Active

---

## 1. Purpose

Staff accounts in the VG SSO are time-limited. An expiry date is set on each account when it is created or renewed. When the expiry date passes, the account is blocked from the browser login flow that this repo provisions automatically. Accounts approaching expiry generate a warning claim in the ID token for use by application UIs.

---

## 2. Expiry Data Model

Two user profile attributes store the expiry configuration:

| Attribute | Format | Example | Edit access |
|---|---|---|---|
| `account_expiry_date` | `YYYY-MM-DD` (local date) | `2026-06-30` | Admin only |
| `account_expiry_timezone` | IANA timezone name | `Asia/Kolkata` | Admin only |

The **effective expiry instant** is computed as midnight at the start of `account_expiry_date` in `account_expiry_timezone`, converted to UTC. A realm-level default timezone (`account_expiry_default_timezone = Asia/Kolkata`) is used when a user's timezone attribute is empty.

---

## 3. Enforcement

### 3.1 Login blocking

The `account-expiry-check-authenticator` is inserted into the browser authentication flow as a **REQUIRED** step:

#### Browser flow (`browser-PhoneOTP`) — position in forms sub-flow

```
auth-username-password-form  (priority 10)  ← password first
account-expiry-check         (priority 12)  ← expiry check second
phone-otp-authenticator      (priority 15)  ← SMS OTP only if account is live
Browser - Conditional 2FA   (priority 20)  ← additional 2FA only if account is live
```

The expiry check runs after the password is validated but before any 2FA. An expired account is rejected without prompting for OTP.

#### Direct grant status

The current bootstrap scripts do not provision a dedicated direct-grant expiry flow. If API logins must enforce expiry checks, that should be added as a separate documented automation step.

### 3.2 Warning window

The `account_expiry` ID token claim provides a **28-day warning window** before expiry. Applications can use this to show a non-blocking banner prompting users to contact their department coordinator to renew.

---

## 4. Token Claim (`account_expiry`)

Included in tokens issued by clients that use the `account_expiry` protocol mapper (provisioned on `org-minimal` client scope via `step3-init`).

```json
{
  "account_expiry": {
    "configured": true,
    "warning": true,
    "expired": false,
    "warningWindowDays": 28,
    "daysRemaining": 19,
    "localDate": "2026-06-30",
    "timeZone": "Asia/Kolkata",
    "expiryUtc": "2026-06-30T18:30:00Z"
  }
}
```

| Field | Meaning |
|---|---|
| `configured` | `true` if `account_expiry_date` attribute is set; `false` if no expiry configured |
| `warning` | `true` if within 28 days of expiry |
| `expired` | `true` if past expiry (login is already blocked; this is informational) |
| `daysRemaining` | Calendar days until expiry (negative if already expired) |
| `localDate` | Expiry date in the user's configured timezone |
| `timeZone` | IANA timezone used for computation |
| `expiryUtc` | Exact expiry instant in UTC ISO-8601 |

**Application guidance:**
- `expired=true`: the auth flow already blocked this login; this claim is only seen in edge cases (e.g., token cached before expiry). Treat as session invalidation signal.
- `warning=true, expired=false`: show a non-blocking reminder banner with `localDate` and `daysRemaining`.
- `configured=false`: no expiry set; no banner needed.

---

## 5. Admin Operations

### 5.1 Set expiry on a user (API)

```bash
curl -s -X PUT \
  "http://localhost:8080/realms/org-new-delhi/account-expiry-admin/users/<USER_ID>/expiry" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $REALM_ADMIN_TOKEN" \
  -d '{"localDate": "2026-12-31", "timeZone": "Asia/Kolkata"}' | jq
```

### 5.2 Set expiry on a user (kcadm)

```bash
./kcadm.sh update users/<USER_ID> -r org-new-delhi \
  -s 'attributes.account_expiry_date=["2026-12-31"]' \
  -s 'attributes.account_expiry_timezone=["Asia/Kolkata"]' \
  --config .kcadm.realm.config
```

### 5.3 Clear expiry (remove blocking)

```bash
curl -s -X PUT \
  "http://localhost:8080/realms/org-new-delhi/account-expiry-admin/users/<USER_ID>/expiry" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $REALM_ADMIN_TOKEN" \
  -d '{"clear": true}' | jq
```

### 5.4 View upcoming expirations

```bash
# Next 14 days
curl -s "http://localhost:8080/realms/org-new-delhi/account-expiry-admin/expirations?windowDays=14" \
  -H "Authorization: Bearer $REALM_ADMIN_TOKEN" | jq

# Next 28 days — for daily reminder job
curl -s "http://localhost:8080/realms/org-new-delhi/account-expiry-admin/expirations?windowDays=28" \
  -H "Authorization: Bearer $USER_MANAGER_TOKEN" \
  | jq '.upcoming[] | {username, localDate, daysRemaining, warning, expired, email, phoneNumber}'
```

### 5.5 Expiry dashboard (admin console)

The custom admin theme (`admin-vg-custom`) adds an **Account Expiry** menu item to the realm admin console left nav. The dashboard shows:

- User name, designation, email, phone number
- Expiry date (computed in UTC from the local date + timezone)
- Warning/expired status

URL: `http://localhost:8080/admin/org-new-delhi/console/`

---

## 6. Reminder Notification Guidance

Recommended daily automation job (using a `user-manager` service account):

1. Fetch expirations for the next 28 days
2. Filter: `warning=true AND expired=false`
3. Send reminder notification (email or SMS) to users with:
   - `daysRemaining <= 7` → daily reminder
   - `daysRemaining == 14` → milestone reminder
   - `daysRemaining == 28` → early warning

```python
# Pseudocode for reminder selection
for user in upcoming:
    if user['expired']:
        continue  # already blocked; login denied
    if user['daysRemaining'] in [28, 14] or user['daysRemaining'] <= 7:
        send_reminder(user)
```

---

## 7. Flow Bypass Audit

Any client with an authentication flow override can bypass the realm browser/direct-grant flows:

```bash
docker exec vg-keycloak /opt/keycloak/bin/kcadm.sh get clients \
  -r org-new-delhi --config /tmp/kcadm.config \
  | jq -r '.[] | select((.authenticationFlowBindingOverrides // {}) != {}) |
    "\(.clientId) -> \(.authenticationFlowBindingOverrides|tostring)"'
```

Any client with an override set must be explicitly reviewed to ensure the expiry check is still enforced in their custom flow.

---

## 8. Bootstrap

The account expiry SPI and authentication flows are set up by `scripts/step5_expiry_config_docker.sh` running as the `step5-init` container.

Force re-run:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml \
  run --rm -e STEP5_FORCE=true step5-init
```

User profile attributes (`account_expiry_date`, `account_expiry_timezone`) and the `account_expiry` OIDC mapper are provisioned by `step3-init` (`scripts/step3_claims_config_docker.sh`).

---

## 9. Source Files

| File | Role |
|---|---|
| `custom-account-expiry-spi/` | Provider SPI Maven module |
| `scripts/step5_expiry_config_docker.sh` | Flow + timezone bootstrap (idempotent) |
| `scripts/step3_claims_config_docker.sh` | User profile attributes + OIDC mapper |
| `docker-compose.yml` → `step5-init` | Expiry flow bootstrap service |
| `docker-compose.yml` → `step3-init` | User profile + claims bootstrap service |

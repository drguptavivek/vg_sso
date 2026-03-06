# User Manager Policy

**Realm:** `org-new-delhi`
**Status:** Active

---

## 1. Purpose

The `user-manager` role enables designated staff to create and manage SSO user accounts and assign group membership, without granting full realm-admin access. This supports delegated onboarding workflows — for example, a department coordinator who registers new staff — while keeping privileged operations (group creation, role assignment, client management) restricted to realm admins.

---

## 2. Role Definition

### `user-manager` (realm role)

A composite realm role that bundles specific `realm-management` client roles.

| Permission | Allowed |
|---|---|
| View users | ✅ (`view-users`) |
| Search / query users | ✅ (`query-users`) |
| Create users | ✅ (`manage` on Users via FGAP v2) |
| Edit user attributes | ✅ (`manage` on Users via FGAP v2) |
| Assign user to existing groups | ✅ (`manage-group-membership` on Users + `manage-membership` on Groups) |
| View groups and group members | ✅ (`view` + `view-members` on Groups) |
| Create new groups | ❌ — realm admin only |
| Delete groups | ❌ — realm admin only |
| Assign realm roles to users | ❌ — realm admin only |
| Manage client roles | ❌ — realm admin only |
| Delete users | ❌ — realm admin only (no `delete` scope granted) |
| Reset user credentials | ❌ — realm admin only |

### Composite role members (from `realm-management` client)

| Client Role | Purpose |
|---|---|
| `view-users` | Read access to user list and user detail |
| `query-users` | Search and filter users |
| `query-groups` | See group list for assignment picker |

---

## 3. Enforcement Architecture

### 3.1 Composite role (base access)

The `user-manager` realm role is created with three `realm-management` client roles as composites in `step2_realm_config_docker.sh`. This gives the bearer basic user and group read access.

### 3.2 FGAP v2 (Fine-Grained Authorization Policies v2)

Additional scoped permissions are granted via `admin-permissions` client Authorization Services (`scripts/step2_fgap_api_setup.py`):

| Resource | Scopes granted | Permission name |
|---|---|---|
| `Users` | `view`, `manage`, `manage-group-membership` | `perm-users-user-manager` |
| `Groups` | `view`, `view-members`, `manage-membership` | `perm-groups-user-manager-readonly` |

**Policy:** `policy-user-manager` (role policy, POSITIVE logic, requires `user-manager` role)

The `manage` scope on `Users` allows creating and editing user records. The absence of any `manage` scope on `Groups` at the resource level means `user-manager` cannot create or delete groups — only assign existing users to existing groups.

### 3.3 What is NOT granted

- No `delete` scope on `Users` → cannot delete accounts
- No `manage` scope on `Groups` → cannot create/rename/delete groups
- No role assignment scopes → cannot grant or revoke realm roles
- No client management scopes → cannot create or edit OAuth clients

---

## 4. Typical Use Cases

| Use Case | Allowed |
|---|---|
| Register a new staff member (create user + set attributes) | ✅ |
| Assign the new staff to their department group | ✅ |
| Set `account_expiry_date` and `account_expiry_timezone` on a user | ✅ |
| View the account expiry dashboard | ✅ (via `account-expiry-admin` endpoints with `view-users` / `manage-users` access) |
| View pending phone verification dashboard | ✅ |
| Send test OTP SMS | ✅ |
| Create a new department group | ❌ |
| Assign a user the `realm-admin` role | ❌ |
| Delete a stale account | ❌ |

---

## 5. Phone OTP Admin Access

`user-manager` users have access to the Phone OTP admin extension in the admin console:

- View **Pending Phone OTP** dashboard (users with unverified phone numbers)
- Open **Phone OTP Test** modal to send a test SMS
- Generate a short-lived test token (`/realms/{realm}/phone-otp-admin/token`)

Access check endpoint:

```bash
curl -s http://localhost:8080/realms/org-new-delhi/phone-otp-admin/access \
  -H "Authorization: Bearer $USER_MANAGER_TOKEN" | jq
```

---

## 6. Account Expiry Integration

`user-manager` users can query the expiry dashboard API:

```bash
# Upcoming expirations (next 28 days)
curl -s "http://localhost:8080/realms/org-new-delhi/account-expiry-admin/expirations?windowDays=28" \
  -H "Authorization: Bearer $USER_MANAGER_TOKEN" \
  | jq '.upcoming[] | {username, localDate, timeZone, daysRemaining, warning, expired}'
```

Recommended use: daily automation job with a dedicated `user-manager` service account to send expiry reminder notifications to users approaching their expiry date.

---

## 7. Operations

### 7.1 Grant user-manager role

```bash
./kcadm.sh add-roles -r org-new-delhi \
  --uusername <username> \
  --rolename user-manager \
  --config .kcadm.realm.config
```

### 7.2 Verify effective permissions

```bash
# Check composite client roles included in user-manager
./kcadm.sh get roles/user-manager -r org-new-delhi \
  --config .kcadm.realm.config | jq '.composites'
```

### 7.3 Bootstrap (idempotent)

The `user-manager` role and FGAP v2 permissions are created by:

- `step2-init` container → `scripts/step2_realm_config_docker.sh` (role + composites)
- `step2-fgap-init` container → `scripts/step2_fgap_api_setup.py` (FGAP v2 policies + permissions)

Both are idempotent and safe to re-run.

---

## 8. Source Files

| File | Role |
|---|---|
| `scripts/step2_realm_config_docker.sh` (line ~467) | Creates `user-manager` realm role + composite client roles |
| `scripts/step2_fgap_api_setup.py` | Creates FGAP v2 policy (`policy-user-manager`) + permissions |
| `docker-compose.yml` → `step2-init` | Runs realm config bootstrap |
| `docker-compose.yml` → `step2-fgap-init` | Runs FGAP v2 bootstrap |

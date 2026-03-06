# Delegated Client Administration Policy

**Realm:** `org-new-delhi`  
**Status:** Active (Step 6 + Step 7)

---

## 1. Purpose

This policy enables delegated client administration in Keycloak without granting full realm-admin privileges.

- `client-manager` can onboard and configure clients.
- Delegated client admins can manage only their own client context using `AppRoles/{clientId}` membership.
- Defense-in-depth is enforced by FGAP v2 plus the delegated admin guard SPI.

---

## 2. Roles

### 2.1 `client-manager` (realm role)

| Capability | Allowed |
|---|---|
| View/list clients | ✅ |
| Create clients | ✅ |
| Update non-system clients | ✅ |
| Delete any client | ❌ |
| Mutate client scopes | ❌ |
| Update system clients | ❌ |

### 2.2 `delegated-client-admin-base` (realm role + AppRoles membership model)

Assigned to client creators by `DelegatedAdminGuardEventListener` during `CLIENT_CREATE`.

| Capability | Allowed |
|---|---|
| View/list clients | ✅ |
| Update owned client(s) only | ✅ (filter-enforced) |
| Update non-owned clients | ❌ (filter-enforced) |
| Delete any client | ❌ (filter-enforced) |
| Mutate client scopes | ❌ (filter-enforced) |
| Manage groups/users for role-subgroup workflow | ✅ (FGAP v2 Step 7) |

### 2.3 Realm admin

Realm admins (`realm-admin` or `manage-realm`) are not restricted by delegated guard paths.

---

## 3. AppRoles Group Model (Step 7)

Group hierarchy:

```text
AppRoles/
  └── {clientId}/
        ├── [direct members = delegated client admins]
        └── {role-subgroup}/
```

Rules:

- `AppRoles` parent group is created by `step7-init`.
- `AppRoles/{clientId}` is created automatically on `CLIENT_CREATE`.
- Creator is added as direct member of `AppRoles/{clientId}` and granted `delegated-client-admin-base`.
- Delegated client admins create role subgroups under `AppRoles/{clientId}` and map client roles to those groups.

---

## 4. Enforcement Architecture

### 4.1 Layer 1: FGAP v2

Configured through bootstrap scripts against `admin-permissions`.

#### Step 6 (`client-manager`) permissions

| Permission | Resource | Scopes | Policy |
|---|---|---|---|
| `perm-client-manager-global` | `Clients` | `view`, `manage` | `policy-client-manager-allow` |
| `perm-client-manager-deny-system` | `Clients` | `manage` (NEGATIVE) | `policy-client-manager-deny` |
| `perm-users-client-manager-view` | `Users` | `view` | `policy-client-manager-allow` |

#### Step 7 (`delegated-client-admin-base`) permissions

| Permission | Resource | Scopes | Policy |
|---|---|---|---|
| `perm-groups-delegated-client-admin-base-manage` | `Groups` | `manage`, `manage-membership`, `view`, `view-members` | `policy-delegated-client-admin-base-allow` |
| `perm-users-delegated-client-admin-base` | `Users` | `view`, `manage-group-membership` | `policy-delegated-client-admin-base-allow` |

Notes:

- Step 7 FGAP is currently role-scoped (`delegated-client-admin-base`), not per-group resource scoped.
- Per-client mutation isolation is enforced by `DelegatedAdminGuardFilter` using direct `AppRoles/{clientId}` membership.

### 4.2 Layer 2: Delegated Admin Guard SPI

The SPI has two components:

- `DelegatedAdminGuardEventListener`
  - On `CLIENT_CREATE` by `client-manager`:
    - create `AppRoles/{clientId}` if missing
    - add creator as direct member
    - grant `delegated-client-admin-base`
  - On blocked operations (`CLIENT DELETE`, `CLIENT_SCOPE` mutations): marks tx rollback as belt-and-suspenders.

- `DelegatedAdminGuardFilter`
  - Authenticates actor and derives:
    - `isClientManager`
    - delegated client admin ownership from direct AppRoles child memberships
  - Pure delegated client admins are ownership-restricted to their assigned clients.
  - If user is both `client-manager` and a delegated client admin, the broader `client-manager` path still applies for non-system client edits.
  - Blocks:
    - `DELETE /admin/realms/{realm}/clients/{uuid}`
    - mutate operations on system clients
    - mutate operations on `/admin/realms/{realm}/client-scopes...`
    - delegated client admin mutation attempts on non-owned client IDs

---

## 5. System Clients

Delegated users are blocked from mutating these client IDs:

- `broker`
- `realm-management`
- `account`
- `account-console`
- `security-admin-console`
- `admin-cli`
- `admin-permissions`

`admin-permissions` note:

- This client is Keycloak-managed FGAP infrastructure.
- It is provisioned by Keycloak when realm `adminPermissionsEnabled=true` is enabled (Step 2/Step 6 bootstrap), not by custom SPI code.
- Delegated mutation access to this client remains denied by policy.

---

## 6. Validation Status

Latest verified Step 7 run (2026-03-05):

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml --profile test run --rm step7-test
```

Result: validated against the current Step 7 test suite in `scripts/test_step7_pca.py` (legacy filename retained; exact test count may change as coverage evolves).

Skip detail:

- `test_11` can skip when token issuance returns `invalid_grant: Account is not fully set up` based on realm required-action/profile state.

---

## 7. Current Security Notes

- `AppRoles` parent and `AppRoles/{clientId}` roots are now protected from delegated delete/mutate paths in `DelegatedAdminGuardFilter`.
- Delegated users can create/delete descendants only inside their owned `AppRoles/{clientId}` subtree.
- `delegated-client-admin-base` remains broad by design; direct manual assignment of `delegated-client-admin-base` should stay tightly controlled.

---

## 8. Operational Commands

Run delegated admin tests:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml --profile test run --rm step6-test
docker compose -f docker-compose.yml -f docker-compose.override.yml --profile test run --rm step7-test
```

Force rerun Step 7 init:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml run --rm -e STEP7_FORCE=true step7-init
docker compose -f docker-compose.yml -f docker-compose.override.yml run --rm -e STEP7_FGAP_FORCE=true step7-fgap-init
```

---

## 9. Source Files

| File | Role |
|---|---|
| `scripts/step6_client_admin_setup.sh` | Step 6 role/composite bootstrap |
| `scripts/step6_fgap_api_setup.py` | Step 6 FGAP v2 setup |
| `scripts/step7_approles_bootstrap.sh` | Step 7 AppRoles + `delegated-client-admin-base` bootstrap |
| `scripts/step7_fgap_api_setup.py` | Step 7 FGAP v2 setup |
| `custom-delegated-admin-guard-spi/src/main/java/tech/epidemiology/keycloak/guard/DelegatedAdminGuardEventListener.java` | Event listener automation + rollback guard |
| `custom-delegated-admin-guard-spi/src/main/java/tech/epidemiology/keycloak/guard/DelegatedAdminGuardFilter.java` | HTTP-level delegated enforcement |
| `custom-delegated-admin-guard-spi/src/main/java/tech/epidemiology/keycloak/guard/DelegatedAdminGuardEventListenerFactory.java` | Event listener provider factory |
| `scripts/test_step6_delegation.py` | Step 6 tests |
| `scripts/test_step7_pca.py` | Step 7 delegated client admin tests (legacy filename) |

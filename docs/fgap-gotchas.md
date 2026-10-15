# FGAP v2 gotchas (Keycloak 26.x)

Lessons from 2026-10-15. Delegated admins (user-manager, group-manager, client-manager, app admins) had been silently losing permissions for months, and nobody noticed. Read this before adding or changing any FGAP permission, policy, or delegated role.

Related: [`user-manager-policy.md`](user-manager-policy.md), [`delegated-client-admin-policy.md`](delegated-client-admin-policy.md), `scripts/fgap_delegated_consolidate.py`, `custom-delegated-admin-guard-spi`.

## 1. Every applicable permission must say yes (UNANIMOUS, and it's locked)

The `admin-permissions` resource server uses the **UNANIMOUS** decision strategy. An action is allowed only if **every** permission that applies to the target permits it. A single DENY wins.

You cannot change this. `PUT .../clients/{admin-permissions}/authz/resource-server` with `decisionStrategy: AFFIRMATIVE` returns **400**, and creating a permission with `decisionStrategy: AFFIRMATIVE` also returned 400 (`unknown_error`).

**Consequence:** separate realm-wide ("all users" / "all groups") permissions per role **cancel each other out**:

| Permission (all Users) | user-manager edits a user |
|---|---|
| `perm-users-user-manager` | PERMIT |
| `perm-users-client-manager-view` | DENY (actor is not a client-manager) |
| `perm-users-group-manager-fgap` | DENY |
| `perm-users-delegated-client-admin-base` | DENY |
| **Result** | **DENY → 403** |

Every delegated role was blocked by every other role's permission, on both Users and Groups. This happened on 26.6.3 and 26.7.5 alike; it was not an upgrade regression.

**Rule:** for each resource type, use **one** realm-wide permission per delegated audience, granted through an **any-of-these-roles** policy. Enforce per-role limits in the guard SPI, not with more FGAP permissions. Current shape (`scripts/fgap_delegated_consolidate.py`):

| Permission | Resource | Scopes | Policy |
|---|---|---|---|
| `perm-users-delegated-shared` | Users | `view`, `manage-group-membership`, `manage`, `reset-password` | `policy-users-delegated-any` |
| `perm-groups-delegated-shared` | Groups | `view`, `view-members`, `manage-membership`, `manage` | `policy-users-delegated-any` |

Per-role limits enforced by `DelegatedAdminGuardFilter`:

- Only `user-manager` may create or modify user accounts (create, edit, disable, credentials, actions email, logout).
- A pure `user-manager` cannot create, rename, move, or delete groups; it can only change membership.
- `client-manager` may only change direct membership of `AppRoles/{clientId}` (appointing app admins).
- App admins may only manage groups and membership inside their own AppRoles subtree.
- `group-manager-fgap` can do everything except touch AppRoles roots.

`perm-client-manager-deny-system` (a NEGATIVE override on system clients) still works because it *relies* on UNANIMOUS. That is the only pattern UNANIMOUS is good for.

## 2. In practice, a DENY blocks every scope, not just its own

Keycloak's `DecisionPermissionCollector` reads as if a denying permission only blocks *its own* scopes. In practice it does not work that way. Permissions with only `view` + `manage-group-membership` evaluated to DENY and still blocked `manage` for user-manager. Removing them fixed it.

**Rule:** do not reason scope by scope. Assume **every realm-wide permission on a resource type must PERMIT** for every actor that needs *anything* on that type.

## 3. "Any of these roles" requires `required: false`

In a role policy, each role entry has `required`. With `required: true` on several roles, the user must hold **all** of them. For "any delegated role", list each role with `required: false`:

```json
{"type": "role", "fetchRoles": true,
 "roles": [{"id": "<user-manager>", "required": false},
           {"id": "<client-manager>", "required": false}, ...]}
```

## 4. Group membership needs both sides

`PUT/DELETE /users/{id}/groups/{gid}` checks **both**:

- Users: `manage-group-membership` on the user, and
- Groups: `manage-membership` on the group.

Fixing only one side still gives 403. That is why the user-manager-only Users permission (`manage`, `reset-password`) had to go. It DENIED the Users side for every other role and blocked their membership changes.

## 5. Scope meanings that bite

- **`reset-password`** is a separate Users scope. Keycloak falls back to `manage` if it isn't granted, but grant it explicitly.
- **`manage-members`** on Groups means "manage every *user* who is a member of the group" (edit, disable, and so on). It is **not** "manage membership". Do not grant it to delegated roles: with a realm-wide Groups permission it would let group-manager edit almost every user. It is deliberately excluded.
- **`manage-membership`** on Groups is add/remove members. **`manage`** on Groups is group structure: rename, attributes, children, delete.

## 6. Built-in admin roles hide FGAP failures

`UserPermissionsV2.canView()` and similar checks return true early if the user holds a built-in `realm-management` role such as `view-users`, `query-users`, or `manage-users`, **without consulting FGAP**. Our delegated roles carry `view-users`/`query-*` composites, so "they can see users" proved nothing about FGAP. Everything that relies on FGAP (edit, disable, reset, membership) was broken while viewing worked fine.

**Rule:** never accept "the dashboard lists users" as evidence that permissions work. Test a **write**.

Related: a `manage-clients` composite bypasses FGAP NEGATIVE policies entirely. That is why the guard SPI blocks system clients itself.

## 7. Two different 403s; learn to tell them apart

| Response body | Source |
|---|---|
| `{"error":"HTTP 403 Forbidden"}` | Keycloak / FGAP denied it |
| `{"error":"access_denied","error_description":"..."}` | `custom-delegated-admin-guard-spi` denied it, with the reason |

The guard filter runs **before** FGAP. A guard 403 means FGAP was never consulted.

## 8. Debug with the evaluation API, not by guessing

Ask Keycloak why it decided what it did. This is read-only:

```bash
make kcadm-login
AP=$(./kcadm.sh get clients -r aiims-new-delhi -q clientId=admin-permissions --fields id --format csv --noquotes --config /tmp/kcadm-master-admin.config)
printf '%s' '{"roleIds":[],"userId":"<ACTOR_USER_ID>","resourceType":"Users",
  "resources":[{"name":"<TARGET_USER_ID>","type":"Users","scopes":[{"name":"manage"}]}],
  "entitlements":false,"context":{"attributes":{}}}' \
| docker exec -i vg-keycloak /opt/keycloak/bin/kcadm.sh create \
    "clients/$AP/authz/resource-server/policy/evaluate" -r aiims-new-delhi \
    --config /tmp/kcadm-master-admin.config -f - -o
```

The result lists every applicable permission with PERMIT/DENY. Any DENY row is your culprit (see §1). Use `resourceType: "Groups"` and a group id for group checks.

## 9. Realm admins and the service account bypass all of this

Realm admins (including the `sso-automation` service account, which holds `realm-admin`) skip FGAP and are exempt from most guard rules. So:

- **Never test delegated permissions as a realm admin.** Create a throwaway user with only the role under test, on a clone.
- Any client whose credentials grant `realm-admin` must be on the guard's **system client** list. Otherwise a client-manager could regenerate its secret and escalate. `sso-automation` is on every list: guard filter, guard event listener, step 6 deny list, and the admin console's reserved clients.
- Some guard rules run *before* the realm-admin exemption and apply even to realm admins. For example, `delegated-client-admin-base` cannot be modified over REST by anyone.

## 10. How to change permissions safely

1. **Never** create per-role realm-wide Users/Groups permissions, whether in the console, a step script, or by hand. Extend the shared ones instead.
2. **New delegated role?** Add it to `DELEGATED_ROLES` in `scripts/fgap_delegated_consolidate.py`, and add its limits to `DelegatedAdminGuardFilter` (deny by default).
3. **Deploy order:** guard SPI first, then the FGAP change. Otherwise roles briefly gain powers the guard doesn't yet restrict.
4. **Test on a clone:** `make upgrade-test-db-copy`, run a role-by-role write matrix for every delegated role (allowed and forbidden operations), and diff the live config suite before and after.
5. **Apply to production** with the maintenance runner, dry run first:
   `make maintenance MAINT_CMD='python3 /workspace/scripts/fgap_delegated_consolidate.py --dry-run'`
6. **Do not force init steps on production** to "re-apply" permissions. They reset other manual changes (see `AGENTS.md`).

## Unrelated 26.7 traps found the same day

- `realm-management` client updates return 403 even for the master super-admin. Scripts must skip it.
- A client or user whose stored data fails current validation (for example a post-logout redirect URI with a leading space, or a user missing a required profile field) rejects **every** update until fixed in the console. Bulk scripts must warn and continue, not abort.

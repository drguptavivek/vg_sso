# Auditor Role Policy

**Realm:** `org-new-delhi`
**Status:** Active

---

## 1. Purpose

The `auditor` realm role provides read-only visibility into users, groups, clients, and event history without granting mutation privileges.

It is intended for operational review, compliance checks, audit support, and investigation workflows where administrators need visibility but must not be able to change realm state.

---

## 2. Bootstrap Model

Step 8 configures the role through:

- `step8-init` in `docker-compose.yml`
- `scripts/step8_auditor_setup.sh`

The script creates or updates the realm role `auditor` and attaches read-only `realm-management` composites where available on the running Keycloak build.

---

## 3. Current Composites

Step 8 attempts to assign these `realm-management` roles:

- `view-users`
- `query-users`
- `query-groups`
- `view-clients`
- `query-clients`
- `view-events`
- `query-realms`

The script skips any composite that is not present on the current Keycloak version.

---

## 4. Scope Boundary

The `auditor` role is intentionally read-only.

It does not grant:

- `manage-users`
- `manage-clients`
- `manage-realm`
- impersonation
- delegated admin privileges

This keeps the role suitable for observation and reporting, not administration.

---

## 5. Events Integration

Step 8 also enables realm events and adds `failure-logs-file` to `eventsListeners`.

That means the auditor setup currently bundles two related outcomes:

- creation of the `auditor` read-only role
- activation of failure-focused event logging and audit retention settings

See:

- [`failure-auth-logging-policy.md`](failure-auth-logging-policy.md)
- [`audit-archival-policy.md`](audit-archival-policy.md)

---

## 6. Verification

Inspect the role:

```bash
./kcadm.sh get roles/auditor -r "$KC_NEW_REALM_NAME" --config .kcadm.config
```

Inspect effective `realm-management` composites:

```bash
./kcadm.sh get-roles -r "$KC_NEW_REALM_NAME" --rname auditor --effective --cclientid realm-management --config .kcadm.config \
  | jq -r '.[].name'
```

Rerun Step 8 if needed:

```bash
make force-step8
```

---

## 7. Source Files

| File | Role |
|---|---|
| `scripts/step8_auditor_setup.sh` | Auditor role bootstrap |
| `docs/Step_8_auditor_role.md` | Step-oriented implementation note |


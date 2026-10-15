#!/usr/bin/env python3
"""Consolidate FGAP v2 permissions on the Users and Groups resource types.

FGAP v2 locks the admin-permissions resource server to the UNANIMOUS decision
strategy: every permission that applies to a user or group must PERMIT.
Separate realm-wide permissions per delegated role therefore cancel each other
out. For example, a user-manager is denied `manage` because the client-manager,
group-manager-fgap, and delegated-client-admin-base permissions on the same
resource evaluate to DENY for them.

Target shape (idempotent):
  - policy-users-delegated-any: role policy satisfied by ANY delegated admin
    role that exists (user-manager, client-manager, group-manager-fgap,
    delegated-client-admin-base).
  - perm-users-delegated-shared: Users [view, manage-group-membership,
    manage, reset-password] for that policy. A user-manager-only permission
    would DENY group membership for every other role, so user lifecycle
    writes (create/edit/disable/credentials) are restricted to user-manager
    by custom-delegated-admin-guard-spi instead.
  - perm-groups-delegated-shared: Groups [view, view-members,
    manage-membership, manage] for that policy. Per-role limits on group
    structure (user-manager: none; client-manager/app admins: own AppRoles
    subtree; group-manager: everything except AppRoles roots) are enforced by
    custom-delegated-admin-guard-spi, which MUST be deployed first.
    `manage-members` (edit every user inside a group) is deliberately not
    granted.
  - Legacy per-role Users and Groups permissions are removed.

Safe to re-run. Use --dry-run to print the plan without changing anything.
"""

import argparse
import os
import sys

import requests
import urllib3
from urllib3.exceptions import InsecureRequestWarning

from kc_auth import get_admin_token

urllib3.disable_warnings(InsecureRequestWarning)

DELEGATED_ROLES = ["user-manager", "client-manager", "group-manager-fgap", "delegated-client-admin-base"]
SHARED_POLICY = "policy-users-delegated-any"
SHARED_PERMISSION = "perm-users-delegated-shared"
SHARED_SCOPES = ["view", "manage-group-membership", "manage", "reset-password"]
GROUPS_SHARED_PERMISSION = "perm-groups-delegated-shared"
GROUPS_SHARED_SCOPES = ["view", "view-members", "manage-membership", "manage"]
LEGACY_PERMISSIONS = [
    "perm-users-user-manager",
    "perm-users-group-manager-fgap",
    "perm-users-client-manager-view",
    "perm-users-delegated-client-admin-base",
    "perm-groups-user-manager-readonly",
    "perm-groups-group-manager-fgap",
    "perm-groups-client-manager-membership",
    "perm-groups-delegated-client-admin-base-manage",
]


def note(message):
    print(f"FGAP-DELEGATED: {message}", flush=True)


class Admin:
    def __init__(self, url, realm, token, dry_run):
        self.base = f"{url}/admin/realms/{realm}"
        self.headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        self.dry_run = dry_run
        clients = self.get("/clients", params={"clientId": "admin-permissions"})
        if not clients:
            raise SystemExit("admin-permissions client not found (is FGAP v2 enabled?)")
        self.authz = f"/clients/{clients[0]['id']}/authz/resource-server"

    def get(self, path, params=None):
        res = requests.get(self.base + path, headers=self.headers, params=params, verify=False, timeout=30)
        res.raise_for_status()
        return res.json()

    def write(self, method, path, payload=None, action=""):
        if self.dry_run:
            note(f"[dry-run] would {action}")
            return None
        res = requests.request(method, self.base + path, headers=self.headers, json=payload, verify=False, timeout=30)
        if res.status_code >= 400:
            raise SystemExit(f"{action} failed: HTTP {res.status_code} {res.text[:300]}")
        note(action)
        return res.json() if res.content and res.headers.get("Content-Type", "").startswith("application/json") else None

    def by_name(self, kind, name):
        for item in self.get(f"{self.authz}/{kind}", params={"name": name, "max": -1}):
            if item["name"] == name:
                return item
        return None

    def scope_ids(self, names):
        scopes = {s["name"]: s["id"] for s in self.get(f"{self.authz}/scope", params={"max": -1})}
        missing = [n for n in names if n not in scopes]
        if missing:
            raise SystemExit(f"authz scopes not found: {missing}")
        return [scopes[n] for n in names]

    def linked(self, policy_id, what):
        return sorted(x["name"] for x in self.get(f"{self.authz}/policy/{policy_id}/{what}"))


def get_token(url, realm, user, password):
    # sso-automation service account first; user/password is the fallback.
    return get_admin_token(url, realm, user, password)


def ensure_shared_policy(admin):
    role_ids = []
    for name in DELEGATED_ROLES:
        res = requests.get(f"{admin.base}/roles/{name}", headers=admin.headers, verify=False, timeout=30)
        if res.status_code == 404:
            note(f"role '{name}' not present yet; skipping it in {SHARED_POLICY}")
            continue
        res.raise_for_status()
        role_ids.append(res.json()["id"])
    payload = {
        "name": SHARED_POLICY,
        "description": "Any delegated admin role (any one role is sufficient)",
        "type": "role", "logic": "POSITIVE", "decisionStrategy": "UNANIMOUS", "fetchRoles": True,
        # required=False: the policy is satisfied by holding ANY listed role.
        "roles": [{"id": rid, "required": False} for rid in role_ids],
    }
    existing = admin.by_name("policy", SHARED_POLICY)
    if existing is None:
        created = admin.write("POST", f"{admin.authz}/policy/role", payload, f"create {SHARED_POLICY}")
        return created["id"] if created else None
    current = admin.get(f"{admin.authz}/policy/role/{existing['id']}")
    if sorted(r["id"] for r in current.get("roles", [])) != sorted(role_ids):
        admin.write("PUT", f"{admin.authz}/policy/role/{existing['id']}", {**payload, "id": existing["id"]},
                    f"update {SHARED_POLICY} roles")
    else:
        note(f"{SHARED_POLICY} up to date")
    return existing["id"]


def ensure_scope_permission(admin, name, description, scope_names, policy_name, policy_id,
                            resource_type="Users"):
    payload = {
        "name": name, "description": description, "type": "scope", "logic": "POSITIVE",
        "decisionStrategy": "UNANIMOUS", "resourceType": resource_type, "resources": [],
        "scopes": admin.scope_ids(scope_names), "policies": [policy_id] if policy_id else [],
    }
    existing = admin.by_name("permission", name)
    if existing is None:
        admin.write("POST", f"{admin.authz}/permission/scope", payload, f"create {name} {scope_names}")
        return
    scopes = admin.linked(existing["id"], "scopes")
    policies = admin.linked(existing["id"], "associatedPolicies")
    if scopes == sorted(scope_names) and policies == [policy_name]:
        note(f"{name} up to date {scope_names}")
        return
    admin.write("PUT", f"{admin.authz}/permission/scope/{existing['id']}", {**payload, "id": existing["id"]},
                f"update {name}: scopes {scopes} -> {sorted(scope_names)}, policies {policies} -> [{policy_name}]")


def consolidate(admin):
    shared_policy_id = ensure_shared_policy(admin)
    ensure_scope_permission(admin, SHARED_PERMISSION,
                            "Users access for any delegated admin role; lifecycle writes limited to "
                            "user-manager by delegated-admin-guard",
                            SHARED_SCOPES, SHARED_POLICY, shared_policy_id)

    ensure_scope_permission(admin, GROUPS_SHARED_PERMISSION,
                            "Groups view + membership + structure for any delegated admin role; "
                            "per-role limits enforced by delegated-admin-guard",
                            GROUPS_SHARED_SCOPES, SHARED_POLICY, shared_policy_id, resource_type="Groups")

    for name in LEGACY_PERMISSIONS:
        legacy = admin.by_name("permission", name)
        if legacy is None:
            continue
        admin.write("DELETE", f"{admin.authz}/permission/{legacy['id']}", action=f"delete legacy {name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--url", default=os.getenv("KC_SERVER_URL", "http://localhost:8080"))
    parser.add_argument("--realm", default=os.getenv("KC_NEW_REALM_NAME", "org-new-delhi"))
    parser.add_argument("--auth-realm", default=os.getenv("KC_ADMIN_AUTH_REALM", "master"))
    parser.add_argument("--user", default=os.getenv("KC_MASTER_ADMIN_USER"))
    parser.add_argument("--password", default=os.getenv("KC_MASTER_ADMIN_PASSWORD"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if not (args.user and args.password) and not os.getenv("KC_AUTOMATION_CLIENT_SECRET"):
        sys.exit("admin credentials required (KC_AUTOMATION_CLIENT_SECRET, or --user/--password)")

    note(f"{'DRY RUN against' if args.dry_run else 'Applying to'} {args.url} realm={args.realm}")
    token = get_token(args.url, args.auth_realm, args.user, args.password)
    consolidate(Admin(args.url, args.realm, token, args.dry_run))
    note("done")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Step 7: FGAP v2 Bootstrap — Per-Client Administration (PCA)
============================================================
Sets up Fine-Grained Admin Permissions (FGAP) v2 so that users
holding the 'delegated-client-admin-base' realm role (Per-Client Admins) can:
  ✅ View all clients in the admin console
  ✅ Manage (configure, update) their own client
  ✅ Create and manage subgroups under AppRoles/{clientId}
  ✅ Add users to those subgroups (group membership management)
  ✅ View user directory (to find users to add)
  ❌ Cannot delete any client (DelegatedAdminGuardFilter)
  ❌ Cannot edit system clients (DelegatedAdminGuardFilter)
  ❌ Cannot create/update/delete client scopes (DelegatedAdminGuardFilter)

PCA identity: Users assigned the 'delegated-client-admin-base' role by the
DelegatedAdminGuardEventListener when a client-manager creates a client.
"""
import os
import sys
import argparse
import requests
import urllib3
from urllib3.exceptions import InsecureRequestWarning

urllib3.disable_warnings(InsecureRequestWarning)


def note(message):
    print(f"STEP7-FGAP: {message}", flush=True)


# ─────────────────────────────── UTILITIES ──────────────────────────────── #

def get_admin_token(keycloak_url, realm, user, password):
    url = f"{keycloak_url}/realms/{realm}/protocol/openid-connect/token"
    res = requests.post(url, data={
        'client_id': 'admin-cli',
        'username': user,
        'password': password,
        'grant_type': 'password'
    }, verify=False, timeout=10)
    res.raise_for_status()
    return res.json()['access_token']


def headers(token):
    return {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}


def get_client_internal_id(keycloak_url, token, realm, client_id_name):
    url = f"{keycloak_url}/admin/realms/{realm}/clients"
    res = requests.get(url, headers=headers(token), params={'clientId': client_id_name}, verify=False)
    res.raise_for_status()
    data = res.json()
    if not data:
        return None
    return data[0]['id']


def get_realm_role_id(keycloak_url, token, realm, role_name):
    url = f"{keycloak_url}/admin/realms/{realm}/roles/{role_name}"
    res = requests.get(url, headers=headers(token), verify=False)
    if res.status_code == 404:
        return None
    res.raise_for_status()
    return res.json()['id']


def get_all_scope_ids(keycloak_url, token, realm, mgmt_client_id):
    """Return dict of {scope_name: scope_id}"""
    url = f"{keycloak_url}/admin/realms/{realm}/clients/{mgmt_client_id}/authz/resource-server/scope"
    res = requests.get(url, headers=headers(token), verify=False)
    res.raise_for_status()
    return {s['name']: s['id'] for s in res.json()}


# ───────────────────────────── POLICY SETUP ─────────────────────────────── #

def ensure_role_policy(keycloak_url, token, realm, mgmt_client_id, policy_name, role_id, logic='POSITIVE'):
    """Create or update a role-based policy. Returns policy ID."""
    url = f"{keycloak_url}/admin/realms/{realm}/clients/{mgmt_client_id}/authz/resource-server/policy/role"
    h = headers(token)

    payload = {
        "name": policy_name,
        "type": "role",
        "logic": logic,
        "decisionStrategy": "UNANIMOUS",
        "roles": [{"id": role_id, "required": True}]
    }

    search = requests.get(url, headers=h, params={'name': policy_name}, verify=False)
    search.raise_for_status()
    existing = [p for p in search.json() if p['name'] == policy_name]

    if existing:
        pid = existing[0]['id']
        note(f"Policy '{policy_name}' exists — updating...")
        requests.put(f"{url}/{pid}", headers=h, json=payload, verify=False).raise_for_status()
        return pid

    note(f"Creating policy '{policy_name}' (logic={logic})...")
    res = requests.post(url, headers=h, json=payload, verify=False)
    if not res.ok:
        note(f"Policy creation failed: {res.text}")
    res.raise_for_status()
    return res.json()['id']


# ─────────────────────────── PERMISSION SETUP ───────────────────────────── #

def ensure_scope_permission(keycloak_url, token, realm, mgmt_client_id,
                            perm_name, resource_type, scope_names,
                            policy_ids, resource_ids=None):
    """
    Create or update a scope-based permission in admin-permissions client.

    - resource_type: "Clients" | "Users" | "Groups" | "Roles"
    - scope_names: list of scope name strings
    - policy_ids: list of policy ID strings
    - resource_ids: list of UUIDs (None = global/all-resources of this type)
    """
    url = f"{keycloak_url}/admin/realms/{realm}/clients/{mgmt_client_id}/authz/resource-server/permission/scope"
    h = headers(token)

    scope_map = get_all_scope_ids(keycloak_url, token, realm, mgmt_client_id)
    scope_ids = [scope_map[s] for s in scope_names if s in scope_map]
    missing = [s for s in scope_names if s not in scope_map]
    if missing:
        note(f"⚠️  Scopes not found (will skip): {missing}")
    if not scope_ids:
        raise ValueError(f"None of the requested scopes {scope_names} were found in admin-permissions")

    payload = {
        "name": perm_name,
        "type": "scope",
        "logic": "POSITIVE",
        "decisionStrategy": "UNANIMOUS",
        "resourceType": resource_type,
        "scopes": scope_ids,
        "policies": policy_ids,
        "resources": resource_ids or []
    }

    search = requests.get(url, headers=h, params={'name': perm_name}, verify=False)
    search.raise_for_status()
    existing = [p for p in search.json() if p['name'] == perm_name]

    if existing:
        pid = existing[0]['id']
        note(f"Permission '{perm_name}' exists — updating...")
        res = requests.put(f"{url}/{pid}", headers=h, json=payload, verify=False)
        if not res.ok:
            note(f"Update failed: {res.text}")
        res.raise_for_status()
        return pid

    note(f"Creating permission '{perm_name}'...")
    res = requests.post(url, headers=h, json=payload, verify=False)
    if not res.ok:
        note(f"Creation failed: {res.text}")
    res.raise_for_status()
    return res.json()['id']


# ─────────────────────────────── MAIN ───────────────────────────────────── #

def main():
    parser = argparse.ArgumentParser(
        description="Step 7: FGAP v2 Bootstrap for Per-Client Administration (PCA)"
    )
    parser.add_argument('--url',         default=os.getenv('KC_SERVER_URL', 'http://localhost:8080'))
    parser.add_argument('--user',        default=os.getenv('KC_NEW_REALM_ADMIN_USER', 'realmadmin1'))
    parser.add_argument('--password',    default=os.getenv('KC_NEW_REALM_ADMIN_PASSWORD'))
    parser.add_argument('--realm',       default=os.getenv('KC_NEW_REALM_NAME', 'org-new-delhi'))
    parser.add_argument('--marker-file', default=os.getenv('STEP7_FGAP_MARKER_FILE', ''))
    parser.add_argument('--force',       action='store_true', default=(os.getenv('STEP7_FGAP_FORCE', 'false').lower() == 'true'))
    args = parser.parse_args()

    if args.marker_file and not args.force and os.path.exists(args.marker_file):
        note(f"marker exists at {args.marker_file}; skipping (set STEP7_FGAP_FORCE=true to rerun).")
        sys.exit(0)

    if not args.password:
        note("ERROR: --password or KC_NEW_REALM_ADMIN_PASSWORD required")
        sys.exit(1)

    KC_URL = args.url
    REALM  = args.realm

    note(f"Connecting to {KC_URL}, realm={REALM}")

    # ── Authenticate ──
    try:
        token = get_admin_token(KC_URL, REALM, args.user, args.password)
    except Exception as e:
        note(f"Authentication failed: {e}")
        sys.exit(1)

    # ── Step 1: Resolve admin-permissions client ID ──
    mgmt_id = get_client_internal_id(KC_URL, token, REALM, 'admin-permissions')
    if not mgmt_id:
        note("ERROR: 'admin-permissions' client not found. Is adminPermissionsEnabled=true?")
        sys.exit(1)
    note(f"admin-permissions client id: {mgmt_id}")

    # ── Step 2: Resolve delegated-client-admin-base role ID ──
    pca_base_role_id = get_realm_role_id(KC_URL, token, REALM, 'delegated-client-admin-base')
    if not pca_base_role_id:
        note("ERROR: 'delegated-client-admin-base' realm role not found. Run step7-init first.")
        sys.exit(1)
    note(f"delegated-client-admin-base role id: {pca_base_role_id}")

    # ── Step 3: Create POSITIVE policy for delegated-client-admin-base role ──
    policy_allow_id = ensure_role_policy(
        KC_URL, token, REALM, mgmt_id,
        policy_name='policy-delegated-client-admin-base-allow',
        role_id=pca_base_role_id,
        logic='POSITIVE'
    )
    note(f"policy-delegated-client-admin-base-allow id: {policy_allow_id}")

    # ── Step 4: Groups permission for delegated-client-admin-base ──
    #    manage:            create/update/delete groups (includes creating subgroups)
    #    manage-membership: add/remove members from groups
    #    view:              view group details
    #    view-members:      list group members
    ensure_scope_permission(
        KC_URL, token, REALM, mgmt_id,
        perm_name='perm-groups-delegated-client-admin-base-manage',
        resource_type='Groups',
        scope_names=['manage', 'manage-membership', 'view', 'view-members'],
        policy_ids=[policy_allow_id],
        resource_ids=None  # all groups
    )
    note("✅ Groups manage+membership permission set for delegated-client-admin-base")

    # ── Step 5: Users permission for delegated-client-admin-base ──
    #    view:                  browse the user directory (needed to find users to add)
    #    manage-group-membership: add/remove users from groups via Users API
    ensure_scope_permission(
        KC_URL, token, REALM, mgmt_id,
        perm_name='perm-users-delegated-client-admin-base',
        resource_type='Users',
        scope_names=['view', 'manage-group-membership'],
        policy_ids=[policy_allow_id],
        resource_ids=None
    )
    note("✅ Users view+manage-group-membership permission set for delegated-client-admin-base")

    note("")
    note("═══════════════════════════════════════════════════")
    note("✅ FGAP v2 Step 7 Bootstrap Complete!")
    note("   Role 'delegated-client-admin-base' holders (Per-Client Admins) can now:")
    note("   • View all clients (via delegated-client-admin-base composites: view-clients, query-clients)")
    note("   • Manage their own client (manage-clients composite)")
    note("   • Create subgroups under AppRoles/{clientId} (manage-groups + FGAP Groups)")
    note("   • Add users to those subgroups (manage-group-membership + FGAP Users)")
    note("   • View user directory to find users (view-users + FGAP Users view)")
    note("   Filter enforcement:")
    note("   • Cannot delete any client (DelegatedAdminGuardFilter)")
    note("   • Cannot edit system clients (DelegatedAdminGuardFilter)")
    note("   • Cannot edit clients outside their AppRoles group (DelegatedAdminGuardFilter)")
    note("   • Cannot create/update/delete client scopes (DelegatedAdminGuardFilter)")
    note("═══════════════════════════════════════════════════")

    if args.marker_file:
        import pathlib
        pathlib.Path(args.marker_file).parent.mkdir(parents=True, exist_ok=True)
        pathlib.Path(args.marker_file).write_text("")
        note(f"Marker written: {args.marker_file}")


if __name__ == '__main__':
    main()

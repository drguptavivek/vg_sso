#!/usr/bin/env python3
"""
Step 6: FGAP v2 Bootstrap — Delegated Client Administration
============================================================
Sets up Fine-Grained Admin Permissions (FGAP) v2 so that users
with the 'client-manager' role can:
  ✅ View all clients
  ✅ Create new clients
  ✅ Manage (configure, update, deactivate) clients they create
  ❌ Cannot manage/delete system clients (admin-cli, broker, etc.)
  ❌ Cannot delete ANY client (achieved via not having manage on system clients
     and the client UI not exposing delete for delegated users — see notes below)

Note on "delete" vs "manage":
  In Keycloak 26 FGAP v2, the `manage` scope covers both update AND delete.
  There is no separate `delete` scope. To prevent deletion of system clients,
  we use a NEGATIVE policy on those specific client IDs.
  For user-created clients, the `client-manager` CAN both manage and delete them.
  To truly block delete on all clients, a custom SPI event listener is needed.
"""
import os
import sys
import argparse
import requests
import urllib3
from urllib3.exceptions import InsecureRequestWarning

urllib3.disable_warnings(InsecureRequestWarning)

# System clients that exist by default that client-manager must NOT touch
SYSTEM_CLIENT_IDS = [
    'admin-cli',
    'account',
    'account-console',
    'broker',
    'realm-management',
    'security-admin-console',
    'admin-permissions',
]

def note(message):
    print(f"STEP6-FGAP: {message}", flush=True)


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


def get_all_scope_ids(keycloak_url, token, realm, mgmt_client_id):
    """Return dict of {scope_name: scope_id}"""
    url = f"{keycloak_url}/admin/realms/{realm}/clients/{mgmt_client_id}/authz/resource-server/scope"
    res = requests.get(url, headers=headers(token), verify=False)
    res.raise_for_status()
    return {s['name']: s['id'] for s in res.json()}


# ───────────────────────────── REALM SETUP ──────────────────────────────── #

def enable_admin_permissions(keycloak_url, token, realm, env_mode):
    url = f"{keycloak_url}/admin/realms/{realm}"
    res = requests.get(url, headers=headers(token), verify=False)
    res.raise_for_status()
    realm_rep = res.json()

    desired_ssl = 'none' if env_mode == 'development' else 'external'
    changed = False

    if not realm_rep.get('adminPermissionsEnabled'):
        realm_rep['adminPermissionsEnabled'] = True
        changed = True
    if realm_rep.get('sslRequired') != desired_ssl:
        realm_rep['sslRequired'] = desired_ssl
        changed = True

    if changed:
        note(f"Updating realm: adminPermissionsEnabled=True, sslRequired={desired_ssl}")
        requests.put(url, headers=headers(token), json=realm_rep, verify=False).raise_for_status()
    else:
        note(f"Realm already configured: adminPermissionsEnabled=True, sslRequired={desired_ssl}")


def register_event_listener(keycloak_url, token, realm, listener_id):
    """Idempotently add an event listener to the realm."""
    url = f"{keycloak_url}/admin/realms/{realm}"
    res = requests.get(url, headers=headers(token), verify=False)
    res.raise_for_status()
    realm_rep = res.json()

    current_listeners = realm_rep.get('eventsListeners', [])
    if listener_id in current_listeners:
        note(f"Event listener '{listener_id}' already registered on realm.")
        return

    note(f"Registering event listener '{listener_id}' on realm {realm}...")
    realm_rep['eventsListeners'] = current_listeners + [listener_id]
    requests.put(url, headers=headers(token), json=realm_rep, verify=False).raise_for_status()
    note(f"✅ Event listener '{listener_id}' registered.")


# ───────────────────────────── ROLE SETUP ───────────────────────────────── #

def ensure_client_manager_role(keycloak_url, token, realm):
    """Ensure the 'client-manager' realm role exists. Returns role ID."""
    url = f"{keycloak_url}/admin/realms/{realm}/roles"
    res = requests.get(f"{url}/client-manager", headers=headers(token), verify=False)

    if res.status_code == 404:
        note("Creating 'client-manager' role...")
        payload = {
            "name": "client-manager",
            "description": "Delegated client administrators — can create and manage own clients. Cannot touch system clients."
        }
        requests.post(url, headers=headers(token), json=payload, verify=False).raise_for_status()
        res = requests.get(f"{url}/client-manager", headers=headers(token), verify=False)

    res.raise_for_status()
    role = res.json()
    note(f"'client-manager' role ready (id={role['id']})")
    return role['id']


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

    # Idempotent search
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
    - resource_ids: list of client/user/group internal UUIDs (None = global/all-resources)
    """
    url = f"{keycloak_url}/admin/realms/{realm}/clients/{mgmt_client_id}/authz/resource-server/permission/scope"
    h = headers(token)

    scope_map = get_all_scope_ids(keycloak_url, token, realm, mgmt_client_id)
    scope_ids = [scope_map[s] for s in scope_names if s in scope_map]

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

    # Idempotent search
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


# ──────────────────────── TESTING CLIENT SETUP ──────────────────────────── #

def ensure_testing_client(keycloak_url, token, realm):
    """Ensure the 'app-testing-client' exists. Returns its internal UUID."""
    existing_id = get_client_internal_id(keycloak_url, token, realm, 'app-testing-client')

    if existing_id:
        note(f"'app-testing-client' exists (id={existing_id})")
        return existing_id

    note("Creating 'app-testing-client'...")
    payload = {
        "clientId": "app-testing-client",
        "name": "App Testing Client",
        "description": "Client used for FGAP verification and testing",
        "enabled": True,
        "publicClient": False,
        "directAccessGrantsEnabled": False,
        "standardFlowEnabled": True,
        "protocol": "openid-connect"
    }
    url = f"{keycloak_url}/admin/realms/{realm}/clients"
    res = requests.post(url, headers=headers(token), json=payload, verify=False)
    res.raise_for_status()
    client_id = get_client_internal_id(keycloak_url, token, realm, 'app-testing-client')
    note(f"'app-testing-client' created (id={client_id})")
    return client_id


def get_system_client_ids(keycloak_url, token, realm):
    """Resolve internal UUIDs for all system clients that exist."""
    system_ids = []
    for cid in SYSTEM_CLIENT_IDS:
        internal_id = get_client_internal_id(keycloak_url, token, realm, cid)
        if internal_id:
            system_ids.append(internal_id)
            note(f"  system client '{cid}' → {internal_id}")
        else:
            note(f"  system client '{cid}' not found (skipping)")
    return system_ids


# ─────────────────────────────── MAIN ───────────────────────────────────── #

def main():
    parser = argparse.ArgumentParser(description="Step 6: FGAP v2 Bootstrap for Delegated Client Administration")
    parser.add_argument('--url',         default=os.getenv('KC_SERVER_URL', 'http://localhost:8080'))
    parser.add_argument('--user',        default=os.getenv('KC_NEW_REALM_ADMIN_USER', 'realmadmin1'))
    parser.add_argument('--password',    default=os.getenv('KC_NEW_REALM_ADMIN_PASSWORD'))
    parser.add_argument('--realm',       default=os.getenv('KC_NEW_REALM_NAME', 'org-new-delhi'))
    parser.add_argument('--env',         default=os.getenv('KEYCLOAK_ENV', 'production'))
    parser.add_argument('--marker-file', default=os.getenv('STEP6_FGAP_MARKER_FILE', ''))
    parser.add_argument('--force',       action='store_true', default=(os.getenv('STEP6_FGAP_FORCE', 'false').lower() == 'true'))
    args = parser.parse_args()

    if args.marker_file and not args.force and os.path.exists(args.marker_file):
        note(f"marker exists at {args.marker_file}; skipping (set STEP6_FGAP_FORCE=true to rerun).")
        sys.exit(0)

    if not args.password:
        note("ERROR: --password or KC_NEW_REALM_ADMIN_PASSWORD required")
        sys.exit(1)

    KC_URL = args.url
    REALM  = args.realm
    ENV    = args.env

    note(f"Connecting to {KC_URL}, realm={REALM}, env={ENV}")

    # ── Authenticate ──
    try:
        token = get_admin_token(KC_URL, REALM, args.user, args.password)
    except Exception as e:
        note(f"Authentication failed: {e}")
        sys.exit(1)

    # ── Step 0: Enable FGAP v2 on realm ──
    enable_admin_permissions(KC_URL, token, REALM, ENV)

    # ── Step 1: Resolve admin-permissions client ID ──
    mgmt_id = get_client_internal_id(KC_URL, token, REALM, 'admin-permissions')
    if not mgmt_id:
        note("ERROR: 'admin-permissions' client not found. Is adminPermissionsEnabled=true?")
        sys.exit(1)
    note(f"admin-permissions client id: {mgmt_id}")

    # ── Step 2: Ensure app-testing-client exists ──
    testing_client_id = ensure_testing_client(KC_URL, token, REALM)

    # ── Step 3: Ensure client-manager role ──
    role_id = ensure_client_manager_role(KC_URL, token, REALM)

    # ── Step 4: Create POSITIVE policy for client-manager role ──
    policy_allow_id = ensure_role_policy(
        KC_URL, token, REALM, mgmt_id,
        policy_name='policy-client-manager-allow',
        role_id=role_id,
        logic='POSITIVE'
    )

    # ── Step 5: Create NEGATIVE policy for client-manager role (to block system clients) ──
    policy_deny_id = ensure_role_policy(
        KC_URL, token, REALM, mgmt_id,
        policy_name='policy-client-manager-deny',
        role_id=role_id,
        logic='NEGATIVE'
    )

    # ── Step 6: Global permission: view + manage ALL clients ──
    #    This allows the client-manager to:
    #      - See all clients (view)
    #      - Create new clients (manage at type level = create)
    #      - Manage clients they create (manage at resource level)
    ensure_scope_permission(
        KC_URL, token, REALM, mgmt_id,
        perm_name='perm-client-manager-global',
        resource_type='Clients',
        scope_names=['view', 'manage'],
        policy_ids=[policy_allow_id],
        resource_ids=None  # None = applies to resource TYPE (all clients)
    )
    note("✅ Global view+manage permission set for client-manager")

    # ── Step 7: Deny permission on system clients ──
    #    NEGATIVE policy on specific system client UUIDs overrides the global permission.
    #    This means client-manager CANNOT manage/delete system clients.
    note("Resolving system client UUIDs to deny...")
    system_ids = get_system_client_ids(KC_URL, token, REALM)

    if system_ids:
        ensure_scope_permission(
            KC_URL, token, REALM, mgmt_id,
            perm_name='perm-client-manager-deny-system',
            resource_type='Clients',
            scope_names=['manage'],  # deny manage (= no update/delete) on system clients
            policy_ids=[policy_deny_id],
            resource_ids=system_ids  # specific system client UUIDs
        )
        note(f"✅ Deny-manage permission set for {len(system_ids)} system clients")
    else:
        note("⚠️  No system clients resolved — skipping deny permission")

    # ── Step 8: Users view permission for client-manager ──
    #    Allows client-manager to browse the user directory (read-only) in the
    #    admin console, needed to find users to promote as PCA.
    #    'view' scope only — no manage, no delete, no credential reset.
    ensure_scope_permission(
        KC_URL, token, REALM, mgmt_id,
        perm_name='perm-users-client-manager-view',
        resource_type='Users',
        scope_names=['view'],
        policy_ids=[policy_allow_id],
        resource_ids=None
    )
    note("✅ Users view permission set for client-manager")

    # ── Step 9: Register the delegated-admin-guard event listener ──
    #    The delegated-admin-guard SPI enforces rules that FGAP v2 scopes cannot:
    #      a) Blocks CLIENT DELETE for client-manager users (HTTP 403 + DB rollback)
    #      b) Blocks PUT/PATCH on system clients for client-manager users (HTTP 403)
    #         — needed because manage-clients composite bypasses FGAP v2 NEGATIVE
    #      c) Blocks CLIENT_SCOPE create/update/delete for client-manager users (HTTP 403 + DB rollback)
    register_event_listener(KC_URL, token, REALM, 'delegated-admin-guard')

    note("")
    note("═══════════════════════════════════════════════════")
    note("✅ FGAP v2 Bootstrap Complete!")
    note("   Role 'client-manager' can now:")
    note("   • View all clients")
    note("   • Create new clients")
    note("   • Manage (update, disable) their own clients")
    note("   • Cannot edit/delete system clients (delegated-admin-guard SPI filter)")
    note("     (manage-clients composite bypasses FGAP v2 NEGATIVE; filter is the guard)")
    note("   • Cannot delete ANY client (delegated-admin-guard SPI)")
    note("   • Cannot create/update/delete client scopes (delegated-admin-guard SPI)")
    note(f"  'app-testing-client' (id={testing_client_id}) is ready")
    note("═══════════════════════════════════════════════════")

    if args.marker_file:
        import pathlib
        pathlib.Path(args.marker_file).parent.mkdir(parents=True, exist_ok=True)
        pathlib.Path(args.marker_file).write_text("")
        note(f"Marker written: {args.marker_file}")


if __name__ == '__main__':
    main()

import os
import sys
import json
import time
import argparse
import requests
from urllib3.exceptions import InsecureRequestWarning
import warnings

# Suppress SSL warnings for dev environments
warnings.filterwarnings('ignore', category=InsecureRequestWarning)

def note(message):
    print(f"STEP2-FGAP: {message}", flush=True)

def get_admin_token(keycloak_url, login_realm, admin_user, admin_password, max_retries=10, retry_delay=3):
    url = f"{keycloak_url}/realms/{login_realm}/protocol/openid-connect/token"
    payload = {
        'client_id': 'admin-cli',
        'username': admin_user,
        'password': admin_password,
        'grant_type': 'password'
    }
    for attempt in range(max_retries):
        try:
            response = requests.post(url, data=payload, verify=False, timeout=10)
            response.raise_for_status()
            return response.json()['access_token']
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
            if attempt < max_retries - 1:
                note(f"Connection failed (attempt {attempt+1}/{max_retries}), retrying in {retry_delay}s: {e}")
                time.sleep(retry_delay)
            else:
                raise

def get_realm_management_client_id(keycloak_url, token, target_realm):
    url = f"{keycloak_url}/admin/realms/{target_realm}/clients"
    headers = {'Authorization': f'Bearer {token}'}
    # In KC 26 FGAPv2, the authz policies are attached to the admin-permissions client!
    target_client = "admin-permissions"
    params = {'clientId': target_client}
    response = requests.get(url, headers=headers, params=params, verify=False)
    response.raise_for_status()
    clients = response.json()
    if not clients:
        raise ValueError(f"Authorization client {target_client} not found")
    return clients[0]['id']

def get_role_id(keycloak_url, token, target_realm, role_name):
    url = f"{keycloak_url}/admin/realms/{target_realm}/roles/{role_name}"
    headers = {'Authorization': f'Bearer {token}'}
    response = requests.get(url, headers=headers, verify=False)
    if response.status_code == 404:
         raise ValueError(f"Role {role_name} not found")
    response.raise_for_status()
    return response.json()['id']

def enable_admin_permissions(keycloak_url, token, target_realm):
    url = f"{keycloak_url}/admin/realms/{target_realm}"
    headers = {'Authorization': f'Bearer {token}'}
    response = requests.get(url, headers=headers, verify=False)
    response.raise_for_status()
    realm_rep = response.json()
    if not realm_rep.get('adminPermissionsEnabled'):
        note(f"Enabling adminPermissionsEnabled for realm {target_realm}")
        realm_rep['adminPermissionsEnabled'] = True
        put_response = requests.put(url, headers=headers, json=realm_rep, verify=False)
        put_response.raise_for_status()
    else:
        note(f"adminPermissionsEnabled already enabled for realm {target_realm}")

def create_role_policy(keycloak_url, token, target_realm, mgmt_client_id, policy_name, role_id):
    url = f"{keycloak_url}/admin/realms/{target_realm}/clients/{mgmt_client_id}/authz/resource-server/policy/role"
    headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}
    
    # Check if policy exists
    search_res = requests.get(url, headers=headers, params={'name': policy_name}, verify=False)
    search_res.raise_for_status()
    existing = search_res.json()
    if existing:
        note(f"Role policy '{policy_name}' already exists.")
        return existing[0]['id']

    payload = {
        "name": policy_name,
        "description": "Fine grained user and group permissions for user-manager role",
        "type": "role",
        "logic": "POSITIVE",
        "decisionStrategy": "UNANIMOUS",
        "roles": [{"id": role_id, "required": True}],
        "fetchRoles": True
    }
    note(f"Creating role policy '{policy_name}'...")
    response = requests.post(url, headers=headers, json=payload, verify=False)
    if response.status_code == 409: # Conflict
         note(f"Policy '{policy_name}' exists (conflict).")
         return search_res.json()[0]['id'] if existing else None
    response.raise_for_status()
    return response.json()['id']

def get_scope_id(keycloak_url, token, target_realm, mgmt_client_id, scope_name):
    url = f"{keycloak_url}/admin/realms/{target_realm}/clients/{mgmt_client_id}/authz/resource-server/scope"
    headers = {'Authorization': f'Bearer {token}'}
    res = requests.get(url, headers=headers, params={'name': scope_name}, verify=False)
    res.raise_for_status()
    scopes = res.json()
    for s in scopes:
        if s['name'] == scope_name:
            return s['id']
    raise ValueError(f"Authz Scope '{scope_name}' not found")

def create_scope_permission(keycloak_url, token, target_realm, mgmt_client_id, perm_name, description, resource_type, scope_names, policy_ids):
    url = f"{keycloak_url}/admin/realms/{target_realm}/clients/{mgmt_client_id}/authz/resource-server/permission/scope"
    headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}
    
    # Check if permission exists
    search_res = requests.get(url, headers=headers, params={'name': perm_name}, verify=False)
    search_res.raise_for_status()
    if search_res.json():
        note(f"Scope permission '{perm_name}' already exists.")
        return search_res.json()[0]['id']

    # Resolve scopes
    scope_ids = []
    for sname in scope_names:
        note(f"Resolving authz scope '{sname}' for permission '{perm_name}'")
        scope_ids.append(get_scope_id(keycloak_url, token, target_realm, mgmt_client_id, sname))

    payload = {
        "name": perm_name,
        "description": description,
        "type": "scope",
        "logic": "POSITIVE",
        "decisionStrategy": "UNANIMOUS",
        "resourceType": resource_type,
        "policies": policy_ids,
        "resources": [],
        "scopes": scope_ids
    }

    note(f"Creating scope permission '{perm_name}'...")
    response = requests.post(url, headers=headers, json=payload, verify=False)
    if response.status_code == 409:
         note(f"Permission '{perm_name}' exists (conflict).")
         return search_res.json()[0]['id']
    response.raise_for_status()
    return response.json()['id']

def main():
    parser = argparse.ArgumentParser(description="Configure FGAPv2 for Keycloak 26 via Authz API")
    parser.add_argument('--url',         default='http://localhost:8080', help='Keycloak Base URL')
    parser.add_argument('--user',        default='permrealmadmin', help='Realm Admin User')
    parser.add_argument('--password',    default='StrongPerm@123', help='Realm Admin Password')
    parser.add_argument('--realm',       default='org-new-delhi', help='Target Realm to configure')
    parser.add_argument('--marker-file', default=os.getenv('STEP2_FGAP_MARKER_FILE', ''))
    parser.add_argument('--force',       action='store_true', default=(os.getenv('STEP2_FGAP_FORCE', 'false').lower() == 'true'))
    args = parser.parse_args()

    if args.marker_file and not args.force and os.path.exists(args.marker_file):
        note(f"marker exists at {args.marker_file}; skipping (set STEP2_FGAP_FORCE=true to rerun).")
        sys.exit(0)

    note(f"Connecting to {args.url} as {args.user}")
    try:
        note(f"Requesting admin token in realm '{args.realm}'")
        token = get_admin_token(args.url, args.realm, args.user, args.password)
    except Exception as e:
        note(f"Failed to get admin token: {e}")
        sys.exit(1)

    # 1. Ensure adminPermissionsEnabled=true
    note("Checking realm admin permissions switch")
    enable_admin_permissions(args.url, token, args.realm)

    # 2. Get necessary entity IDs
    note("Locating admin-permissions client")
    mgmt_client_id = get_realm_management_client_id(args.url, token, args.realm)
    note(f"Found admin-permissions client ID: {mgmt_client_id}")
    
    note("Resolving user-manager role")
    user_manager_role_id = get_role_id(args.url, token, args.realm, 'user-manager')
    note(f"Found 'user-manager' role ID: {user_manager_role_id}")

    # 3. Create the Role Policy
    note("Ensuring role policy for user-manager")
    policy_id = create_role_policy(
        args.url, token, args.realm, mgmt_client_id, 
        policy_name="policy-user-manager", 
        role_id=user_manager_role_id
    )
    note(f"Role policy ID: {policy_id}")

    # 4. Create User Permission
    note("Ensuring Users scope permission")
    perm_users_id = create_scope_permission(
        keycloak_url=args.url,
        token=token,
        target_realm=args.realm,
        mgmt_client_id=mgmt_client_id,
        perm_name="perm-users-user-manager",
        description="Allow user-manager to create/edit users and assign group membership",
        resource_type="Users",
        scope_names=["view", "manage", "manage-group-membership"],
        policy_ids=[policy_id]
    )
    note(f"Users permission ID: {perm_users_id}")

    # 5. Create Group Permission
    note("Ensuring Groups scope permission")
    perm_groups_id = create_scope_permission(
        keycloak_url=args.url,
        token=token,
        target_realm=args.realm,
        mgmt_client_id=mgmt_client_id,
        perm_name="perm-groups-user-manager-readonly",
        description="user-manager can only read groups and view members",
        resource_type="Groups",
        scope_names=["view", "view-members", "manage-membership"],
        policy_ids=[policy_id]
    )
    note(f"Groups permission ID: {perm_groups_id}")

    note("Success: FGAPv2 configured.")

    if args.marker_file:
        import pathlib
        pathlib.Path(args.marker_file).parent.mkdir(parents=True, exist_ok=True)
        pathlib.Path(args.marker_file).write_text("")
        note(f"Marker written: {args.marker_file}")

if __name__ == '__main__':
    main()

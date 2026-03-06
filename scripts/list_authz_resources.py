import requests
import json
import os
from urllib3.exceptions import InsecureRequestWarning
requests.packages.urllib3.disable_warnings(InsecureRequestWarning)

def get_admin_token(keycloak_url, login_realm, admin_user, admin_password):
    url = f"{keycloak_url}/realms/{login_realm}/protocol/openid-connect/token"
    payload = {
        'client_id': 'admin-cli',
        'username': admin_user,
        'password': admin_password,
        'grant_type': 'password'
    }
    response = requests.post(url, data=payload, verify=False, timeout=10)
    response.raise_for_status()
    return response.json()['access_token']

def list_resources(keycloak_url, token, target_realm, mgmt_client_id):
    url = f"{keycloak_url}/admin/realms/{target_realm}/clients/{mgmt_client_id}/authz/resource-server/resource"
    headers = {'Authorization': f'Bearer {token}'}
    response = requests.get(url, headers=headers, verify=False)
    response.raise_for_status()
    return response.json()

KC_URL = 'http://localhost:8080'
REALM = 'org-new-delhi'
USER = 'realmadmin1'
PASS = 'StrongPass@123'

token = get_admin_token(KC_URL, REALM, USER, PASS)
# Get admin-permissions client internal id
url = f"{KC_URL}/admin/realms/{REALM}/clients"
headers = {'Authorization': f'Bearer {token}'}
params = {'clientId': 'admin-permissions'}
res = requests.get(url, headers=headers, params=params, verify=False)
res.raise_for_status()
mgmt_client_id = res.json()[0]['id']

resources = list_resources(KC_URL, token, REALM, mgmt_client_id)
# Find if any name contains 'app-testing-client'
print(f"Total resources: {len(resources)}")
for r in resources:
    # Get full details of the resource to see scopes
    res_url = f"{KC_URL}/admin/realms/{REALM}/clients/{mgmt_client_id}/authz/resource-server/resource/{r.get('_id') or r.get('id')}"
    resp = requests.get(res_url, headers={'Authorization': f'Bearer {token}'}, verify=False)
    details = resp.json()
    scopes = [s.get('name') for s in details.get('scopes', [])]
    print(f"Resource: {r.get('name')} (id={r.get('_id') or r.get('id')}), scopes={scopes}")

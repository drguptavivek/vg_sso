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

def list_scopes(keycloak_url, token, target_realm, mgmt_client_id):
    url = f"{keycloak_url}/admin/realms/{target_realm}/clients/{mgmt_client_id}/authz/resource-server/scope"
    headers = {'Authorization': f'Bearer {token}'}
    response = requests.get(url, headers=headers, verify=False)
    response.raise_for_status()
    return response.json()

KC_URL = 'http://localhost:8080'
REALM = 'org-new-delhi'
USER = 'realmadmin1'
PASS = 'StrongPass@123'

token = get_admin_token(KC_URL, REALM, USER, PASS)
url = f"{KC_URL}/admin/realms/{REALM}/clients"
res = requests.get(url, headers={'Authorization': f'Bearer {token}'}, params={'clientId': 'admin-permissions'}, verify=False)
res.raise_for_status()
mgmt_client_id = res.json()[0]['id']

scopes = list_scopes(KC_URL, token, REALM, mgmt_client_id)
print(f"Total scopes: {len(scopes)}")
for s in sorted([s['name'] for s in scopes]):
    print(f"Scope: {s}")

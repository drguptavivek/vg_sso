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

KC_URL = 'http://localhost:8080'
REALM = 'org-new-delhi'
USER = 'realmadmin1'
PASS = 'StrongPass@123'

token = get_admin_token(KC_URL, REALM, USER, PASS)
headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}

# Get admin-permissions ID
res = requests.get(f"{KC_URL}/admin/realms/{REALM}/clients", headers=headers, params={'clientId': 'admin-permissions'}, verify=False)
mgmt_client_id = res.json()[0]['id']

url = f"{KC_URL}/admin/realms/{REALM}/clients/{mgmt_client_id}/authz/resource-server/resource"
# Try different names
# Get app-testing-client ID
res = requests.get(f"{KC_URL}/admin/realms/{REALM}/clients", headers=headers, params={'clientId': 'app-testing-client'}, verify=False)
client_id = res.json()[0]['id']

# Try GUID as name
for name in [client_id]:
    payload = {
        "name": name,
        "type": "Clients",
        "ownerManagedAccess": False
    }
    res = requests.post(url, headers=headers, json=payload, verify=False)
    print(f"Name: {name}, Status: {res.status_code}, Response: {res.text}")

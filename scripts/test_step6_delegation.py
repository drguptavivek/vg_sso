#!/usr/bin/env python3
"""
Test: Step 6 — FGAP v2 Delegated Client Administration
=======================================================
Verifies the 'client-manager' role behaves correctly:
  ✅ test_01: Can list/view clients
  ✅ test_02: Can create and configure new clients
  ✅ test_03: Can delete own clients (FGAP v2 — manage scope implies delete)
              NOTE: True delete restriction requires a custom SPI (step 6b).
  ✅ test_04: CANNOT edit system clients (broker, realm-management, etc.)
  ✅ test_05: CANNOT delete system clients
  ✅ test_06: CAN deactivate (disable) a self-created client
"""
import os
import sys
import unittest
import requests
import uuid
import urllib3
from urllib3.exceptions import InsecureRequestWarning

urllib3.disable_warnings(InsecureRequestWarning)

# System clients that must NOT be editable/deletable by client-manager
SYSTEM_CLIENT_IDS = [
    'broker',
    'realm-management',
    'security-admin-console',
]


class TestStep6Delegation(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.url = os.getenv('KC_SERVER_URL', 'http://localhost:8080')
        cls.realm = os.getenv('KC_NEW_REALM_NAME', 'org-new-delhi')
        cls.admin_user = os.getenv('KC_NEW_REALM_ADMIN_USER', 'realmadmin1')
        cls.admin_password = os.getenv('KC_NEW_REALM_ADMIN_PASSWORD')

        if not cls.admin_password:
            raise unittest.SkipTest("KC_NEW_REALM_ADMIN_PASSWORD not set")

        cls.session = requests.Session()
        cls.session.verify = False

        # ── Admin token ──
        token_url = f"{cls.url}/realms/{cls.realm}/protocol/openid-connect/token"
        res = cls.session.post(token_url, data={
            'client_id': 'admin-cli',
            'username': cls.admin_user,
            'password': cls.admin_password,
            'grant_type': 'password'
        }, timeout=10)
        res.raise_for_status()
        cls.admin_token = res.json()['access_token']
        cls.headers = {'Authorization': f'Bearer {cls.admin_token}', 'Content-Type': 'application/json'}

        # ── Create unique test user ──
        cls.test_username = f"clientadmin-{uuid.uuid4().hex[:6]}"
        cls.test_password = f"TestDelegation@{uuid.uuid4().hex[:6]}"
        print(f"\nCreating test user: {cls.test_username}")

        res = cls.session.post(f"{cls.url}/admin/realms/{cls.realm}/users", headers=cls.headers, json={
            "username": cls.test_username,
            "enabled": True,
            "email": f"{cls.test_username}@example.org",
            "emailVerified": True,
            "firstName": "Test",
            "lastName": "Delegation",
            "attributes": {"mobile": ["+1234567890"], "mobile_verified": ["true"]},
            "requiredActions": []
        })
        res.raise_for_status()

        res = cls.session.get(f"{cls.url}/admin/realms/{cls.realm}/users",
                              params={'username': cls.test_username}, headers=cls.headers)
        cls.test_user_id = res.json()[0]['id']

        # Set password
        cls.session.put(
            f"{cls.url}/admin/realms/{cls.realm}/users/{cls.test_user_id}/reset-password",
            json={"type": "password", "temporary": False, "value": cls.test_password},
            headers=cls.headers
        ).raise_for_status()

        # ── Assign client-manager realm role ──
        res = cls.session.get(f"{cls.url}/admin/realms/{cls.realm}/roles/client-manager", headers=cls.headers)
        res.raise_for_status()
        role = res.json()
        cls.session.post(
            f"{cls.url}/admin/realms/{cls.realm}/users/{cls.test_user_id}/role-mappings/realm",
            json=[role], headers=cls.headers
        ).raise_for_status()
        print(f"Assigned 'client-manager' role to {cls.test_username}")

        # ── Get delegated user token ──
        res = cls.session.post(token_url, data={
            'client_id': 'admin-cli',
            'username': cls.test_username,
            'password': cls.test_password,
            'grant_type': 'password'
        }, timeout=10)

        # Clear any required actions if login fails
        if res.status_code == 400 and "Account is not fully set up" in res.text:
            cls.session.put(
                f"{cls.url}/admin/realms/{cls.realm}/users/{cls.test_user_id}",
                json={"emailVerified": True, "enabled": True, "requiredActions": []},
                headers=cls.headers
            ).raise_for_status()
            res = cls.session.post(token_url, data={
                'client_id': 'admin-cli',
                'username': cls.test_username,
                'password': cls.test_password,
                'grant_type': 'password'
            }, timeout=10)

        res.raise_for_status()
        cls.test_token = res.json()['access_token']
        cls.test_headers = {'Authorization': f'Bearer {cls.test_token}', 'Content-Type': 'application/json'}
        print(f"Got delegated user token for {cls.test_username}")

    @classmethod
    def get_client_id(cls, client_id_name):
        """Get internal UUID of a client (using admin token)."""
        res = cls.session.get(
            f"{cls.url}/admin/realms/{cls.realm}/clients",
            params={'clientId': client_id_name},
            headers=cls.headers
        )
        res.raise_for_status()
        data = res.json()
        if not data:
            return None
        return data[0]['id']

    @classmethod
    def tearDownClass(cls):
        # Clean up the created client if still exists
        if hasattr(cls, 'created_client_id') and cls.created_client_id:
            cls.session.delete(
                f"{cls.url}/admin/realms/{cls.realm}/clients/{cls.created_client_id}",
                headers=cls.headers
            )
        # Clean up test user
        if hasattr(cls, 'test_user_id'):
            print(f"\nCleaning up test user: {cls.test_username}")
            cls.session.delete(
                f"{cls.url}/admin/realms/{cls.realm}/users/{cls.test_user_id}",
                headers=cls.headers
            )

    # ─────────────────────── TESTS ─────────────────────────────────────── #

    def test_01_client_listing(self):
        """✅ Delegated admin can list/view clients."""
        res = self.session.get(
            f"{self.url}/admin/realms/{self.realm}/clients",
            headers=self.test_headers
        )
        self.assertEqual(res.status_code, 200, f"Expected 200, got {res.status_code}: {res.text}")
        clients = res.json()
        self.assertGreater(len(clients), 0, "Should see at least one client")
        print(f"\n✅ test_01: Can list clients ({len(clients)} visible)")

    def test_02_client_creation_and_config(self):
        """✅ Delegated admin can create and configure a new client."""
        test_client_id = f"test-client-{uuid.uuid4().hex[:6]}"
        print(f"\nCreating client: {test_client_id}")

        # Create
        res = self.session.post(
            f"{self.url}/admin/realms/{self.realm}/clients",
            json={"clientId": test_client_id, "enabled": True, "protocol": "openid-connect"},
            headers=self.test_headers
        )
        self.assertEqual(res.status_code, 201, f"Expected 201, got {res.status_code}: {res.text}")

        # Get internal ID
        res = self.session.get(
            f"{self.url}/admin/realms/{self.realm}/clients",
            params={'clientId': test_client_id},
            headers=self.test_headers
        )
        internal_id = res.json()[0]['id']

        # Configure
        res = self.session.put(
            f"{self.url}/admin/realms/{self.realm}/clients/{internal_id}",
            json={"clientId": test_client_id, "enabled": True, "description": "Updated by delegated admin"},
            headers=self.test_headers
        )
        self.assertEqual(res.status_code, 204, f"Expected 204, got {res.status_code}: {res.text}")

        self.__class__.created_client_id = internal_id
        print(f"✅ test_02: Created and configured client '{test_client_id}'")

    def test_03_own_client_deletion_blocked(self):
        """
        ✅ delegated-admin-guard SPI blocks CLIENT DELETE even for own clients.
        The SPI throws ForbiddenException within the transaction before commit.
        """
        if not hasattr(self.__class__, 'created_client_id') or not self.__class__.created_client_id:
            self.skipTest("No client created in previous test")

        print(f"\nAttempting to delete own client (expecting 403): {self.__class__.created_client_id}")
        res = self.session.delete(
            f"{self.url}/admin/realms/{self.realm}/clients/{self.__class__.created_client_id}",
            headers=self.test_headers
        )
        self.assertEqual(res.status_code, 403,
                         f"delegated-admin-guard SPI should block delete. Got {res.status_code}: {res.text}")
        print("✅ test_03: CLIENT DELETE blocked by delegated-admin-guard SPI → 403")

    def test_04_system_client_edit_denied(self):
        """✅ Delegated admin CANNOT edit system clients (broker, realm-management, etc.)."""
        for system_client_name in SYSTEM_CLIENT_IDS:
            system_id = self.get_client_id(system_client_name)
            if not system_id:
                print(f"  ⚠️  System client '{system_client_name}' not found — skipping")
                continue

            # First try to view it (should still work via global view permission)
            res = self.session.get(
                f"{self.url}/admin/realms/{self.realm}/clients/{system_id}",
                headers=self.test_headers
            )
            # View may or may not be 200 depending on filtering — that's ok

            # Try to UPDATE the system client — must be DENIED
            current = res.json() if res.status_code == 200 else {}
            current['description'] = 'Tampered by delegated admin'
            res = self.session.put(
                f"{self.url}/admin/realms/{self.realm}/clients/{system_id}",
                json=current,
                headers=self.test_headers
            )
            self.assertEqual(
                res.status_code, 403,
                f"SECURITY: client-manager should NOT be able to edit '{system_client_name}'. "
                f"Got {res.status_code}: {res.text}"
            )
            print(f"✅ test_04: Cannot edit system client '{system_client_name}' → 403")

    def test_05_system_client_delete_denied(self):
        """✅ Delegated admin CANNOT delete system clients."""
        for system_client_name in SYSTEM_CLIENT_IDS:
            system_id = self.get_client_id(system_client_name)
            if not system_id:
                print(f"  ⚠️  System client '{system_client_name}' not found — skipping")
                continue

            res = self.session.delete(
                f"{self.url}/admin/realms/{self.realm}/clients/{system_id}",
                headers=self.test_headers
            )
            self.assertEqual(
                res.status_code, 403,
                f"SECURITY: client-manager should NOT be able to delete '{system_client_name}'. "
                f"Got {res.status_code}: {res.text}"
            )
            print(f"✅ test_05: Cannot delete system client '{system_client_name}' → 403")

    def test_06_deactivate_own_client(self):
        """✅ Delegated admin CAN deactivate (disable) a client they create."""
        test_client_id = f"test-deactivate-{uuid.uuid4().hex[:6]}"
        print(f"\nCreating client to deactivate: {test_client_id}")

        # Create
        res = self.session.post(
            f"{self.url}/admin/realms/{self.realm}/clients",
            json={"clientId": test_client_id, "enabled": True, "protocol": "openid-connect"},
            headers=self.test_headers
        )
        self.assertEqual(res.status_code, 201, f"Create failed: {res.text}")

        res = self.session.get(
            f"{self.url}/admin/realms/{self.realm}/clients",
            params={'clientId': test_client_id},
            headers=self.test_headers
        )
        internal_id = res.json()[0]['id']

        # Deactivate (set enabled=False)
        res = self.session.put(
            f"{self.url}/admin/realms/{self.realm}/clients/{internal_id}",
            json={"clientId": test_client_id, "enabled": False},
            headers=self.test_headers
        )
        self.assertEqual(res.status_code, 204, f"Expected 204 for deactivation, got {res.status_code}: {res.text}")
        print(f"✅ test_06: Can deactivate own client '{test_client_id}'")

        # Verify it's actually disabled (using admin token)
        res = self.session.get(
            f"{self.url}/admin/realms/{self.realm}/clients/{internal_id}",
            headers=self.headers  # admin token
        )
        self.assertEqual(res.json().get('enabled'), False, "Client should be disabled")
        print(f"   Verified: client.enabled=False in Keycloak")

        self.session.delete(
            f"{self.url}/admin/realms/{self.realm}/clients/{internal_id}",
            headers=self.headers
        )

    def test_07_client_scope_mutations_blocked(self):
        """
        ✅ Delegated admin CANNOT create, update, or delete client scopes.
        Protected by delegated-admin-guard SPI (CLIENT_SCOPE resource type).
        """
        print("\n--- Client Scope Protection Check ---")

        # Try CREATE a new client scope → must be blocked
        res = self.session.post(
            f"{self.url}/admin/realms/{self.realm}/client-scopes",
            json={"name": f"probe-scope-{uuid.uuid4().hex[:6]}", "protocol": "openid-connect"},
            headers=self.test_headers
        )
        self.assertEqual(
            res.status_code, 403,
            f"SECURITY: client-manager should NOT create client-scopes. Got {res.status_code}: {res.text}"
        )
        print("✅ test_07: CREATE client-scope → 403")

        # Get an existing scope via admin token to test UPDATE and DELETE
        admin_scopes = self.session.get(
            f"{self.url}/admin/realms/{self.realm}/client-scopes",
            headers=self.headers
        ).json()
        self.assertTrue(len(admin_scopes) > 0, "Admin should see at least one client scope")
        scope = admin_scopes[0]

        # Try UPDATE → must be blocked
        res = self.session.put(
            f"{self.url}/admin/realms/{self.realm}/client-scopes/{scope['id']}",
            json={**scope, "description": "tampered by client-manager"},
            headers=self.test_headers
        )
        self.assertEqual(
            res.status_code, 403,
            f"SECURITY: client-manager should NOT update client-scopes. Got {res.status_code}: {res.text}"
        )
        print(f"✅ test_07: UPDATE client-scope '{scope['name']}' → 403")

        # Try DELETE → must be blocked
        res = self.session.delete(
            f"{self.url}/admin/realms/{self.realm}/client-scopes/{scope['id']}",
            headers=self.test_headers
        )
        self.assertEqual(
            res.status_code, 403,
            f"SECURITY: client-manager should NOT delete client-scopes. Got {res.status_code}: {res.text}"
        )
        print(f"✅ test_07: DELETE client-scope '{scope['name']}' → 403")


if __name__ == "__main__":
    unittest.main(verbosity=2)

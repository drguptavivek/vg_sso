#!/usr/bin/env python3
"""
Test: Step 7 — Per-Client Administration (PCA)
================================================
Verifies the Per-Client Admin (PCA) system works end-to-end:

  ✅ test_01: client-manager creates test-app-alpha → AppRoles/test-app-alpha group auto-created
  ✅ test_02: Creator is direct member of AppRoles/test-app-alpha (is PCA)
  ✅ test_03: PCA can view client list
  ✅ test_04: PCA can edit their own client (test-app-alpha settings)
  ✅ test_05: CM+PCA user can edit another non-system client (CM precedence)
  ✅ test_06: PCA cannot edit system clients → 403
  ✅ test_07: PCA cannot delete any client → 403
  ✅ test_08: PCA can create a subgroup under AppRoles/test-app-alpha
  ✅ test_08b: PCA cannot delete AppRoles/{clientId} root group
  ✅ test_08c: PCA can delete descendant groups under owned AppRoles subtree
  ✅ test_09: PCA can add a user to the subgroup
  ✅ test_10: PCA can map a client role to the subgroup
  ✅ test_11: User in subgroup has the client role in their token
  ✅ test_12: PCA can add another user as co-PCA (direct member of app group)
  ✅ test_13: client-manager cannot delete AppRoles parent group → 403
  ✅ test_14: manual delegated-client-admin-base role mapping via REST is blocked (auto-only invariant)
  ✅ test_15: audit finds no orphan delegated-client-admin-base users (without direct AppRoles/{clientId} membership)
  ✅ test_16: default-deny blocks unsupported delegated user UPDATE endpoint
  ✅ test_17: default-deny blocks unsupported delegated reset-password endpoint
  ✅ test_18: allow-list permits delegated REMOVE membership in owned subtree
  ✅ test_19: allow-list permits delegated UPDATE on owned descendant group
  ✅ test_20: auto-grant delegated-client-admin-base when user added to AppRoles/{clientId} root
  ✅ test_21: auto-revoke delegated-client-admin-base when user removed from all AppRoles roots
"""
import os
import sys
import json
import unittest
import requests
import uuid
import urllib3
from urllib3.exceptions import InsecureRequestWarning

urllib3.disable_warnings(InsecureRequestWarning)

SYSTEM_CLIENT_IDS = ['broker', 'realm-management', 'security-admin-console']
APPROLES_GROUP_NAME = 'AppRoles'


class TestStep7PCA(unittest.TestCase):

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

        token_url = f"{cls.url}/realms/{cls.realm}/protocol/openid-connect/token"

        # ── Admin token ──
        res = cls.session.post(token_url, data={
            'client_id': 'admin-cli',
            'username': cls.admin_user,
            'password': cls.admin_password,
            'grant_type': 'password'
        }, timeout=10)
        res.raise_for_status()
        cls.admin_token = res.json()['access_token']
        cls.admin_headers = {'Authorization': f'Bearer {cls.admin_token}', 'Content-Type': 'application/json'}

        # ── Create client-manager user (will become PCA after creating a client) ──
        cls.cm_username = f"cm-{uuid.uuid4().hex[:6]}"
        cls.cm_password = f"TestPCA@{uuid.uuid4().hex[:6]}"
        print(f"\nCreating client-manager user: {cls.cm_username}")

        res = cls.session.post(
            f"{cls.url}/admin/realms/{cls.realm}/users",
            headers=cls.admin_headers,
            json={
                "username": cls.cm_username,
                "enabled": True,
                "email": f"{cls.cm_username}@example.org",
                "emailVerified": True,
                "firstName": "Test",
                "lastName": "ClientManager",
                "attributes": {"mobile": ["+1234567890"], "mobile_verified": ["true"]},
                "requiredActions": []
            }
        )
        res.raise_for_status()
        cls.cm_user_id = cls._get_user_id(cls, cls.cm_username)

        # Set password
        cls.session.put(
            f"{cls.url}/admin/realms/{cls.realm}/users/{cls.cm_user_id}/reset-password",
            json={"type": "password", "temporary": False, "value": cls.cm_password},
            headers=cls.admin_headers
        ).raise_for_status()

        # Assign client-manager role
        role_res = cls.session.get(
            f"{cls.url}/admin/realms/{cls.realm}/roles/client-manager",
            headers=cls.admin_headers
        )
        role_res.raise_for_status()
        cls.session.post(
            f"{cls.url}/admin/realms/{cls.realm}/users/{cls.cm_user_id}/role-mappings/realm",
            json=[role_res.json()], headers=cls.admin_headers
        ).raise_for_status()
        print(f"Assigned 'client-manager' role to {cls.cm_username}")

        # ── Get client-manager token ──
        res = cls.session.post(token_url, data={
            'client_id': 'admin-cli',
            'username': cls.cm_username,
            'password': cls.cm_password,
            'grant_type': 'password'
        }, timeout=10)
        if res.status_code == 400 and "Account is not fully set up" in res.text:
            cls.session.put(
                f"{cls.url}/admin/realms/{cls.realm}/users/{cls.cm_user_id}",
                json={"emailVerified": True, "enabled": True, "requiredActions": []},
                headers=cls.admin_headers
            ).raise_for_status()
            res = cls.session.post(token_url, data={
                'client_id': 'admin-cli',
                'username': cls.cm_username,
                'password': cls.cm_password,
                'grant_type': 'password'
            }, timeout=10)
        res.raise_for_status()
        cls.cm_token = res.json()['access_token']
        cls.cm_headers = {'Authorization': f'Bearer {cls.cm_token}', 'Content-Type': 'application/json'}
        print(f"Got client-manager token for {cls.cm_username}")

        # ── Create test-app-alpha via client-manager (triggers event listener) ──
        cls.alpha_client_id = f"test-app-alpha-{uuid.uuid4().hex[:6]}"
        cls.beta_client_id  = f"test-app-beta-{uuid.uuid4().hex[:6]}"
        print(f"\nCreating client via client-manager: {cls.alpha_client_id}")
        res = cls.session.post(
            f"{cls.url}/admin/realms/{cls.realm}/clients",
            json={"clientId": cls.alpha_client_id, "enabled": True, "protocol": "openid-connect"},
            headers=cls.cm_headers
        )
        res.raise_for_status()
        cls.alpha_uuid = cls._get_client_uuid(cls, cls.alpha_client_id, use_admin=True)
        print(f"Created {cls.alpha_client_id} (uuid={cls.alpha_uuid})")

        # ── Create test-app-beta via admin (for PCA isolation test) ──
        print(f"Creating client via admin: {cls.beta_client_id}")
        res = cls.session.post(
            f"{cls.url}/admin/realms/{cls.realm}/clients",
            json={"clientId": cls.beta_client_id, "enabled": True, "protocol": "openid-connect"},
            headers=cls.admin_headers
        )
        res.raise_for_status()
        cls.beta_uuid = cls._get_client_uuid(cls, cls.beta_client_id, use_admin=True)
        print(f"Created {cls.beta_client_id} (uuid={cls.beta_uuid})")

        # ── Re-fetch PCA token (delegated-client-admin-base role was granted by event listener) ──
        res = cls.session.post(token_url, data={
            'client_id': 'admin-cli',
            'username': cls.cm_username,
            'password': cls.cm_password,
            'grant_type': 'password'
        }, timeout=10)
        res.raise_for_status()
        cls.pca_token = res.json()['access_token']
        cls.pca_headers = {'Authorization': f'Bearer {cls.pca_token}', 'Content-Type': 'application/json'}
        print(f"Re-fetched PCA token for {cls.cm_username}")

        # ── Create a regular test user (target of group membership operations) ──
        cls.target_username = f"enduser-{uuid.uuid4().hex[:6]}"
        cls.target_password = f"TestUser@{uuid.uuid4().hex[:6]}"
        res = cls.session.post(
            f"{cls.url}/admin/realms/{cls.realm}/users",
            headers=cls.admin_headers,
            json={
                "username": cls.target_username,
                "enabled": True,
                "email": f"{cls.target_username}@example.org",
                "emailVerified": True,
                "firstName": "End",
                "lastName": "User",
                "attributes": {"mobile": ["+1234567891"], "mobile_verified": ["true"]},
                "requiredActions": []
            }
        )
        res.raise_for_status()
        cls.target_user_id = cls._get_user_id(cls, cls.target_username)
        cls.session.put(
            f"{cls.url}/admin/realms/{cls.realm}/users/{cls.target_user_id}/reset-password",
            json={"type": "password", "temporary": False, "value": cls.target_password},
            headers=cls.admin_headers
        ).raise_for_status()
        # Clear any default required actions (mobile verification etc.)
        cls.session.put(
            f"{cls.url}/admin/realms/{cls.realm}/users/{cls.target_user_id}",
            json={"emailVerified": True, "enabled": True, "requiredActions": [],
                  "attributes": {"mobile": ["+1234567891"], "mobile_verified": ["true"]}},
            headers=cls.admin_headers
        ).raise_for_status()
        print(f"Created end user: {cls.target_username}")

        # ── Create co-PCA candidate user ──
        cls.copca_username = f"copca-{uuid.uuid4().hex[:6]}"
        cls.copca_password = f"TestCoPCA@{uuid.uuid4().hex[:6]}"
        res = cls.session.post(
            f"{cls.url}/admin/realms/{cls.realm}/users",
            headers=cls.admin_headers,
            json={
                "username": cls.copca_username,
                "enabled": True,
                "email": f"{cls.copca_username}@example.org",
                "emailVerified": True,
                "firstName": "Co",
                "lastName": "PCA",
                "attributes": {"mobile": ["+1234567892"], "mobile_verified": ["true"]},
                "requiredActions": []
            }
        )
        res.raise_for_status()
        cls.copca_user_id = cls._get_user_id(cls, cls.copca_username)
        cls.session.put(
            f"{cls.url}/admin/realms/{cls.realm}/users/{cls.copca_user_id}/reset-password",
            json={"type": "password", "temporary": False, "value": cls.copca_password},
            headers=cls.admin_headers
        ).raise_for_status()
        print(f"Created co-PCA candidate: {cls.copca_username}")

        # Class-level state for shared test values
        cls.app_group_id = None       # AppRoles/{alpha_client_id} group UUID
        cls.subgroup_id = None        # AppRoles/{alpha_client_id}/manager subgroup UUID
        cls.subgroup_name = f"manager-{uuid.uuid4().hex[:4]}"

    def _get_user_id(self, username):
        res = self.session.get(
            f"{self.url}/admin/realms/{self.realm}/users",
            params={'username': username}, headers=self.admin_headers
        )
        res.raise_for_status()
        return res.json()[0]['id']

    def _get_client_uuid(self, client_id_name, use_admin=False):
        h = self.admin_headers if use_admin else self.pca_headers
        res = self.session.get(
            f"{self.url}/admin/realms/{self.realm}/clients",
            params={'clientId': client_id_name}, headers=h
        )
        res.raise_for_status()
        data = res.json()
        return data[0]['id'] if data else None

    def _find_group_by_name(self, group_name, parent_id=None):
        """Find a group UUID by name (using admin token)."""
        res = self.session.get(
            f"{self.url}/admin/realms/{self.realm}/groups",
            params={'search': group_name, 'exact': 'true'},
            headers=self.admin_headers
        )
        res.raise_for_status()
        groups = res.json()
        for g in groups:
            if g['name'] == group_name and (parent_id is None):
                return g['id']
            if g.get('subGroups'):
                for sg in g['subGroups']:
                    if sg['name'] == group_name and (parent_id is None or g['id'] == parent_id):
                        return sg['id']
        return None

    def _get_approles_group_id(self):
        """Resolve AppRoles parent group UUID."""
        res = self.session.get(
            f"{self.url}/admin/realms/{self.realm}/groups",
            params={'search': APPROLES_GROUP_NAME, 'exact': 'true'},
            headers=self.admin_headers
        )
        res.raise_for_status()
        groups = res.json()
        for g in groups:
            if g['name'] == APPROLES_GROUP_NAME:
                return g['id']
        return None

    @classmethod
    def tearDownClass(cls):
        """Clean up all test artifacts using admin token."""
        print("\n--- Cleanup ---")

        # Delete test clients (admin token bypasses filter)
        for client_id, uuid_val in [
            (cls.alpha_client_id, getattr(cls, 'alpha_uuid', None)),
            (cls.beta_client_id,  getattr(cls, 'beta_uuid',  None)),
        ]:
            if uuid_val:
                cls.session.delete(
                    f"{cls.url}/admin/realms/{cls.realm}/clients/{uuid_val}",
                    headers=cls.admin_headers
                )
                print(f"Deleted client: {client_id}")

        # Delete test users
        for uid, uname in [
            (getattr(cls, 'cm_user_id',     None), cls.cm_username),
            (getattr(cls, 'target_user_id', None), cls.target_username),
            (getattr(cls, 'copca_user_id',  None), cls.copca_username),
        ]:
            if uid:
                cls.session.delete(
                    f"{cls.url}/admin/realms/{cls.realm}/users/{uid}",
                    headers=cls.admin_headers
                )
                print(f"Deleted user: {uname}")

        # Delete AppRoles/{alpha_client_id} group if it exists
        if getattr(cls, 'app_group_id', None):
            cls.session.delete(
                f"{cls.url}/admin/realms/{cls.realm}/groups/{cls.app_group_id}",
                headers=cls.admin_headers
            )
            print(f"Deleted app group for {cls.alpha_client_id}")

    # ─────────────────────── TESTS ─────────────────────────────────────── #

    def test_01_approles_subgroup_auto_created(self):
        """✅ After client-manager creates test-app-alpha, AppRoles/{clientId} group exists."""
        approles_id = self._get_approles_group_id()
        self.assertIsNotNone(approles_id, f"'{APPROLES_GROUP_NAME}' parent group must exist (run step7-init)")

        # Look for AppRoles/{alpha_client_id} subgroup.
        # Use /children endpoint — Keycloak 26 does NOT embed subGroups in group detail responses.
        res = self.session.get(
            f"{self.url}/admin/realms/{self.realm}/groups/{approles_id}/children",
            headers=self.admin_headers
        )
        res.raise_for_status()
        subgroups = res.json()
        app_group = next((g for g in subgroups if g['name'] == self.alpha_client_id), None)

        self.assertIsNotNone(
            app_group,
            f"Event listener must auto-create AppRoles/{self.alpha_client_id} on CLIENT_CREATE. "
            f"Found subgroups: {[g['name'] for g in subgroups]}"
        )
        self.__class__.app_group_id = app_group['id']
        print(f"\n✅ test_01: AppRoles/{self.alpha_client_id} auto-created (id={app_group['id']})")

    def test_02_creator_is_pca_member(self):
        """✅ Creator (client-manager user) is direct member of AppRoles/{clientId}."""
        if not self.__class__.app_group_id:
            self.skipTest("app_group_id not set — test_01 may have failed")

        res = self.session.get(
            f"{self.url}/admin/realms/{self.realm}/users/{self.cm_user_id}/groups",
            headers=self.admin_headers
        )
        res.raise_for_status()
        groups = res.json()
        app_group_names = [g['name'] for g in groups]

        self.assertIn(
            self.alpha_client_id, app_group_names,
            f"Creator '{self.cm_username}' must be direct member of AppRoles/{self.alpha_client_id}. "
            f"Found groups: {app_group_names}"
        )
        print(f"\n✅ test_02: '{self.cm_username}' is direct member of AppRoles/{self.alpha_client_id}")

    def test_03_pca_can_view_clients(self):
        """✅ PCA can list/view clients."""
        res = self.session.get(
            f"{self.url}/admin/realms/{self.realm}/clients",
            headers=self.pca_headers
        )
        self.assertEqual(res.status_code, 200, f"Expected 200, got {res.status_code}: {res.text}")
        clients = res.json()
        self.assertGreater(len(clients), 0, "PCA should see at least one client")
        print(f"\n✅ test_03: PCA can list clients ({len(clients)} visible)")

    def test_04_pca_can_edit_own_client(self):
        """✅ PCA can edit settings of their own client."""
        res = self.session.put(
            f"{self.url}/admin/realms/{self.realm}/clients/{self.alpha_uuid}",
            json={"clientId": self.alpha_client_id, "enabled": True, "description": "Updated by PCA"},
            headers=self.pca_headers
        )
        self.assertEqual(
            res.status_code, 204,
            f"PCA should be able to update own client. Got {res.status_code}: {res.text}"
        )
        print(f"\n✅ test_04: PCA can edit own client '{self.alpha_client_id}' → 204")

    def test_05_cm_plus_pca_can_edit_other_client(self):
        """✅ If user is both client-manager and PCA, client-manager scope wins for client edits."""
        res = self.session.put(
            f"{self.url}/admin/realms/{self.realm}/clients/{self.beta_uuid}",
            json={"clientId": self.beta_client_id, "enabled": True, "description": "tampered by PCA"},
            headers=self.pca_headers
        )
        self.assertEqual(
            res.status_code, 204,
            f"CM+PCA should be able to edit non-system client. Got {res.status_code}: {res.text}"
        )
        print(f"\n✅ test_05: CM+PCA can edit '{self.beta_client_id}' (CM precedence) → 204")

    def test_06_pca_cannot_edit_system_clients(self):
        """✅ PCA cannot edit system clients — 403."""
        for system_cid in SYSTEM_CLIENT_IDS:
            res = self.session.get(
                f"{self.url}/admin/realms/{self.realm}/clients",
                params={'clientId': system_cid}, headers=self.admin_headers
            )
            if not res.json():
                print(f"  ⚠️  System client '{system_cid}' not found — skipping")
                continue
            sys_uuid = res.json()[0]['id']
            current = res.json()[0]

            res = self.session.put(
                f"{self.url}/admin/realms/{self.realm}/clients/{sys_uuid}",
                json={**current, "description": "tampered by PCA"},
                headers=self.pca_headers
            )
            self.assertEqual(
                res.status_code, 403,
                f"PCA should NOT be able to edit system client '{system_cid}'. Got {res.status_code}: {res.text}"
            )
            print(f"✅ test_06: PCA cannot edit system client '{system_cid}' → 403")

    def test_07_pca_cannot_delete_any_client(self):
        """✅ PCA cannot delete any client — 403."""
        # Try to delete their OWN client (should still be blocked by filter)
        res = self.session.delete(
            f"{self.url}/admin/realms/{self.realm}/clients/{self.alpha_uuid}",
            headers=self.pca_headers
        )
        self.assertEqual(
            res.status_code, 403,
            f"PCA should NOT be able to delete own client. Got {res.status_code}: {res.text}"
        )
        print(f"\n✅ test_07: PCA cannot delete own client → 403")

    def test_08_pca_can_create_subgroup(self):
        """✅ PCA can create a subgroup under AppRoles/{clientId}."""
        if not self.__class__.app_group_id:
            self.skipTest("app_group_id not set — test_01 may have failed")

        print(f"\nCreating subgroup '{self.subgroup_name}' under AppRoles/{self.alpha_client_id}")
        res = self.session.post(
            f"{self.url}/admin/realms/{self.realm}/groups/{self.app_group_id}/children",
            json={"name": self.subgroup_name},
            headers=self.pca_headers
        )
        self.assertIn(
            res.status_code, [200, 201],
            f"PCA should be able to create subgroups. Got {res.status_code}: {res.text}"
        )

        # Find the created subgroup (admin).
        # Use /children endpoint — Keycloak 26 does NOT embed subGroups in group detail responses.
        res2 = self.session.get(
            f"{self.url}/admin/realms/{self.realm}/groups/{self.app_group_id}/children",
            headers=self.admin_headers
        )
        res2.raise_for_status()
        subgroups = res2.json()
        sg = next((g for g in subgroups if g['name'] == self.subgroup_name), None)
        self.assertIsNotNone(sg, f"Subgroup '{self.subgroup_name}' should exist after creation")
        self.__class__.subgroup_id = sg['id']
        print(f"✅ test_08: PCA created subgroup '{self.subgroup_name}' (id={sg['id']})")

    def test_08b_pca_cannot_delete_owned_app_root(self):
        """✅ Delegated user cannot delete AppRoles/{clientId} root group."""
        if not self.__class__.app_group_id:
            self.skipTest("app_group_id not set — test_01 may have failed")

        res = self.session.delete(
            f"{self.url}/admin/realms/{self.realm}/groups/{self.app_group_id}",
            headers=self.pca_headers
        )
        self.assertEqual(
            res.status_code, 403,
            f"Should NOT delete owned AppRoles client root group. Got {res.status_code}: {res.text}"
        )
        print(f"✅ test_08b: cannot delete AppRoles/{self.alpha_client_id} root group → 403")

    def test_08c_pca_can_delete_owned_descendant(self):
        """✅ Delegated user can delete descendants under owned AppRoles/{clientId} subtree."""
        if not self.__class__.app_group_id:
            self.skipTest("app_group_id not set — test_01 may have failed")

        tmp_name = f"tmp-del-{uuid.uuid4().hex[:4]}"
        create_res = self.session.post(
            f"{self.url}/admin/realms/{self.realm}/groups/{self.app_group_id}/children",
            json={"name": tmp_name},
            headers=self.pca_headers
        )
        self.assertIn(create_res.status_code, [200, 201], f"Failed creating temp subgroup: {create_res.text}")

        list_res = self.session.get(
            f"{self.url}/admin/realms/{self.realm}/groups/{self.app_group_id}/children",
            headers=self.admin_headers
        )
        list_res.raise_for_status()
        tmp_group = next((g for g in list_res.json() if g['name'] == tmp_name), None)
        self.assertIsNotNone(tmp_group, "Temp subgroup should exist")

        del_res = self.session.delete(
            f"{self.url}/admin/realms/{self.realm}/groups/{tmp_group['id']}",
            headers=self.pca_headers
        )
        self.assertIn(
            del_res.status_code, [200, 204],
            f"Should be able to delete descendant subgroup. Got {del_res.status_code}: {del_res.text}"
        )
        print(f"✅ test_08c: deleted descendant subgroup '{tmp_name}' under owned app root")

    def test_09_pca_can_add_user_to_subgroup(self):
        """✅ PCA can add a user to a subgroup (group membership management)."""
        if not self.__class__.subgroup_id:
            self.skipTest("subgroup_id not set — test_08 may have failed")

        print(f"\nAdding user '{self.target_username}' to subgroup '{self.subgroup_name}'")
        res = self.session.put(
            f"{self.url}/admin/realms/{self.realm}/users/{self.target_user_id}/groups/{self.subgroup_id}",
            headers=self.pca_headers
        )
        self.assertEqual(
            res.status_code, 204,
            f"PCA should be able to add users to subgroups. Got {res.status_code}: {res.text}"
        )

        # Verify membership (admin)
        groups_res = self.session.get(
            f"{self.url}/admin/realms/{self.realm}/users/{self.target_user_id}/groups",
            headers=self.admin_headers
        )
        groups_res.raise_for_status()
        user_group_ids = [g['id'] for g in groups_res.json()]
        self.assertIn(self.subgroup_id, user_group_ids, "User should be in the subgroup")
        print(f"✅ test_09: PCA added '{self.target_username}' to subgroup '{self.subgroup_name}'")

    def test_10_pca_can_map_client_role_to_subgroup(self):
        """✅ PCA can map a client role to the subgroup (group role mapping)."""
        if not self.__class__.subgroup_id:
            self.skipTest("subgroup_id not set — test_08 may have failed")

        # Create a client role on test-app-alpha (admin does this — client role management
        # is covered by manage-clients composite which PCA already has)
        role_name = f"role-{self.subgroup_name}"
        res = self.session.post(
            f"{self.url}/admin/realms/{self.realm}/clients/{self.alpha_uuid}/roles",
            json={"name": role_name, "description": f"Role for {self.subgroup_name}"},
            headers=self.pca_headers
        )
        self.assertIn(
            res.status_code, [200, 201],
            f"PCA should be able to create client roles. Got {res.status_code}: {res.text}"
        )
        print(f"\nCreated client role '{role_name}' on {self.alpha_client_id}")

        # Get the role object
        role_res = self.session.get(
            f"{self.url}/admin/realms/{self.realm}/clients/{self.alpha_uuid}/roles/{role_name}",
            headers=self.admin_headers
        )
        role_res.raise_for_status()
        role_obj = role_res.json()

        # Map the role to the subgroup
        map_res = self.session.post(
            f"{self.url}/admin/realms/{self.realm}/groups/{self.subgroup_id}"
            f"/role-mappings/clients/{self.alpha_uuid}",
            json=[role_obj],
            headers=self.pca_headers
        )
        self.assertEqual(
            map_res.status_code, 204,
            f"PCA should be able to map client roles to subgroups. Got {map_res.status_code}: {map_res.text}"
        )
        print(f"✅ test_10: PCA mapped client role '{role_name}' → subgroup '{self.subgroup_name}'")
        self.__class__.mapped_role_name = role_name

    def test_11_user_has_client_role_in_token(self):
        """✅ User in subgroup has the mapped client role in their access token."""
        if not getattr(self.__class__, 'mapped_role_name', None):
            self.skipTest("mapped_role_name not set — test_10 may have failed")

        # Get a token for the target user
        token_url = f"{self.url}/realms/{self.realm}/protocol/openid-connect/token"
        res = self.session.post(token_url, data={
            'client_id': self.alpha_client_id,
            'username': self.target_username,
            'password': self.target_password,
            'grant_type': 'password'
        }, timeout=10)

        if res.status_code == 401:
            # Client might require direct grant enabled
            # Try with admin-cli (which always works for resource owner password grant)
            res = self.session.post(token_url, data={
                'client_id': 'admin-cli',
                'username': self.target_username,
                'password': self.target_password,
                'grant_type': 'password'
            }, timeout=10)

        if res.status_code != 200:
            self.skipTest(f"Could not get user token: {res.status_code} — {res.text[:200]}")

        token_data = res.json()
        access_token = token_data['access_token']

        # Decode the JWT payload (no verification needed for claim inspection)
        import base64
        parts = access_token.split('.')
        payload_b64 = parts[1] + '=='  # add padding
        payload = json.loads(base64.b64decode(payload_b64).decode('utf-8'))

        # Look for client roles in the token
        resource_access = payload.get('resource_access', {})
        client_roles = resource_access.get(self.alpha_client_id, {}).get('roles', [])

        self.assertIn(
            self.__class__.mapped_role_name, client_roles,
            f"User should have role '{self.__class__.mapped_role_name}' from group membership. "
            f"Token resource_access: {json.dumps(resource_access, indent=2)}"
        )
        print(f"\n✅ test_11: User token contains client role '{self.__class__.mapped_role_name}' "
              f"(via group membership)")

    def test_12_pca_can_add_copca(self):
        """✅ PCA can add another user as co-PCA (direct member of AppRoles/{clientId})."""
        if not self.__class__.app_group_id:
            self.skipTest("app_group_id not set — test_01 may have failed")

        print(f"\nAdding '{self.copca_username}' as co-PCA to AppRoles/{self.alpha_client_id}")
        res = self.session.put(
            f"{self.url}/admin/realms/{self.realm}/users/{self.copca_user_id}/groups/{self.app_group_id}",
            headers=self.pca_headers
        )
        self.assertEqual(
            res.status_code, 204,
            f"PCA should be able to add co-PCAs to app group. Got {res.status_code}: {res.text}"
        )

        # Verify co-PCA is in the group
        groups_res = self.session.get(
            f"{self.url}/admin/realms/{self.realm}/users/{self.copca_user_id}/groups",
            headers=self.admin_headers
        )
        groups_res.raise_for_status()
        user_group_ids = [g['id'] for g in groups_res.json()]
        self.assertIn(self.app_group_id, user_group_ids, "co-PCA should be in the app group")
        print(f"✅ test_12: PCA added '{self.copca_username}' as co-PCA to AppRoles/{self.alpha_client_id}")

    def test_20_auto_grant_pca_base_on_app_root_add(self):
        """✅ AppRoles root membership add auto-grants delegated-client-admin-base role."""
        role_mappings = self.session.get(
            f"{self.url}/admin/realms/{self.realm}/users/{self.copca_user_id}/role-mappings/realm",
            headers=self.admin_headers
        )
        role_mappings.raise_for_status()
        realm_role_names = {r.get("name") for r in role_mappings.json()}
        self.assertIn(
            "delegated-client-admin-base", realm_role_names,
            "co-PCA should auto-receive delegated-client-admin-base after being added to AppRoles/{clientId} root"
        )
        print("✅ test_20: auto-granted delegated-client-admin-base on AppRoles root membership add")

    def test_21_auto_revoke_pca_base_on_last_app_root_remove(self):
        """✅ Removing user from all AppRoles roots auto-revokes delegated-client-admin-base."""
        if not self.__class__.app_group_id:
            self.skipTest("app_group_id not set — test_01 may have failed")

        remove_res = self.session.delete(
            f"{self.url}/admin/realms/{self.realm}/users/{self.copca_user_id}/groups/{self.app_group_id}",
            headers=self.pca_headers
        )
        self.assertEqual(
            remove_res.status_code, 204,
            f"Expected 204 removing co-PCA from app root group. Got {remove_res.status_code}: {remove_res.text}"
        )

        role_mappings = self.session.get(
            f"{self.url}/admin/realms/{self.realm}/users/{self.copca_user_id}/role-mappings/realm",
            headers=self.admin_headers
        )
        role_mappings.raise_for_status()
        realm_role_names = {r.get("name") for r in role_mappings.json()}
        self.assertNotIn(
            "delegated-client-admin-base", realm_role_names,
            "delegated-client-admin-base should auto-revoke when user is removed from all direct AppRoles roots"
        )
        print("✅ test_21: auto-revoked delegated-client-admin-base after removing from last AppRoles root")

    def test_13_client_manager_cannot_delete_approles(self):
        """✅ client-manager cannot delete the AppRoles parent group — 403."""
        approles_id = self._get_approles_group_id()
        if not approles_id:
            self.skipTest(f"'{APPROLES_GROUP_NAME}' group not found")

        res = self.session.delete(
            f"{self.url}/admin/realms/{self.realm}/groups/{approles_id}",
            headers=self.cm_headers
        )
        self.assertEqual(
            res.status_code, 403,
            f"client-manager must NOT delete AppRoles parent. Got {res.status_code}: {res.text}"
        )
        print(f"\n✅ test_13: client-manager cannot delete '{APPROLES_GROUP_NAME}' group → 403")

    def test_14_manual_pca_base_mapping_blocked(self):
        """✅ Manual delegated-client-admin-base role mapping over admin REST is blocked (auto-only role)."""
        role_res = self.session.get(
            f"{self.url}/admin/realms/{self.realm}/roles/delegated-client-admin-base",
            headers=self.admin_headers
        )
        role_res.raise_for_status()
        pca_role = role_res.json()

        # User role mapping path should be blocked even for admin REST caller.
        user_map_res = self.session.post(
            f"{self.url}/admin/realms/{self.realm}/users/{self.copca_user_id}/role-mappings/realm",
            headers=self.admin_headers,
            json=[pca_role]
        )
        self.assertEqual(
            user_map_res.status_code, 403,
            f"Manual user role mapping for delegated-client-admin-base must be blocked. "
            f"Got {user_map_res.status_code}: {user_map_res.text}"
        )

        # Group role mapping path should also be blocked.
        if self.__class__.app_group_id:
            group_map_res = self.session.post(
                f"{self.url}/admin/realms/{self.realm}/groups/{self.app_group_id}/role-mappings/realm",
                headers=self.admin_headers,
                json=[pca_role]
            )
            self.assertEqual(
                group_map_res.status_code, 403,
                f"Manual group role mapping for delegated-client-admin-base must be blocked. "
                f"Got {group_map_res.status_code}: {group_map_res.text}"
            )
        print("✅ test_14: manual delegated-client-admin-base role mapping blocked on users/groups role-mappings endpoints")

    def test_15_audit_no_orphan_pca_base_users(self):
        """✅ Guardrail audit: every delegated-client-admin-base user must be direct member of at least one AppRoles/{clientId} root."""
        role_users_res = self.session.get(
            f"{self.url}/admin/realms/{self.realm}/roles/delegated-client-admin-base/users",
            headers=self.admin_headers
        )
        role_users_res.raise_for_status()
        pca_users = role_users_res.json()
        if not pca_users:
            self.skipTest("No delegated-client-admin-base users found in realm for audit")

        approles_id = self._get_approles_group_id()
        self.assertIsNotNone(approles_id, "AppRoles group must exist for orphan-pca audit")

        children_res = self.session.get(
            f"{self.url}/admin/realms/{self.realm}/groups/{approles_id}/children",
            headers=self.admin_headers
        )
        children_res.raise_for_status()
        app_root_groups = children_res.json()

        direct_member_ids = set()
        for g in app_root_groups:
            members_res = self.session.get(
                f"{self.url}/admin/realms/{self.realm}/groups/{g['id']}/members",
                headers=self.admin_headers
            )
            members_res.raise_for_status()
            for u in members_res.json():
                direct_member_ids.add(u['id'])

        orphan_users = [u for u in pca_users if u.get('id') not in direct_member_ids]
        self.assertEqual(
            len(orphan_users), 0,
            "Found orphan delegated-client-admin-base users without direct AppRoles/{clientId} membership: "
            + ", ".join([f"{u.get('username')}({u.get('id')})" for u in orphan_users])
        )
        print(f"✅ test_15: no orphan delegated-client-admin-base users found ({len(pca_users)} checked)")

    def test_16_default_deny_blocks_user_update(self):
        """✅ Default-deny blocks unsupported delegated mutate path: PUT /users/{id}."""
        res = self.session.put(
            f"{self.url}/admin/realms/{self.realm}/users/{self.target_user_id}",
            headers=self.pca_headers,
            json={"firstName": "BlockedByFilter", "enabled": True}
        )
        self.assertEqual(
            res.status_code, 403,
            f"Expected 403 from default-deny for delegated user update. Got {res.status_code}: {res.text}"
        )
        self.assertIn(
            "not allowed by policy", res.text.lower(),
            f"Expected default-deny message from filter. Got: {res.text}"
        )
        print("✅ test_16: default-deny blocked delegated PUT /users/{id} with policy message")

    def test_17_default_deny_blocks_reset_password(self):
        """✅ Default-deny blocks unsupported delegated mutate path: PUT /users/{id}/reset-password."""
        res = self.session.put(
            f"{self.url}/admin/realms/{self.realm}/users/{self.target_user_id}/reset-password",
            headers=self.pca_headers,
            json={"type": "password", "temporary": False, "value": "XxTempPass@123"}
        )
        self.assertEqual(
            res.status_code, 403,
            f"Expected 403 from default-deny for delegated reset-password. Got {res.status_code}: {res.text}"
        )
        self.assertIn(
            "not allowed by policy", res.text.lower(),
            f"Expected default-deny message from filter. Got: {res.text}"
        )
        print("✅ test_17: default-deny blocked delegated reset-password with policy message")

    def test_18_allow_remove_user_membership_in_owned_subtree(self):
        """✅ Allow-list permits delegated DELETE membership inside owned AppRoles descendant."""
        if not self.__class__.subgroup_id:
            self.skipTest("subgroup_id not set — prior subgroup tests may have failed")

        # Ensure membership exists before removal.
        groups_before = self.session.get(
            f"{self.url}/admin/realms/{self.realm}/users/{self.target_user_id}/groups",
            headers=self.admin_headers
        )
        groups_before.raise_for_status()
        before_ids = [g['id'] for g in groups_before.json()]
        self.assertIn(self.subgroup_id, before_ids, "Precondition failed: user must be in subgroup before removal")

        remove_res = self.session.delete(
            f"{self.url}/admin/realms/{self.realm}/users/{self.target_user_id}/groups/{self.subgroup_id}",
            headers=self.pca_headers
        )
        self.assertEqual(
            remove_res.status_code, 204,
            f"Delegated user should be able to remove membership in owned subtree. "
            f"Got {remove_res.status_code}: {remove_res.text}"
        )

        groups_after = self.session.get(
            f"{self.url}/admin/realms/{self.realm}/users/{self.target_user_id}/groups",
            headers=self.admin_headers
        )
        groups_after.raise_for_status()
        after_ids = [g['id'] for g in groups_after.json()]
        self.assertNotIn(self.subgroup_id, after_ids, "User should have been removed from subgroup")
        print("✅ test_18: allow-list permitted delegated DELETE user-group membership in owned subtree")

    def test_19_allow_update_owned_descendant_group(self):
        """✅ Allow-list permits delegated PUT on owned AppRoles descendant group."""
        if not self.__class__.subgroup_id:
            self.skipTest("subgroup_id not set — prior subgroup tests may have failed")

        new_name = f"{self.subgroup_name}-renamed"
        update_res = self.session.put(
            f"{self.url}/admin/realms/{self.realm}/groups/{self.subgroup_id}",
            headers=self.pca_headers,
            json={"name": new_name}
        )
        self.assertEqual(
            update_res.status_code, 204,
            f"Delegated user should be able to update owned descendant group. "
            f"Got {update_res.status_code}: {update_res.text}"
        )

        verify_res = self.session.get(
            f"{self.url}/admin/realms/{self.realm}/groups/{self.subgroup_id}",
            headers=self.admin_headers
        )
        verify_res.raise_for_status()
        self.assertEqual(
            verify_res.json().get("name"), new_name,
            f"Expected subgroup name to be updated to '{new_name}'"
        )
        self.__class__.subgroup_name = new_name
        print("✅ test_19: allow-list permitted delegated PUT on owned descendant group")


if __name__ == "__main__":
    unittest.main(verbosity=2)

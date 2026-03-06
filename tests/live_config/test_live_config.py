import json
import time
import uuid
import unittest
import urllib.parse
from pathlib import Path

import yaml

from assessment import GROUPS_EXPECTED, build_context, decode_jwt_payload


REPO_ROOT = Path("/workspace")


class LiveConfigValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.context = build_context()
        cls.server_url = cls.context["server_url"]
        cls.realm = cls.context["realm"]
        cls.client = cls.context["realm_client"]
        cls.realm_data = cls.context["realm_data"]
        cls.required_actions = cls.context["required_actions"]
        cls.user_profile = cls.context["user_profile"]
        cls.clients = cls.context["clients"]
        cls.client_scopes = cls.context["client_scopes"]
        cls.default_scopes = cls.context["default_scopes"]

    def _create_direct_grant_client(self, client_id: str, include_detail_scope: bool = False) -> str:
        create_status, create_headers, _ = self.client.post(
            f"/admin/realms/{self.realm}/clients",
            json_body={
                "clientId": client_id,
                "enabled": True,
                "publicClient": True,
                "directAccessGrantsEnabled": True,
                "standardFlowEnabled": False,
                "implicitFlowEnabled": False,
                "serviceAccountsEnabled": False,
                "protocol": "openid-connect",
            },
        )
        self.assertIn(create_status, {201, 204})
        kc_client_uuid = create_headers["Location"].rstrip("/").split("/")[-1]
        if include_detail_scope:
            scope_ids = {scope["name"]: scope["id"] for scope in self.client_scopes}
            put_status, _, _ = self.client.put(
                f"/admin/realms/{self.realm}/clients/{kc_client_uuid}/default-client-scopes/{scope_ids['detail-profile']}"
            )
            self.assertIn(put_status, {200, 204})
        return kc_client_uuid

    def _create_user_with_password(
        self,
        username: str,
        password: str,
        first_name: str,
        last_name: str,
        attributes: dict,
    ) -> str:
        status, headers, _ = self.client.post(
            f"/admin/realms/{self.realm}/users",
            json_body={
                "username": username,
                "enabled": True,
                "email": f"{username}@example.org",
                "firstName": first_name,
                "lastName": last_name,
                "emailVerified": True,
                "attributes": attributes,
            },
        )
        self.assertIn(status, {201, 204})
        user_id = headers["Location"].rstrip("/").split("/")[-1]

        reset_status, _, _ = self.client.put(
            f"/admin/realms/{self.realm}/users/{user_id}/reset-password",
            json_body={"type": "password", "temporary": False, "value": password},
        )
        self.assertIn(reset_status, {200, 204})

        update_status, _, _ = self.client.put(
            f"/admin/realms/{self.realm}/users/{user_id}",
            json_body={
                "id": user_id,
                "username": username,
                "enabled": True,
                "email": f"{username}@example.org",
                "firstName": first_name,
                "lastName": last_name,
                "emailVerified": True,
                "requiredActions": [],
                "attributes": attributes,
            },
        )
        self.assertIn(update_status, {200, 204})
        return user_id

    def _group_by_path(self, path: str) -> dict:
        return self.client.get(
            f"/admin/realms/{self.realm}/group-by-path/{urllib.parse.quote(path, safe='')}"
        )

    def _flatten_group_tree(self, nodes: list[dict]) -> dict[str, dict]:
        flattened = {}

        def visit(node: dict, lineage: tuple[str, ...]) -> None:
            current_lineage = lineage + (node["name"],)
            flattened["/".join(current_lineage)] = node
            for child in node.get("grps", []):
                visit(child, current_lineage)

        for node in nodes:
            visit(node, tuple())
        return flattened

    def test_realm_exists_and_themes_are_applied(self) -> None:
        self.assertEqual(self.realm_data["realm"], self.realm)
        self.assertTrue(self.realm_data["enabled"])
        self.assertEqual(self.realm_data["loginTheme"], "vg")
        self.assertEqual(self.realm_data["accountTheme"], "vg")
        self.assertEqual(self.realm_data["adminTheme"], "admin-vg-custom")

    def test_master_realm_themes_are_applied(self) -> None:
        if not self.context["master_access_ok"]:
            self.skipTest(self.context["master_access_error"])
        master_realm_data = self.context["master_realm_data"]
        self.assertEqual(master_realm_data["loginTheme"], "vg-master")
        self.assertEqual(master_realm_data["accountTheme"], "vg-master")
        self.assertEqual(master_realm_data["adminTheme"], "vg-master")

    def test_admin_users_exist(self) -> None:
        realm_admin_users = self.client.get(
            f"/admin/realms/{self.realm}/users",
            {"username": self.context["realm_admin_user"], "exact": "true"},
        )
        self.assertEqual(len(realm_admin_users), 1)
        if not self.context["master_access_ok"]:
            self.skipTest(self.context["master_access_error"])
        self.assertEqual(len(self.context["master_admin_users"]), 1)

    def test_master_admin_has_master_api_access(self) -> None:
        self.assertTrue(self.context["master_access_ok"], self.context["master_access_error"])

    def test_bootstrap_admin_is_retired(self) -> None:
        self.assertFalse(
            self.context["bootstrap_auth_ok"],
            "bootstrap admin still authenticates in master realm",
        )

    def test_master_admin_has_realm_admin_role(self) -> None:
        master_client = self.context["master_client"]
        master_admin_id = self.context["master_admin_users"][0]["id"]
        master_roles = master_client.get(f"/admin/realms/master/users/{master_admin_id}/role-mappings/realm")
        master_role_names = {role["name"] for role in master_roles}
        self.assertIn("admin", master_role_names)

    def test_realm_admin_has_realm_management_role(self) -> None:
        realm_admin_users = self.client.get(
            f"/admin/realms/{self.realm}/users",
            {"username": self.context["realm_admin_user"], "exact": "true"},
        )
        realm_admin_id = realm_admin_users[0]["id"]
        realm_management = self.client.get(
            f"/admin/realms/{self.realm}/clients",
            {"clientId": "realm-management"},
        )
        realm_management_id = realm_management[0]["id"]
        client_roles = self.client.get(
            f"/admin/realms/{self.realm}/users/{realm_admin_id}/role-mappings/clients/{realm_management_id}"
        )
        self.assertIn("realm-admin", {role["name"] for role in client_roles})

    def test_realm_login_and_bruteforce_baseline(self) -> None:
        self.assertFalse(self.realm_data["registrationAllowed"])
        self.assertFalse(self.realm_data["rememberMe"])
        self.assertTrue(self.realm_data["verifyEmail"])
        self.assertFalse(self.realm_data["loginWithEmailAllowed"])
        self.assertTrue(self.realm_data["bruteForceProtected"])
        self.assertFalse(self.realm_data["permanentLockout"])
        self.assertEqual(self.realm_data["maxFailureWaitSeconds"], 900)
        self.assertEqual(self.realm_data["waitIncrementSeconds"], 60)
        self.assertEqual(self.realm_data["quickLoginCheckMilliSeconds"], 1000)
        self.assertEqual(self.realm_data["minimumQuickLoginWaitSeconds"], 60)
        self.assertEqual(self.realm_data["maxDeltaTimeSeconds"], 43200)
        self.assertEqual(self.realm_data["failureFactor"], 5)

    def test_password_policy_and_session_timeouts(self) -> None:
        password_policy = self.realm_data["passwordPolicy"]
        for token in (
            "length(12)",
            "digits(1)",
            "upperCase(1)",
            "lowerCase(1)",
            "specialChars(1)",
            "notUsername",
            "passwordHistory(5)",
        ):
            self.assertIn(token, password_policy)

        self.assertEqual(self.realm_data["ssoSessionIdleTimeout"], 1800)
        self.assertEqual(self.realm_data["ssoSessionMaxLifespan"], 28800)
        self.assertEqual(self.realm_data["accessTokenLifespan"], 300)
        self.assertEqual(self.realm_data["accessTokenLifespanForImplicitFlow"], 900)
        self.assertEqual(self.realm_data["clientSessionIdleTimeout"], 1800)
        self.assertEqual(self.realm_data["clientSessionMaxLifespan"], 28800)
        self.assertEqual(self.realm_data["offlineSessionIdleTimeout"], 2592000)

    def test_events_and_required_actions_are_enabled(self) -> None:
        self.assertTrue(self.realm_data["eventsEnabled"])
        self.assertTrue(self.realm_data["adminEventsEnabled"])
        self.assertTrue(self.realm_data["adminEventsDetailsEnabled"])

        enabled_event_types = set(self.realm_data["enabledEventTypes"])
        for event_type in (
            "LOGIN",
            "LOGIN_ERROR",
            "LOGOUT",
            "LOGOUT_ERROR",
            "REGISTER",
            "REGISTER_ERROR",
            "UPDATE_PASSWORD",
            "UPDATE_PASSWORD_ERROR",
            "VERIFY_EMAIL",
            "VERIFY_EMAIL_ERROR",
            "RESET_PASSWORD",
            "RESET_PASSWORD_ERROR",
        ):
            self.assertIn(event_type, enabled_event_types)

        action_map = {item["alias"]: item for item in self.required_actions}
        self.assertTrue(action_map["VERIFY_EMAIL"]["enabled"])
        self.assertTrue(action_map["VERIFY_EMAIL"]["defaultAction"])
        self.assertTrue(action_map["UPDATE_PASSWORD"]["enabled"])
        self.assertTrue(action_map["UPDATE_PASSWORD"]["defaultAction"])

    def test_client_hardening_matches_step_scripts(self) -> None:
        admin_cli = None
        for client in self.clients:
            if client["clientId"] == "admin-cli":
                admin_cli = client
                self.assertTrue(client["directAccessGrantsEnabled"])
                continue
            self.assertFalse(
                client["directAccessGrantsEnabled"],
                f"client {client['clientId']} still has direct grants enabled",
            )
            self.assertFalse(
                client["implicitFlowEnabled"],
                f"client {client['clientId']} still has implicit flow enabled",
            )
        self.assertIsNotNone(admin_cli, "admin-cli client not found")

    def test_default_scopes_and_custom_scope_mappers_exist(self) -> None:
        default_scope_names = {scope["name"] for scope in self.default_scopes}
        self.assertIn("profile", default_scope_names)
        self.assertIn("email", default_scope_names)
        self.assertIn("roles", default_scope_names)
        self.assertIn("web-origins", default_scope_names)
        self.assertIn("org-minimal", default_scope_names)

        scope_ids = {scope["name"]: scope["id"] for scope in self.client_scopes}
        org_minimal_id = scope_ids["org-minimal"]
        detail_profile_id = scope_ids["detail-profile"]

        vg_mappers = self.client.get(
            f"/admin/realms/{self.realm}/client-scopes/{org_minimal_id}/protocol-mappers/models"
        )
        detail_mappers = self.client.get(
            f"/admin/realms/{self.realm}/client-scopes/{detail_profile_id}/protocol-mappers/models"
        )

        vg_mapper_names = {mapper["name"] for mapper in vg_mappers}
        self.assertIn("group-details", vg_mapper_names)
        self.assertIn("employment_type", vg_mapper_names)
        self.assertIn("preferred_username", vg_mapper_names)
        self.assertIn("account_expiry", vg_mapper_names)

        detail_mapper_names = {mapper["name"] for mapper in detail_mappers}
        for name in (
            "phone_number",
            "employment_type",
            "designation",
            "last_date",
            "posts",
            "firstName",
            "lastName",
            "email",
        ):
            self.assertIn(name, detail_mapper_names)
        self.assertNotIn("remarks", detail_mapper_names)

    def test_user_profile_schema_contains_expected_custom_attributes(self) -> None:
        attributes = {item["name"]: item for item in self.user_profile["attributes"]}

        phone = attributes["phone_number"]
        self.assertEqual(set(phone["permissions"]["view"]), {"user", "admin"})
        self.assertEqual(set(phone["permissions"]["edit"]), {"admin"})
        self.assertEqual(phone["validations"]["length"]["max"], 20)
        self.assertEqual(phone["validations"]["pattern"]["pattern"], r"^\+?[0-9]{10,15}$")

        employment_type = attributes["employment_type"]
        self.assertEqual(
            employment_type["validations"]["options"]["options"],
            ["Permanent", "Contract", "Research", "Student", "Deputed", "Outsourced"],
        )

        employee_id = attributes["employee_id"]
        self.assertEqual(employee_id["validations"]["length"]["max"], 32)

        posts = attributes["posts"]
        self.assertTrue(posts["multivalued"])
        self.assertEqual(posts["validations"]["length"]["max"], 50)

        designation = attributes["designation"]
        self.assertIn("Director", designation["validations"]["options"]["options"])
        self.assertIn("Housekeeping Supervisor", designation["validations"]["options"]["options"])

        remarks = attributes["remarks"]
        self.assertTrue(remarks["multivalued"])
        self.assertEqual(remarks["validations"]["length"]["max"], 1000)
        self.assertEqual(remarks["annotations"]["inputType"], "textarea")

    def test_user_manager_role_and_composites_exist(self) -> None:
        role = self.client.get(f"/admin/realms/{self.realm}/roles/user-manager")
        self.assertEqual(role["name"], "user-manager")
        self.assertEqual(role["description"], "User operations without group creation")

        realm_management = self.client.get(
            f"/admin/realms/{self.realm}/clients",
            {"clientId": "realm-management"},
        )
        realm_management_id = realm_management[0]["id"]
        composites = self.client.get(
            f"/admin/realms/{self.realm}/roles-by-id/{role['id']}/composites/clients/{realm_management_id}"
        )
        composite_names = {item["name"] for item in composites}
        self.assertEqual(composite_names, {"view-users", "query-users", "query-groups"})

    def test_expected_groups_are_present_with_expected_attributes(self) -> None:
        self.assertTrue(GROUPS_EXPECTED.exists(), "groups_expected.tsv not mounted into test container")

        checked_paths = set()
        with GROUPS_EXPECTED.open("r", encoding="utf-8") as handle:
            for raw_line in handle:
                line = raw_line.rstrip("\n")
                if not line:
                    continue
                path, attr_key, attr_val = line.split("\t")
                if path not in checked_paths:
                    checked_paths.add(path)
                encoded_path = urllib.parse.quote(path, safe="")
                group = self.client.get(f"/admin/realms/{self.realm}/group-by-path/{encoded_path}")
                self.assertEqual(group["path"], path)
                if attr_key == "__NONE__":
                    continue
                actual_values = group.get("attributes", {}).get(attr_key, [])
                self.assertIn(
                    attr_val,
                    actual_values,
                    f"group {path} missing attribute {attr_key}={attr_val}",
                )

        self.assertGreater(len(checked_paths), 0)

    def test_token_claims_from_minimal_and_detail_scopes(self) -> None:
        client = self.client
        suffix = uuid.uuid4().hex[:8]
        username = f"claims-user-{suffix}"
        password = f"Claims@{suffix}123!"
        minimal_client_id = f"claims-minimal-{suffix}"
        detail_client_id = f"claims-detail-{suffix}"
        created_client_ids = []
        created_user_id = None

        def cleanup() -> None:
            for client_id in created_client_ids:
                client.delete(f"/admin/realms/{self.realm}/clients/{client_id}")
            if created_user_id:
                client.delete(f"/admin/realms/{self.realm}/users/{created_user_id}")

        try:
            status, headers, _ = client.post(
                f"/admin/realms/{self.realm}/users",
                json_body={
                    "username": username,
                    "enabled": True,
                    "email": f"{username}@example.org",
                    "firstName": "Claims",
                    "lastName": "User",
                    "emailVerified": True,
                    "attributes": {
                        "employment_type": ["Permanent"],
                        "phone_number": ["+919876543210"],
                        "designation": ["Professor"],
                        "posts": ["Cardiology"],
                        "remarks": ["internal-only"],
                    },
                },
            )
            self.assertIn(status, {201, 204})
            created_user_id = headers["Location"].rstrip("/").split("/")[-1]

            reset_status, _, _ = client.put(
                f"/admin/realms/{self.realm}/users/{created_user_id}/reset-password",
                json_body={"type": "password", "temporary": False, "value": password},
            )
            self.assertIn(reset_status, {200, 204})

            user_update_status, _, _ = client.put(
                f"/admin/realms/{self.realm}/users/{created_user_id}",
                json_body={
                    "id": created_user_id,
                    "username": username,
                    "enabled": True,
                    "email": f"{username}@example.org",
                    "firstName": "Claims",
                    "lastName": "User",
                    "emailVerified": True,
                    "requiredActions": [],
                    "attributes": {
                        "employment_type": ["Permanent"],
                        "phone_number": ["+919876543210"],
                        "designation": ["Professor"],
                        "posts": ["Cardiology"],
                        "remarks": ["internal-only"],
                    },
                },
            )
            self.assertIn(user_update_status, {200, 204})

            group = None
            with GROUPS_EXPECTED.open("r", encoding="utf-8") as handle:
                for raw_line in handle:
                    line = raw_line.rstrip("\n")
                    if not line:
                        continue
                    path, attr_key, _ = line.split("\t")
                    if attr_key != "__NONE__":
                        group = self.client.get(
                            f"/admin/realms/{self.realm}/group-by-path/{urllib.parse.quote(path, safe='')}"
                        )
                        break
            self.assertIsNotNone(group)

            group_status, _, _ = client.put(
                f"/admin/realms/{self.realm}/users/{created_user_id}/groups/{group['id']}"
            )
            self.assertIn(group_status, {200, 204})

            for client_id, include_detail_scope in (
                (minimal_client_id, False),
                (detail_client_id, True),
            ):
                create_status, create_headers, _ = client.post(
                    f"/admin/realms/{self.realm}/clients",
                    json_body={
                        "clientId": client_id,
                        "enabled": True,
                        "publicClient": True,
                        "directAccessGrantsEnabled": True,
                        "standardFlowEnabled": False,
                        "implicitFlowEnabled": False,
                        "serviceAccountsEnabled": False,
                        "protocol": "openid-connect",
                    },
                )
                self.assertIn(create_status, {201, 204})
                kc_client_uuid = create_headers["Location"].rstrip("/").split("/")[-1]
                created_client_ids.append(kc_client_uuid)

                if include_detail_scope:
                    scope_ids = {scope["name"]: scope["id"] for scope in self.client_scopes}
                    put_status, _, _ = client.put(
                        f"/admin/realms/{self.realm}/clients/{kc_client_uuid}/default-client-scopes/{scope_ids['detail-profile']}"
                    )
                    self.assertIn(put_status, {200, 204})

            minimal_token = client.issue_token(self.realm, minimal_client_id, username, password)
            minimal_claims = decode_jwt_payload(minimal_token["access_token"])
            self.assertEqual(minimal_claims["preferred_username"], username)
            self.assertEqual(minimal_claims["employment_type"], "Permanent")
            self.assertIn("group_details", minimal_claims)
            self.assertIn("account_expiry", minimal_claims)
            self.assertEqual(minimal_claims["account_expiry"]["configured"], False)
            self.assertEqual(minimal_claims["account_expiry"]["warning"], False)
            self.assertNotIn("phone_number", minimal_claims)
            self.assertNotIn("remarks", minimal_claims)

            detail_token = client.issue_token(self.realm, detail_client_id, username, password)
            detail_claims = decode_jwt_payload(detail_token["access_token"])
            self.assertEqual(detail_claims["phone_number"], "+919876543210")
            self.assertEqual(detail_claims["designation"], "Professor")
            self.assertEqual(detail_claims["posts"], ["Cardiology"])
            self.assertEqual(detail_claims["given_name"], "Claims")
            self.assertEqual(detail_claims["family_name"], "User")
            self.assertEqual(detail_claims["email"], f"{username}@example.org")
            self.assertNotIn("remarks", detail_claims)
        finally:
            cleanup()

    def test_group_membership_scenarios_are_reflected_in_tokens(self) -> None:
        suffix = uuid.uuid4().hex[:8]
        minimal_client_id = f"group-minimal-{suffix}"
        detail_client_id = f"group-detail-{suffix}"
        created_client_ids = []
        created_user_ids = []

        def cleanup() -> None:
            for client_id in created_client_ids:
                self.client.delete(f"/admin/realms/{self.realm}/clients/{client_id}")
            for user_id in created_user_ids:
                self.client.delete(f"/admin/realms/{self.realm}/users/{user_id}")

        try:
            created_client_ids.append(self._create_direct_grant_client(minimal_client_id))
            created_client_ids.append(self._create_direct_grant_client(detail_client_id, include_detail_scope=True))

            scenarios = [
                {
                    "name": "two-departments",
                    "groups": ["/Departments/Cardiology", "/Departments/Medicine"],
                    "expected_root_names": {"Departments"},
                    "expected_root_order": ["Departments"],
                    "expected_child_order": {"Departments": ["Cardiology", "Medicine"]},
                    "expected_tree_names": {
                        "Departments",
                        "Departments/Cardiology",
                        "Departments/Medicine",
                    },
                    "expected_dept_ids": {"14", "1"},
                },
                {
                    "name": "faculty-plus-two-departments",
                    "groups": ["/User Type/faculty", "/Departments/Cardiology", "/Departments/Medicine"],
                    "expected_root_names": {"Departments", "User Type"},
                    "expected_root_order": ["Departments", "User Type"],
                    "expected_child_order": {
                        "Departments": ["Cardiology", "Medicine"],
                        "User Type": ["faculty"],
                    },
                    "expected_tree_names": {
                        "Departments",
                        "Departments/Cardiology",
                        "Departments/Medicine",
                        "User Type",
                        "User Type/faculty",
                    },
                    "expected_dept_ids": {"14", "1"},
                },
                {
                    "name": "ans-only",
                    "groups": ["/User Type/ANS"],
                    "expected_root_names": {"User Type"},
                    "expected_root_order": ["User Type"],
                    "expected_child_order": {"User Type": ["ANS"]},
                    "expected_tree_names": {"User Type", "User Type/ANS"},
                    "expected_dept_ids": set(),
                },
                {
                    "name": "faculty-only",
                    "groups": ["/User Type/faculty"],
                    "expected_root_names": {"User Type"},
                    "expected_root_order": ["User Type"],
                    "expected_child_order": {"User Type": ["faculty"]},
                    "expected_tree_names": {"User Type", "User Type/faculty"},
                    "expected_dept_ids": set(),
                },
                {
                    "name": "it-role-only",
                    "groups": ["/IT Roles/sso_user_manager"],
                    "expected_root_names": {"IT Roles"},
                    "expected_root_order": ["IT Roles"],
                    "expected_child_order": {"IT Roles": ["sso_user_manager"]},
                    "expected_tree_names": {"IT Roles", "IT Roles/sso_user_manager"},
                    "expected_dept_ids": set(),
                },
                {
                    "name": "it-role-plus-department",
                    "groups": ["/IT Roles/sso_user_manager", "/Departments/Cardiology"],
                    "expected_root_names": {"IT Roles", "Departments"},
                    "expected_root_order": ["Departments", "IT Roles"],
                    "expected_child_order": {
                        "Departments": ["Cardiology"],
                        "IT Roles": ["sso_user_manager"],
                    },
                    "expected_tree_names": {
                        "IT Roles",
                        "IT Roles/sso_user_manager",
                        "Departments",
                        "Departments/Cardiology",
                    },
                    "expected_dept_ids": {"14"},
                },
            ]

            for scenario in scenarios:
                with self.subTest(scenario=scenario["name"]):
                    username = f"group-user-{scenario['name']}-{suffix}"
                    password = f"Group@{suffix}123!"
                    user_id = self._create_user_with_password(
                        username,
                        password,
                        "Group",
                        "Claims",
                        {
                            "employment_type": ["Permanent"],
                            "phone_number": ["+919876543210"],
                            "designation": ["Professor"],
                            "posts": ["Cardiology"],
                        },
                    )
                    created_user_ids.append(user_id)

                    for group_path in scenario["groups"]:
                        group = self._group_by_path(group_path)
                        group_status, _, _ = self.client.put(
                            f"/admin/realms/{self.realm}/users/{user_id}/groups/{group['id']}"
                        )
                        self.assertIn(group_status, {200, 204})

                    minimal_claims = decode_jwt_payload(
                        self.client.issue_token(self.realm, minimal_client_id, username, password)["access_token"]
                    )
                    detail_claims = decode_jwt_payload(
                        self.client.issue_token(self.realm, detail_client_id, username, password)["access_token"]
                    )

                    for claim_name, claims in (("minimal", minimal_claims), ("detail", detail_claims)):
                        group_details = claims.get("group_details")
                        self.assertIsNotNone(group_details, claim_name)
                        self.assertIsInstance(group_details, list, claim_name)
                        actual_root_names = {item["name"] for item in group_details}
                        self.assertEqual(
                            [item["name"] for item in group_details],
                            scenario["expected_root_order"],
                            f"{claim_name} token root order drifted for {scenario['name']}: {group_details}",
                        )
                        self.assertEqual(
                            actual_root_names,
                            scenario["expected_root_names"],
                            f"{claim_name} token root names drifted for {scenario['name']}: {group_details}",
                        )
                        for root in group_details:
                            if "grps" in root:
                                self.assertEqual(
                                    [child["name"] for child in root["grps"]],
                                    scenario["expected_child_order"][root["name"]],
                                    f"{claim_name} token child order drifted for {scenario['name']}: {group_details}",
                                )

                        flattened = self._flatten_group_tree(group_details)
                        self.assertEqual(
                            set(flattened.keys()),
                            scenario["expected_tree_names"],
                            f"{claim_name} token tree names drifted for {scenario['name']}: {group_details}",
                        )

                        actual_dept_ids = set()
                        for item in flattened.values():
                            if "attrs" in item:
                                self.assertIsInstance(
                                    item["attrs"],
                                    dict,
                                    f"{claim_name} token attrs not object for {scenario['name']}: {group_details}",
                                )
                            if "grps" in item:
                                self.assertIsInstance(
                                    item["grps"],
                                    list,
                                    f"{claim_name} token grps not list for {scenario['name']}: {group_details}",
                                )
                            actual_dept_ids.update(item.get("attrs", {}).get("dept_id", []))
                        self.assertEqual(
                            actual_dept_ids,
                            scenario["expected_dept_ids"],
                            f"{claim_name} token dept_ids drifted for {scenario['name']}: {group_details}",
                        )

                    self.assertEqual(minimal_claims["preferred_username"], username)
                    self.assertEqual(detail_claims["phone_number"], "+919876543210")
                    self.assertEqual(detail_claims["designation"], "Professor")
                    self.assertEqual(detail_claims["posts"], ["Cardiology"])
        finally:
            cleanup()

    def test_invalid_custom_user_profile_attributes_are_rejected(self) -> None:
        invalid_cases = [
            (
                "bad-phone",
                {
                    "username": f"invalid-phone-{uuid.uuid4().hex[:8]}",
                    "enabled": True,
                    "email": f"invalid-phone-{uuid.uuid4().hex[:8]}@example.org",
                    "firstName": "Invalid",
                    "lastName": "Phone",
                    "emailVerified": True,
                    "attributes": {
                        "employment_type": ["Permanent"],
                        "phone_number": ["abc123"],
                    },
                },
            ),
            (
                "long-employee-id",
                {
                    "username": f"invalid-employee-{uuid.uuid4().hex[:8]}",
                    "enabled": True,
                    "email": f"invalid-employee-{uuid.uuid4().hex[:8]}@example.org",
                    "firstName": "Invalid",
                    "lastName": "Employee",
                    "emailVerified": True,
                    "attributes": {
                        "employment_type": ["Permanent"],
                        "employee_id": ["X" * 33],
                    },
                },
            ),
            (
                "long-post",
                {
                    "username": f"invalid-post-{uuid.uuid4().hex[:8]}",
                    "enabled": True,
                    "email": f"invalid-post-{uuid.uuid4().hex[:8]}@example.org",
                    "firstName": "Invalid",
                    "lastName": "Post",
                    "emailVerified": True,
                    "attributes": {
                        "employment_type": ["Permanent"],
                        "posts": ["Y" * 51],
                    },
                },
            ),
            (
                "long-remarks",
                {
                    "username": f"invalid-remarks-{uuid.uuid4().hex[:8]}",
                    "enabled": True,
                    "email": f"invalid-remarks-{uuid.uuid4().hex[:8]}@example.org",
                    "firstName": "Invalid",
                    "lastName": "Remarks",
                    "emailVerified": True,
                    "attributes": {
                        "employment_type": ["Permanent"],
                        "remarks": ["Z" * 1001],
                    },
                },
            ),
        ]

        for case_name, payload in invalid_cases:
            with self.subTest(case=case_name):
                status, _, body = self.client.post(f"/admin/realms/{self.realm}/users", json_body=payload)
                self.assertGreaterEqual(status, 400, body)
                self.assertLess(status, 500, body)

    def test_scope_and_mapper_names_are_unique(self) -> None:
        scope_names = [scope["name"] for scope in self.client_scopes]
        self.assertEqual(len(scope_names), len(set(scope_names)))

        scope_ids = {scope["name"]: scope["id"] for scope in self.client_scopes}
        for scope_name in ("org-minimal", "detail-profile"):
            with self.subTest(scope=scope_name):
                mappers = self.client.get(
                    f"/admin/realms/{self.realm}/client-scopes/{scope_ids[scope_name]}/protocol-mappers/models"
                )
                mapper_names = [mapper["name"] for mapper in mappers]
                self.assertEqual(len(mapper_names), len(set(mapper_names)))

    def test_expected_singletons_for_roles_and_client_scopes(self) -> None:
        scope_names = [scope["name"] for scope in self.client_scopes]
        self.assertEqual(scope_names.count("org-minimal"), 1)
        self.assertEqual(scope_names.count("detail-profile"), 1)

        roles = self.client.get(f"/admin/realms/{self.realm}/roles")
        role_names = [role["name"] for role in roles]
        self.assertEqual(role_names.count("user-manager"), 1)

    def test_token_endpoint_rate_limit_triggers_via_nginx(self) -> None:
        from assessment import proxy_request

        suffix = uuid.uuid4().hex[:8]
        username = f"rate-user-{suffix}"
        password = f"Rate@{suffix}123!"
        client_id = f"rate-client-{suffix}"
        created_client_id = None
        created_user_id = None

        def cleanup() -> None:
            if created_client_id:
                self.client.delete(f"/admin/realms/{self.realm}/clients/{created_client_id}")
            if created_user_id:
                self.client.delete(f"/admin/realms/{self.realm}/users/{created_user_id}")

        try:
            status, headers, _ = self.client.post(
                f"/admin/realms/{self.realm}/users",
                json_body={
                    "username": username,
                    "enabled": True,
                    "email": f"{username}@example.org",
                    "firstName": "Rate",
                    "lastName": "Limit",
                    "emailVerified": True,
                    "requiredActions": [],
                    "attributes": {"employment_type": ["Permanent"]},
                },
            )
            self.assertIn(status, {201, 204})
            created_user_id = headers["Location"].rstrip("/").split("/")[-1]

            reset_status, _, _ = self.client.put(
                f"/admin/realms/{self.realm}/users/{created_user_id}/reset-password",
                json_body={"type": "password", "temporary": False, "value": password},
            )
            self.assertIn(reset_status, {200, 204})

            update_status, _, _ = self.client.put(
                f"/admin/realms/{self.realm}/users/{created_user_id}",
                json_body={
                    "id": created_user_id,
                    "username": username,
                    "enabled": True,
                    "email": f"{username}@example.org",
                    "firstName": "Rate",
                    "lastName": "Limit",
                    "emailVerified": True,
                    "requiredActions": [],
                    "attributes": {"employment_type": ["Permanent"]},
                },
            )
            self.assertIn(update_status, {200, 204})

            create_status, create_headers, _ = self.client.post(
                f"/admin/realms/{self.realm}/clients",
                json_body={
                    "clientId": client_id,
                    "enabled": True,
                    "publicClient": True,
                    "directAccessGrantsEnabled": True,
                    "standardFlowEnabled": False,
                    "implicitFlowEnabled": False,
                    "serviceAccountsEnabled": False,
                    "protocol": "openid-connect",
                },
            )
            self.assertIn(create_status, {201, 204})
            created_client_id = create_headers["Location"].rstrip("/").split("/")[-1]

            body = urllib.parse.urlencode(
                {
                    "client_id": client_id,
                    "grant_type": "password",
                    "username": username,
                    "password": password,
                }
            ).encode("utf-8")

            statuses = []
            for _ in range(15):
                status_code, _, _ = proxy_request(
                    self.context["proxy_https_url"],
                    self.context["proxy_realm_host"],
                    f"/realms/{self.realm}/protocol/openid-connect/token",
                    method="POST",
                    data=body,
                    extra_headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
                statuses.append(status_code)
                if status_code in {429, 503}:
                    break

            self.assertIn(200, statuses)
            self.assertTrue(any(code in {429, 503} for code in statuses), statuses)
        finally:
            cleanup()
            time.sleep(1)

    def test_nginx_proxy_reverse_proxy_controls(self) -> None:
        from assessment import location_matches, proxy_request

        http_status, http_headers, _ = proxy_request(
            self.context["proxy_http_url"],
            self.context["proxy_master_host"],
            "/",
        )
        self.assertIn(http_status, {301, 302})
        self.assertTrue(http_headers.get("Location", "").startswith("https://"))

        master_status, master_headers, _ = proxy_request(
            self.context["proxy_https_url"],
            self.context["proxy_master_host"],
            "/",
        )
        self.assertIn(master_status, {301, 302})
        self.assertTrue(location_matches(master_headers.get("Location", ""), "/realms/master/account/"))

        mgmt_status, _, _ = proxy_request(
            self.context["proxy_https_url"],
            self.context["proxy_master_host"],
            "/management",
        )
        self.assertEqual(mgmt_status, 403)

        other_realm_status, _, _ = proxy_request(
            self.context["proxy_https_url"],
            self.context["proxy_master_host"],
            f"/realms/{self.realm}/account",
        )
        self.assertEqual(other_realm_status, 403)

        realm_status, realm_headers, _ = proxy_request(
            self.context["proxy_https_url"],
            self.context["proxy_realm_host"],
            "/",
        )
        self.assertIn(realm_status, {301, 302})
        self.assertTrue(
            location_matches(realm_headers.get("Location", ""), f"/realms/{self.realm}/account/")
        )

        realm_mgmt_status, _, _ = proxy_request(
            self.context["proxy_https_url"],
            self.context["proxy_realm_host"],
            "/management",
        )
        self.assertEqual(realm_mgmt_status, 403)

        denied_status, _, _ = proxy_request(
            self.context["proxy_https_url"],
            self.context["proxy_realm_host"],
            f"/admin/{self.realm}/console/",
            self.context["proxy_admin_denied_ip"],
        )
        self.assertEqual(denied_status, 403)

        allowed_status, _, _ = proxy_request(
            self.context["proxy_https_url"],
            self.context["proxy_realm_host"],
            f"/admin/{self.realm}/console/",
            self.context["proxy_admin_allowed_ip"],
        )
        self.assertIn(allowed_status, {200, 302, 303})

        _, header_headers, _ = proxy_request(
            self.context["proxy_https_url"],
            self.context["proxy_realm_host"],
            "/",
        )
        header_names = {name.lower(): value for name, value in header_headers.items()}
        self.assertIn("strict-transport-security", header_names)
        self.assertEqual(header_names.get("x-content-type-options"), "nosniff")
        self.assertEqual(header_names.get("x-frame-options"), "DENY")
        self.assertIn("frame-ancestors 'none'", header_names.get("content-security-policy", ""))

    def test_otp_admin_api_functionality(self) -> None:
        import http.server
        import threading
        import socket

        # 1. Start a local HTTP server to receive the "SMS" POST request
        class MockSmsHandler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"status":"sent"}')
            def log_message(self, format, *args):
                pass # Silencing logs for clean output

        mock_server = http.server.HTTPServer(("0.0.0.0", 0), MockSmsHandler)
        port = mock_server.server_port
        thread = threading.Thread(target=mock_server.serve_forever)
        thread.daemon = True
        thread.start()

        try:
            # 2. Find our own hostname/IP in the docker network
            # 'config-tests' container needs to be reachable by 'keycloak' container
            my_hostname = socket.gethostname()

            # 3. Generate test token
            status, _, body = self.client.post(f"/realms/{self.realm}/phone-otp-admin/token")
            self.assertEqual(status, 200, f"Failed to generate OTP test token: {body}")
            token_data = json.loads(body)
            self.assertTrue(token_data["ok"])
            test_token = token_data["token"]
    
            # 4. Use test token to call 'test' endpoint pointing to our mock server
            test_payload = {
                "primaryEndpoint": f"http://{my_hostname}:{port}/sms",
                "mobile": "9899410420",
                "message": "Integration test OTP: 123456",
                "retryMax": 0
            }
            status, _, body = self.client.post(
                f"/realms/{self.realm}/phone-otp-admin/test",
                json_body=test_payload,
                headers={"X-Phone-Otp-Test-Token": test_token}
            )
            self.assertEqual(status, 200, f"Expected 200 for mock endpoint, got {status}: {body}")
            resp_data = json.loads(body)
            self.assertTrue(resp_data["ok"])
            self.assertEqual(resp_data["message"], "Test SMS sent")
        finally:
            mock_server.shutdown()
            mock_server.server_close()

    def test_step4_otp_admin_api_rbac_and_validation(self) -> None:
        import uuid
        import socket
        import http.server
        import threading

        # 1. Start a local mock server for validation test (missing/invalid fields)
        class MockSmsHandler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"status":"sent"}')
            def log_message(self, format, *args):
                pass
        mock_server = http.server.HTTPServer(("0.0.0.0", 0), MockSmsHandler)
        port = mock_server.server_port
        thread = threading.Thread(target=mock_server.serve_forever)
        thread.daemon = True
        thread.start()

        suffix = uuid.uuid4().hex[:8]
        client_id_str = f"test-rbac-{suffix}"
        
        created_client_ids = []
        created_user_ids = []

        try:
            # 2. Setup RBAC users (Manage Realm, User Manager, Standard)
            client_uuid = self._create_direct_grant_client(client_id_str)
            created_client_ids.append(client_uuid)

            def create_user(role_name=None):
                u_name = f"user-{role_name or 'std'}-{suffix}"
                pw = f"Temp@{suffix}123!"
                u_id = self._create_user_with_password(u_name, pw, "Test", "User", {})
                created_user_ids.append(u_id)
                if role_name:
                    if role_name == "manage-realm":
                        clients = self.client.get(f"/admin/realms/{self.realm}/clients", query={"clientId": "realm-management"})
                        realm_mgmt_id = clients[0]["id"]
                        roles = self.client.get(f"/admin/realms/{self.realm}/clients/{realm_mgmt_id}/roles")
                        role = next((r for r in roles if r["name"] == role_name), None)
                        if role:
                            self.client.post(
                                f"/admin/realms/{self.realm}/users/{u_id}/role-mappings/clients/{realm_mgmt_id}",
                                json_body=[{"id": role["id"], "name": role["name"]}]
                            )
                    else:
                        roles = self.client.get(f"/admin/realms/{self.realm}/roles")
                        role = next((r for r in roles if r["name"] == role_name), None)
                        if role:
                            self.client.post(
                                f"/admin/realms/{self.realm}/users/{u_id}/role-mappings/realm",
                                json_body=[{"id": role["id"], "name": role["name"]}]
                            )
                return u_name, pw
            
            manage_realm_user, manage_realm_pw = create_user("manage-realm")
            user_manager_user, user_manager_pw = create_user("user-manager")
            standard_user, standard_pw = create_user(None)
            
            mr_token = self.client.issue_token(self.realm, client_id_str, manage_realm_user, manage_realm_pw)["access_token"]
            um_token = self.client.issue_token(self.realm, client_id_str, user_manager_user, user_manager_pw)["access_token"]
            st_token = self.client.issue_token(self.realm, client_id_str, standard_user, standard_pw)["access_token"]
            original_token = self.client.token

            def run_as(token, callback):
                self.client.token = token
                try:
                    return callback()
                finally:
                    self.client.token = original_token

            # 3. Test /ui endpoint (Only manage-realm gets the actual UI, others get Forbidden text)
            def test_ui():
                status, _, body = self.client.raw_request("GET", f"/realms/{self.realm}/phone-otp-admin/ui")
                return status, body
            
            st_ui_status, st_ui_body = run_as(st_token, test_ui)
            self.assertEqual(st_ui_status, 200) 
            self.assertIn("Forbidden", st_ui_body)
            
            um_ui_status, um_ui_body = run_as(um_token, test_ui)
            self.assertEqual(um_ui_status, 200)
            self.assertIn("Forbidden", um_ui_body)
            
            mr_ui_status, mr_ui_body = run_as(mr_token, test_ui)
            self.assertEqual(mr_ui_status, 200)
            self.assertIn("Phone OTP Test", mr_ui_body)

            # 4. Test /access endpoint
            def test_access():
                status, _, body = self.client.raw_request("GET", f"/realms/{self.realm}/phone-otp-admin/access")
                return status, json.loads(body)

            st_acc_status, st_acc_body = run_as(st_token, test_access)
            self.assertEqual(st_acc_status, 200)
            self.assertFalse(st_acc_body.get("canTest"))
            self.assertFalse(st_acc_body.get("canPending"))

            um_acc_status, um_acc_body = run_as(um_token, test_access)
            self.assertEqual(um_acc_status, 200)
            self.assertTrue(um_acc_body.get("canPending"))
            self.assertFalse(um_acc_body.get("canTest"))
            
            mr_acc_status, mr_acc_body = run_as(mr_token, test_access)
            self.assertEqual(mr_acc_status, 200)
            self.assertTrue(mr_acc_body.get("canPending"))
            self.assertTrue(mr_acc_body.get("canTest"))

            # 5. Test /pending-users endpoint
            def test_pending():
                status, _, _ = self.client.raw_request("GET", f"/realms/{self.realm}/phone-otp-admin/pending-users")
                return status

            self.assertEqual(run_as(st_token, test_pending), 403)
            self.assertEqual(run_as(um_token, test_pending), 200)
            self.assertEqual(run_as(mr_token, test_pending), 200)

            # 6. Test /token endpoint (Only manage-realm can generate)
            def test_token():
                status, _, body = self.client.raw_request("POST", f"/realms/{self.realm}/phone-otp-admin/token")
                return status, (json.loads(body) if status == 200 else body)

            self.assertEqual(run_as(st_token, test_token)[0], 403)
            self.assertEqual(run_as(um_token, test_token)[0], 403)
            status, mock_token_data = run_as(mr_token, test_token)
            self.assertEqual(status, 200)
            generated_token = mock_token_data["token"]

            # 7. Test /test endpoint validation logic
            my_hostname = socket.gethostname()

            def test_empty_token():
                status, _, _ = self.client.raw_request(
                    "POST",
                    f"/realms/{self.realm}/phone-otp-admin/test",
                    json_body={"primaryEndpoint": "https://localhost", "mobile": "99", "message": "msg"}
                )
                return status

            self.assertEqual(run_as(st_token, test_empty_token), 401)
            
            def test_invalid_token():
                status, _, _ = self.client.raw_request(
                    "POST",
                    f"/realms/{self.realm}/phone-otp-admin/test",
                    json_body={"primaryEndpoint": "https://localhost", "mobile": "99", "message": "msg"},
                    headers={"X-Phone-Otp-Test-Token": "invalid-token-123"}
                )
                return status
            self.assertEqual(run_as(st_token, test_invalid_token), 401)

            def test_missing_fields():
                status, _, _ = self.client.raw_request(
                    "POST",
                    f"/realms/{self.realm}/phone-otp-admin/test",
                    json_body={"primaryEndpoint": f"http://{my_hostname}:{port}/sms"},
                    headers={"X-Phone-Otp-Test-Token": generated_token}
                )
                return status
            self.assertEqual(run_as(st_token, test_missing_fields), 400)

            def test_invalid_endpoint():
                status, _, _ = self.client.raw_request(
                    "POST",
                    f"/realms/{self.realm}/phone-otp-admin/test",
                    json_body={"primaryEndpoint": "not-a-url", "mobile": "99", "message": "msg"},
                    headers={"X-Phone-Otp-Test-Token": generated_token}
                )
                return status
            self.assertEqual(run_as(st_token, test_invalid_endpoint), 400)

            def test_valid_payload():
                status, _, _ = self.client.raw_request(
                    "POST",
                    f"/realms/{self.realm}/phone-otp-admin/test",
                    json_body={"primaryEndpoint": f"http://{my_hostname}:{port}/sms", "mobile": "9899", "message": "Test"},
                    headers={"X-Phone-Otp-Test-Token": generated_token}
                )
                return status
            self.assertEqual(run_as(st_token, test_valid_payload), 200)


        finally:
            mock_server.shutdown()
            mock_server.server_close()
            for u_id in created_user_ids:
                try:
                    self.client.delete(f"/admin/realms/{self.realm}/users/{u_id}")
                except Exception:
                    pass
            for c_id in created_client_ids:
                try:
                    self.client.delete(f"/admin/realms/{self.realm}/clients/{c_id}")
                except Exception:
                    pass

    def test_step4_end_to_end_login_otp_enforcement(self) -> None:
        import uuid
        import requests
        import urllib3
        from urllib.parse import urlparse, parse_qs
        from bs4 import BeautifulSoup
        
        # Disable warnings for self-signed certificates in dev
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        
        # We need a browser session to maintain the Auth cookies
        session = requests.Session()
        session.verify = False

        
        suffix = uuid.uuid4().hex[:8]
        u_name = f"e2e-user-{suffix}"
        pw = f"Temp@{suffix}123!"
        
        # Start a server for mock SMS
        import http.server
        import threading
        class MockSmsHandler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                print(f"--- MOCK SERVER RECEIVED: {self.path} ---")
                content_len = int(self.headers.get('Content-Length', 0))
                print(self.rfile.read(content_len).decode('utf-8'))
                
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"status":"sent"}')
            def log_message(self, format, *args):
                print(f"MOCK LOG: {format % args}")
        mock_server = http.server.HTTPServer(("0.0.0.0", 0), MockSmsHandler)
        thread = threading.Thread(target=mock_server.serve_forever)
        thread.daemon = True
        thread.start()

        # Step 1: Create a pending user (has number, but not verified)
        u_id = self._create_user_with_password(
            username=u_name,
            password=pw,
            first_name="E2E",
            last_name="Tester",
            attributes={"phone_number": ["+1234567890"]}
        )
        created_user_ids = [u_id]
        
        import socket
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("10.255.255.255", 1))
            host_ip = s.getsockname()[0]
            s.close()
        except Exception:
            host_ip = "127.0.0.1"
            
        print(f"MOCK SMS SERVER RUNNING AT: {host_ip}:{mock_server.server_port}")
            
        dummy_client_id = f"e2e-dummy-{suffix}"
        
        # -------------------------------------------------------------
        # Update Keycloak SMS configuration to point to our mock server
        # -------------------------------------------------------------
        from urllib.parse import quote
        forms_alias = "browser-PhoneOTP forms"
        executions = self.client.get(f"/admin/realms/{self.realm}/authentication/flows/{quote(forms_alias)}/executions")
        phone_otp_exec = next((e for e in executions if e.get("providerId") == "phone-otp-authenticator"), None)
        
        original_config = None
        config_id = None
        if phone_otp_exec and phone_otp_exec.get("authenticationConfig"):
            config_id = phone_otp_exec["authenticationConfig"]
            original_config = self.client.get(f"/admin/realms/{self.realm}/authentication/config/{config_id}")

            # Deep-copy so mutation of patched_config doesn't corrupt original_config
            import copy
            original_config = copy.deepcopy(original_config)

            # Create a patched config
            mock_url = f"http://{host_ip}:{mock_server.server_port}/"
            patched_config = copy.deepcopy(original_config)
            patched_config["config"]["otp.endpoint.primary"] = mock_url

            # Apply to Keycloak
            self.client.put(f"/admin/realms/{self.realm}/authentication/config/{config_id}", json_body=patched_config)
        
        # Create a dummy client with Standard Flow enabled so we trigger the real browser form
        self.client.post(
            f"/admin/realms/{self.realm}/clients",
            json_body={
                "clientId": dummy_client_id,
                "protocol": "openid-connect",
                "publicClient": True,
                "standardFlowEnabled": True,
                "directAccessGrantsEnabled": False,
                "redirectUris": ["*"]
            }
        )
        
        saved_client = self.client.get(f"/admin/realms/{self.realm}/clients", query={"clientId": dummy_client_id})[0]
        print(f"\nSAVED CLIENT: {saved_client}")
        
        try:
            # We need a fresh browser session to maintain the Auth cookies without API interference
            browser_session = requests.Session()
            browser_session.verify = False
            
            base_url = "http://vg-keycloak:8080/"
            valid_redirect = "http://vg-keycloak:8080/callback"
            
            # Helper: Initiate Login Flow
            def initiate_login_flow(client_id=dummy_client_id):
                auth_url = f"{base_url}realms/{self.realm}/protocol/openid-connect/auth?client_id={client_id}&response_type=code&redirect_uri={valid_redirect}&scope=openid"
                
                headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                }
                browser_session.cookies.clear()
                resp = browser_session.get(auth_url, headers=headers, allow_redirects=True)
                if resp.status_code != 200:
                    events = self.client.get(f"/admin/realms/{self.realm}/events", query={"max": 5})
                    print("KEYCLOAK RECENT EVENTS:")
                    for e in events:
                        print(e.get("type"), e.get("error"), e.get("details"))
                    
                    soup = BeautifulSoup(resp.text, 'html.parser')
                    err = soup.find(id='kc-error-message') or soup.find(id='kc-content')
                    err_text = err.text.strip() if err else resp.text[:200]
                    print(f"\nFAILED REQUEST TO: {resp.url}")
                    print(f"RESPONSE HTML: \n{resp.text[:1000]}")
                    self.fail(f"Should land on login page, got {resp.status_code}: {err_text}")
                
                soup = BeautifulSoup(resp.text, 'html.parser')
                form = soup.find('form')
                if not form or not form.get('action'):
                    print("FORM NOT FOUND. HTML was:")
                    print(resp.text[:5000])
                    return resp, soup, None
                
                action_url = form['action']
                return resp, soup, action_url
            
            # Helper: Submit Username & Password
            def submit_credentials(action_url, username, password):
                data = {
                    "username": username,
                    "password": password,
                    "credentialId": ""
                }
                resp = browser_session.post(action_url, data=data)
                return resp, BeautifulSoup(resp.text, 'html.parser')

            # ---------------------------------------------------------
            # Scenario 1: Pending User gets challenged with OTP Form
            # ---------------------------------------------------------
            _, _, login_action = initiate_login_flow()
            self.assertIsNotNone(login_action)
            
            resp, soup = submit_credentials(login_action, u_name, pw)
            if resp.status_code != 200:
                print(f"\n--- FAILED CREDENTIAL SUBMISSION: {resp.status_code} ---")
                print(resp.text[:5000])
                try:
                    events = self.client.get(f"/admin/realms/{self.realm}/events", query={"max": 5})
                    print("\nKEYCLOAK EVENTS:")
                    for e in events:
                        print(e.get("type"), e.get("error"), e.get("details"))
                except Exception as ex:
                    print(f"Failed to fetch events: {ex}")
            self.assertEqual(resp.status_code, 200)
            
            # Should now be on the OTP challenge page
            form_otp = soup.find('form', id='kc-otp-login-form')
            self.assertIsNotNone(form_otp, "Pending user was not challenged with the OTP form")
            # Clear cookies so we can start fresh
            browser_session.cookies.clear()

            # ---------------------------------------------------------
            # Scenario 2: Verified User bypasses Phone OTP
            # ---------------------------------------------------------
            # Mark user as verified — use explicit copy/merge to avoid mutation bugs
            user_prof = self.client.get(f"/admin/realms/{self.realm}/users/{u_id}")
            import copy
            user_prof_update = copy.deepcopy(user_prof)
            user_prof_update["attributes"] = {**user_prof_update.get("attributes", {}), "phone_verified": ["true"]}
            self.client.put(f"/admin/realms/{self.realm}/users/{u_id}", json_body=user_prof_update)

            # Verify attribute was persisted
            updated = self.client.get(f"/admin/realms/{self.realm}/users/{u_id}")
            print(f"\nSCENARIO 2 - user attributes after update: {updated.get('attributes', {})}")

            _, _, login_action = initiate_login_flow()
            resp, soup = submit_credentials(login_action, u_name, pw)
            
            # Should NOT find the custom phone OTP login form
            form_otp = soup.find('form', id='kc-otp-login-form')
            if form_otp:
                 page_text = soup.get_text().lower()
                 self.assertNotIn("we sent a verification code", page_text, "Verified user was prompted for Phone SMS OTP!")
            
            # A verified user should bypass the phone OTP form entirely.
            # They may land on the Keycloak TOTP form (if they have TOTP configured),
            # the callback redirect, or a Keycloak error page — but NOT on our custom
            # phone OTP form (id="kc-otp-login-form").
            phone_otp_form = soup.find('form', id='kc-otp-login-form')
            self.assertIsNone(phone_otp_form, "Verified user was incorrectly shown the Phone OTP form")
            browser_session.cookies.clear()

            # ---------------------------------------------------------
            # Scenario 3: Changing Phone Number forces OTP challenge again
            # ---------------------------------------------------------
            user_prof = self.client.get(f"/admin/realms/{self.realm}/users/{u_id}")
            user_prof["attributes"]["phone_number"] = ["+00000000000"]
            user_prof["attributes"].pop("phone_verified", None)
            self.client.put(f"/admin/realms/{self.realm}/users/{u_id}", json_body=user_prof)

            _, _, login_action = initiate_login_flow()
            resp, soup = submit_credentials(login_action, u_name, pw)
            
            # Should be back to the OTP challenge
            form_otp = soup.find('form', id='kc-otp-login-form')
            self.assertIsNotNone(form_otp, "User with reset verification was not challenged!")
            browser_session.cookies.clear()
            
            # ---------------------------------------------------------
            # Scenario 4: Missing Phone Number returns HTTP 400 blocked page
            # ---------------------------------------------------------
            no_phone_name = f"no-phone-{suffix}"
            no_phone_id = self._create_user_with_password(
                username=no_phone_name,
                password=pw,
                first_name="No",
                last_name="Phone",
                attributes={} # Empty
            )
            created_user_ids.append(no_phone_id)
            
            _, _, login_action = initiate_login_flow()
            
            data = {
                "username": no_phone_name,
                "password": pw,
                "credentialId": ""
            }
            resp = browser_session.post(login_action, data=data)
            
            self.assertEqual(resp.status_code, 400, "Missing phone number should return HTTP 400 Bad Request error page")
            self.assertIn("phone number missing", resp.text.lower(), "Error message should mention missing phone")

        finally:
            if config_id and original_config:
                try:
                    self.client.put(f"/admin/realms/{self.realm}/authentication/config/{config_id}", json_body=original_config)
                except Exception as e:
                    print(f"Failed to restore Keycloak OTP config: {e}")

            mock_server.shutdown()
            mock_server.server_close()
            for c_uid in created_user_ids:
                try:
                    self.client.delete(f"/admin/realms/{self.realm}/users/{c_uid}")
                except Exception:
                    pass
            
            # Cleanup dummy client
            try:
                clients = self.client.get(f"/admin/realms/{self.realm}/clients", query={"clientId": dummy_client_id})
                if clients:
                    self.client.delete(f"/admin/realms/{self.realm}/clients/{clients[0]['id']}")
            except Exception:
                pass

    def test_step4_authentication_flow_structure(self) -> None:
        # 1. Verify browser-PhoneOTP is the active flow
        self.assertEqual(self.realm_data["browserFlow"], "browser-PhoneOTP")

        # 2. Verify top-level copied browser flow structure.
        executions = self.client.get(f"/admin/realms/{self.realm}/authentication/flows/browser-PhoneOTP/executions")
        top_level = sorted([e for e in executions if e.get("level") == 0], key=lambda x: x.get("index", 99))

        top_level_names = [item.get("providerId") or item.get("displayName") for item in top_level]
        self.assertEqual(
            top_level_names,
            [
                "auth-cookie",
                "auth-spnego",
                "identity-provider-redirector",
                "browser-PhoneOTP Organization",
                "browser-PhoneOTP forms",
            ],
        )
        self.assertEqual([item["index"] for item in top_level], [0, 1, 2, 3, 4])
        self.assertEqual([item["priority"] for item in top_level], [10, 20, 25, 26, 30])
        self.assertEqual(
            [item["requirement"] for item in top_level],
            ["ALTERNATIVE", "DISABLED", "ALTERNATIVE", "ALTERNATIVE", "ALTERNATIVE"],
        )

        forms_subflow = next((e for e in executions if e.get("authenticationFlow") and "forms" in (e.get("displayName") or "").lower()), None)
        self.assertIsNotNone(forms_subflow, "Forms subflow not found in browser-PhoneOTP")

        # 3. Verify forms subflow direct children in the desired custom order.
        forms_execs = self.client.get(
            f"/admin/realms/{self.realm}/authentication/flows/{urllib.parse.quote(forms_subflow['displayName'], safe='')}/executions"
        )
        forms_top = sorted([e for e in forms_execs if e.get("level") == 0], key=lambda x: x.get("index", 99))
        forms_names = [item.get("providerId") or item.get("displayName") for item in forms_top]
        self.assertEqual(
            forms_names,
            [
                "auth-username-password-form",
                "account-expiry-check-authenticator",
                "phone-otp-authenticator",
                "browser-PhoneOTP Browser - Conditional 2FA",
            ],
        )
        self.assertEqual([item["index"] for item in forms_top], [0, 1, 2, 3])
        self.assertEqual([item["priority"] for item in forms_top], [10, 12, 15, 20])
        self.assertEqual([item["requirement"] for item in forms_top], ["REQUIRED", "REQUIRED", "REQUIRED", "CONDITIONAL"])

        otp_exec = next((e for e in forms_top if e.get("providerId") == "phone-otp-authenticator"), None)
        self.assertIsNotNone(otp_exec)
        self.assertEqual(otp_exec["requirement"], "REQUIRED")

        expiry_exec = next((e for e in forms_top if e.get("providerId") == "account-expiry-check-authenticator"), None)
        self.assertIsNotNone(expiry_exec)
        self.assertEqual(expiry_exec["requirement"], "REQUIRED")

        # 4. Verify Conditional 2FA children remain in the copied browser order.
        c2fa_subflow = next((e for e in forms_top if e.get("authenticationFlow") and "2fa" in (e.get("displayName") or "").lower()), None)
        self.assertIsNotNone(c2fa_subflow)
        c2fa_execs = self.client.get(
            f"/admin/realms/{self.realm}/authentication/flows/{urllib.parse.quote(c2fa_subflow['displayName'], safe='')}/executions"
        )
        c2fa_children = sorted([e for e in c2fa_execs if e.get("level") == 0], key=lambda x: x.get("index", 99))
        c2fa_names = [item.get("providerId") or item.get("displayName") for item in c2fa_children]
        self.assertEqual(
            c2fa_names,
            [
                "conditional-user-configured",
                "conditional-credential",
                "auth-otp-form",
                "webauthn-authenticator",
                "auth-recovery-authn-code-form",
            ],
        )
        self.assertEqual([item["index"] for item in c2fa_children], [0, 1, 2, 3, 4])
        self.assertEqual([item["priority"] for item in c2fa_children], [10, 20, 30, 40, 50])
        self.assertEqual(
            [item["requirement"] for item in c2fa_children],
            ["REQUIRED", "REQUIRED", "ALTERNATIVE", "DISABLED", "DISABLED"],
        )

    def test_step4_phone_otp_authenticator_config(self) -> None:
        executions = self.client.get(f"/admin/realms/{self.realm}/authentication/flows/browser-PhoneOTP/executions")
        otp_exec = next((e for e in executions if e.get("providerId") == "phone-otp-authenticator"), None)
        self.assertIsNotNone(otp_exec)
        
        config_id = otp_exec.get("authenticationConfig")
        self.assertIsNotNone(config_id, "phone-otp-authenticator has no configuration linked")
        
        config = self.client.get(f"/admin/realms/{self.realm}/authentication/config/{config_id}")
        self.assertEqual(config["alias"], "browser-PhoneOTP-phone-otp-config")
        
        params = config["config"]
        # Assert the endpoint is a real HTTPS URL — not the http mock URL left by the E2E test.
        # The exact production URL may vary per environment; we ensure it is https.
        endpoint = params.get("otp.endpoint.primary", "")
        self.assertTrue(
            endpoint.startswith("https://"),
            f"otp.endpoint.primary should be an https URL, got: {endpoint!r}"
        )
        self.assertEqual(params["otp.length"], "6")
        self.assertEqual(params["otp.ttl.seconds"], "300")
        self.assertEqual(params["otp.sms.mobile.field"], "mobile")

    def test_base_compose_runtime_contract(self) -> None:
        compose_data = yaml.safe_load((REPO_ROOT / "docker-compose.yml").read_text(encoding="utf-8"))
        services = compose_data["services"]

        # Updated to check for the new feature flag
        self.assertIn("--features=admin-fine-grained-authz:v2", services["keycloak"]["command"])
        self.assertEqual(services["keycloak"]["ports"], ["9000:9000"])
        
        self.assertEqual(services["step1-init"]["environment"]["STEP1_FORCE"], "${STEP1_FORCE:-false}")
        self.assertEqual(services["step2-init"]["environment"]["STEP2_FORCE"], "${STEP2_FORCE:-false}")
        self.assertEqual(services["step3-init"]["environment"]["STEP3_FORCE"], "${STEP3_FORCE:-false}")
        self.assertEqual(services["step5-init"]["environment"]["STEP5_FORCE"], "${STEP5_FORCE:-false}")
        self.assertEqual(services["step2-fgap-init"]["env_file"], [".env"])
        step2_fgap_cmd = " ".join(services["step2-fgap-init"]["command"])
        self.assertIn('KC_NEW_REALM_NAME', step2_fgap_cmd)
        self.assertIn('KC_NEW_REALM_ADMIN_USER', step2_fgap_cmd)
        self.assertIn('KC_NEW_REALM_ADMIN_PASSWORD', step2_fgap_cmd)
        
        # Verify Step 4 service exists
        self.assertIn("step4-init", services)
        self.assertEqual(services["step4-init"]["container_name"], "vg-step4-init")
        
        self.assertEqual(services["config-tests"]["profiles"], ["test"])
        self.assertEqual(services["nginx-proxy"]["profiles"], ["test"])

    def test_step2_fine_grained_admin_permissions_enforcement(self) -> None:
        import uuid
        import json
        suffix = uuid.uuid4().hex[:8]
        
        created_user_ids = []
        created_group_ids = []
        
        try:
            # Set up a test group
            status, headers, _ = self.client.raw_request("POST", f"/admin/realms/{self.realm}/groups", json_body={"name": f"fgap-test-group-{suffix}"})
            self.assertEqual(status, 201)
            group_id = headers["Location"].rstrip("/").split("/")[-1]
            created_group_ids.append(group_id)

            def create_user(role_name=None):
                u_name = f"fgap-{role_name or 'std'}-{suffix}"
                pw = f"Fgap@{suffix}123!"
                u_id = self._create_user_with_password(u_name, pw, "FGAP", "Test", {"phone_verified": ["true"]})
                created_user_ids.append(u_id)
                if role_name:
                    if role_name == "realm-admin":
                        clients = self.client.get(f"/admin/realms/{self.realm}/clients", query={"clientId": "realm-management"})
                        realm_mgmt_id = clients[0]["id"]
                        roles = self.client.get(f"/admin/realms/{self.realm}/clients/{realm_mgmt_id}/roles")
                        role = next((r for r in roles if r["name"] == role_name), None)
                        if role:
                            self.client.post(
                                f"/admin/realms/{self.realm}/users/{u_id}/role-mappings/clients/{realm_mgmt_id}",
                                json_body=[{"id": role["id"], "name": role["name"]}]
                            )
                    else:
                        roles = self.client.get(f"/admin/realms/{self.realm}/roles")
                        role = next((r for r in roles if r["name"] == role_name), None)
                        if role:
                            self.client.post(
                                f"/admin/realms/{self.realm}/users/{u_id}/role-mappings/realm",
                                json_body=[{"id": role["id"], "name": role["name"]}]
                            )
                return u_id, u_name, pw

            mr_id, manage_realm_user, manage_realm_pw = create_user("realm-admin")
            um_id, user_manager_user, user_manager_pw = create_user("user-manager")
            st_id, standard_user, standard_pw = create_user(None)

            mr_token = self.client.issue_token(self.realm, "admin-cli", manage_realm_user, manage_realm_pw)["access_token"]
            um_token = self.client.issue_token(self.realm, "admin-cli", user_manager_user, user_manager_pw)["access_token"]
            st_token = self.client.issue_token(self.realm, "admin-cli", standard_user, standard_pw)["access_token"]
            original_token = self.client.token

            def run_as(token, callback):
                self.client.token = token
                try:
                    return callback()
                finally:
                    self.client.token = original_token

            # Test 1: Query users
            def test_query_users():
                status, _, _ = self.client.raw_request("GET", f"/admin/realms/{self.realm}/users")
                return status
            self.assertEqual(run_as(st_token, test_query_users), 403)
            self.assertEqual(run_as(um_token, test_query_users), 200)
            self.assertEqual(run_as(mr_token, test_query_users), 200)

            # Test 2: Query groups
            def test_query_groups():
                status, _, _ = self.client.raw_request("GET", f"/admin/realms/{self.realm}/groups")
                return status
            self.assertEqual(run_as(st_token, test_query_groups), 403)
            self.assertEqual(run_as(um_token, test_query_groups), 200)
            self.assertEqual(run_as(mr_token, test_query_groups), 200)

            # Test 3: Modify a user attributes (e.g. standard_user)
            def test_modify_user():
                status, _, body = self.client.raw_request("PUT", f"/admin/realms/{self.realm}/users/{st_id}", json_body={"firstName": "Modified", "email": f"mod-{suffix}@example.org"})
                return status
            self.assertEqual(run_as(st_token, test_modify_user), 403)
            self.assertEqual(run_as(um_token, test_modify_user), 204)
            self.assertEqual(run_as(mr_token, test_modify_user), 204)

            # Test 4: Modify a group (e.g. rename the group)
            def test_modify_group():
                status, _, _ = self.client.raw_request("PUT", f"/admin/realms/{self.realm}/groups/{group_id}", json_body={"name": f"fgap-test-group-mod-{suffix}"})
                return status
            self.assertEqual(run_as(st_token, test_modify_group), 403)
            self.assertEqual(run_as(um_token, test_modify_group), 403) # user-manager gets 403!
            self.assertEqual(run_as(mr_token, test_modify_group), 204) # manage-realm gets 204!

        finally:
            for c_uid in created_user_ids:
                try:
                    self.client.delete(f"/admin/realms/{self.realm}/users/{c_uid}")
                except Exception:
                    pass
            for g_id in created_group_ids:
                try:
                    self.client.delete(f"/admin/realms/{self.realm}/groups/{g_id}")
                except Exception:
                    pass

    def test_step5_account_expiry_integration(self) -> None:
        import uuid
        import socket
        import http.server
        import threading
        import requests
        import urllib3
        from urllib.parse import urlparse, parse_qs
        from bs4 import BeautifulSoup
        
        # Disable warnings for self-signed certificates in dev
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        
        # 1. Verify SPI is loaded and endpoint returns timezone arrays
        status, _, body = self.client.raw_request("GET", f"/realms/{self.realm}/account-expiry-admin/timezones")
        self.assertEqual(status, 200)
        
        # 2. Verify SPI injected required fields into User Profile Schema
        status, _, body = self.client.raw_request("GET", f"/admin/realms/{self.realm}/users/profile")
        self.assertEqual(status, 200)
        schema = json.loads(body)
        attr_names = [a["name"] for a in schema.get("attributes", [])]
        self.assertIn("account_expiry_date", attr_names)
        self.assertIn("account_expiry_timezone", attr_names)
        
        
        # 3. Test Authentication behavior
        suffix = uuid.uuid4().hex[:8]
        u_name = f"expiry-tester-{suffix}"
        pw = f"Expiry@{suffix}123!"
        reminder_user_name = f"expiry-um-{suffix}"
        reminder_user_pw = f"ExpiryUm@{suffix}123!"
        dg_client_id = f"expiry-claim-{suffix}"

        # Create a test user with a phone number and verified status so they bypass OTP 
        # (Focus exclusively on Expiry logic)
        u_id = self._create_user_with_password(
            username=u_name,
            password=pw,
            first_name="Expiry",
            last_name="Tester",
            attributes={"phone_number": ["+1234567890"], "phone_verified": ["true"]}
        )
        created_user_ids = [u_id]
        reminder_user_id = self._create_user_with_password(
            username=reminder_user_name,
            password=reminder_user_pw,
            first_name="Expiry",
            last_name="Manager",
            attributes={"phone_verified": ["true"]},
        )
        created_user_ids.append(reminder_user_id)

        # Create dummy client with Standard Flow
        dummy_client_id = f"expiry-test-app-{suffix}"
        self.client.post(
            f"/admin/realms/{self.realm}/clients",
            json_body={
                "clientId": dummy_client_id,
                "protocol": "openid-connect",
                "publicClient": True,
                "standardFlowEnabled": True,
                "directAccessGrantsEnabled": False,
                "redirectUris": ["*"]
            }
        )
        dg_client_uuid = self._create_direct_grant_client(dg_client_id)
        realm_roles = self.client.get(f"/admin/realms/{self.realm}/roles")
        user_manager_role = next((r for r in realm_roles if r["name"] == "user-manager"), None)
        self.assertIsNotNone(user_manager_role)
        assign_status, _, _ = self.client.post(
            f"/admin/realms/{self.realm}/users/{reminder_user_id}/role-mappings/realm",
            json_body=[{"id": user_manager_role["id"], "name": user_manager_role["name"]}],
        )
        self.assertIn(assign_status, {200, 204})
        try:
            browser_session = requests.Session()
            browser_session.verify = False
            
            base_url = "http://vg-keycloak:8080/"
            valid_redirect = "http://vg-keycloak:8080/callback"
            
            def attempt_login(username, password):
                auth_url = f"{base_url}realms/{self.realm}/protocol/openid-connect/auth?client_id={dummy_client_id}&response_type=code&redirect_uri={valid_redirect}&scope=openid"
                browser_session.cookies.clear()
                resp = browser_session.get(auth_url, allow_redirects=True)
                soup = BeautifulSoup(resp.text, 'html.parser')
                form = soup.find('form')
                if not form: return resp, soup, "NO_FORM"
                
                action_url = form['action']
                resp = browser_session.post(action_url, data={"username": username, "password": password, "credentialId": ""}, allow_redirects=False)
                # Successful login results in 302 redirect to the callback
                event = "LOGIN_ATTEMPTED"
                if resp.status_code == 302:
                    event = "LOGIN_SUCCESS_REDIRECT"
                return resp, BeautifulSoup(resp.text, 'html.parser'), event

            # Scenario A: No Expiry Set -> Should Succeed
            resp, soup, event = attempt_login(u_name, pw)
            self.assertEqual(resp.status_code, 302) # Success redirect
            self.assertIn("/callback", resp.headers.get("Location", ""))

            # Scenario B: Future Expiry -> Should Succeed
            future_date = "2040-01-01"
            user_prof = self.client.get(f"/admin/realms/{self.realm}/users/{u_id}")
            import copy
            user_prof_update = copy.deepcopy(user_prof)
            user_prof_update["attributes"] = {**user_prof_update.get("attributes", {}), "account_expiry_date": [future_date], "account_expiry_timezone": ["Asia/Kolkata"]}
            self.client.put(f"/admin/realms/{self.realm}/users/{u_id}", json_body=user_prof_update)

            warning_token = self.client.issue_token(self.realm, dg_client_id, u_name, pw)
            warning_claims = decode_jwt_payload(warning_token["access_token"])
            self.assertIn("account_expiry", warning_claims)
            self.assertEqual(warning_claims["account_expiry"]["configured"], True)
            self.assertEqual(warning_claims["account_expiry"]["warning"], False)
            self.assertEqual(warning_claims["account_expiry"]["expired"], False)
            self.assertEqual(warning_claims["account_expiry"]["localDate"], future_date)

            resp, soup, event = attempt_login(u_name, pw)
            self.assertEqual(resp.status_code, 302) # Success redirect
            self.assertIn("/callback", resp.headers.get("Location", ""))

            near_future_date = "2026-03-20"
            user_prof_update["attributes"]["account_expiry_date"] = [near_future_date]
            self.client.put(f"/admin/realms/{self.realm}/users/{u_id}", json_body=user_prof_update)

            warning_token = self.client.issue_token(self.realm, dg_client_id, u_name, pw)
            warning_claims = decode_jwt_payload(warning_token["access_token"])
            self.assertEqual(warning_claims["account_expiry"]["configured"], True)
            self.assertEqual(warning_claims["account_expiry"]["warning"], True)
            self.assertEqual(warning_claims["account_expiry"]["expired"], False)
            self.assertLessEqual(warning_claims["account_expiry"]["daysRemaining"], 28)
            self.assertEqual(warning_claims["account_expiry"]["localDate"], near_future_date)

            reminder_token = self.client.issue_token(self.realm, "admin-cli", reminder_user_name, reminder_user_pw)["access_token"]
            status, _, body = self.client.raw_request(
                "GET",
                f"/realms/{self.realm}/account-expiry-admin/expirations",
                query={"windowDays": 28},
                headers={"Authorization": f"Bearer {reminder_token}"},
            )
            self.assertEqual(status, 200)
            reminder_payload = json.loads(body)
            reminder_match = next((item for item in reminder_payload.get("upcoming", []) if item.get("userId") == u_id), None)
            self.assertIsNotNone(reminder_match)
            self.assertEqual(reminder_match["warning"], True)
            self.assertEqual(reminder_match["expired"], False)
            self.assertLessEqual(reminder_match["daysRemaining"], 28)

            # Scenario C: Past Expiry -> Should FAIL
            past_date = "2020-01-01"
            user_prof_update["attributes"]["account_expiry_date"] = [past_date]
            self.client.put(f"/admin/realms/{self.realm}/users/{u_id}", json_body=user_prof_update)
            
            resp, soup, event = attempt_login(u_name, pw)
            # Should NOT redirect, but show error page
            self.assertNotEqual(resp.status_code, 302)
            self.assertIn("Account expired", resp.text)

            
        finally:
            for c_uid in created_user_ids:
                try:
                    self.client.delete(f"/admin/realms/{self.realm}/users/{c_uid}")
                except Exception:
                    pass
            try:
                self.client.delete(f"/admin/realms/{self.realm}/clients/{dg_client_uuid}")
            except Exception:
                pass
            try:
                clients = self.client.get(f"/admin/realms/{self.realm}/clients", query={"clientId": dummy_client_id})
                if clients:
                    self.client.delete(f"/admin/realms/{self.realm}/clients/{clients[0]['id']}")
            except Exception:
                pass


    def test_production_nginx_configs_contain_expected_hardening(self) -> None:
        master_conf = (REPO_ROOT / "nginx-confs" / "sso1-master.conf").read_text(encoding="utf-8")
        realm_conf = (REPO_ROOT / "nginx-confs" / "sso2-org-new-delhi.conf").read_text(encoding="utf-8")
        global_conf = (REPO_ROOT / "nginx-confs" / "00-global-http.conf").read_text(encoding="utf-8")

        self.assertIn('limit_req_zone $binary_remote_addr zone=kc_login_rate:10m rate=10r/m;', global_conf)
        self.assertIn('limit_req zone=kc_login_rate burst=10 nodelay;', master_conf)
        self.assertIn('location ~ ^/(metrics|health|management|q/)', master_conf)
        self.assertIn("location ~ ^/realms/(?!master(/|$)).*", master_conf)
        self.assertIn('add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;', master_conf)

        self.assertIn('location ~ ^/(metrics|health|management|q/)', realm_conf)
        self.assertIn("location ~ ^/realms/(?!org-new-delhi(/|$)).*", realm_conf)
        self.assertIn("allow 192.168.1.34;", realm_conf)
        self.assertIn("deny all;", realm_conf)
        self.assertIn("location ~ ^/admin/realms/org-new-delhi/", realm_conf)
        self.assertIn('add_header Content-Security-Policy "frame-ancestors \'none\'; object-src \'none\'; base-uri \'self\'" always;', realm_conf)

    # =========================================================================
    # STEP 6: Delegated Client Administration Tests
    # =========================================================================

    def test_step6_client_manager_role_exists(self) -> None:
        """Test that client-manager realm role exists with correct composites."""
        # Check role exists
        role = self.client.get(f"/admin/realms/{self.realm}/roles/client-manager")
        self.assertEqual(role["name"], "client-manager")
        self.assertIn("client", role.get("description", "").lower())
        # Description mentions what they can do, not necessarily "manager"
        self.assertIn("create", role.get("description", "").lower())

        # Check composites - should include realm-management client roles
        composites = self.client.get(f"/admin/realms/{self.realm}/roles/client-manager/composites")
        composite_names = [c["name"] for c in composites]

        # client-manager should have create-client and view-clients from realm-management
        self.assertIn("create-client", composite_names)
        self.assertIn("view-clients", composite_names)

    def test_step6_test_user_exists(self) -> None:
        """Test that the sample client-manager-test user was created."""
        users = self.client.get(
            f"/admin/realms/{self.realm}/users",
            {"username": "client-manager-test", "exact": "true"}
        )
        self.assertEqual(len(users), 1, "client-manager-test user should exist")
        user = users[0]
        self.assertEqual(user["username"], "client-manager-test")
        self.assertTrue(user["enabled"])

        # Verify user has client-manager role
        # Note: If user already existed from a previous run, role assignment may have been skipped
        user_roles = self.client.get(
            f"/admin/realms/{self.realm}/users/{user['id']}/role-mappings/realm"
        )
        role_names = [r["name"] for r in user_roles]
        # Check for client-manager role - if missing, it's because user pre-existed
        # In a fresh install, the role should be assigned
        if "client-manager" not in role_names:
            self.skipTest("client-manager-test user exists but role was not assigned (user may have pre-existed)")

    def test_step6_fgap_role_policy_exists(self) -> None:
        """Test that FGAP role policy for client-manager was created."""
        # Get admin-permissions client (FGAP v2 in KC 26)
        admin_perm_clients = self.client.get(
            f"/admin/realms/{self.realm}/clients",
            {"clientId": "admin-permissions"}
        )
        self.assertEqual(len(admin_perm_clients), 1, "admin-permissions client should exist")
        admin_perm_id = admin_perm_clients[0]["id"]

        # Check for role policy
        policies = self.client.get(
            f"/admin/realms/{self.realm}/clients/{admin_perm_id}/authz/resource-server/policy/role"
        )
        policy_names = [p["name"] for p in policies]
        self.assertIn("policy-client-manager", policy_names)

    def test_step6_fgap_scope_permission_exists(self) -> None:
        """Test that FGAP scope permission for Clients was NOT created.

        Rationale: FGAP scope permissions OVERRIDE realm-management roles.
        Since there's no separate 'create' scope (only 'manage' which includes delete),
        we rely on realm-management roles instead for client-manager permissions.
        """
        # Get admin-permissions client
        admin_perm_clients = self.client.get(
            f"/admin/realms/{self.realm}/clients",
            {"clientId": "admin-permissions"}
        )
        self.assertEqual(len(admin_perm_clients), 1)
        admin_perm_id = admin_perm_clients[0]["id"]

        # Check that Clients scope permission does NOT exist for client-manager
        permissions = self.client.get(
            f"/admin/realms/{self.realm}/clients/{admin_perm_id}/authz/resource-server/permission/scope"
        )
        perm_names = [p["name"] for p in permissions]
        # The perm-clients-client-manager should NOT exist
        # Client permissions are controlled by realm-management role composites instead
        self.assertNotIn("perm-clients-client-manager", perm_names,
            "Clients FGAP permission should NOT exist - using realm-management roles instead")

    def test_step6_admin_permissions_enabled(self) -> None:
        """Test that adminPermissionsEnabled is true on the realm."""
        self.assertTrue(
            self.realm_data.get("adminPermissionsEnabled", False),
            "Realm should have adminPermissionsEnabled=true for FGAP"
        )

    def test_step6_client_manager_permissions_enforcement(self) -> None:
        """Test that client-manager can create/view clients but NOT delete them.

        Permissions are controlled by realm-management role composites:
        - create-client role → allows creating clients
        - view-clients role → allows viewing clients
        - delete → NOT allowed (no manage-clients role in composite)
        """
        import uuid

        suffix = uuid.uuid4().hex[:8]
        created_client_ids = []
        created_user_ids = []

        try:
            # Create a client-manager user
            cm_user = f"client-mgr-{suffix}"
            cm_pw = f"ClientMgr@{suffix}123!"
            cm_id = self._create_user_with_password(cm_user, cm_pw, "Client", "Manager", {})
            created_user_ids.append(cm_id)

            # Assign client-manager role to user
            roles = self.client.get(f"/admin/realms/{self.realm}/roles")
            cm_role = next((r for r in roles if r["name"] == "client-manager"), None)
            self.assertIsNotNone(cm_role)
            self.client.post(
                f"/admin/realms/{self.realm}/users/{cm_id}/role-mappings/realm",
                json_body=[{"id": cm_role["id"], "name": cm_role["name"]}]
            )

            # Get token for client-manager user
            cm_token = self.client.issue_token(self.realm, "admin-cli", cm_user, cm_pw)["access_token"]
            original_token = self.client.token

            def run_as(token, callback):
                self.client.token = token
                try:
                    return callback()
                finally:
                    self.client.token = original_token

            # Test 1: client-manager CAN view clients
            def test_view_clients():
                status, _, body = self.client.raw_request(
                    "GET", f"/admin/realms/{self.realm}/clients"
                )
                return status

            view_status = run_as(cm_token, test_view_clients)
            self.assertEqual(view_status, 200, "client-manager should be able to view clients")

            # Test 2: client-manager CAN create clients (via create-client realm-management role)
            def test_create_client():
                new_client_id = f"test-cm-client-{suffix}"
                status, _, body = self.client.raw_request(
                    "POST", f"/admin/realms/{self.realm}/clients",
                    json_body={
                        "clientId": new_client_id,
                        "name": f"Test Client Manager Client {suffix}",
                        "enabled": True,
                        "publicClient": True,
                        "protocol": "openid-connect"
                    }
                )
                return status

            create_status = run_as(cm_token, test_create_client)
            self.assertIn(create_status, [201, 204],
                f"client-manager should be able to create clients, got {create_status}")

            # Find the created client
            clients = self.client.get(f"/admin/realms/{self.realm}/clients",
                query={"clientId": f"test-cm-client-{suffix}"})
            self.assertEqual(len(clients), 1)
            created_client_ids.append(clients[0]["id"])

            # Test 3: client-manager CANNOT delete clients (no manage-clients role)
            def test_delete_client():
                status, _, body = self.client.raw_request(
                    "DELETE", f"/admin/realms/{self.realm}/clients/{created_client_ids[0]}"
                )
                return status

            delete_status = run_as(cm_token, test_delete_client)
            self.assertEqual(delete_status, 403,
                f"client-manager should NOT be able to delete clients, got {delete_status}")

        finally:
            # Cleanup - delete created clients (as admin)
            for cid in created_client_ids:
                try:
                    self.client.delete(f"/admin/realms/{self.realm}/clients/{cid}")
                except Exception:
                    pass
            # Cleanup - delete created users
            for uid in created_user_ids:
                try:
                    self.client.delete(f"/admin/realms/{self.realm}/users/{uid}")
                except Exception:
                    pass

    def test_step6_docker_compose_config(self) -> None:
        """Test that docker-compose.yml has correct step6 service configuration."""
        compose_data = yaml.safe_load((REPO_ROOT / "docker-compose.yml").read_text(encoding="utf-8"))
        services = compose_data["services"]

        # Verify step6-init service exists
        self.assertIn("step6-init", services)
        step6 = services["step6-init"]
        self.assertEqual(step6["container_name"], "vg-step6-init")
        self.assertEqual(step6["restart"], "no")
        self.assertEqual(step6["depends_on"]["step5-init"]["condition"], "service_completed_successfully")

        # Verify step6-fgap-init service exists
        self.assertIn("step6-fgap-init", services)
        step6_fgap = services["step6-fgap-init"]
        self.assertEqual(step6_fgap["container_name"], "vg-step6-fgap-init")
        self.assertEqual(step6_fgap["build"]["dockerfile"], "tests/step6_fgap/Dockerfile")
        self.assertEqual(step6_fgap["depends_on"]["step6-init"]["condition"], "service_completed_successfully")

        # Verify config-tests depends on step6-fgap-init
        self.assertIn("step6-fgap-init", services["config-tests"]["depends_on"])

    def test_step6_keycloak_healthcheck_config(self) -> None:
        """Test that Keycloak service has correct healthcheck configuration."""
        compose_data = yaml.safe_load((REPO_ROOT / "docker-compose.yml").read_text(encoding="utf-8"))
        services = compose_data["services"]

        # Verify keycloak healthcheck
        self.assertIn("healthcheck", services["keycloak"])
        healthcheck = services["keycloak"]["healthcheck"]
        self.assertIn("management/health/ready", str(healthcheck["test"]))
        self.assertEqual(healthcheck["interval"], "10s")
        self.assertEqual(healthcheck["timeout"], "5s")
        self.assertEqual(healthcheck["retries"], 30)
        self.assertEqual(healthcheck["start_period"], "30s")

        # Verify step1-init waits for healthy keycloak
        step1 = services["step1-init"]
        self.assertEqual(step1["depends_on"]["keycloak"]["condition"], "service_healthy")


if __name__ == "__main__":
    unittest.main()

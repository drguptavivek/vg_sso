from __future__ import annotations

import json
import os
import socket
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from base64 import urlsafe_b64decode
from dataclasses import asdict, dataclass
from pathlib import Path


REPO_ROOT = Path("/workspace")
GROUPS_EXPECTED = REPO_ROOT / "older_sso" / "groups_expected.tsv"


@dataclass
class ControlResult:
    control_id: str
    category: str
    severity: str
    status: str
    title: str
    details: str

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ClaimShapeReport:
    name: str
    expected_present: list[str]
    expected_absent: list[str]
    observed_keys: list[str]
    sample_claims: dict

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class GroupClaimScenarioReport:
    name: str
    group_paths: list[str]
    minimal_group_details: object
    detail_group_details: object
    minimal_observed_keys: list[str]
    detail_observed_keys: list[str]

    def to_dict(self) -> dict:
        return asdict(self)


class KeycloakAdminClient:
    def __init__(self, server_url: str, realm: str, username: str, password: str) -> None:
        self.server_url = server_url.rstrip("/")
        self.realm = realm
        self.username = username
        self.password = password
        self.token: str | None = None

    def raw_request(
        self,
        method: str,
        path: str,
        query: dict | None = None,
        json_body: dict | list | None = None,
        data: bytes | None = None,
        headers: dict | None = None,
    ) -> tuple[int, dict, str]:
        url = f"{self.server_url}{path}"
        if query:
            url = f"{url}?{urllib.parse.urlencode(query, doseq=True)}"

        request_headers = dict(headers or {})
        if self.token:
            request_headers["Authorization"] = f"Bearer {self.token}"

        payload = data
        if json_body is not None:
            payload = json.dumps(json_body).encode("utf-8")
            request_headers["Content-Type"] = "application/json"

        request = urllib.request.Request(
            url,
            data=payload,
            headers=request_headers,
            method=method,
        )

        # Retry logic for transient transport failures
        max_retries = 5
        backoff_delays = [1, 2, 3, 5, 8]

        for attempt in range(max_retries):
            try:
                with urllib.request.urlopen(request, timeout=20) as response:
                    body = response.read().decode("utf-8")
                    return response.status, dict(response.headers), body
            except urllib.error.HTTPError as exc:
                # HTTP errors (4xx, 5xx) should not be retried
                # Note: We do NOT re-auth on 401 here because the token may have been
                # intentionally set by tests using different user credentials.
                return exc.code, dict(exc.headers), exc.read().decode("utf-8", errors="replace")
            except (urllib.error.URLError, ConnectionRefusedError, socket.gaierror, socket.timeout) as exc:
                if attempt < max_retries - 1:
                    delay = backoff_delays[attempt] if attempt < len(backoff_delays) else backoff_delays[-1]
                    print(f"Transport error on attempt {attempt + 1}/{max_retries}, retrying in {delay}s: {exc}")
                    time.sleep(delay)
                    continue
                # Re-raise on final attempt
                raise

    def authenticate(self) -> None:
        token_url = f"{self.server_url}/realms/{self.realm}/protocol/openid-connect/token"
        form = urllib.parse.urlencode(
            {
                "client_id": "admin-cli",
                "grant_type": "password",
                "username": self.username,
                "password": self.password,
            }
        ).encode("utf-8")
        request = urllib.request.Request(
            token_url,
            data=form,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
        self.token = payload["access_token"]

    def get(self, path: str, query: dict | None = None, headers: dict | None = None):
        status, _, body = self.raw_request("GET", path, query=query, headers=headers)
        if status >= 400:
            raise urllib.error.HTTPError(path, status, body, None, None)
        return json.loads(body)

    def post(self, path: str, json_body: dict | list | None = None, query: dict | None = None, headers: dict | None = None):
        return self.raw_request("POST", path, query=query, json_body=json_body, headers=headers)

    def put(self, path: str, json_body: dict | list | None = None, query: dict | None = None, headers: dict | None = None):
        return self.raw_request("PUT", path, query=query, json_body=json_body, headers=headers)

    def delete(self, path: str, query: dict | None = None, headers: dict | None = None):
        return self.raw_request("DELETE", path, query=query, headers=headers)

    def issue_token(
        self,
        realm: str,
        client_id: str,
        username: str,
        password: str,
        scope: str | None = None,
    ) -> dict:
        token_url = f"{self.server_url}/realms/{realm}/protocol/openid-connect/token"
        params = {
            "client_id": client_id,
            "grant_type": "password",
            "username": username,
            "password": password,
        }
        if scope:
            params["scope"] = scope
        form = urllib.parse.urlencode(params).encode("utf-8")
        request = urllib.request.Request(
            token_url,
            data=form,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def proxy_request(
    base_url: str,
    host: str,
    path: str,
    x_forwarded_for: str | None = None,
    method: str = "GET",
    data: bytes | None = None,
    extra_headers: dict | None = None,
) -> tuple[int, dict, str]:
    headers = {"Host": host}
    if x_forwarded_for:
        headers["X-Forwarded-For"] = x_forwarded_for
    if extra_headers:
        headers.update(extra_headers)
    request = urllib.request.Request(f"{base_url}{path}", data=data, headers=headers, method=method)
    handlers = [NoRedirectHandler()]
    if base_url.startswith("https://"):
        handlers.append(urllib.request.HTTPSHandler(context=ssl._create_unverified_context()))
    opener = urllib.request.build_opener(*handlers)
    try:
        with opener.open(request, timeout=20) as response:
            return response.status, dict(response.headers), response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read().decode("utf-8", errors="replace")


def location_matches(location: str, expected_path: str) -> bool:
    return location == expected_path or location.endswith(expected_path)


def decode_jwt_payload(token: str) -> dict:
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Invalid JWT format")
    payload = parts[1]
    payload += "=" * (-len(payload) % 4)
    return json.loads(urlsafe_b64decode(payload.encode("ascii")).decode("utf-8"))


def _summarize_claims(payload: dict, preferred_keys: list[str]) -> dict:
    summary = {}
    for key in preferred_keys:
        if key in payload:
            summary[key] = payload[key]
    return summary


def _create_direct_grant_client(
    realm_client: KeycloakAdminClient,
    realm: str,
    client_id: str,
    created_client_ids: list[str],
    detail_scope_id: str | None = None,
) -> str | None:
    create_status, create_headers, _ = realm_client.post(
        f"/admin/realms/{realm}/clients",
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
    if create_status not in {201, 204}:
        return None
    kc_client_uuid = create_headers["Location"].rstrip("/").split("/")[-1]
    created_client_ids.append(kc_client_uuid)
    if detail_scope_id:
        realm_client.put(
            f"/admin/realms/{realm}/clients/{kc_client_uuid}/default-client-scopes/{detail_scope_id}"
        )
    return kc_client_uuid


def _create_report_user(
    realm_client: KeycloakAdminClient,
    realm: str,
    username: str,
    password: str,
    first_name: str,
    last_name: str,
    attributes: dict[str, list[str]],
    created_user_ids: list[str],
) -> str | None:
    status, headers, _ = realm_client.post(
        f"/admin/realms/{realm}/users",
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
    if status not in {201, 204}:
        return None
    user_id = headers["Location"].rstrip("/").split("/")[-1]
    created_user_ids.append(user_id)
    realm_client.put(
        f"/admin/realms/{realm}/users/{user_id}/reset-password",
        json_body={"type": "password", "temporary": False, "value": password},
    )
    realm_client.put(
        f"/admin/realms/{realm}/users/{user_id}",
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
    return user_id


def _group_by_path(realm_client: KeycloakAdminClient, realm: str, path: str) -> dict:
    return realm_client.get(f"/admin/realms/{realm}/group-by-path/{urllib.parse.quote(path, safe='')}")


def _auth_with_retry(client: KeycloakAdminClient, timeout_seconds: int = 120) -> None:
    deadline = time.time() + timeout_seconds
    last_error = None
    while time.time() < deadline:
        try:
            client.authenticate()
            return
        except Exception as exc:  # pragma: no cover - setup retry only
            last_error = exc
            time.sleep(3)
    raise AssertionError(f"Could not authenticate to Keycloak: {last_error}")


def build_context() -> dict:
    server_url = os.environ["KC_SERVER_URL"]
    realm = os.environ["KC_NEW_REALM_NAME"]
    realm_admin_user = os.environ["KC_NEW_REALM_ADMIN_USER"]
    realm_admin_password = os.environ["KC_NEW_REALM_ADMIN_PASSWORD"]
    master_admin_user = os.environ.get("KC_MASTER_ADMIN_USER", "")
    master_admin_password = os.environ.get("KC_MASTER_ADMIN_PASSWORD", "")
    bootstrap_admin_user = os.environ.get("KC_BOOTSTRAP_ADMIN_USERNAME", "")
    bootstrap_admin_password = os.environ.get("KC_BOOTSTRAP_ADMIN_PASSWORD", "")

    realm_client = KeycloakAdminClient(server_url, realm, realm_admin_user, realm_admin_password)
    _auth_with_retry(realm_client)

    master_client = None
    master_access_ok = False
    master_access_error = ""
    if master_admin_user and master_admin_password:
        master_client = KeycloakAdminClient(server_url, "master", master_admin_user, master_admin_password)
        _auth_with_retry(master_client)

    bootstrap_auth_ok = False
    bootstrap_auth_error = ""
    if bootstrap_admin_user and bootstrap_admin_password:
        bootstrap_client = KeycloakAdminClient(
            server_url,
            "master",
            bootstrap_admin_user,
            bootstrap_admin_password,
        )
        try:
            bootstrap_client.authenticate()
            bootstrap_auth_ok = True
        except Exception as exc:  # pragma: no cover - live status only
            bootstrap_auth_error = str(exc)

    context = {
        "server_url": server_url,
        "realm": realm,
        "realm_client": realm_client,
        "master_client": master_client,
        "realm_data": realm_client.get(f"/admin/realms/{realm}"),
        "required_actions": realm_client.get(f"/admin/realms/{realm}/authentication/required-actions"),
        "user_profile": realm_client.get(f"/admin/realms/{realm}/users/profile"),
        "clients": realm_client.get(f"/admin/realms/{realm}/clients", {"max": 500}),
        "client_scopes": realm_client.get(f"/admin/realms/{realm}/client-scopes"),
        "default_scopes": realm_client.get(f"/admin/realms/{realm}/default-default-client-scopes"),
        "realm_admin_user": realm_admin_user,
        "master_admin_user": master_admin_user,
        "bootstrap_admin_user": bootstrap_admin_user,
        "bootstrap_auth_ok": bootstrap_auth_ok,
        "bootstrap_auth_error": bootstrap_auth_error,
        "master_access_ok": master_access_ok,
        "master_access_error": master_access_error,
        "proxy_http_url": os.environ.get("KC_PROXY_HTTP_URL", ""),
        "proxy_https_url": os.environ.get("KC_PROXY_HTTPS_URL", ""),
        "proxy_master_host": os.environ.get("KC_PROXY_MASTER_HOST", ""),
        "proxy_realm_host": os.environ.get("KC_PROXY_REALM_HOST", ""),
        "proxy_admin_allowed_ip": os.environ.get("KC_PROXY_ADMIN_ALLOWED_IP", ""),
        "proxy_admin_denied_ip": os.environ.get("KC_PROXY_ADMIN_DENIED_IP", ""),
    }

    if master_client is not None:
        try:
            context["master_realm_data"] = master_client.get("/admin/realms/master")
            context["master_admin_users"] = master_client.get(
                "/admin/realms/master/users",
                {"username": master_admin_user, "exact": "true"},
            )
            if bootstrap_admin_user:
                context["bootstrap_admin_users"] = master_client.get(
                    "/admin/realms/master/users",
                    {"username": bootstrap_admin_user, "exact": "true"},
                )
            context["master_access_ok"] = True
        except urllib.error.HTTPError as exc:
            context["master_access_error"] = f"HTTP {exc.code} accessing master admin API"
    return context


def _result(control_id: str, category: str, severity: str, status: str, title: str, details: str) -> ControlResult:
    return ControlResult(control_id, category, severity, status, title, details)


def evaluate_controls(context: dict) -> list[ControlResult]:
    realm_data = context["realm_data"]
    required_actions = {item["alias"]: item for item in context["required_actions"]}
    clients = context["clients"]
    client_scopes = {scope["name"]: scope["id"] for scope in context["client_scopes"]}
    default_scope_names = {scope["name"] for scope in context["default_scopes"]}
    realm_client = context["realm_client"]
    realm = context["realm"]
    results: list[ControlResult] = []

    results.append(
        _result(
            "realm-exists",
            "realm",
            "high",
            "PASS" if realm_data["realm"] == realm and realm_data["enabled"] else "FAIL",
            "Target realm exists and is enabled",
            f"Realm '{realm_data.get('realm')}' enabled={realm_data.get('enabled')}",
        )
    )

    results.append(
        _result(
            "realm-themes",
            "theme",
            "low",
            "PASS"
            if realm_data.get("loginTheme") == "vg"
            and realm_data.get("accountTheme") == "vg"
            and realm_data.get("adminTheme") == "admin-vg-custom"
            else "FAIL",
            "VG realm themes applied",
            f"loginTheme={realm_data.get('loginTheme')} accountTheme={realm_data.get('accountTheme')} adminTheme={realm_data.get('adminTheme')}",
        )
    )

    master_realm_data = context.get("master_realm_data")
    if master_realm_data:
        results.append(
            _result(
                "master-themes",
                "theme",
                "low",
                "PASS"
                if master_realm_data.get("loginTheme") == "vg-master"
                and master_realm_data.get("accountTheme") == "vg-master"
                and master_realm_data.get("adminTheme") == "vg-master"
                else "FAIL",
                "Master realm themes applied",
                f"loginTheme={master_realm_data.get('loginTheme')} accountTheme={master_realm_data.get('accountTheme')} adminTheme={master_realm_data.get('adminTheme')}",
            )
        )

    results.append(
        _result(
            "master-admin-api-access",
            "admin",
            "critical",
            "PASS" if context.get("master_access_ok") else "FAIL",
            "Configured master admin can access master admin API",
            context.get("master_access_error", "") or "Master admin API access confirmed",
        )
    )

    master_admin_users = context.get("master_admin_users", [])
    results.append(
        _result(
            "master-admin-user",
            "admin",
            "high",
            "PASS" if context.get("master_access_ok") and len(master_admin_users) == 1 else "WARN",
            "Configured master admin user exists",
            f"username={context.get('master_admin_user')} matches={len(master_admin_users)}",
        )
    )

    realm_admin_users = realm_client.get(
        f"/admin/realms/{realm}/users",
        {"username": context["realm_admin_user"], "exact": "true"},
    )
    results.append(
        _result(
            "realm-admin-user",
            "admin",
            "high",
            "PASS" if len(realm_admin_users) == 1 else "FAIL",
            "Configured realm admin user exists",
            f"username={context['realm_admin_user']} matches={len(realm_admin_users)}",
        )
    )

    bootstrap_admin_users = context.get("bootstrap_admin_users", [])
    bootstrap_present = len(bootstrap_admin_users) > 0
    if context.get("bootstrap_auth_ok"):
        bootstrap_status = "WARN"
        bootstrap_details = (
            f"Bootstrap admin '{context.get('bootstrap_admin_user')}' still authenticates in master realm."
        )
    elif context.get("master_access_ok") and bootstrap_present:
        bootstrap_status = "WARN"
        bootstrap_details = (
            f"Bootstrap admin '{context.get('bootstrap_admin_user')}' user exists but direct login did not succeed."
        )
    elif not context.get("master_access_ok"):
        bootstrap_status = "WARN"
        bootstrap_details = (
            "Bootstrap admin presence could not be verified via master admin API "
            f"because access failed: {context.get('master_access_error', 'unknown error')}"
        )
    elif bootstrap_present:
        bootstrap_status = "WARN"
        bootstrap_details = (
            f"Bootstrap admin '{context.get('bootstrap_admin_user')}' user exists but direct login did not succeed."
        )
    else:
        bootstrap_status = "PASS"
        bootstrap_details = f"Bootstrap admin '{context.get('bootstrap_admin_user')}' not found in master realm."
    results.append(
        _result(
            "bootstrap-admin-retired",
            "admin",
            "critical",
            bootstrap_status,
            "Bootstrap admin is retired or inaccessible",
            bootstrap_details,
        )
    )

    results.append(
        _result(
            "login-baseline",
            "security",
            "high",
            "PASS"
            if not realm_data["registrationAllowed"]
            and not realm_data["rememberMe"]
            and realm_data["verifyEmail"]
            and not realm_data["loginWithEmailAllowed"]
            else "FAIL",
            "Realm login baseline hardened",
            (
                f"registrationAllowed={realm_data['registrationAllowed']} "
                f"rememberMe={realm_data['rememberMe']} "
                f"verifyEmail={realm_data['verifyEmail']} "
                f"loginWithEmailAllowed={realm_data['loginWithEmailAllowed']}"
            ),
        )
    )

    brute_force_ok = (
        realm_data["bruteForceProtected"]
        and not realm_data["permanentLockout"]
        and realm_data["maxFailureWaitSeconds"] == 900
        and realm_data["waitIncrementSeconds"] == 60
        and realm_data["quickLoginCheckMilliSeconds"] == 1000
        and realm_data["minimumQuickLoginWaitSeconds"] == 60
        and realm_data["maxDeltaTimeSeconds"] == 43200
        and realm_data["failureFactor"] == 5
    )
    results.append(
        _result(
            "bruteforce-baseline",
            "security",
            "high",
            "PASS" if brute_force_ok else "FAIL",
            "Brute-force protection baseline applied",
            (
                f"bruteForceProtected={realm_data['bruteForceProtected']} "
                f"permanentLockout={realm_data['permanentLockout']} "
                f"failureFactor={realm_data['failureFactor']}"
            ),
        )
    )

    password_policy = realm_data["passwordPolicy"]
    password_tokens = [
        "length(12)",
        "digits(1)",
        "upperCase(1)",
        "lowerCase(1)",
        "specialChars(1)",
        "notUsername",
        "passwordHistory(5)",
    ]
    results.append(
        _result(
            "password-policy",
            "security",
            "high",
            "PASS" if all(token in password_policy for token in password_tokens) else "FAIL",
            "Password policy baseline applied",
            password_policy,
        )
    )

    timeout_ok = (
        realm_data["ssoSessionIdleTimeout"] == 1800
        and realm_data["ssoSessionMaxLifespan"] == 28800
        and realm_data["accessTokenLifespan"] == 300
        and realm_data["accessTokenLifespanForImplicitFlow"] == 900
        and realm_data["clientSessionIdleTimeout"] == 1800
        and realm_data["clientSessionMaxLifespan"] == 28800
        and realm_data["offlineSessionIdleTimeout"] == 2592000
    )
    results.append(
        _result(
            "session-timeouts",
            "security",
            "high",
            "PASS" if timeout_ok else "FAIL",
            "Session and token lifetime baseline applied",
            (
                f"ssoIdle={realm_data['ssoSessionIdleTimeout']} accessToken={realm_data['accessTokenLifespan']} "
                f"offlineIdle={realm_data['offlineSessionIdleTimeout']}"
            ),
        )
    )

    event_types = set(realm_data["enabledEventTypes"])
    required_event_types = {
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
    }
    results.append(
        _result(
            "audit-events",
            "security",
            "medium",
            "PASS"
            if realm_data["eventsEnabled"]
            and realm_data["adminEventsEnabled"]
            and realm_data["adminEventsDetailsEnabled"]
            and required_event_types.issubset(event_types)
            else "FAIL",
            "Realm and admin audit events enabled",
            f"eventsEnabled={realm_data['eventsEnabled']} adminEventsEnabled={realm_data['adminEventsEnabled']} types={sorted(required_event_types.intersection(event_types))}",
        )
    )

    required_actions_ok = (
        required_actions["VERIFY_EMAIL"]["enabled"]
        and required_actions["VERIFY_EMAIL"]["defaultAction"]
        and required_actions["UPDATE_PASSWORD"]["enabled"]
        and required_actions["UPDATE_PASSWORD"]["defaultAction"]
    )
    results.append(
        _result(
            "required-actions",
            "security",
            "medium",
            "PASS" if required_actions_ok else "FAIL",
            "Required actions VERIFY_EMAIL and UPDATE_PASSWORD enabled by default",
            (
                f"VERIFY_EMAIL enabled={required_actions['VERIFY_EMAIL']['enabled']} default={required_actions['VERIFY_EMAIL']['defaultAction']}; "
                f"UPDATE_PASSWORD enabled={required_actions['UPDATE_PASSWORD']['enabled']} default={required_actions['UPDATE_PASSWORD']['defaultAction']}"
            ),
        )
    )

    all_hardened = True
    admin_cli_ok = False
    for client in clients:
        if client["clientId"] == "admin-cli":
            admin_cli_ok = bool(client["directAccessGrantsEnabled"])
            continue
        if client["directAccessGrantsEnabled"] or client["implicitFlowEnabled"]:
            all_hardened = False
            break
    results.append(
        _result(
            "client-flow-hardening",
            "security",
            "high",
            "PASS" if all_hardened and admin_cli_ok else "FAIL",
            "Client direct grants and implicit flow hardened",
            f"non-admin-cli hardened={all_hardened} admin-cli-direct-grants={admin_cli_ok}",
        )
    )

    results.append(
        _result(
            "default-scopes",
            "claims",
            "medium",
            "PASS"
            if {"profile", "email", "roles", "web-origins", "org-minimal"}.issubset(default_scope_names)
            else "FAIL",
            "Default client scopes baseline applied",
            f"default scopes={sorted(default_scope_names)}",
        )
    )

    org_minimal_id = client_scopes.get("org-minimal")
    detail_profile_id = client_scopes.get("detail-profile")
    vg_mappers = []
    detail_mappers = []
    if org_minimal_id:
        vg_mappers = realm_client.get(
            f"/admin/realms/{realm}/client-scopes/{org_minimal_id}/protocol-mappers/models"
        )
    if detail_profile_id:
        detail_mappers = realm_client.get(
            f"/admin/realms/{realm}/client-scopes/{detail_profile_id}/protocol-mappers/models"
        )
    vg_mapper_names = {mapper["name"] for mapper in vg_mappers}
    detail_mapper_names = {mapper["name"] for mapper in detail_mappers}

    results.append(
        _result(
            "minimal-scope-mappers",
            "claims",
            "medium",
            "PASS"
            if {"group-details", "employment_type", "preferred_username", "account_expiry"}.issubset(vg_mapper_names)
            else "FAIL",
            "org-minimal scope mappers installed",
            f"mappers={sorted(vg_mapper_names)}",
        )
    )

    detail_expected = {
        "phone_number",
        "employment_type",
        "designation",
        "last_date",
        "posts",
        "firstName",
        "lastName",
        "email",
    }
    results.append(
        _result(
            "detail-scope-mappers",
            "claims",
            "medium",
            "PASS" if detail_expected.issubset(detail_mapper_names) and "remarks" not in detail_mapper_names else "FAIL",
            "detail-profile scope mappers installed",
            f"mappers={sorted(detail_mapper_names)}",
        )
    )

    attributes = {item["name"]: item for item in context["user_profile"]["attributes"]}
    expected_attrs = {
        "phone_number",
        "employment_type",
        "employee_id",
        "posts",
        "designation",
        "remarks",
    }
    results.append(
        _result(
            "user-profile-attributes",
            "user-profile",
            "medium",
            "PASS" if expected_attrs.issubset(attributes.keys()) else "FAIL",
            "Custom user profile attributes exist",
            f"attributes={sorted(expected_attrs.intersection(attributes.keys()))}",
        )
    )

    phone = attributes.get("phone_number", {})
    phone_ok = (
        set(phone.get("permissions", {}).get("view", [])) == {"user", "admin"}
        and set(phone.get("permissions", {}).get("edit", [])) == {"admin"}
        and phone.get("validations", {}).get("length", {}).get("max") == 20
        and phone.get("validations", {}).get("pattern", {}).get("pattern") == r"^\+?[0-9]{10,15}$"
    )
    results.append(
        _result(
            "user-profile-phone",
            "user-profile",
            "medium",
            "PASS" if phone_ok else "FAIL",
            "phone_number attribute validation and permissions applied",
            json.dumps(phone, sort_keys=True),
        )
    )

    employment_type = attributes.get("employment_type", {})
    employment_options = employment_type.get("validations", {}).get("options", {}).get("options", [])
    results.append(
        _result(
            "user-profile-employment-type",
            "user-profile",
            "low",
            "PASS"
            if employment_options == ["Permanent", "Contract", "Research", "Student", "Deputed", "Outsourced"]
            else "FAIL",
            "employment_type options baseline applied",
            f"options={employment_options}",
        )
    )

    remarks = attributes.get("remarks", {})
    results.append(
        _result(
            "user-profile-remarks",
            "user-profile",
            "low",
            "PASS"
            if remarks.get("multivalued")
            and remarks.get("validations", {}).get("length", {}).get("max") == 1000
            and remarks.get("annotations", {}).get("inputType") == "textarea"
            else "FAIL",
            "remarks attribute is multivalued textarea with length cap",
            json.dumps(remarks, sort_keys=True),
        )
    )

    role = realm_client.get(f"/admin/realms/{realm}/roles/user-manager")
    realm_management = realm_client.get(
        f"/admin/realms/{realm}/clients",
        {"clientId": "realm-management"},
    )
    realm_management_id = realm_management[0]["id"]
    composites = realm_client.get(
        f"/admin/realms/{realm}/roles-by-id/{role['id']}/composites/clients/{realm_management_id}"
    )
    composite_names = {item["name"] for item in composites}
    results.append(
        _result(
            "user-manager-role",
            "authorization",
            "medium",
            "PASS"
            if role["description"] == "User operations without group creation"
            and composite_names == {"view-users", "query-users", "query-groups"}
            else "FAIL",
            "user-manager role baseline applied",
            f"description={role.get('description')} composites={sorted(composite_names)}",
        )
    )

    group_paths_checked = 0
    group_mismatches = 0
    if GROUPS_EXPECTED.exists():
        with GROUPS_EXPECTED.open("r", encoding="utf-8") as handle:
            for raw_line in handle:
                line = raw_line.rstrip("\n")
                if not line:
                    continue
                path, attr_key, attr_val = line.split("\t")
                encoded_path = urllib.parse.quote(path, safe="")
                group = realm_client.get(f"/admin/realms/{realm}/group-by-path/{encoded_path}")
                group_paths_checked += 1
                if group.get("path") != path:
                    group_mismatches += 1
                    continue
                if attr_key == "__NONE__":
                    continue
                actual_values = group.get("attributes", {}).get(attr_key, [])
                if attr_val not in actual_values:
                    group_mismatches += 1
        group_status = "PASS" if group_mismatches == 0 and group_paths_checked > 0 else "FAIL"
        group_details = f"rows_checked={group_paths_checked} mismatches={group_mismatches}"
    else:
        group_status = "WARN"
        group_details = f"manifest missing at {GROUPS_EXPECTED}"
    results.append(
        _result(
            "groups-import",
            "groups",
            "medium",
            group_status,
            "Expected groups and attributes imported",
            group_details,
        )
    )

    smtp = realm_data.get("smtpServer", {})
    smtp_host = smtp.get("host", "")
    smtp_user = smtp.get("user", "")
    smtp_from = smtp.get("from", "")
    placeholder_markers = ("example.com", "your-email", "your-app-password")
    smtp_status = "PASS"
    if not smtp:
        smtp_status = "WARN"
    elif any(marker in value for marker in placeholder_markers for value in (smtp_host, smtp_user, smtp_from)):
        smtp_status = "WARN"
    results.append(
        _result(
            "smtp-config",
            "integration",
            "medium",
            smtp_status,
            "SMTP configuration present and non-placeholder",
            f"host={smtp_host} user={smtp_user} from={smtp_from}",
        )
    )

    proxy_http_url = context.get("proxy_http_url")
    proxy_https_url = context.get("proxy_https_url")
    if proxy_http_url and proxy_https_url:
        http_status, http_headers, _ = proxy_request(proxy_http_url, context["proxy_master_host"], "/")
        results.append(
            _result(
                "proxy-http-redirect",
                "reverse-proxy",
                "high",
                "PASS"
                if http_status in {301, 302} and http_headers.get("Location", "").startswith("https://")
                else "FAIL",
                "HTTP requests redirect to HTTPS on proxy",
                f"status={http_status} location={http_headers.get('Location', '')}",
            )
        )

        master_root_status, master_root_headers, _ = proxy_request(proxy_https_url, context["proxy_master_host"], "/")
        master_mgmt_status, _, _ = proxy_request(proxy_https_url, context["proxy_master_host"], "/management")
        master_other_realm_status, _, _ = proxy_request(
            proxy_https_url,
            context["proxy_master_host"],
            f"/realms/{realm}/account",
        )
        results.append(
            _result(
                "proxy-master-routing",
                "reverse-proxy",
                "high",
                "PASS"
                if master_root_status in {301, 302}
                and location_matches(master_root_headers.get("Location", ""), "/realms/master/account/")
                and master_mgmt_status == 403
                and master_other_realm_status == 403
                else "FAIL",
                "Master proxy host enforces routing and management blocking",
                (
                    f"root={master_root_status} root_location={master_root_headers.get('Location', '')} "
                    f"management={master_mgmt_status} other_realm={master_other_realm_status}"
                ),
            )
        )

        realm_root_status, realm_root_headers, _ = proxy_request(proxy_https_url, context["proxy_realm_host"], "/")
        realm_mgmt_status, _, _ = proxy_request(proxy_https_url, context["proxy_realm_host"], "/management")
        realm_other_realm_status, _, _ = proxy_request(
            proxy_https_url,
            context["proxy_realm_host"],
            "/realms/master/account",
        )
        admin_denied_status, _, _ = proxy_request(
            proxy_https_url,
            context["proxy_realm_host"],
            f"/admin/{realm}/console/",
            context["proxy_admin_denied_ip"],
        )
        admin_allowed_status, admin_allowed_headers, _ = proxy_request(
            proxy_https_url,
            context["proxy_realm_host"],
            f"/admin/{realm}/console/",
            context["proxy_admin_allowed_ip"],
        )
        results.append(
            _result(
                "proxy-realm-routing",
                "reverse-proxy",
                "high",
                "PASS"
                if realm_root_status in {301, 302}
                and location_matches(realm_root_headers.get("Location", ""), f"/realms/{realm}/account/")
                and realm_mgmt_status == 403
                and realm_other_realm_status == 403
                and admin_denied_status == 403
                and admin_allowed_status in {200, 302, 303}
                else "FAIL",
                "Realm proxy host enforces realm isolation and admin allowlist",
                (
                    f"root={realm_root_status} root_location={realm_root_headers.get('Location', '')} "
                    f"management={realm_mgmt_status} other_realm={realm_other_realm_status} "
                    f"admin_denied={admin_denied_status} admin_allowed={admin_allowed_status} "
                    f"admin_allowed_location={admin_allowed_headers.get('Location', '')}"
                ),
            )
        )

        header_status, header_headers, _ = proxy_request(
            proxy_https_url,
            context["proxy_realm_host"],
            "/",
        )
        header_names = {name.lower(): value for name, value in header_headers.items()}
        results.append(
            _result(
                "proxy-security-headers",
                "reverse-proxy",
                "medium",
                "PASS"
                if header_status in {200, 301, 302}
                and "strict-transport-security" in header_names
                and header_names.get("x-content-type-options") == "nosniff"
                and header_names.get("x-frame-options") == "DENY"
                and "frame-ancestors 'none'" in header_names.get("content-security-policy", "")
                else "FAIL",
                "Proxy emits security headers on HTTPS responses",
                json.dumps(header_names, sort_keys=True),
            )
        )

    return results


def collect_claim_reports(context: dict) -> tuple[list[ClaimShapeReport], list[GroupClaimScenarioReport]]:
    realm_client = context["realm_client"]
    realm = context["realm"]
    client_scopes = {scope["name"]: scope["id"] for scope in context["client_scopes"]}

    suffix = uuid.uuid4().hex[:8]
    minimal_client_id = f"report-minimal-{suffix}"
    detail_client_id = f"report-detail-{suffix}"

    created_user_ids: list[str] = []
    created_client_ids: list[str] = []

    def cleanup() -> None:
        for client_id in created_client_ids:
            realm_client.delete(f"/admin/realms/{realm}/clients/{client_id}")
        for user_id in created_user_ids:
            realm_client.delete(f"/admin/realms/{realm}/users/{user_id}")

    def build_group_scenario(
        scenario_name: str,
        group_paths: list[str],
        first_name: str,
        last_name: str,
    ) -> GroupClaimScenarioReport | None:
        scenario_username = f"report-groups-{scenario_name}-{suffix}"
        scenario_password = f"Groups@{suffix}123!"
        scenario_user_id = _create_report_user(
            realm_client,
            realm,
            scenario_username,
            scenario_password,
            first_name,
            last_name,
            {
                "employment_type": ["Permanent"],
                "phone_number": ["+919876543210"],
                "designation": ["Professor"],
                "posts": ["Cardiology"],
            },
            created_user_ids,
        )
        if not scenario_user_id:
            return None
        for path in group_paths:
            group = _group_by_path(realm_client, realm, path)
            realm_client.put(f"/admin/realms/{realm}/users/{scenario_user_id}/groups/{group['id']}")

        minimal_claims = decode_jwt_payload(
            realm_client.issue_token(realm, minimal_client_id, scenario_username, scenario_password)["access_token"]
        )
        detail_claims = decode_jwt_payload(
            realm_client.issue_token(realm, detail_client_id, scenario_username, scenario_password)["access_token"]
        )
        return GroupClaimScenarioReport(
            name=scenario_name,
            group_paths=group_paths,
            minimal_group_details=minimal_claims.get("group_details"),
            detail_group_details=detail_claims.get("group_details"),
            minimal_observed_keys=sorted(minimal_claims.keys()),
            detail_observed_keys=sorted(detail_claims.keys()),
        )

    try:
        minimal_client_uuid = _create_direct_grant_client(
            realm_client,
            realm,
            minimal_client_id,
            created_client_ids,
        )
        detail_client_uuid = _create_direct_grant_client(
            realm_client,
            realm,
            detail_client_id,
            created_client_ids,
            client_scopes.get("detail-profile"),
        )
        if not minimal_client_uuid or not detail_client_uuid:
            return [], []

        username = f"report-claims-{suffix}"
        password = f"Report@{suffix}123!"
        created_user_id = _create_report_user(
            realm_client,
            realm,
            username,
            password,
            "Claims",
            "Report",
            {
                "employment_type": ["Permanent"],
                "phone_number": ["+919876543210"],
                "designation": ["Professor"],
                "posts": ["Cardiology"],
                "remarks": ["internal-only"],
            },
            created_user_ids,
        )
        if not created_user_id:
            return [], []

        group = None
        with GROUPS_EXPECTED.open("r", encoding="utf-8") as handle:
            for raw_line in handle:
                line = raw_line.rstrip("\n")
                if not line:
                    continue
                path, attr_key, _ = line.split("\t")
                if attr_key != "__NONE__":
                    group = realm_client.get(
                        f"/admin/realms/{realm}/group-by-path/{urllib.parse.quote(path, safe='')}"
                    )
                    break
        if group:
            realm_client.put(f"/admin/realms/{realm}/users/{created_user_id}/groups/{group['id']}")

        minimal_token = realm_client.issue_token(realm, minimal_client_id, username, password)
        minimal_claims = decode_jwt_payload(minimal_token["access_token"])
        detail_token = realm_client.issue_token(realm, detail_client_id, username, password)
        detail_claims = decode_jwt_payload(detail_token["access_token"])

        claim_shapes = [
            ClaimShapeReport(
                name="org-minimal",
                expected_present=["preferred_username", "employment_type", "group_details", "account_expiry"],
                expected_absent=["phone_number", "remarks", "email"],
                observed_keys=sorted(minimal_claims.keys()),
                sample_claims=_summarize_claims(
                    minimal_claims,
                    ["preferred_username", "employment_type", "group_details", "account_expiry"],
                ),
            ),
            ClaimShapeReport(
                name="detail-profile",
                expected_present=[
                    "phone_number",
                    "employment_type",
                    "designation",
                    "posts",
                    "given_name",
                    "family_name",
                    "email",
                ],
                expected_absent=["remarks"],
                observed_keys=sorted(detail_claims.keys()),
                sample_claims=_summarize_claims(
                    detail_claims,
                    [
                        "phone_number",
                        "employment_type",
                        "designation",
                        "posts",
                        "given_name",
                        "family_name",
                        "email",
                    ],
                ),
            ),
        ]

        scenario_specs = [
            (
                "two-departments",
                ["/Departments/Cardiology", "/Departments/Medicine"],
                "Departments",
                "Only",
            ),
            (
                "faculty-plus-two-departments",
                ["/User Type/faculty", "/Departments/Cardiology", "/Departments/Medicine"],
                "Faculty",
                "Departments",
            ),
            (
                "ans-only",
                ["/User Type/ANS"],
                "Ans",
                "Only",
            ),
            (
                "faculty-only",
                ["/User Type/faculty"],
                "Faculty",
                "Only",
            ),
            (
                "it-role-only",
                ["/IT Roles/sso_user_manager"],
                "ItRole",
                "Only",
            ),
            (
                "it-role-plus-department",
                ["/IT Roles/sso_user_manager", "/Departments/Cardiology"],
                "ItRole",
                "Department",
            ),
        ]
        group_claims: list[GroupClaimScenarioReport] = []
        for name, group_paths, first_name, last_name in scenario_specs:
            report = build_group_scenario(name, group_paths, first_name, last_name)
            if report:
                group_claims.append(report)

        return claim_shapes, group_claims
    finally:
        cleanup()


def render_markdown_report(results: list[ControlResult], context: dict) -> str:
    claim_shapes, group_claim_samples = collect_claim_reports(context)
    counts: dict[str, int] = {}
    for result in results:
        counts[result.status] = counts.get(result.status, 0) + 1

    lines = [
        "# Live Config Assessment",
        "",
        f"Realm: `{context['realm']}`",
        f"Server: `{context['server_url']}`",
        "",
        "## Summary",
        "",
        f"- PASS: {counts.get('PASS', 0)}",
        f"- FAIL: {counts.get('FAIL', 0)}",
        f"- WARN: {counts.get('WARN', 0)}",
        f"- INFO: {counts.get('INFO', 0)}",
        "",
        "## Controls",
        "",
        "| ID | Category | Severity | Status | Title | Details |",
        "| --- | --- | --- | --- | --- | --- |",
    ]

    for result in results:
        details = result.details.replace("|", "\\|").replace("\n", " ")
        lines.append(
            f"| `{result.control_id}` | {result.category} | {result.severity} | {result.status} | {result.title} | {details} |"
        )

    if claim_shapes:
        lines.extend(
            [
                "",
                "## Token Shapes",
                "",
            ]
        )
        for shape in claim_shapes:
            lines.extend(
                [
                    f"### `{shape.name}`",
                    "",
                    f"- Expected present: `{', '.join(shape.expected_present)}`",
                    f"- Expected absent: `{', '.join(shape.expected_absent)}`",
                    f"- Observed keys: `{', '.join(shape.observed_keys)}`",
                    "- Sample claims:",
                    "```json",
                    json.dumps(shape.sample_claims, indent=2, sort_keys=True),
                    "```",
                    "",
                ]
            )

    if group_claim_samples:
        lines.extend(
            [
                "",
                "## Group Claim Samples",
                "",
            ]
        )
        for sample in group_claim_samples:
            lines.extend(
                [
                    f"### `{sample.name}`",
                    "",
                    f"- Group paths: `{', '.join(sample.group_paths)}`",
                    f"- Minimal token keys: `{', '.join(sample.minimal_observed_keys)}`",
                    f"- Detail token keys: `{', '.join(sample.detail_observed_keys)}`",
                    "- Minimal `group_details`:",
                    "```json",
                    json.dumps(sample.minimal_group_details, indent=2, sort_keys=True),
                    "```",
                    "- Detail `group_details`:",
                    "```json",
                    json.dumps(sample.detail_group_details, indent=2, sort_keys=True),
                    "```",
                    "",
                ]
            )

    return "\n".join(lines) + "\n"


def render_json_report(results: list[ControlResult], context: dict) -> str:
    claim_shapes, group_claim_samples = collect_claim_reports(context)
    payload = {
        "realm": context["realm"],
        "server_url": context["server_url"],
        "results": [result.to_dict() for result in results],
        "claim_shapes": [shape.to_dict() for shape in claim_shapes],
        "group_claim_samples": [sample.to_dict() for sample in group_claim_samples],
    }
    return json.dumps(payload, indent=2, sort_keys=True) + "\n"

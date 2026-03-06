from __future__ import annotations

import argparse
import json
from pathlib import Path

from assessment import build_context, evaluate_controls, render_json_report, render_markdown_report

PYTEST_RESULTS_PATH = Path("/workspace/tests/results/pytest-results.json")


def _load_pytest_results() -> dict | None:
    """Load the pytest results JSON written by conftest.py, if available."""
    try:
        return json.loads(PYTEST_RESULTS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


# Plain-English descriptions for non-technical readers.
# Key = the pytest method name (without class prefix).
TEST_DESCRIPTIONS: dict[str, str] = {
    "test_admin_users_exist":
        "Checks that the required administrator accounts exist and are active in Keycloak.",
    "test_base_compose_runtime_contract":
        "Verifies that all essential Docker services (Keycloak, Postgres, Nginx) are running and healthy.",
    "test_bootstrap_admin_is_retired":
        "Confirms that the temporary setup admin account has been disabled after initial configuration.",
    "test_client_hardening_matches_step_scripts":
        "Ensures that client application security settings in Keycloak match the hardening rules defined in deployment scripts.",
    "test_default_scopes_and_custom_scope_mappers_exist":
        "Checks that user information (name, phone, employee ID etc.) is correctly included in login tokens.",
    "test_events_and_required_actions_are_enabled":
        "Verifies that Keycloak is recording security events and enforces account actions like terms acceptance.",
    "test_expected_groups_are_present_with_expected_attributes":
        "Confirms that all department and role groups exist in the system with the correct attributes.",
    "test_expected_singletons_for_roles_and_client_scopes":
        "Checks that there are no duplicate roles or permission scopes that could grant unintended access.",
    "test_group_membership_scenarios_are_reflected_in_tokens":
        "Verifies that a user's group memberships (e.g. department, designation) are correctly reflected in their login token.",
    "test_invalid_custom_user_profile_attributes_are_rejected":
        "Confirms that users cannot set arbitrary custom profile fields — only approved attributes are accepted.",
    "test_master_admin_has_master_api_access":
        "Checks that the master administrator account has the correct permissions to manage all realms.",
    "test_master_admin_has_realm_admin_role":
        "Verifies that the master admin has the realm-level admin role required for user management.",
    "test_master_realm_themes_are_applied":
        "Confirms that the VG branded login page is shown in the master admin realm.",
    "test_nginx_proxy_reverse_proxy_controls":
        "Checks that the Nginx proxy correctly forwards requests to Keycloak and blocks direct access to internal admin endpoints.",
    "test_otp_admin_api_functionality":
        "Verifies that staff with OTP Admin role can generate/reset OTP credentials for other users, but cannot access unrelated user data.",
    "test_password_policy_and_session_timeouts":
        "Confirms that password strength rules and automatic session expiry are configured to VG security requirements.",
    "test_production_nginx_configs_contain_expected_hardening":
        "Checks that the production Nginx configuration includes security headers and rate-limiting rules.",
    "test_realm_admin_has_realm_management_role":
        "Verifies that the realm administrator can manage users and settings within the VG realm.",
    "test_realm_exists_and_themes_are_applied":
        "Confirms that the VG login realm exists, is enabled, and displays the correct VG branded theme.",
    "test_realm_login_and_bruteforce_baseline":
        "Checks that brute-force protection is active — repeated wrong passwords will temporarily lock an account.",
    "test_scope_and_mapper_names_are_unique":
        "Ensures all permission scopes and claim mappers have unique names to prevent accidental conflicts.",
    "test_step4_authentication_flow_structure":
        "Verifies that the login flow runs in the correct order: username/password first, then phone SMS OTP, then optional TOTP.",
    "test_step4_end_to_end_login_otp_enforcement":
        "Full browser-flow simulation: confirms pending users are challenged with OTP, verified users bypass it, changed phone numbers retrigger OTP, and users without a phone number are blocked.",
    "test_step4_otp_admin_api_rbac_and_validation":
        "Checks that only authorised OTP admins can manage phone OTP verification status, and that invalid requests are rejected.",
    "test_step4_phone_otp_authenticator_config":
        "Confirms that the phone SMS OTP authenticator is configured with the correct endpoint, OTP length, and expiry settings.",
    "test_token_claims_from_minimal_and_detail_scopes":
        "Verifies that the two token permission levels (minimal and detailed) return the correct set of user information fields.",
    "test_token_endpoint_rate_limit_triggers_via_nginx":
        "Confirms that the system blocks excessive login attempts by rate-limiting the token endpoint through Nginx.",
    "test_user_manager_role_and_composites_exist":
        "Checks that the User Manager role exists and grants the correct subset of permissions for day-to-day user administration.",
    "test_user_profile_schema_contains_expected_custom_attributes":
        "Confirms that all VG-specific user fields (phone number, employee ID, designation etc.) are defined in the user profile schema.",
}


def _test_description(node_id: str) -> str:
    """Extract the method name from a node id and return its plain-English description."""
    method = node_id.split("::")[-1]
    return TEST_DESCRIPTIONS.get(method, "")


def _render_e2e_section(pytest_results: dict | None) -> str:
    """Render an '## E2E Tests' markdown section from the pytest results JSON."""
    if not pytest_results:
        return "\n## E2E Tests\n\n> No result file found — pytest results unavailable.\n"

    s = pytest_results.get("summary", {})
    total = s.get("total", 0)
    passed = s.get("passed", 0)
    failed = s.get("failed", 0)
    skipped = s.get("skipped", 0)
    duration = s.get("duration_seconds", 0)
    exit_status = pytest_results.get("exit_status", -1)
    generated_at = pytest_results.get("generated_at", "unknown")

    overall = "✅ PASS" if exit_status == 0 else "❌ FAIL"

    lines = [
        "",
        "## E2E Tests",
        "",
        f"**Overall: {overall}** &nbsp;|&nbsp; "
        f"Total: {total} &nbsp;|&nbsp; "
        f"✅ {passed} passed &nbsp;|&nbsp; "
        f"❌ {failed} failed &nbsp;|&nbsp; "
        f"⏭ {skipped} skipped &nbsp;|&nbsp; "
        f"⏱ {duration}s",
        f"_Generated at {generated_at}_",
        "",
        "| Test | Description | Outcome | Duration |",
        "| --- | --- | --- | --- |",
    ]

    for test in pytest_results.get("tests", []):
        node = test["node_id"]
        # Shorten the node id: strip leading path, keep class::method
        short = node.split("/")[-1] if "/" in node else node
        desc = _test_description(node).replace("|", "\\|")
        outcome = test["outcome"]
        icon = {"passed": "✅", "failed": "❌", "skipped": "⏭"}.get(outcome, outcome)
        dur = test.get("duration", 0)
        lines.append(f"| `{short}` | {desc} | {icon} {outcome} | {dur}s |")

    # Append failure details
    failures = [t for t in pytest_results.get("tests", []) if t["outcome"] == "failed"]
    if failures:
        lines += ["", "### Failure Details", ""]
        for t in failures:
            lines += [
                f"#### `{t['node_id']}`",
                "",
                "```",
                (t.get("longrepr") or "").strip()[:3000],
                "```",
                "",
            ]

    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--markdown-out", type=Path, required=True)
    parser.add_argument("--json-out", type=Path, required=True)
    args = parser.parse_args()

    context = build_context()
    results = evaluate_controls(context)

    pytest_results = _load_pytest_results()

    # ── Markdown ──────────────────────────────────────────────────────────────
    markdown = render_markdown_report(results, context)
    markdown += _render_e2e_section(pytest_results)

    # ── JSON ──────────────────────────────────────────────────────────────────
    json_str = render_json_report(results, context)
    json_payload = json.loads(json_str)
    if pytest_results:
        json_payload["e2e_tests"] = pytest_results
    json_str = json.dumps(json_payload, indent=2, sort_keys=True) + "\n"

    # ── Write outputs ─────────────────────────────────────────────────────────
    args.markdown_out.parent.mkdir(parents=True, exist_ok=True)
    args.json_out.parent.mkdir(parents=True, exist_ok=True)
    args.markdown_out.write_text(markdown, encoding="utf-8")
    args.json_out.write_text(json_str, encoding="utf-8")

    print(markdown, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

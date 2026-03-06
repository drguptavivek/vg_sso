# Live Config Assessment

Realm: `org-new-delhi`
Server: `http://keycloak:8080`

## Summary

- PASS: 27
- FAIL: 0
- WARN: 1
- INFO: 0

## Controls

| ID | Category | Severity | Status | Title | Details |
| --- | --- | --- | --- | --- | --- |
| `realm-exists` | realm | high | PASS | Target realm exists and is enabled | Realm 'org-new-delhi' enabled=True |
| `realm-themes` | theme | low | PASS | VG realm themes applied | loginTheme=vg accountTheme=vg adminTheme=admin-vg-custom |
| `master-themes` | theme | low | PASS | Master realm themes applied | loginTheme=vg-master accountTheme=vg-master adminTheme=vg-master |
| `master-admin-api-access` | admin | critical | PASS | Configured master admin can access master admin API | Master admin API access confirmed |
| `master-admin-user` | admin | high | PASS | Configured master admin user exists | username=permrealmadmin matches=1 |
| `realm-admin-user` | admin | high | PASS | Configured realm admin user exists | username=realmadmin1 matches=1 |
| `bootstrap-admin-retired` | admin | critical | PASS | Bootstrap admin is retired or inaccessible | Bootstrap admin 'admin' not found in master realm. |
| `login-baseline` | security | high | PASS | Realm login baseline hardened | registrationAllowed=False rememberMe=False verifyEmail=True loginWithEmailAllowed=False |
| `bruteforce-baseline` | security | high | PASS | Brute-force protection baseline applied | bruteForceProtected=True permanentLockout=False failureFactor=5 |
| `password-policy` | security | high | PASS | Password policy baseline applied | length(12) and digits(1) and upperCase(1) and lowerCase(1) and specialChars(1) and notUsername and passwordHistory(5) |
| `session-timeouts` | security | high | PASS | Session and token lifetime baseline applied | ssoIdle=1800 accessToken=300 offlineIdle=2592000 |
| `audit-events` | security | medium | PASS | Realm and admin audit events enabled | eventsEnabled=True adminEventsEnabled=True types=['LOGIN', 'LOGIN_ERROR', 'LOGOUT', 'LOGOUT_ERROR', 'REGISTER', 'REGISTER_ERROR', 'RESET_PASSWORD', 'RESET_PASSWORD_ERROR', 'UPDATE_PASSWORD', 'UPDATE_PASSWORD_ERROR', 'VERIFY_EMAIL', 'VERIFY_EMAIL_ERROR'] |
| `required-actions` | security | medium | PASS | Required actions VERIFY_EMAIL and UPDATE_PASSWORD enabled by default | VERIFY_EMAIL enabled=True default=True; UPDATE_PASSWORD enabled=True default=True |
| `client-flow-hardening` | security | high | PASS | Client direct grants and implicit flow hardened | non-admin-cli hardened=True admin-cli-direct-grants=True |
| `default-scopes` | claims | medium | PASS | Default client scopes baseline applied | default scopes=['acr', 'org-minimal', 'basic', 'email', 'profile', 'role_list', 'roles', 'saml_organization', 'web-origins'] |
| `minimal-scope-mappers` | claims | medium | PASS | org-minimal scope mappers installed | mappers=['account_expiry', 'employment_type', 'group-details', 'preferred_username'] |
| `detail-scope-mappers` | claims | medium | PASS | detail-profile scope mappers installed | mappers=['designation', 'email', 'employment_type', 'firstName', 'lastName', 'last_date', 'phone_number', 'posts'] |
| `user-profile-attributes` | user-profile | medium | PASS | Custom user profile attributes exist | attributes=['designation', 'employee_id', 'employment_type', 'phone_number', 'posts', 'remarks'] |
| `user-profile-phone` | user-profile | medium | PASS | phone_number attribute validation and permissions applied | {"displayName": "Phone Number", "multivalued": false, "name": "phone_number", "permissions": {"edit": ["admin"], "view": ["admin", "user"]}, "validations": {"length": {"max": 20}, "pattern": {"error-message": "Invalid phone number", "pattern": "^\\+?[0-9]{10,15}$"}}} |
| `user-profile-employment-type` | user-profile | low | PASS | employment_type options baseline applied | options=['Permanent', 'Contract', 'Research', 'Student', 'Deputed', 'Outsourced'] |
| `user-profile-remarks` | user-profile | low | PASS | remarks attribute is multivalued textarea with length cap | {"annotations": {"inputType": "textarea", "inputTypeCols": "60", "inputTypeRows": "4"}, "displayName": "Remarks", "multivalued": true, "name": "remarks", "permissions": {"edit": ["admin"], "view": ["admin", "user"]}, "validations": {"length": {"max": 1000}}} |
| `user-manager-role` | authorization | medium | PASS | user-manager role baseline applied | description=User operations without group creation composites=['query-groups', 'query-users', 'view-users'] |
| `groups-import` | groups | medium | PASS | Expected groups and attributes imported | rows_checked=66 mismatches=0 |
| `smtp-config` | integration | medium | WARN | SMTP configuration present and non-placeholder | host= user= from= |
| `proxy-http-redirect` | reverse-proxy | high | PASS | HTTP requests redirect to HTTPS on proxy | status=301 location=https://sso1.local.test/ |
| `proxy-master-routing` | reverse-proxy | high | PASS | Master proxy host enforces routing and management blocking | root=302 root_location=https://sso1.local.test/realms/master/account/ management=403 other_realm=403 |
| `proxy-realm-routing` | reverse-proxy | high | PASS | Realm proxy host enforces realm isolation and admin allowlist | root=302 root_location=https://sso2.local.test/realms/org-new-delhi/account/ management=403 other_realm=403 admin_denied=403 admin_allowed=200 admin_allowed_location= |
| `proxy-security-headers` | reverse-proxy | medium | PASS | Proxy emits security headers on HTTPS responses | {"connection": "close", "content-length": "138", "content-security-policy": "frame-ancestors 'none'; object-src 'none'; base-uri 'self'", "content-type": "text/html", "date": "Sun, 01 Mar 2026 17:53:35 GMT", "location": "https://sso2.local.test/realms/org-new-delhi/account/", "referrer-policy": "strict-origin-when-cross-origin", "server": "nginx", "strict-transport-security": "max-age=31536000; includeSubDomains", "x-content-type-options": "nosniff", "x-frame-options": "DENY"} |

## Token Shapes

### `org-minimal`

- Expected present: `preferred_username, employment_type, group_details, account_expiry`
- Expected absent: `phone_number, remarks, email`
- Observed keys: `account_expiry, acr, aud, azp, email, email_verified, employment_type, exp, family_name, given_name, group_details, iat, iss, jti, name, preferred_username, realm_access, resource_access, scope, sid, sub, typ`
- Sample claims:
```json
{
  "account_expiry": {
    "configured": false,
    "expired": false,
    "warning": false,
    "warningWindowDays": 28
  },
  "employment_type": "Permanent",
  "group_details": [
    {
      "grps": [
        {
          "attrs": {
            "dept_id": [
              "172"
            ]
          },
          "name": "Burns And  Plastic Surgery block"
        }
      ],
      "name": "Departments"
    }
  ],
  "preferred_username": "report-claims-fd5c6972"
}
```

### `detail-profile`

- Expected present: `phone_number, employment_type, designation, posts, given_name, family_name, email`
- Expected absent: `remarks`
- Observed keys: `account_expiry, acr, aud, azp, designation, email, email_verified, employment_type, exp, family_name, given_name, group_details, iat, iss, jti, name, phone_number, posts, preferred_username, realm_access, resource_access, scope, sid, sub, typ`
- Sample claims:
```json
{
  "designation": "Professor",
  "email": "report-claims-fd5c6972@example.org",
  "employment_type": "Permanent",
  "family_name": "Report",
  "given_name": "Claims",
  "phone_number": "+919876543210",
  "posts": [
    "Cardiology"
  ]
}
```


## Group Claim Samples

### `two-departments`

- Group paths: `/Departments/Cardiology, /Departments/Medicine`
- Minimal token keys: `account_expiry, acr, aud, azp, email, email_verified, employment_type, exp, family_name, given_name, group_details, iat, iss, jti, name, preferred_username, realm_access, resource_access, scope, sid, sub, typ`
- Detail token keys: `account_expiry, acr, aud, azp, designation, email, email_verified, employment_type, exp, family_name, given_name, group_details, iat, iss, jti, name, phone_number, posts, preferred_username, realm_access, resource_access, scope, sid, sub, typ`
- Minimal `group_details`:
```json
[
  {
    "grps": [
      {
        "attrs": {
          "dept_id": [
            "14"
          ]
        },
        "name": "Cardiology"
      },
      {
        "attrs": {
          "dept_id": [
            "1"
          ]
        },
        "name": "Medicine"
      }
    ],
    "name": "Departments"
  }
]
```
- Detail `group_details`:
```json
[
  {
    "grps": [
      {
        "attrs": {
          "dept_id": [
            "14"
          ]
        },
        "name": "Cardiology"
      },
      {
        "attrs": {
          "dept_id": [
            "1"
          ]
        },
        "name": "Medicine"
      }
    ],
    "name": "Departments"
  }
]
```

### `faculty-plus-two-departments`

- Group paths: `/User Type/faculty, /Departments/Cardiology, /Departments/Medicine`
- Minimal token keys: `account_expiry, acr, aud, azp, email, email_verified, employment_type, exp, family_name, given_name, group_details, iat, iss, jti, name, preferred_username, realm_access, resource_access, scope, sid, sub, typ`
- Detail token keys: `account_expiry, acr, aud, azp, designation, email, email_verified, employment_type, exp, family_name, given_name, group_details, iat, iss, jti, name, phone_number, posts, preferred_username, realm_access, resource_access, scope, sid, sub, typ`
- Minimal `group_details`:
```json
[
  {
    "grps": [
      {
        "attrs": {
          "dept_id": [
            "14"
          ]
        },
        "name": "Cardiology"
      },
      {
        "attrs": {
          "dept_id": [
            "1"
          ]
        },
        "name": "Medicine"
      }
    ],
    "name": "Departments"
  },
  {
    "grps": [
      {
        "name": "faculty"
      }
    ],
    "name": "User Type"
  }
]
```
- Detail `group_details`:
```json
[
  {
    "grps": [
      {
        "attrs": {
          "dept_id": [
            "14"
          ]
        },
        "name": "Cardiology"
      },
      {
        "attrs": {
          "dept_id": [
            "1"
          ]
        },
        "name": "Medicine"
      }
    ],
    "name": "Departments"
  },
  {
    "grps": [
      {
        "name": "faculty"
      }
    ],
    "name": "User Type"
  }
]
```

### `ans-only`

- Group paths: `/User Type/ANS`
- Minimal token keys: `account_expiry, acr, aud, azp, email, email_verified, employment_type, exp, family_name, given_name, group_details, iat, iss, jti, name, preferred_username, realm_access, resource_access, scope, sid, sub, typ`
- Detail token keys: `account_expiry, acr, aud, azp, designation, email, email_verified, employment_type, exp, family_name, given_name, group_details, iat, iss, jti, name, phone_number, posts, preferred_username, realm_access, resource_access, scope, sid, sub, typ`
- Minimal `group_details`:
```json
[
  {
    "grps": [
      {
        "name": "ANS"
      }
    ],
    "name": "User Type"
  }
]
```
- Detail `group_details`:
```json
[
  {
    "grps": [
      {
        "name": "ANS"
      }
    ],
    "name": "User Type"
  }
]
```

### `faculty-only`

- Group paths: `/User Type/faculty`
- Minimal token keys: `account_expiry, acr, aud, azp, email, email_verified, employment_type, exp, family_name, given_name, group_details, iat, iss, jti, name, preferred_username, realm_access, resource_access, scope, sid, sub, typ`
- Detail token keys: `account_expiry, acr, aud, azp, designation, email, email_verified, employment_type, exp, family_name, given_name, group_details, iat, iss, jti, name, phone_number, posts, preferred_username, realm_access, resource_access, scope, sid, sub, typ`
- Minimal `group_details`:
```json
[
  {
    "grps": [
      {
        "name": "faculty"
      }
    ],
    "name": "User Type"
  }
]
```
- Detail `group_details`:
```json
[
  {
    "grps": [
      {
        "name": "faculty"
      }
    ],
    "name": "User Type"
  }
]
```

### `it-role-only`

- Group paths: `/IT Roles/sso_user_manager`
- Minimal token keys: `account_expiry, acr, aud, azp, email, email_verified, employment_type, exp, family_name, given_name, group_details, iat, iss, jti, name, preferred_username, realm_access, resource_access, scope, sid, sub, typ`
- Detail token keys: `account_expiry, acr, aud, azp, designation, email, email_verified, employment_type, exp, family_name, given_name, group_details, iat, iss, jti, name, phone_number, posts, preferred_username, realm_access, resource_access, scope, sid, sub, typ`
- Minimal `group_details`:
```json
[
  {
    "grps": [
      {
        "name": "sso_user_manager"
      }
    ],
    "name": "IT Roles"
  }
]
```
- Detail `group_details`:
```json
[
  {
    "grps": [
      {
        "name": "sso_user_manager"
      }
    ],
    "name": "IT Roles"
  }
]
```

### `it-role-plus-department`

- Group paths: `/IT Roles/sso_user_manager, /Departments/Cardiology`
- Minimal token keys: `account_expiry, acr, aud, azp, email, email_verified, employment_type, exp, family_name, given_name, group_details, iat, iss, jti, name, preferred_username, realm_access, resource_access, scope, sid, sub, typ`
- Detail token keys: `account_expiry, acr, aud, azp, designation, email, email_verified, employment_type, exp, family_name, given_name, group_details, iat, iss, jti, name, phone_number, posts, preferred_username, realm_access, resource_access, scope, sid, sub, typ`
- Minimal `group_details`:
```json
[
  {
    "grps": [
      {
        "attrs": {
          "dept_id": [
            "14"
          ]
        },
        "name": "Cardiology"
      }
    ],
    "name": "Departments"
  },
  {
    "grps": [
      {
        "name": "sso_user_manager"
      }
    ],
    "name": "IT Roles"
  }
]
```
- Detail `group_details`:
```json
[
  {
    "grps": [
      {
        "attrs": {
          "dept_id": [
            "14"
          ]
        },
        "name": "Cardiology"
      }
    ],
    "name": "Departments"
  },
  {
    "grps": [
      {
        "name": "sso_user_manager"
      }
    ],
    "name": "IT Roles"
  }
]
```


## E2E Tests

**Overall: ❌ FAIL** &nbsp;|&nbsp; Total: 39 &nbsp;|&nbsp; ✅ 35 passed &nbsp;|&nbsp; ❌ 3 failed &nbsp;|&nbsp; ⏭ 1 skipped &nbsp;|&nbsp; ⏱ 10.67s
_Generated at 2026-03-01T17:53:34Z_

| Test | Description | Outcome | Duration |
| --- | --- | --- | --- |
| `test_live_config.py::LiveConfigValidationTests::test_admin_users_exist` | Checks that the required administrator accounts exist and are active in Keycloak. | ✅ passed | 0.007s |
| `test_live_config.py::LiveConfigValidationTests::test_base_compose_runtime_contract` | Verifies that all essential Docker services (Keycloak, Postgres, Nginx) are running and healthy. | ✅ passed | 0.009s |
| `test_live_config.py::LiveConfigValidationTests::test_bootstrap_admin_is_retired` | Confirms that the temporary setup admin account has been disabled after initial configuration. | ✅ passed | 0.0s |
| `test_live_config.py::LiveConfigValidationTests::test_client_hardening_matches_step_scripts` | Ensures that client application security settings in Keycloak match the hardening rules defined in deployment scripts. | ✅ passed | 0.0s |
| `test_live_config.py::LiveConfigValidationTests::test_default_scopes_and_custom_scope_mappers_exist` | Checks that user information (name, phone, employee ID etc.) is correctly included in login tokens. | ✅ passed | 0.009s |
| `test_live_config.py::LiveConfigValidationTests::test_events_and_required_actions_are_enabled` | Verifies that Keycloak is recording security events and enforces account actions like terms acceptance. | ✅ passed | 0.0s |
| `test_live_config.py::LiveConfigValidationTests::test_expected_groups_are_present_with_expected_attributes` | Confirms that all department and role groups exist in the system with the correct attributes. | ✅ passed | 0.347s |
| `test_live_config.py::LiveConfigValidationTests::test_expected_singletons_for_roles_and_client_scopes` | Checks that there are no duplicate roles or permission scopes that could grant unintended access. | ✅ passed | 0.007s |
| `test_live_config.py::LiveConfigValidationTests::test_group_membership_scenarios_are_reflected_in_tokens` | Verifies that a user's group memberships (e.g. department, designation) are correctly reflected in their login token. | ✅ passed | 2.066s |
| `test_live_config.py::LiveConfigValidationTests::test_invalid_custom_user_profile_attributes_are_rejected` | Confirms that users cannot set arbitrary custom profile fields — only approved attributes are accepted. | ✅ passed | 0.022s |
| `test_live_config.py::LiveConfigValidationTests::test_master_admin_has_master_api_access` | Checks that the master administrator account has the correct permissions to manage all realms. | ✅ passed | 0.0s |
| `test_live_config.py::LiveConfigValidationTests::test_master_admin_has_realm_admin_role` | Verifies that the master admin has the realm-level admin role required for user management. | ✅ passed | 0.004s |
| `test_live_config.py::LiveConfigValidationTests::test_master_realm_themes_are_applied` | Confirms that the VG branded login page is shown in the master admin realm. | ✅ passed | 0.0s |
| `test_live_config.py::LiveConfigValidationTests::test_nginx_proxy_reverse_proxy_controls` | Checks that the Nginx proxy correctly forwards requests to Keycloak and blocks direct access to internal admin endpoints. | ✅ passed | 0.116s |
| `test_live_config.py::LiveConfigValidationTests::test_otp_admin_api_functionality` | Verifies that staff with OTP Admin role can generate/reset OTP credentials for other users, but cannot access unrelated user data. | ✅ passed | 0.558s |
| `test_live_config.py::LiveConfigValidationTests::test_password_policy_and_session_timeouts` | Confirms that password strength rules and automatic session expiry are configured to VG security requirements. | ✅ passed | 0.0s |
| `test_live_config.py::LiveConfigValidationTests::test_production_nginx_configs_contain_expected_hardening` | Checks that the production Nginx configuration includes security headers and rate-limiting rules. | ✅ passed | 0.002s |
| `test_live_config.py::LiveConfigValidationTests::test_realm_admin_has_realm_management_role` | Verifies that the realm administrator can manage users and settings within the VG realm. | ✅ passed | 0.036s |
| `test_live_config.py::LiveConfigValidationTests::test_realm_exists_and_themes_are_applied` | Confirms that the VG login realm exists, is enabled, and displays the correct VG branded theme. | ✅ passed | 0.0s |
| `test_live_config.py::LiveConfigValidationTests::test_realm_login_and_bruteforce_baseline` | Checks that brute-force protection is active — repeated wrong passwords will temporarily lock an account. | ✅ passed | 0.0s |
| `test_live_config.py::LiveConfigValidationTests::test_scope_and_mapper_names_are_unique` | Ensures all permission scopes and claim mappers have unique names to prevent accidental conflicts. | ✅ passed | 0.008s |
| `test_live_config.py::LiveConfigValidationTests::test_step2_fine_grained_admin_permissions_enforcement` |  | ✅ passed | 0.844s |
| `test_live_config.py::LiveConfigValidationTests::test_step4_authentication_flow_structure` | Verifies that the login flow runs in the correct order: username/password first, then phone SMS OTP, then optional TOTP. | ❌ failed | 0.015s |
| `test_live_config.py::LiveConfigValidationTests::test_step4_end_to_end_login_otp_enforcement` | Full browser-flow simulation: confirms pending users are challenged with OTP, verified users bypass it, changed phone numbers retrigger OTP, and users without a phone number are blocked. | ✅ passed | 1.267s |
| `test_live_config.py::LiveConfigValidationTests::test_step4_otp_admin_api_rbac_and_validation` | Checks that only authorised OTP admins can manage phone OTP verification status, and that invalid requests are rejected. | ✅ passed | 1.206s |
| `test_live_config.py::LiveConfigValidationTests::test_step4_phone_otp_authenticator_config` | Confirms that the phone SMS OTP authenticator is configured with the correct endpoint, OTP length, and expiry settings. | ✅ passed | 0.009s |
| `test_live_config.py::LiveConfigValidationTests::test_step5_account_expiry_integration` |  | ❌ failed | 0.902s |
| `test_live_config.py::LiveConfigValidationTests::test_step6_admin_permissions_enabled` |  | ✅ passed | 0.0s |
| `test_live_config.py::LiveConfigValidationTests::test_step6_client_manager_permissions_enforcement` |  | ❌ failed | 0.224s |
| `test_live_config.py::LiveConfigValidationTests::test_step6_client_manager_role_exists` |  | ✅ passed | 0.006s |
| `test_live_config.py::LiveConfigValidationTests::test_step6_docker_compose_config` |  | ✅ passed | 0.008s |
| `test_live_config.py::LiveConfigValidationTests::test_step6_fgap_role_policy_exists` |  | ✅ passed | 0.008s |
| `test_live_config.py::LiveConfigValidationTests::test_step6_fgap_scope_permission_exists` |  | ✅ passed | 0.005s |
| `test_live_config.py::LiveConfigValidationTests::test_step6_keycloak_healthcheck_config` |  | ✅ passed | 0.008s |
| `test_live_config.py::LiveConfigValidationTests::test_step6_test_user_exists` |  | ⏭ skipped | 0.01s |
| `test_live_config.py::LiveConfigValidationTests::test_token_claims_from_minimal_and_detail_scopes` | Verifies that the two token permission levels (minimal and detailed) return the correct set of user information fields. | ✅ passed | 0.322s |
| `test_live_config.py::LiveConfigValidationTests::test_token_endpoint_rate_limit_triggers_via_nginx` | Confirms that the system blocks excessive login attempts by rate-limiting the token endpoint through Nginx. | ✅ passed | 2.054s |
| `test_live_config.py::LiveConfigValidationTests::test_user_manager_role_and_composites_exist` | Checks that the User Manager role exists and grants the correct subset of permissions for day-to-day user administration. | ✅ passed | 0.024s |
| `test_live_config.py::LiveConfigValidationTests::test_user_profile_schema_contains_expected_custom_attributes` | Confirms that all VG-specific user fields (phone number, employee ID, designation etc.) are defined in the user profile schema. | ✅ passed | 0.0s |

### Failure Details

#### `test_live_config.py::LiveConfigValidationTests::test_step4_authentication_flow_structure`

```
self = <test_live_config.LiveConfigValidationTests testMethod=test_step4_authentication_flow_structure>

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
>       self.assertEqual(
            forms_names,
            [
                "auth-username-password-form",
                "account-expiry-check-authenticator",
                "phone-otp-authenticator",
                "browser-PhoneOTP Browser - Conditional 2FA",
            ],
        )
E       AssertionError: Lists differ: ['aut[23 chars]m', 'phone-otp-authenticator', 'browser-PhoneO[25 chars]2FA'] != ['aut[23 chars]m', 'account-expiry-check-authenticator', 'pho[63 chars]2FA']
E       
E       First differing element 1:
E       'phone-otp-authenticator'
E       'account-expiry-check-authenticator'
E       
E       Second list contains 1 additional elements.
E       First extra element 3:
E       'browser-PhoneOTP Browser - Conditional 2FA'
E       
E         ['auth-username-password-form',
E       +  'account-expiry-check-authenticator',
E          'phone-otp-authenticator',
E          'browser-PhoneOTP Browser - Condition
```

#### `test_live_config.py::LiveConfigValidationTests::test_step5_account_expiry_integration`

```
self = <test_live_config.LiveConfigValidationTests testMethod=test_step5_account_expiry_integration>

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
        user_manager_role = next((r for r in realm_roles if r["name"] == "u
```

#### `test_live_config.py::LiveConfigValidationTests::test_step6_client_manager_permissions_enforcement`

```
self = <test_live_config.LiveConfigValidationTests testMethod=test_step6_client_manager_permissions_enforcement>

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
    
            create_status = run_as(cm_to
```


# Handoff

## Branch / Base

- Branch at handoff: `main`
- Recent baseline commits:
  - `f136853` Step 5: Automated Account Expiry SPI integration and verification
  - `f946325` FGAP checks folded into `test_live_config.py`
  - `4313fa6` automated Keycloak 26 FGAP setup without Playwright
  - `606cab7` OTP flow verification across 4 scenarios

## What Was Changed In This Session

### Review findings fixed

- Restored production nginx hardening in [nginx-confs/sso2-org-new-delhi.conf](/Users/vivekgupta/workspace/vg_sso/nginx-confs/sso2-org-new-delhi.conf):
  - removed widened admin allowlist
  - restored login/token rate limiting
- Fixed `step2-fgap-init` to use env-driven realm/admin values in [docker-compose.yml](/Users/vivekgupta/workspace/vg_sso/docker-compose.yml)
- Restored one-shot Step 5 behavior in [docker-compose.yml](/Users/vivekgupta/workspace/vg_sso/docker-compose.yml) by using `${STEP5_FORCE:-false}`

### Step 2 fixes

- Fixed malformed JSON in [scripts/step2_realm_config_docker.sh](/Users/vivekgupta/workspace/vg_sso/scripts/step2_realm_config_docker.sh)
- Fixed FGAP bootstrap auth realm in [scripts/step2_fgap_api_setup.py](/Users/vivekgupta/workspace/vg_sso/scripts/step2_fgap_api_setup.py)
- Added progress markers to FGAP bootstrap logs in [scripts/step2_fgap_api_setup.py](/Users/vivekgupta/workspace/vg_sso/scripts/step2_fgap_api_setup.py)

### Step 3 claim work

- Added a new Keycloak protocol mapper:
  - [AccountExpiryWarningProtocolMapper.java](/Users/vivekgupta/workspace/vg_sso/custom-account-expiry-spi/src/main/java/tech/epidemiology/keycloak/expiry/AccountExpiryWarningProtocolMapper.java)
- Registered the mapper in:
  - [META-INF/services/org.keycloak.protocol.ProtocolMapper](/Users/vivekgupta/workspace/vg_sso/custom-account-expiry-spi/src/main/resources/META-INF/services/org.keycloak.protocol.ProtocolMapper)
- Provisioned `account_expiry` into the default `org-minimal` scope in [scripts/step3_claims_config_docker.sh](/Users/vivekgupta/workspace/vg_sso/scripts/step3_claims_config_docker.sh)

### Step 4 work

- Documented desired browser flow state in [Step_4_PhoneSMSOTP.md](docs/Step_4_PhoneSMSOTP.md)
- Tightened live assertions in [tests/live_config/test_live_config.py](/Users/vivekgupta/workspace/vg_sso/tests/live_config/test_live_config.py)
- Step 4 script already uses deterministic JSON execution updates in [scripts/step4_otp_config_docker.sh](/Users/vivekgupta/workspace/vg_sso/scripts/step4_otp_config_docker.sh)

### Step 5 work

- Improved expiry SPI utility reuse in:
  - [AccountExpiryUtil.java](/Users/vivekgupta/workspace/vg_sso/custom-account-expiry-spi/src/main/java/tech/epidemiology/keycloak/expiry/AccountExpiryUtil.java)
  - [AccountExpiryAuthenticator.java](/Users/vivekgupta/workspace/vg_sso/custom-account-expiry-spi/src/main/java/tech/epidemiology/keycloak/expiry/AccountExpiryAuthenticator.java)
  - [AccountExpiryAdminResourceProvider.java](/Users/vivekgupta/workspace/vg_sso/custom-account-expiry-spi/src/main/java/tech/epidemiology/keycloak/expiry/AccountExpiryAdminResourceProvider.java)
- Added unit coverage file:
  - [AccountExpiryWarningProtocolMapperTest.java](/Users/vivekgupta/workspace/vg_sso/custom-account-expiry-spi/src/test/java/tech/epidemiology/keycloak/expiry/AccountExpiryWarningProtocolMapperTest.java)
- Step 5 default expiry backfill rule in [scripts/step5_expiry_config_docker.sh](/Users/vivekgupta/workspace/vg_sso/scripts/step5_expiry_config_docker.sh):
  - `1 year + pseudo-random 2-8 weeks`
- Step 5 now re-applies if marker exists but expiry schema is missing
- Step 5 sets deterministic forms order to:
  - `auth-username-password-form`
  - `account-expiry-check-authenticator`
  - `phone-otp-authenticator`
  - `Browser - Conditional 2FA`
- Step 5 docs updated in [Step_5_Account_expiry.md](docs/Step_5_Account_expiry.md):
  - warning claim shape
  - reminder endpoint usage
  - reminder policy notes

### Test/runtime image changes

- Removed unused Playwright dependencies from live-config test env:
  - [tests/live_config/pyproject.toml](/Users/vivekgupta/workspace/vg_sso/tests/live_config/pyproject.toml)
  - [tests/live_config/uv.lock](/Users/vivekgupta/workspace/vg_sso/tests/live_config/uv.lock)
- Baked `uv sync --project /tmp/live-config --locked` into [tests/live_config/Dockerfile](/Users/vivekgupta/workspace/vg_sso/tests/live_config/Dockerfile)
- Split `step2-fgap-init` onto its own minimal image:
  - [tests/step2_fgap/Dockerfile](/Users/vivekgupta/workspace/vg_sso/tests/step2_fgap/Dockerfile)
- Added progress markers to `config-tests` command in [docker-compose.yml](/Users/vivekgupta/workspace/vg_sso/docker-compose.yml)

## Current Known State

### What is working

- Keycloak build succeeds with the new expiry warning mapper
- Compose config is valid
- Python syntax checks are clean for the touched Python files
- FGAP bootstrap now logs useful phases
- `config-tests` no longer pulls Playwright
- `step2-fgap-init` no longer shares the heavy live-config test image

### Latest manual run outcome

The user ran:

```bash
STEP1_FORCE=true STEP2_FORCE=true STEP3_FORCE=true STEP4_FORCE=true STEP5_FORCE=true \
docker compose -f docker-compose.yml -f docker-compose.override.yml --profile test \
up --build --abort-on-container-exit --exit-code-from config-tests config-tests
```

Observed summary:

- `26 passed`
- `5 failed`

Failed tests:

- `test_step4_phone_otp_authenticator_config`
- `test_step5_account_expiry_integration`
- `test_token_claims_from_minimal_and_detail_scopes`
- `test_token_endpoint_rate_limit_triggers_via_nginx`
- `test_user_manager_role_and_composites_exist`

### Root cause of current failures

The failures are not Playwright-related and do not look like nginx rate limiting.

The detailed traces in [tests/results/pytest-results.json](/Users/vivekgupta/workspace/vg_sso/tests/results/pytest-results.json) show:

- requests are made to `http://keycloak:8080`
- failures are transport-level:
  - `Connection refused`
  - `Name or service not known`

This means:

- `keycloak:8080` is the intended direct service host used by [tests/live_config/assessment.py](/Users/vivekgupta/workspace/vg_sso/tests/live_config/assessment.py)
- the host worked earlier in the same run, because 26 tests passed
- Keycloak availability became unstable mid-suite, or the test container briefly lost service discovery/connectivity

This is not the same issue as:

- wrong hostname constant
- nginx rate limiting
- Step 4/5 assertion mismatch

## Exact Evidence

- `test_step4_phone_otp_authenticator_config` failed on admin API access via `self.client.get(...)`
- `test_step5_account_expiry_integration` failed on:
  - `GET /realms/{realm}/account-expiry-admin/timezones`
- `test_token_claims_from_minimal_and_detail_scopes` failed on admin API object creation
- `test_token_endpoint_rate_limit_triggers_via_nginx` failed while creating a user through the admin API
- `test_user_manager_role_and_composites_exist` failed on:
  - `GET /admin/realms/{realm}/roles/user-manager`

All of those go through the same client in [tests/live_config/assessment.py](/Users/vivekgupta/workspace/vg_sso/tests/live_config/assessment.py), using `KC_SERVER_URL=http://keycloak:8080`.

## Most Likely Next Fix

Patch [tests/live_config/assessment.py](/Users/vivekgupta/workspace/vg_sso/tests/live_config/assessment.py) to add a retry loop in `raw_request()` for transient transport failures:

- `urllib.error.URLError`
- `ConnectionRefusedError`
- `socket.gaierror`

Suggested policy:

- retry 5 times
- short backoff, e.g. `1s, 2s, 3s`
- retry only for transport failures
- do not retry normal HTTP 4xx/5xx
- optionally re-auth once on `401`

This should make the suite resilient to short Keycloak restarts or Compose DNS timing glitches.

## Useful Commands

### Canonical rerun

```bash
STEP1_FORCE=true STEP2_FORCE=true STEP3_FORCE=true STEP4_FORCE=true STEP5_FORCE=true \
docker compose -f docker-compose.yml -f docker-compose.override.yml --profile test \
up --build --abort-on-container-exit --exit-code-from config-tests config-tests
```

### Inspect config-tests logs

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml logs --no-color --tail=200 config-tests
```

### Inspect keycloak logs during run

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml logs -f keycloak
```

### Inspect current compose state

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml ps
```

### Print failed pytest details from recorded artifact

```bash
python3 - <<'PY'
import json
from pathlib import Path
p = Path('tests/results/pytest-results.json')
obj = json.loads(p.read_text())
for t in obj['tests']:
    if t['outcome'] == 'failed':
        print(f"\\n=== {t['node_id']} ===\\n")
        print(t['longrepr'][:12000])
        print("\\n" + "=" * 100 + "\\n")
PY
```

## Notes

- Host-side Maven unit tests were intentionally avoided for Mockito/JaCoCo-sensitive paths after the user asked to keep those container-only.
- There are existing modified result files:
  - [tests/results/live-config-report.json](/Users/vivekgupta/workspace/vg_sso/tests/results/live-config-report.json)
  - [tests/results/live-config-report.md](/Users/vivekgupta/workspace/vg_sso/tests/results/live-config-report.md)
  - [tests/results/pytest-results.json](/Users/vivekgupta/workspace/vg_sso/tests/results/pytest-results.json)
  These reflect the latest failing run and are included in the current worktree.

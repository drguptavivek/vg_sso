# AGENTS.md

This repository now uses a Docker-based Keycloak setup as the canonical workflow.
Use `docker compose` plus the helper scripts below instead of manually starting `keycloak-26.5.x/bin/kc.sh`.

## Canonical Runtime

- `docker-compose.yml` defines the base stack:
  - `postgres`
  - `keycloak`
  - `step1-init`
  - `step2-init`
  - `step3-init` ... `step9-init`
  - `keycloak-maintenance` (routine maintenance runner)
- `docker-compose.override.yml` is the local development overlay:
  - exposes `8080`, `9000`, and `5432`
  - runs Keycloak with `start-dev`
  - disables theme caches for faster iteration
  - bind-mounts `./scripts` to `/opt/keycloak/scripts` for script-only iteration without image rebuild
- The custom Keycloak image is built from the repo `Dockerfile`.
  - It packages the custom providers.
  - It copies themes and import data.
  - It runs `kc.sh build` in the image.

## Environment Setup

Create the local env file first:

```bash
cp .env.template .env
```

Update at least these values in `.env`:

- `KC_BOOTSTRAP_ADMIN_USERNAME`
- `KC_BOOTSTRAP_ADMIN_PASSWORD`
- `KC_DB_USERNAME`
- `KC_DB_PASSWORD`
- `KC_MASTER_ADMIN_USER`
- `KC_MASTER_ADMIN_PASSWORD`
- `KC_NEW_REALM_NAME`
- `KC_NEW_REALM_ADMIN_USER`
- `KC_NEW_REALM_ADMIN_PASSWORD`
- `KC_NEW_REALM_ADMIN_EMAIL`
- `KC_NEW_REALM_ADMIN_PHONE`
- `KC_NEW_REALM_ADMIN_PHONE_VERIFIED`
- `KEYCLOAK_ENV` (Requires `development` to disable SSL enforcement `sslRequired=none` on localhost).

Notes:

- `step1-init` fails fast if `KC_MASTER_ADMIN_USER`, `KC_NEW_REALM_ADMIN_USER`, or their passwords still use placeholder values like `change_*`.
- `step2-init` and `step3-init` authenticate with `KC_NEW_REALM_ADMIN_USER` in `KC_NEW_REALM_NAME`.
- Keep `.env` and `.kcadm.config` local; they contain secrets/tokens.

## Local CLI Shortcuts

Host-side `kcadm` usage is still supported.
At repo root, create local shortcuts to the checked-in Keycloak distribution:

```bash
ln -sf ./keycloak-current/bin/kc.sh kc.sh
ln -sf ./keycloak-current/bin/kcadm.sh kcadm.sh
chmod +x kc.sh kcadm.sh
```

If `keycloak-current/` is not the intended target in your checkout, point the symlinks at the desired `keycloak-26.5.x/` directory instead.

## Keycloak Version Notes

- The image currently builds from Keycloak `26.5.4`.
- Keycloak 26.x `bootstrap-admin` does not accept `--password`; use `--password:env`.
- On this setup, `kcadm.sh set-password` treats `--temporary` as a flag.
  - Permanent password: omit `--temporary`.
  - Temporary password: include `--temporary`.

## SPI Hot-Reload (Dev Workflow)

When iterating on a custom SPI (Java), **do not do a full image rebuild**. Build JARs on host and hot-swap:

```bash
# 1. Build only the changed SPI JAR (Maven must be on PATH)
mvn -q -f custom-delegated-admin-guard-spi/pom.xml -DskipTests package

# 2. Copy JAR into the running container
docker cp custom-delegated-admin-guard-spi/target/custom-delegated-admin-guard-spi-1.0.0.jar \
  vg-keycloak:/opt/keycloak/providers/

# 3. Restart Keycloak to pick up the new JAR
docker compose -f docker-compose.yml -f docker-compose.override.yml restart keycloak

# 4. Wait for health
curl -sf http://localhost:9000/management/health/ready
```

This takes ~30 seconds vs several minutes for a full `docker compose build`.

For all SPI modules, use:

```bash
make build-spis
```

and for full hot-reload flow:

```bash
make dev-reload-spi
```

**Full image rebuild** is only needed when:
- Adding a new SPI module (pom.xml changes)
- Changing theme files
- Changing Dockerfile itself

**Note:** Running `--profile test run --rm step7-test` re-starts init containers (step1 -> step9)
as a dependency chain. This is by design and fast — each init container checks its marker file and
exits immediately if already run. No re-configuration happens unless `STEP_FORCE=true` is set.

## Start The Stack

Development workflow:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.override.yml ps
```

Base stack without the dev override:

```bash
docker compose up -d --build
docker compose ps
```

Local access with the dev overlay:

- Keycloak: `http://localhost:8080`
- Management: `http://localhost:9000/management`
- Postgres: `localhost:5432`

## Bootstrap Flow

The compose workflow is intentionally split into one-shot init containers:

1. `step1-init`
   - waits for Keycloak
   - logs in with `KC_BOOTSTRAP_ADMIN_USERNAME` / `KC_BOOTSTRAP_ADMIN_PASSWORD`
   - ensures the master admin user exists
   - ensures `KC_NEW_REALM_NAME` exists
   - ensures the realm admin user exists and has `realm-admin`
   - applies realm/master themes
2. `step2-init`
   - logs into `KC_NEW_REALM_NAME` using `KC_NEW_REALM_ADMIN_USER`
   - applies realm security baseline, required actions, profile schema, groups, and delegated admin setup
3. `step3-init`
   - logs into `KC_NEW_REALM_NAME` using `KC_NEW_REALM_ADMIN_USER`
   - applies client scopes and token claim mappers
4. `step4-init`
   - applies OTP/browser-flow configuration
5. `step5-init`
   - applies account expiry baseline and profile extensions
6. `step6-init`
   - configures delegated client-manager role model
7. `step6-fgap-init`
   - applies FGAP permissions for client-manager
8. `step7-init`
   - bootstraps `AppRoles` and delegated client admin baseline
9. `step7-fgap-init`
   - applies FGAP permissions for delegated client admin
10. `step8-init`
   - configures `auditor` role, 270-day event retention baseline, and failure log listener assignment
11. `step9-init`
   - provisions audit archival/export directories and watermark state

Each step writes a marker file into the shared Keycloak data volume and skips on later runs unless forced.

## Check Logs And Status

Inspect running services:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml ps
```

Inspect bootstrap/config logs:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml logs --no-color --tail=200 step1-init
docker compose -f docker-compose.yml -f docker-compose.override.yml logs --no-color --tail=200 step2-init
docker compose -f docker-compose.yml -f docker-compose.override.yml logs --no-color --tail=200 step3-init
```

Useful make shortcuts:

```bash
make logs-runtime   # keycloak + postgres only (timestamps)
make logs-init      # init steps only (timestamps)
make logs-all       # all containers
```

## Re-run One Init Step

Force a step to run again even if its marker file already exists:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml run --rm -e STEP1_FORCE=true step1-init
docker compose -f docker-compose.yml -f docker-compose.override.yml run --rm -e STEP2_FORCE=true step2-init
docker compose -f docker-compose.yml -f docker-compose.override.yml run --rm -e STEP3_FORCE=true step3-init
docker compose -f docker-compose.yml -f docker-compose.override.yml run --rm -e STEP8_FORCE=true step8-init
docker compose -f docker-compose.yml -f docker-compose.override.yml run --rm -e STEP9_FORCE=true step9-init
```

Useful when iterating:

- use `STEP1_FORCE=true` after changing realm bootstrap assumptions
- use `STEP2_FORCE=true` after changing realm security/profile/group automation
- use `STEP3_FORCE=true` after changing scopes or mapper automation
- use `STEP8_FORCE=true` after changing auditor/event retention/listener automation
- use `STEP9_FORCE=true` after changing archival setup automation

## Maintenance Runner

Routine operational scripts should use `keycloak-maintenance` and must not trigger unrelated init steps.

Examples:

```bash
make maintenance MAINT_CMD='python3 /workspace/scripts/audit_export_events.py --dry-run'
make audit-export
```

## Stop And Reset

Stop services:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml down
```

Full reset including Postgres and Keycloak data volumes:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml down -v
```

## kcadm Login From Host

Use the local wrapper script when you need a host-side token cache:

```bash
ADMIN_PASSWORD='your-admin-password' ./scripts/keycloak_login_admin.sh
```

Defaults:

- `KEYCLOAK_URL=http://localhost:8080`
- `ADMIN_REALM=master`
- `ADMIN_USER=admin`
- `KCADM_CONFIG=.kcadm.config`

Direct `kcadm` example:

```bash
./kcadm.sh config credentials \
  --server http://localhost:8080 \
  --realm master \
  --user "$KC_BOOTSTRAP_ADMIN_USERNAME" \
  --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" \
  --config .kcadm.config
```

Security:

- `.kcadm.config` contains tokens/secrets and must stay local.
- It is ignored by git via `.gitignore`.

## Live Config Validation

Run the automated live config checks after the stack and init steps complete:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml --profile test up --build --abort-on-container-exit --exit-code-from config-tests config-tests
```

Clean up test containers after the run:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml --profile test down
```
## Issue Tracking

This project uses **bd (beads)** for issue tracking.
Run `bd prime` for workflow context, or install hooks (`bd hooks install`) for auto-injection.

**Quick reference:**
- `bd ready` - Find unblocked work
- `bd create "Title" --type task --priority 2` - Create issue
- `bd close <id>` - Complete work
- `bd sync` - Sync with git (run at session end)

For full workflow details: `bd prime`

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

<!-- BEGIN BEADS INTEGRATION -->
## Issue Tracking with bd (beads)

**IMPORTANT**: This project uses **bd (beads)** for ALL issue tracking. Do NOT use markdown TODOs, task lists, or other tracking methods.

### Why bd?

- Dependency-aware: Track blockers and relationships between issues
- Git-friendly: Dolt-powered version control with native sync
- Agent-optimized: JSON output, ready work detection, discovered-from links
- Prevents duplicate tracking systems and confusion

### Quick Start

**Check for ready work:**

```bash
bd ready --json
```

**Create new issues:**

```bash
bd create "Issue title" --description="Detailed context" -t bug|feature|task -p 0-4 --json
bd create "Issue title" --description="What this issue is about" -p 1 --deps discovered-from:bd-123 --json
```

**Claim and update:**

```bash
bd update <id> --claim --json
bd update bd-42 --priority 1 --json
```

**Complete work:**

```bash
bd close bd-42 --reason "Completed" --json
```

### Issue Types

- `bug` - Something broken
- `feature` - New functionality
- `task` - Work item (tests, docs, refactoring)
- `epic` - Large feature with subtasks
- `chore` - Maintenance (dependencies, tooling)

### Priorities

- `0` - Critical (security, data loss, broken builds)
- `1` - High (major features, important bugs)
- `2` - Medium (default, nice-to-have)
- `3` - Low (polish, optimization)
- `4` - Backlog (future ideas)

### Workflow for AI Agents

1. **Check ready work**: `bd ready` shows unblocked issues
2. **Claim your task atomically**: `bd update <id> --claim`
3. **Work on it**: Implement, test, document
4. **Discover new work?** Create linked issue:
   - `bd create "Found bug" --description="Details about what was found" -p 1 --deps discovered-from:<parent-id>`
5. **Complete**: `bd close <id> --reason "Done"`

### Auto-Sync

bd automatically syncs via Dolt:

- Each write auto-commits to Dolt history
- Use `bd dolt push`/`bd dolt pull` for remote sync
- No manual export/import needed!

### Important Rules

- ✅ Use bd for ALL task tracking
- ✅ Always use `--json` flag for programmatic use
- ✅ Link discovered work with `discovered-from` dependencies
- ✅ Check `bd ready` before asking "what should I work on?"
- ❌ Do NOT create markdown TODO lists
- ❌ Do NOT use external issue trackers
- ❌ Do NOT duplicate tracking systems

For more details, see README.md and docs/QUICKSTART.md.

<!-- END BEADS INTEGRATION -->

# Docker Quick Commands

This file lists the exact command sequence for running this repo with Docker.

## 1) First-time setup

```bash
cp .env.template .env
```

Edit `.env` and set at least:
- `KC_BOOTSTRAP_ADMIN_USERNAME`
- `KC_BOOTSTRAP_ADMIN_PASSWORD`
- `KC_DB_USERNAME`
- `KC_DB_PASSWORD`
- `KC_MASTER_ADMIN_USER`
- `KC_MASTER_ADMIN_PASSWORD`
- `KC_NEW_REALM_NAME`
- `KC_NEW_REALM_ADMIN_USER`
- `KC_NEW_REALM_ADMIN_PASSWORD`
- `KC_NEW_REALM_ADMIN_PHONE`
- `KC_NEW_REALM_ADMIN_PHONE_VERIFIED`
- `KEYCLOAK_ENV` (Requires `development` to disable SSL enforcement `sslRequired=none` on localhost).

## 2) Start stack (dev mode with override)

```bash
docker compose down

docker compose -f docker-compose.yml -f docker-compose.override.yml up --build
docker compose -f docker-compose.yml -f docker-compose.override.yml ps
```

Services:
- Keycloak: `http://localhost:8080`
- Management: `http://localhost:9000/management`
- Postgres: `localhost:5432`

## 3) Check init/bootstrap logs

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml logs  --tail=200 step1-init
```

Expected: `step1-init` exits `0` after creating/checking master admin, realm, and realm admin.

## 4) Use kcadm from host

```bash
./kcadm.sh config credentials \
  --server http://localhost:8080 \
  --realm master \
  --user "$KC_BOOTSTRAP_ADMIN_USERNAME" \
  --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" \
  --config .kcadm.config

./kcadm.sh get realms --config .kcadm.config
```

## 5) Stop stack

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml down
```

## 6) Full reset (delete DB + Keycloak data)

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml down -v
```

## 7) Re-run one-time Step1 init explicitly

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml up -d --build step1-init
docker logs vg-step1-init --tail 300
```

Force Step1 script even if marker exists:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml run --rm -e STEP1_FORCE=true step1-init
```

## 8) Rebuild only Keycloak image/service

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml up -d --build keycloak
```

## 9) Run live config validation after Step 1/2/3

This uses the running Keycloak realm created by `step1-init`, `step2-init`, and `step3-init` as the system under test.

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml --profile test up --build --abort-on-container-exit --exit-code-from config-tests config-tests
```

This test profile also starts the internal Nginx reverse proxy used for proxy hardening checks.

Clean up test containers after the run:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml --profile test down
```

## Troubleshooting SSL Requirements (`sslRequired`)

If Keycloak forces an "HTTPS required" error on localhost:
1. Ensure `KEYCLOAK_ENV=development` is properly set in your `.env.dev` (or exported locally). 
2. Ensure you have allowed the step containers (`step1` to `step6`) to fully finish running. SSL enforcement is applied during initialization, and until the scripts finish configuring the realm, it defaults to Keycloak's restrictive `external` requirement.
3. Validate current behavior:
```bash
./kcadm.sh get realms/org-new-delhi --fields sslRequired --config .kcadm.config
```

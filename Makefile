SHELL := /bin/bash

COMPOSE := docker compose -f docker-compose.yml -f docker-compose.override.yml
COMPOSE_PROD := docker compose -f docker-compose.yml
COMPOSE_UPGRADE_TEST := docker compose -p vg_sso_upgrade_test -f docker-compose.upgrade-test.yml
UPGRADE_TEST_VERSION ?= 26.6.3
UPGRADE_TEST_IMAGE ?= vg_sso-keycloak-upgrade-test:$(UPGRADE_TEST_VERSION)
UPGRADE_TEST_KEYCLOAK_IMAGE ?= quay.io/keycloak/keycloak:$(UPGRADE_TEST_VERSION)
SPI_MVN_ARGS ?=

.PHONY: help apply-branding build-spis dev-up dev-reload-spi up down reset ps logs kcadm-login \
	logs-all \
	logs-runtime logs-init \
	force-step1 force-step2 force-step3 force-step4 force-step5 force-step6 force-step7 force-step7-fgap force-step8 force-step9 force-step10 maintenance audit-export backup full-backup \
	test-config test-step6 test-step7 \
	upgrade-test-build upgrade-test-db-copy upgrade-test-up upgrade-test-logs upgrade-test-version upgrade-test-down upgrade-test-reset

help:
	@echo "Targets:"
	@echo "  make dev-up           Hot-reload all SPIs, then start full dev stack"
	@echo "  make build-spis       Build all SPI provider JARs on host"
	@echo "  make apply-branding   Apply local branding assets from .local/brand-assets"
	@echo "  make dev-reload-spi   Build/copy all SPI JARs into running Keycloak and restart"
	@echo "  make up               Start full dev stack (docker compose override)"
	@echo "  make down             Stop dev stack"
	@echo "  make reset            Stop and remove volumes (fresh state)"
	@echo "  make ps               Show service status"
	@echo "  make logs             Tail logs for keycloak + init steps"
	@echo "  make logs-all         Tail last 200 lines for all containers"
	@echo "  make logs-runtime     Tail last 200 lines for keycloak + postgres"
	@echo "  make logs-init        Tail last 200 lines for step init containers"
	@echo "  make kcadm-login      Login kcadm in vg-keycloak using KC_MASTER_ADMIN_USER from .env"
	@echo "  make force-step1      Re-run step1-init"
	@echo "  make force-step2      Re-run step2-init"
	@echo "  make force-step3      Re-run step3-init"
	@echo "  make force-step4      Re-run step4-init"
	@echo "  make force-step5      Re-run step5-init"
	@echo "  make force-step6      Re-run step6-init"
	@echo "  make force-step7      Re-run step7-init"
	@echo "  make force-step7-fgap Re-run step7-fgap-init"
	@echo "  make force-step8      Re-run step8-init"
	@echo "  make force-step9      Re-run step9-init (archive setup)"
	@echo "  make force-step10     Re-run step10-init (user onboarding mail setup)"
	@echo "  make maintenance      Run custom command in keycloak-maintenance (MAINT_CMD='...')"
	@echo "  make audit-export     Run audit export now (updates watermark)"
	@echo "  make backup           Dump DB and copy .env/.local into ~/sso_backups/<timestamp>"
	@echo "  make full-backup      Dump DB and copy .env/.local into ~/sso_backups/<timestamp>"
	@echo "  make test-config      Run live config tests profile"
	@echo "  make test-step6       Run step6 tests profile"
	@echo "  make test-step7       Run step7 tests profile"
	@echo "  make upgrade-test-build   Build 26.6.3 rehearsal image without changing production"
	@echo "  make upgrade-test-db-copy Copy live Postgres into isolated upgrade-test Postgres"
	@echo "  make upgrade-test-up      Start 26.6.3 rehearsal Keycloak on 18080/19000"
	@echo "  make upgrade-test-logs    Tail upgrade-test Keycloak logs"
	@echo "  make upgrade-test-version Print test Keycloak version"
	@echo "  make upgrade-test-down    Stop upgrade-test containers"
	@echo "  make upgrade-test-reset   Stop upgrade-test containers and remove test volumes"

apply-branding:
	./scripts/apply_local_brand_assets.sh

build-spis:
	mvn -q -f custom-group-attr-mapper/pom.xml $(SPI_MVN_ARGS) -DskipTests package
	mvn -q -f custom-phone-otp-authenticator/pom.xml $(SPI_MVN_ARGS) -DskipTests package
	mvn -q -f custom-account-expiry-spi/pom.xml $(SPI_MVN_ARGS) -DskipTests package
	mvn -q -f custom-delegated-admin-guard-spi/pom.xml $(SPI_MVN_ARGS) -DskipTests package
	mvn -q -f custom-password-phrase-policy-spi/pom.xml $(SPI_MVN_ARGS) -DskipTests package
	mvn -q -f custom-failure-logs-event-listener-spi/pom.xml $(SPI_MVN_ARGS) -DskipTests package
	mvn -q -f custom-user-onboarding-email-spi/pom.xml $(SPI_MVN_ARGS) -DskipTests package
	mvn -q -f custom-async-email-spi/pom.xml $(SPI_MVN_ARGS) -DskipTests package

dev-reload-spi:
	./scripts/dev_hot_reload_spi.sh

dev-up:
	./scripts/apply_local_brand_assets.sh
	./scripts/prepare_host_log_dir.sh
	$(MAKE) build-spis
	./scripts/dev_hot_reload_spi.sh
	$(COMPOSE) up -d

up:
	./scripts/apply_local_brand_assets.sh
	./scripts/prepare_host_log_dir.sh
	$(MAKE) build-spis
	$(COMPOSE) up -d --build

prod-up:
	./scripts/apply_local_brand_assets.sh
	./scripts/prepare_host_log_dir.sh
	$(MAKE) build-spis
	$(COMPOSE_PROD) up -d --build

down:
	$(COMPOSE) down

prod-down:
	$(COMPOSE_PROD) down

reset:
	$(COMPOSE) down -v

ps:
	$(COMPOSE) ps

logs:
	$(COMPOSE) logs --tail=200 

logs-all:
	$(COMPOSE) logs --tail=200 -f

logs-runtime:
	$(COMPOSE) logs --timestamps --tail=200 -f keycloak postgres

logs-init:
	$(COMPOSE) logs --timestamps --tail=200 -f step1-init step2-init step2-fgap-init step3-init step4-init step5-init step6-init step6-fgap-init step7-init step7-fgap-init step8-init step9-init step10-init

kcadm-login:
	@bash -lc 'set -euo pipefail; get_env() { grep -m1 "^$$1=" .env | cut -d= -f2-; }; server="$${KEYCLOAK_URL:-http://localhost:8080}"; realm="$${ADMIN_REALM:-master}"; user="$${ADMIN_USER:-$$(get_env KC_MASTER_ADMIN_USER)}"; password="$${ADMIN_PASSWORD:-$$(get_env KC_MASTER_ADMIN_PASSWORD)}"; config="$${KCADM_CONFIG:-/tmp/kcadm-master-admin.config}"; container="$${CONTAINER_NAME:-vg-keycloak}"; if [[ -z "$$user" || -z "$$password" ]]; then echo "ERROR: KC_MASTER_ADMIN_USER/KC_MASTER_ADMIN_PASSWORD missing in .env or ADMIN_USER/ADMIN_PASSWORD env" >&2; exit 1; fi; docker exec "$$container" /opt/keycloak/bin/kcadm.sh config credentials --server "$$server" --realm "$$realm" --user "$$user" --password "$$password" --config "$$config"; echo "kcadm config: $$config"'

force-step1:
	$(COMPOSE) run --rm -e STEP1_FORCE=true step1-init

force-step2:
	$(COMPOSE) run --rm -e STEP2_FORCE=true step2-init

force-step3:
	$(COMPOSE) run --rm -e STEP3_FORCE=true step3-init

force-step4:
	$(COMPOSE) run --rm -e STEP4_FORCE=true step4-init

force-step5:
	$(COMPOSE) run --rm -e STEP5_FORCE=true step5-init

force-step6:
	$(COMPOSE) run --rm -e STEP6_FORCE=true step6-init

force-step7:
	$(COMPOSE) run --rm -e STEP7_FORCE=true step7-init

force-step7-fgap:
	$(COMPOSE) run --rm -e STEP7_FGAP_FORCE=true step7-fgap-init

force-step8:
	$(COMPOSE) run --rm -e STEP8_FORCE=true step8-init

force-step9:
	$(COMPOSE) run --rm -e STEP9_FORCE=true step9-init

force-step10:
	$(COMPOSE) run --rm -e STEP10_FORCE=true step10-init

maintenance:
	$(COMPOSE) run --rm --no-build keycloak-maintenance /bin/bash -lc "$${MAINT_CMD:?Set MAINT_CMD='...'}"

audit-export:
	$(COMPOSE) run --rm --no-build keycloak-maintenance python3 /workspace/scripts/audit_export_events.py

backup:
	./scripts/full_backup.sh

full-backup:
	./scripts/full_backup.sh

test-config:
	$(COMPOSE) --profile test up --build --abort-on-container-exit --exit-code-from config-tests config-tests

test-step6:
	$(COMPOSE) --profile test run --rm step6-test

test-step7:
	$(COMPOSE) --profile test run --rm step7-test


upgrade-test-build:
	./scripts/apply_local_brand_assets.sh
	./scripts/prepare_host_log_dir.sh
	mkdir -p logs/keycloak-upgrade-test
	$(MAKE) build-spis SPI_MVN_ARGS="-Dkeycloak.version=$(UPGRADE_TEST_VERSION)"
	docker build --build-arg KEYCLOAK_IMAGE=$(UPGRADE_TEST_KEYCLOAK_IMAGE) -t $(UPGRADE_TEST_IMAGE) .

upgrade-test-db-copy:
	$(COMPOSE_UPGRADE_TEST) up -d upgrade-postgres
	@bash -lc 'set -euo pipefail; db="$$(docker exec vg-postgres printenv POSTGRES_DB 2>/dev/null || true)"; user="$$(docker exec vg-postgres printenv POSTGRES_USER 2>/dev/null || true)"; db="$${db:-keycloak}"; user="$${user:-keycloak}"; mkdir -p backups/upgrade-test; dump="backups/upgrade-test/keycloak-$$(date +%Y%m%d_%H%M%S).dump"; echo "Waiting for vg-postgres-upgrade-test"; for _ in {1..60}; do docker exec vg-postgres-upgrade-test pg_isready -U "$$user" -d "$$db" >/dev/null 2>&1 && break; sleep 2; done; docker exec vg-postgres-upgrade-test pg_isready -U "$$user" -d "$$db" >/dev/null; echo "Dumping live vg-postgres to $$dump"; docker exec vg-postgres pg_dump -U "$$user" -d "$$db" -Fc -f /tmp/upgrade-test.dump; docker cp vg-postgres:/tmp/upgrade-test.dump "$$dump"; docker cp "$$dump" vg-postgres-upgrade-test:/tmp/upgrade-test.dump; echo "Restoring dump into vg-postgres-upgrade-test"; docker exec vg-postgres-upgrade-test psql -U "$$user" -d "$$db" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"; docker exec vg-postgres-upgrade-test pg_restore -U "$$user" -d "$$db" --no-owner --no-privileges /tmp/upgrade-test.dump; echo "Upgrade-test DB restored from $$dump"'

upgrade-test-up:
	mkdir -p logs/keycloak-upgrade-test
	UPGRADE_TEST_IMAGE=$(UPGRADE_TEST_IMAGE) $(COMPOSE_UPGRADE_TEST) up -d upgrade-keycloak

upgrade-test-logs:
	$(COMPOSE_UPGRADE_TEST) logs --timestamps --tail=200 -f upgrade-keycloak

upgrade-test-version:
	docker exec vg-keycloak-upgrade-test /opt/keycloak/bin/kc.sh --version

upgrade-test-down:
	$(COMPOSE_UPGRADE_TEST) down

upgrade-test-reset:
	$(COMPOSE_UPGRADE_TEST) down -v

SHELL := /bin/bash

COMPOSE := docker compose -f docker-compose.yml -f docker-compose.override.yml

.PHONY: help apply-branding build-spis dev-up dev-reload-spi up down reset ps logs \
	logs-all \
	logs-runtime logs-init \
	force-step1 force-step2 force-step3 force-step4 force-step5 force-step6 force-step7 force-step7-fgap force-step8 force-step9 maintenance audit-export \
	test-config test-step6 test-step7

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
	@echo "  make maintenance      Run custom command in keycloak-maintenance (MAINT_CMD='...')"
	@echo "  make audit-export     Run audit export now (updates watermark)"
	@echo "  make test-config      Run live config tests profile"
	@echo "  make test-step6       Run step6 tests profile"
	@echo "  make test-step7       Run step7 tests profile"

apply-branding:
	./scripts/apply_local_brand_assets.sh

build-spis:
	mvn -q -f custom-group-attr-mapper/pom.xml -DskipTests package
	mvn -q -f custom-phone-otp-authenticator/pom.xml -DskipTests package
	mvn -q -f custom-account-expiry-spi/pom.xml -DskipTests package
	mvn -q -f custom-delegated-admin-guard-spi/pom.xml -DskipTests package
	mvn -q -f custom-password-phrase-policy-spi/pom.xml -DskipTests package
	mvn -q -f custom-failure-logs-event-listener-spi/pom.xml -DskipTests package

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

down:
	$(COMPOSE) down

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
	$(COMPOSE) logs --timestamps --tail=200 -f step1-init step2-init step2-fgap-init step3-init step4-init step5-init step6-init step6-fgap-init step7-init step7-fgap-init step8-init step9-init

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

maintenance:
	$(COMPOSE) run --rm --no-build keycloak-maintenance /bin/bash -lc "$${MAINT_CMD:?Set MAINT_CMD='...'}"

audit-export:
	$(COMPOSE) run --rm --no-build keycloak-maintenance python3 /workspace/scripts/audit_export_events.py

test-config:
	$(COMPOSE) --profile test up --build --abort-on-container-exit --exit-code-from config-tests config-tests

test-step6:
	$(COMPOSE) --profile test run --rm step6-test

test-step7:
	$(COMPOSE) --profile test run --rm step7-test

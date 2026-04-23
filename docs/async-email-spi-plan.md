# Async Email SPI Plan

This document is the implementation handoff for a single custom Keycloak SPI module that captures standard outbound email, queues it asynchronously in the database, exposes an admin dashboard, supports export, retries transient failures, scrubs sensitive payload after send, and hard-deletes rows older than the configured retention window.

## Objective

Implement one deployable module:

- `custom-async-email-spi`

Constraints:

- no Keycloak source changes
- DB-backed queue table name must be `kc_vg_async_mail_queue`
- recipient is stored/exported masked
- subject is stored/exported in plain text
- hard-delete all rows older than `KC_ASYNC_EMAIL_RETENTION_DAYS`
- default retention is `180` days
- no separate payload-retention env var
- dashboard should follow the existing Phone OTP admin-extension pattern

## Functional Scope

The module should:

- catch standard Keycloak outbound emails through provider overrides
- queue email delivery asynchronously
- expose dashboard UI and JSON endpoints
- support CSV and TXT export of email logs
- retry transient failures with bounded backoff
- mark non-retryable failures as terminal
- scrub sensitive transient payload after send
- hard-delete old rows after the configured retention period

## Provider Strategy

This remains one custom module/JAR, but it will register multiple provider factories:

- `EmailTemplateProviderFactory`
- `EmailSenderProviderFactory`
- `RealmResourceProviderFactory`

Reason:

- `EmailTemplateProvider` is needed to classify mail into categories before send
- `EmailSenderProvider` is needed to intercept actual outbound email requests globally
- `RealmResourceProvider` is needed for dashboard, retry, and export APIs

## Catch-All Boundary

This SPI is intended to catch standard Keycloak outbound email flows that go through:

- `EmailTemplateProvider`
- `EmailSenderProvider`

That includes normal Keycloak emails such as:

- execute-actions
- verify-email
- password reset
- email update confirmation
- org invite
- SMTP test
- event-listener email notifications

It will not catch arbitrary third-party code that bypasses Keycloak email providers and talks directly to SMTP.

## Queue Table

Primary table:

- `kc_vg_async_mail_queue`

Required columns:

- `id`
- `realm_name`
- `category`
- `status`
- `recipient_masked`
- `recipient_domain`
- `subject`
- `template_name`
- `event_type`
- `user_id`
- `username`
- `created_at`
- `updated_at`
- `queued_at`
- `next_attempt_at`
- `sent_at`
- `failed_at`
- `retry_count`
- `last_error_summary`
- `payload_json`
- `payload_scrubbed`
- `worker_node`

Recommended indexes:

- `(status, next_attempt_at)`
- `(realm_name, created_at)`
- `(category, created_at)`
- `(created_at)`

Notes:

- `payload_json` is temporary and only exists to support pending delivery/retry
- `payload_scrubbed` is a marker to confirm cleanup of transient content
- `recipient_masked` is what dashboard/export uses
- `recipient_domain` is retained for operational grouping

## Status Model

Use the following statuses:

- `queued`
- `sending`
- `sent`
- `failed_retryable`
- `dead_letter`

Definitions:

- `queued`: accepted into the outbox and waiting for worker pickup
- `sending`: claimed by a worker and currently being processed
- `sent`: SMTP delivery completed successfully
- `failed_retryable`: failed transiently and scheduled for another attempt
- `dead_letter`: failed terminally or exhausted retry attempts

## Category Model

Use these categories:

- `execute-actions`
- `verify-email`
- `password-reset`
- `email-update-confirmation`
- `org-invite`
- `smtp-test`
- `event-notification`
- `generic-template`
- `unknown`

Category assignment should happen in the template wrapper, not in the low-level sender.

## Secret and Payload Handling

Never store:

- SMTP passwords
- SMTP bearer tokens
- SMTP auth headers
- raw request credentials
- full stack traces in DB

Store temporarily only while needed for pending delivery:

- recipient full email
- rendered text body
- rendered html body
- template/category metadata

After successful send:

- scrub `payload_json`
- retain only operational metadata

After terminal dead-letter:

- scrub payload if it is no longer needed
- retain only masked recipient, subject, timestamps, category, retry count, and failure summary

## Recipient Masking

Recipient must be stored and exported masked.

Example policy:

- `alice@example.org` -> `a***e@example.org`
- short local parts should still be obscured
- domain remains visible

Masking must be centralized in one utility so storage, dashboard, and export remain consistent.

## Retry Policy

Retry only transient failures:

- connection timeout
- socket timeout
- SMTP temporary 4xx
- transient DNS/connectivity errors

Do not retry:

- invalid recipient address
- malformed message
- template/rendering failure
- SMTP auth/configuration failure
- missing required data

Suggested retry schedule:

1. initial attempt immediately after queue pickup
2. retry after 30 seconds
3. retry after 2 minutes
4. retry after 10 minutes
5. retry after 30 minutes
6. then mark `dead_letter`

Use jitter to avoid synchronized retries.

Config:

- `KC_ASYNC_EMAIL_RETRY_MAX_ATTEMPTS`

## Retention Policy

Compliance requirement:

- hard-delete all rows older than `KC_ASYNC_EMAIL_RETENTION_DAYS`
- default value `180`

This applies to all statuses:

- `queued`
- `sending`
- `sent`
- `failed_retryable`
- `dead_letter`

There is no separate payload-retention env var.

## Worker Behavior

The worker should:

- run from SPI `postInit`
- poll due rows from the queue table
- atomically claim rows for sending
- mark rows `sending`
- attempt SMTP delivery
- update state to `sent`, `failed_retryable`, or `dead_letter`
- scrub transient payload after terminal handling
- periodically delete rows older than retention

The worker must not re-queue the same message through the same high-level sender path. It needs an internal direct SMTP delivery path to avoid recursion.

## Provider Override Rules

The module must override the defaults without changing Keycloak source:

- custom sender provider should win over the default sender
- custom template provider should win over the default Freemarker email provider
- provider precedence should be controlled through factory `order()`

The worker path must use an internal SMTP sender implementation path and must not loop back into queue insertion.

## Dashboard

Follow the same overall pattern as the Phone OTP dashboard:

- backend HTML from `RealmResourceProvider`
- admin theme JS inserts a menu entry that opens a provider URL

Required endpoints:

- `/realms/{realm}/async-email-admin/ui`
- `/realms/{realm}/async-email-admin/stats`
- `/realms/{realm}/async-email-admin/messages`
- `/realms/{realm}/async-email-admin/failures`
- `/realms/{realm}/async-email-admin/retry`
- `/realms/{realm}/async-email-admin/export.csv`
- `/realms/{realm}/async-email-admin/export.txt`

Dashboard should show:

- queued count
- sending count
- sent count
- retrying count
- dead-letter count
- counts by category
- recent failures
- recent sends
- oldest queued age

Filters:

- by status
- by category
- by date range if feasible
- by free-text subject / username / masked recipient

## Export

Export formats:

- CSV
- TXT

Exported fields:

- `id`
- `realm_name`
- `category`
- `status`
- `recipient_masked`
- `subject`
- `template_name`
- `created_at`
- `sent_at`
- `failed_at`
- `retry_count`
- `last_error_summary`

Never export:

- action links/tokens
- full rendered email body
- full recipient
- SMTP/auth secrets

Config:

- `KC_ASYNC_EMAIL_EXPORT_MAX_ROWS`

## Environment Variables

Required:

- `KC_ASYNC_EMAIL_RETENTION_DAYS=180`
- `KC_ASYNC_EMAIL_RETRY_MAX_ATTEMPTS=5`
- `KC_ASYNC_EMAIL_WORKER_ENABLED=true`
- `KC_ASYNC_EMAIL_EXPORT_MAX_ROWS=10000`

Optional:

- `KC_ASYNC_EMAIL_WORKER_POLL_SECONDS`
- `KC_ASYNC_EMAIL_WORKER_BATCH_SIZE`
- `KC_ASYNC_EMAIL_STALE_SENDING_MINUTES`

## Module Layout

Recommended package:

- `tech.epidemiology.keycloak.asyncmail`

Recommended classes:

- `AsyncEmailTemplateProviderFactory`
- `AsyncEmailTemplateProvider`
- `AsyncEmailSenderProviderFactory`
- `AsyncEmailSenderProvider`
- `AsyncEmailAdminResourceProviderFactory`
- `AsyncEmailAdminResourceProvider`
- `AsyncEmailQueueRepository`
- `AsyncEmailQueueRecord`
- `AsyncEmailQueueSchema`
- `AsyncEmailWorker`
- `AsyncEmailRetryPolicy`
- `AsyncEmailRetentionPolicy`
- `AsyncEmailCategoryResolver`
- `AsyncEmailExportService`
- `AsyncEmailMasking`
- `AsyncEmailConfig`
- `AsyncEmailContext`
- `AsyncEmailLifecycleManager`

## TDD Work Plan

Start with tests before implementation.

Unit tests:

- masking behavior
- category resolution
- retry classification transient vs permanent
- backoff calculation
- retention cutoff calculation
- payload scrubbing rules
- CSV export formatting
- TXT export formatting

Repository tests:

- insert queued row
- claim due rows
- mark sent
- mark retryable
- mark dead-letter
- scrub payload
- delete expired rows
- aggregate counts by category and status

Provider tests:

- template wrapper assigns category correctly
- sender wrapper queues instead of sending inline
- worker SMTP path does not re-queue

Resource tests:

- stats endpoint shape
- messages endpoint filtering
- failures endpoint filtering
- retry endpoint behavior
- export endpoint content type and formatting
- authorization checks

## Implementation Phases

### Phase 1: Scaffolding

- create `custom-async-email-spi/`
- add `pom.xml`
- add `META-INF/services` registrations
- add base package layout
- add initial tests

### Phase 2: Core Model and Policies

- implement config parsing
- implement status/category model
- implement recipient masking
- implement retry policy
- implement retention policy
- implement export formatting

### Phase 3: DB Repository

- implement table bootstrap for `kc_vg_async_mail_queue`
- implement insert/update/query/delete methods
- implement row claiming for worker
- implement stale `sending` recovery if needed

### Phase 4: Provider Overrides

- implement template wrapper
- implement sender wrapper
- ensure default provider override via `order()`
- ensure no recursion between queueing and worker send path

### Phase 5: Worker

- start worker in `postInit`
- poll due rows
- claim rows
- send via internal SMTP path
- update state transitions
- scrub payload
- run retention cleanup

### Phase 6: Dashboard and Export

- implement `RealmResourceProvider`
- build HTML UI
- add JSON stats/list/failure/retry endpoints
- add CSV/TXT export endpoints

### Phase 7: Admin Theme Integration

- add new admin menu JS link in `vg` and `vg-master`
- route to `/realms/{realm}/async-email-admin/ui`
- follow the same pattern used by Phone OTP dashboard links

### Phase 8: Repo Wiring

- add module to `Makefile build-spis`
- add module to `Dockerfile` provider JAR copy list
- add module to `scripts/dev_hot_reload_spi.sh`
- add env vars to `.env.template`
- document usage

### Phase 9: Onboarding Migration

- refactor onboarding-specific async logic later to use the shared async email infrastructure
- keep onboarding business trigger logic separate from queue/delivery logic

## File-by-File Checklist

### New module

- `custom-async-email-spi/pom.xml`

### Java sources

- `custom-async-email-spi/src/main/java/tech/epidemiology/keycloak/asyncmail/AsyncEmailConfig.java`
- `custom-async-email-spi/src/main/java/tech/epidemiology/keycloak/asyncmail/AsyncEmailMasking.java`
- `custom-async-email-spi/src/main/java/tech/epidemiology/keycloak/asyncmail/AsyncEmailCategoryResolver.java`
- `custom-async-email-spi/src/main/java/tech/epidemiology/keycloak/asyncmail/AsyncEmailRetryPolicy.java`
- `custom-async-email-spi/src/main/java/tech/epidemiology/keycloak/asyncmail/AsyncEmailRetentionPolicy.java`
- `custom-async-email-spi/src/main/java/tech/epidemiology/keycloak/asyncmail/AsyncEmailQueueRecord.java`
- `custom-async-email-spi/src/main/java/tech/epidemiology/keycloak/asyncmail/AsyncEmailQueueRepository.java`
- `custom-async-email-spi/src/main/java/tech/epidemiology/keycloak/asyncmail/AsyncEmailQueueSchema.java`
- `custom-async-email-spi/src/main/java/tech/epidemiology/keycloak/asyncmail/AsyncEmailExportService.java`
- `custom-async-email-spi/src/main/java/tech/epidemiology/keycloak/asyncmail/AsyncEmailContext.java`
- `custom-async-email-spi/src/main/java/tech/epidemiology/keycloak/asyncmail/AsyncEmailTemplateProvider.java`
- `custom-async-email-spi/src/main/java/tech/epidemiology/keycloak/asyncmail/AsyncEmailTemplateProviderFactory.java`
- `custom-async-email-spi/src/main/java/tech/epidemiology/keycloak/asyncmail/AsyncEmailSenderProvider.java`
- `custom-async-email-spi/src/main/java/tech/epidemiology/keycloak/asyncmail/AsyncEmailSenderProviderFactory.java`
- `custom-async-email-spi/src/main/java/tech/epidemiology/keycloak/asyncmail/AsyncEmailWorker.java`
- `custom-async-email-spi/src/main/java/tech/epidemiology/keycloak/asyncmail/AsyncEmailLifecycleManager.java`
- `custom-async-email-spi/src/main/java/tech/epidemiology/keycloak/asyncmail/AsyncEmailAdminResourceProvider.java`
- `custom-async-email-spi/src/main/java/tech/epidemiology/keycloak/asyncmail/AsyncEmailAdminResourceProviderFactory.java`

### Service registrations

- `custom-async-email-spi/src/main/resources/META-INF/services/org.keycloak.email.EmailTemplateProviderFactory`
- `custom-async-email-spi/src/main/resources/META-INF/services/org.keycloak.email.EmailSenderProviderFactory`
- `custom-async-email-spi/src/main/resources/META-INF/services/org.keycloak.services.resource.RealmResourceProviderFactory`

### Tests

- `custom-async-email-spi/src/test/java/tech/epidemiology/keycloak/asyncmail/AsyncEmailMaskingTest.java`
- `custom-async-email-spi/src/test/java/tech/epidemiology/keycloak/asyncmail/AsyncEmailCategoryResolverTest.java`
- `custom-async-email-spi/src/test/java/tech/epidemiology/keycloak/asyncmail/AsyncEmailRetryPolicyTest.java`
- `custom-async-email-spi/src/test/java/tech/epidemiology/keycloak/asyncmail/AsyncEmailRetentionPolicyTest.java`
- `custom-async-email-spi/src/test/java/tech/epidemiology/keycloak/asyncmail/AsyncEmailExportServiceTest.java`
- `custom-async-email-spi/src/test/java/tech/epidemiology/keycloak/asyncmail/AsyncEmailQueueRepositoryTest.java`
- `custom-async-email-spi/src/test/java/tech/epidemiology/keycloak/asyncmail/AsyncEmailTemplateProviderTest.java`
- `custom-async-email-spi/src/test/java/tech/epidemiology/keycloak/asyncmail/AsyncEmailSenderProviderTest.java`
- `custom-async-email-spi/src/test/java/tech/epidemiology/keycloak/asyncmail/AsyncEmailAdminResourceProviderTest.java`

### Repo wiring

- update `Makefile`
- update `Dockerfile`
- update `scripts/dev_hot_reload_spi.sh`
- update `.env.template`

### Theme integration

- update `theme/vg/admin/theme.properties` if a new JS file is needed
- update `theme/vg-master/admin/theme.properties` if a new JS file is needed
- add a new admin JS link file if separate from existing menu files

### Documentation

- update `README.md`
- add a dedicated runtime/ops doc if needed

## Subagent Work Split

Recommended parallelization:

Subagent 1:

- core model and policy classes
- masking
- retry policy
- retention policy
- export formatter
- unit tests

Subagent 2:

- DB repository
- schema bootstrap
- repository tests

Subagent 3:

- template provider override
- sender provider override
- provider tests

Subagent 4:

- worker
- lifecycle manager
- stale-send recovery

Subagent 5:

- admin resource provider
- dashboard HTML
- stats/list/failures/retry/export endpoints
- resource tests

Subagent 6:

- theme integration
- repo wiring
- docs updates

## Definition of Done

The work is complete when:

- Keycloak outbound email requests are queued instead of SMTP-inline
- queue rows are created in `kc_vg_async_mail_queue`
- worker delivers queued rows asynchronously
- transient failures retry correctly
- permanent failures become `dead_letter`
- payload is scrubbed after successful send
- rows older than retention are hard-deleted
- dashboard and exports work
- recipient is masked everywhere
- subject is stored and exported in plain text
- module is wired into build and runtime


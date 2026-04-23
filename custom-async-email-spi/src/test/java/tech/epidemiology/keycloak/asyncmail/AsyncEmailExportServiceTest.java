package tech.epidemiology.keycloak.asyncmail;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.junit.jupiter.api.Test;

class AsyncEmailExportServiceTest {

  @Test
  void toCsv_exportsExpectedHeadersAndEscapesSpecialCharacters() {
    AsyncEmailExportService.MailRecord row = new AsyncEmailExportService.MailRecord(
        "id-001",
        "org-test",
        "verify-email",
        AsyncEmailExportService.STATUS_SENT,
        "u***r@example.com",
        "Reset, \"Password\"",
        "verify-email.ftl",
        "user-alpha",
        Instant.parse("2026-01-01T10:00:00Z"),
        Instant.parse("2026-01-01T10:01:00Z"),
        null,
        0,
        "smtp retryable: timeout");

    AsyncEmailExportService service = new AsyncEmailExportService();
    String csv = service.toCsv(List.of(row));

    String[] lines = csv.split("\\r?\\n");
    assertThat(lines).hasSize(2);
    assertThat(lines[0]).isEqualTo(
        "id,realm_name,category,status,recipient_masked,subject,template_name,created_at,sent_at,failed_at,retry_count,last_error_summary");
    assertThat(lines[1]).isEqualTo(
        "id-001,org-test,verify-email,sent,u***r@example.com,\"Reset, \"\"Password\"\"\",verify-email.ftl,2026-01-01T10:00:00Z,2026-01-01T10:01:00Z,,0,\"smtp retryable: timeout\"");
  }

  @Test
  void toTxt_exportsExpectedColumnsAndValues() {
    AsyncEmailExportService.MailRecord row = new AsyncEmailExportService.MailRecord(
        "id-009",
        "org-test",
        AsyncEmailExportService.CATEGORY_ORG_INVITE,
        AsyncEmailExportService.STATUS_QUEUED,
        "a***e@example.org",
        "Welcome Org user",
        "invite.ftl",
        "admin",
        Instant.parse("2026-02-03T01:00:00Z"),
        null,
        null,
        1,
        "");

    AsyncEmailExportService service = new AsyncEmailExportService();
    String txt = service.toTxt(List.of(row));

    String[] lines = txt.split("\\r?\\n");
    assertThat(lines).hasSize(2);
    assertThat(lines[0]).isEqualTo(
        "id|realm_name|category|status|recipient_masked|subject|template_name|created_at|sent_at|failed_at|retry_count|last_error_summary");
    assertThat(lines[1]).contains("id-009", "org-test", "org-invite", "queued", "a***e@example.org", "Welcome Org user", "invite.ftl");
  }

  @Test
  void queryMessages_filtersByStatusCategoryTextAndDateRange() {
    AsyncEmailExportService service = new AsyncEmailExportService();
    service.save(new AsyncEmailExportService.MailRecord(
        "id-1", "org", AsyncEmailExportService.CATEGORY_PASSWORD_RESET, AsyncEmailExportService.STATUS_SENT,
        "a***e@example.org", "Reset password requested", "reset.ftl", "alice",
        Instant.parse("2026-02-01T00:00:00Z"), Instant.parse("2026-02-01T00:01:00Z"), null, 0, ""));
    service.save(new AsyncEmailExportService.MailRecord(
        "id-2", "org", AsyncEmailExportService.CATEGORY_PASSWORD_RESET, AsyncEmailExportService.STATUS_FAILED_RETRYABLE,
        "b***e@example.org", "Verify email", "verify.ftl", "bob",
        Instant.parse("2026-02-02T00:00:00Z"), null, Instant.parse("2026-02-02T01:00:00Z"), 1, "smtp timeout"));
    service.save(new AsyncEmailExportService.MailRecord(
        "id-3", "org", AsyncEmailExportService.CATEGORY_SMTP_TEST, AsyncEmailExportService.STATUS_DEAD_LETTER,
        "c***e@example.org", "SMTP test", "smtp-test.ftl", "charlie",
        Instant.parse("2026-02-03T00:00:00Z"), null, Instant.parse("2026-02-03T01:00:00Z"), 3, "permanent"));

    List<AsyncEmailExportService.MailRecord> failedResets = service.queryMessages(
        "org",
        AsyncEmailExportService.STATUS_FAILED_RETRYABLE,
        null,
        null,
        Instant.parse("2026-02-01T00:00:00Z"),
        Instant.parse("2026-02-04T00:00:00Z"),
        0,
        100);
    assertThat(failedResets).extracting(AsyncEmailExportService.MailRecord::id).containsExactly("id-2");

    List<AsyncEmailExportService.MailRecord> textMatches = service.queryMessages(
        "org",
        null,
        null,
        "alice",
        null,
        null,
        0,
        100);
    assertThat(textMatches).extracting(AsyncEmailExportService.MailRecord::id).containsExactly("id-1");
  }

  @Test
  void normalizePagination_clampsOutOfRangeValues() {
    AsyncEmailExportService service = new AsyncEmailExportService();
    assertThat(service.normalizeFirst(null)).isEqualTo(0);
    assertThat(service.normalizeFirst(-10)).isEqualTo(0);
    assertThat(service.normalizeMax(0)).isEqualTo(1);
    assertThat(service.normalizeMax(-20)).isEqualTo(1);
    assertThat(service.normalizeMax(9999)).isEqualTo(500);
    assertThat(service.normalizeMax(25)).isEqualTo(25);
    assertThat(service.normalizeMax(null)).isEqualTo(100);
  }

  @Test
  void markRetry_requeuesSupportedFailuresOnly() {
    AsyncEmailExportService service = new AsyncEmailExportService();
    service.save(new AsyncEmailExportService.MailRecord(
        "retry-id", "org", AsyncEmailExportService.CATEGORY_PASSWORD_RESET, AsyncEmailExportService.STATUS_FAILED_RETRYABLE,
        "r***y@example.com", "Subject", "tpl.ftl", "retry-user",
        Instant.now().truncatedTo(ChronoUnit.SECONDS), null, Instant.now().truncatedTo(ChronoUnit.SECONDS), 2, "temporary"));
    service.save(new AsyncEmailExportService.MailRecord(
        "sent-id", "org", AsyncEmailExportService.CATEGORY_PASSWORD_RESET, AsyncEmailExportService.STATUS_SENT,
        "s***t@example.com", "Subject", "tpl.ftl", "sent-user",
        Instant.now().truncatedTo(ChronoUnit.SECONDS), Instant.now().truncatedTo(ChronoUnit.SECONDS), null, 0, ""));

    assertThat(service.markRetry("org", "retry-id")).isTrue();
    assertThat(service.markRetry("org", "sent-id")).isFalse();
    assertThat(service.markRetry("org", "missing")).isFalse();

    AsyncEmailExportService.MailRecord retried = service.findById("retry-id");
    assertThat(retried.status()).isEqualTo(AsyncEmailExportService.STATUS_QUEUED);
  }

  @Test
  void countFailures_reportsAcrossAllPages() {
    AsyncEmailExportService service = new AsyncEmailExportService();
    service.save(new AsyncEmailExportService.MailRecord(
        "failure-a", "org", AsyncEmailExportService.CATEGORY_UNKNOWN, AsyncEmailExportService.STATUS_FAILED_RETRYABLE,
        "a***e@example.com", "A", "tpl", "u1", Instant.parse("2026-03-01T00:00:00Z"), null, null, 0, ""));
    service.save(new AsyncEmailExportService.MailRecord(
        "failure-b", "org", AsyncEmailExportService.CATEGORY_UNKNOWN, AsyncEmailExportService.STATUS_DEAD_LETTER,
        "b***e@example.com", "B", "tpl", "u2", Instant.parse("2026-03-01T00:00:01Z"), null, null, 1, ""));
    service.save(new AsyncEmailExportService.MailRecord(
        "good", "org", AsyncEmailExportService.CATEGORY_UNKNOWN, AsyncEmailExportService.STATUS_SENT,
        "c***e@example.com", "C", "tpl", "u3", Instant.parse("2026-03-01T00:00:02Z"), null, null, 0, ""));

    assertThat(service.countFailures("org", null, null, null)).isEqualTo(2L);
    assertThat(service.queryFailures("org", null, null, null, 0, 1)).hasSize(1);
  }
}

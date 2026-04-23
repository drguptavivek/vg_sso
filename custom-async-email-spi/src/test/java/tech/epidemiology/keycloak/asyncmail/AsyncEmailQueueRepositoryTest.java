package tech.epidemiology.keycloak.asyncmail;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

class AsyncEmailQueueRepositoryTest {

  @Test
  void enqueuesAndClaimsRows() {
    AsyncEmailQueueRepository repo = new AsyncEmailQueueRepository();

    AsyncEmailContext context = context("realm-a", "alice@example.org", AsyncEmailQueueRecord.Category.VERIFY_EMAIL);
    Instant now = Instant.parse("2026-04-23T00:00:00Z");
    AsyncEmailQueueRecord queued = repo.enqueue(context, "{\"subject\":\"hi\"}", now);

    List<AsyncEmailQueueRecord> claimed = repo.claimDueRows(10, "worker-a", now);
    assertThat(claimed).hasSize(1);
    assertThat(claimed.get(0).id()).isEqualTo(queued.id());
    assertThat(claimed.get(0).status()).isEqualTo(AsyncEmailQueueRecord.Status.SENDING);
    assertThat(repo.findById(queued.id()).status()).isEqualTo(AsyncEmailQueueRecord.Status.SENDING);
    assertThat(claimed.get(0).workerNode()).isEqualTo("worker-a");
  }

  @Test
  void updatesRowsToSentRetryableOrDeadLetter() {
    AsyncEmailQueueRepository repo = new AsyncEmailQueueRepository();
    Instant now = Instant.parse("2026-04-23T00:00:00Z");

    AsyncEmailQueueRecord queued = repo.enqueue(context("realm-a", "alice@example.org", AsyncEmailQueueRecord.Category.PASSWORD_RESET), "payload", now);
    String id = queued.id();

    repo.markRetryable(id, "temporary SMTP timeout", 1, now.plus(30, ChronoUnit.SECONDS), "worker-a", now);
    assertThat(repo.findById(id).status()).isEqualTo(AsyncEmailQueueRecord.Status.FAILED_RETRYABLE);
    assertThat(repo.findById(id).retryCount()).isEqualTo(1);

    repo.markDeadLetter(id, "invalid recipient", 2, "worker-a", now.plus(1, ChronoUnit.MINUTES));
    assertThat(repo.findById(id).status()).isEqualTo(AsyncEmailQueueRecord.Status.DEAD_LETTER);

    repo.markSent(id, "worker-a", now);
    assertThat(repo.findById(id).status()).isEqualTo(AsyncEmailQueueRecord.Status.DEAD_LETTER);
  }

  @Test
  void scrubsPayloadAndDeletesExpiredRows() {
    AsyncEmailQueueRepository repo = new AsyncEmailQueueRepository();
    Instant old = Instant.parse("2026-01-01T00:00:00Z");
    Instant now = Instant.parse("2026-04-23T00:00:00Z");
    Instant recent = Instant.parse("2026-04-22T00:00:00Z");

    AsyncEmailQueueRecord oldRow = repo.enqueue(context("realm-a", "a@example.org", AsyncEmailQueueRecord.Category.EVENT_NOTIFICATION), "sensitive", old);
    AsyncEmailQueueRecord freshRow = repo.enqueue(context("realm-a", "b@example.org", AsyncEmailQueueRecord.Category.EVENT_NOTIFICATION), "sensitive", recent);

    repo.scrubPayload(oldRow.id(), now);
    assertThat(repo.findById(oldRow.id()).payloadScrubbed()).isTrue();
    assertThat(repo.findById(oldRow.id()).payloadJson()).isNull();

    assertThat(repo.findById(freshRow.id())).isNotNull();
    int deleted = repo.deleteExpiredRows(now.minus(60, ChronoUnit.DAYS));
    assertThat(deleted).isEqualTo(1);
    assertThat(repo.findById(oldRow.id())).isNull();
    assertThat(repo.findById(freshRow.id())).isNotNull();
  }

  @Test
  void aggregatesCountsByCategoryAndStatus() {
    AsyncEmailQueueRepository repo = new AsyncEmailQueueRepository();
    Instant now = Instant.parse("2026-04-23T00:00:00Z");

    repo.enqueue(context("r1", "a@x", AsyncEmailQueueRecord.Category.VERIFY_EMAIL), "payload", now);
    repo.enqueue(context("r1", "b@x", AsyncEmailQueueRecord.Category.VERIFY_EMAIL), "payload", now);
    AsyncEmailQueueRecord c = repo.enqueue(context("r1", "c@x", AsyncEmailQueueRecord.Category.PASSWORD_RESET), "payload", now);
    repo.markSent(c.id(), "worker-a", now);

    Map<AsyncEmailQueueRecord.Category, Long> byCategory = repo.countByCategory("r1");
    Map<AsyncEmailQueueRecord.Status, Long> byStatus = repo.countByStatus("r1");

    assertThat(byCategory.get(AsyncEmailQueueRecord.Category.VERIFY_EMAIL)).isEqualTo(2L);
    assertThat(byCategory.get(AsyncEmailQueueRecord.Category.PASSWORD_RESET)).isEqualTo(1L);
    assertThat(byStatus.get(AsyncEmailQueueRecord.Status.QUEUED)).isEqualTo(2L);
    assertThat(byStatus.get(AsyncEmailQueueRecord.Status.SENT)).isEqualTo(1L);
  }

  @Test
  void filtersBySearchText() {
    AsyncEmailQueueRepository repo = new AsyncEmailQueueRepository();
    Instant now = Instant.parse("2026-04-23T00:00:00Z");

    repo.enqueue(context("realm-x", "alice@example.org", AsyncEmailQueueRecord.Category.VERIFY_EMAIL, "verify", "alice"), "payload", now);
    repo.enqueue(context("realm-x", "bob@example.org", AsyncEmailQueueRecord.Category.VERIFY_EMAIL, "verify", "bob"), "payload", now);

    List<AsyncEmailQueueRecord> matching = repo.listMessages("realm-x", 10, null, null, "alice");
    assertThat(matching).hasSize(1);
    assertThat(matching.get(0).username()).isEqualTo("alice");

    List<AsyncEmailQueueRecord> all = repo.listMessages("realm-x", 10, AsyncEmailQueueRecord.Status.QUEUED, null, null);
    assertThat(all).hasSize(2);
  }

  @Test
  void listsFailuresInRecencyOrder() {
    AsyncEmailQueueRepository repo = new AsyncEmailQueueRepository();
    Instant now = Instant.parse("2026-04-23T00:00:00Z");

    AsyncEmailQueueRecord first = repo.enqueue(context("realm-fail", "a@x", AsyncEmailQueueRecord.Category.VERIFY_EMAIL), "payload", now.minus(10, ChronoUnit.MINUTES));
    AsyncEmailQueueRecord second = repo.enqueue(context("realm-fail", "b@x", AsyncEmailQueueRecord.Category.PASSWORD_RESET), "payload", now.minus(1, ChronoUnit.MINUTES));
    repo.markRetryable(first.id(), "temporary issue", 1, now, "w", now);
    repo.markDeadLetter(second.id(), "bad recipient", 1, "w", now);

    List<AsyncEmailQueueRecord> failures = repo.listFailures("realm-fail", 10);
    assertThat(failures).extracting(AsyncEmailQueueRecord::id).containsExactly(second.id(), first.id());
  }

  private AsyncEmailContext context(String realm, String recipient, AsyncEmailQueueRecord.Category category) {
    return context(realm, recipient, category, "template", "user");
  }

  private AsyncEmailContext context(String realm, String recipient, AsyncEmailQueueRecord.Category category, String templateName, String username) {
    return new AsyncEmailContext(
        realm,
        recipient,
        category,
        templateName,
        "event",
        "user-id-" + username,
        username,
        recipient + "-subject",
        null,
        null
    );
  }
}

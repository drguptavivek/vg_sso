package tech.epidemiology.keycloak.asyncmail;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class AsyncEmailWorkerTest {

    @Test
    void sendsQueuedMessageAndMarksDone() throws Exception {
        AsyncEmailQueueRepository repository = new AsyncEmailQueueRepository();
        AtomicReference<AsyncEmailQueueRecord> sent = new AtomicReference<>();
        AsyncEmailWorker worker = new AsyncEmailWorker(
            repository,
            new AsyncEmailRetryPolicy(5, 42),
            new AsyncEmailRetentionPolicy(365),
            sent::set,
            java.time.Clock.systemUTC(),
            10,
            "worker-a",
            42L
        );

        Instant now = Instant.parse("2026-04-23T10:00:00Z");
        AsyncEmailQueueRecord queued = repository.enqueue(context("realm-a", "alice@example.org"), "{\"payload\":\"ok\"}", now);
        int processed = worker.runOnce(now);

        assertThat(processed).isEqualTo(1);
        assertThat(sent.get().id()).isEqualTo(queued.id());
        AsyncEmailQueueRecord result = repository.findById(queued.id());
        assertThat(result.status()).isEqualTo(AsyncEmailQueueRecord.Status.SENT);
        assertThat(result.payloadJson()).isNull();
        assertThat(result.payloadScrubbed()).isTrue();
        assertThat(result.workerNode()).isEqualTo("worker-a");
    }

    @Test
    void retriesTransientFailuresWithBackoff() throws Exception {
        AsyncEmailQueueRepository repository = new AsyncEmailQueueRepository();
        AsyncEmailWorker worker = new AsyncEmailWorker(
            repository,
            new AsyncEmailRetryPolicy(3, 7),
            new AsyncEmailRetentionPolicy(365),
            message -> {
                throw new RuntimeException("connection timed out");
            },
            java.time.Clock.systemUTC(),
            10,
            "worker-a",
            7L
        );

        Instant now = Instant.parse("2026-04-23T10:00:00Z");
        AsyncEmailQueueRecord queued = repository.enqueue(context("realm-a", "alice@example.org"), "{\"payload\":\"ok\"}", now);
        int processed = worker.runOnce(now);

        assertThat(processed).isEqualTo(1);
        AsyncEmailQueueRecord result = repository.findById(queued.id());
        assertThat(result.status()).isEqualTo(AsyncEmailQueueRecord.Status.FAILED_RETRYABLE);
        assertThat(result.retryCount()).isEqualTo(1);
        assertThat(result.nextAttemptAt()).isAfter(now);
        assertThat(result.payloadJson()).isEqualTo("{\"payload\":\"ok\"}");
        assertThat(result.payloadScrubbed()).isFalse();
    }

    @Test
    void deadLettersNonRetryableFailures() throws Exception {
        AsyncEmailQueueRepository repository = new AsyncEmailQueueRepository();
        AsyncEmailWorker worker = new AsyncEmailWorker(
            repository,
            new AsyncEmailRetryPolicy(3, 7),
            new AsyncEmailRetentionPolicy(365),
            message -> {
                throw new RuntimeException("550 invalid recipient");
            },
            java.time.Clock.systemUTC(),
            10,
            "worker-a",
            7L
        );

        Instant now = Instant.parse("2026-04-23T10:00:00Z");
        AsyncEmailQueueRecord queued = repository.enqueue(context("realm-a", "alice@example.org"), "{\"payload\":\"ok\"}", now);
        int processed = worker.runOnce(now);

        assertThat(processed).isEqualTo(1);
        AsyncEmailQueueRecord result = repository.findById(queued.id());
        assertThat(result.status()).isEqualTo(AsyncEmailQueueRecord.Status.DEAD_LETTER);
        assertThat(result.retryCount()).isEqualTo(1);
        assertThat(result.payloadJson()).isNull();
        assertThat(result.payloadScrubbed()).isTrue();
        assertThat(result.lastErrorSummary()).contains("invalid recipient");
    }

    @Test
    void deletesExpiredRowsDuringRun() throws Exception {
        AsyncEmailQueueRepository repository = new AsyncEmailQueueRepository();
        AsyncEmailWorker worker = new AsyncEmailWorker(
            repository,
            new AsyncEmailRetryPolicy(3, 7),
            new AsyncEmailRetentionPolicy(1),
            message -> {
            },
            java.time.Clock.systemUTC(),
            10,
            "worker-a",
            7L
        );

        Instant now = Instant.parse("2026-04-23T10:00:00Z");
        AsyncEmailQueueRecord fresh = repository.enqueue(
            context("realm-a", "alice@example.org"),
            "{\"payload\":\"ok\"}",
            now.minus(2, ChronoUnit.DAYS));
        repository.enqueue(context("realm-a", "bob@example.org"), "{\"payload\":\"ok\"}", now.minus(1, ChronoUnit.HOURS));

        int processed = worker.runOnce(now);

        assertThat(processed).isEqualTo(2);
        assertThat(repository.findById(fresh.id())).isNull();
    }

    private AsyncEmailContext context(String realmName, String recipient) {
        return new AsyncEmailContext(
            realmName,
            recipient,
            AsyncEmailQueueRecord.Category.VERIFY_EMAIL,
            "template-name",
            "event-type",
            "user-id",
            "username",
            "subject",
            "{}",
            "{}"
        );
    }
}

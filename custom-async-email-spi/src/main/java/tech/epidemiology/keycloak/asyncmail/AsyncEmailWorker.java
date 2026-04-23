package tech.epidemiology.keycloak.asyncmail;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.List;

public final class AsyncEmailWorker {

    @FunctionalInterface
    public interface DirectEmailSender {
        void send(AsyncEmailQueueRecord message) throws Exception;
    }

    private final AsyncEmailQueueRepository repository;
    private final AsyncEmailRetryPolicy retryPolicy;
    private final AsyncEmailRetentionPolicy retentionPolicy;
    private final DirectEmailSender directEmailSender;
    private final Clock clock;
    private final int batchSize;
    private final String workerNode;
    private final long jitterSeed;

    public AsyncEmailWorker(
        AsyncEmailQueueRepository repository,
        AsyncEmailRetryPolicy retryPolicy,
        AsyncEmailRetentionPolicy retentionPolicy,
        DirectEmailSender directEmailSender,
        Clock clock,
        int batchSize,
        String workerNode,
        long jitterSeed
    ) {
        this.repository = repository;
        this.retryPolicy = retryPolicy == null ? new AsyncEmailRetryPolicy() : retryPolicy;
        this.retentionPolicy = retentionPolicy == null ? new AsyncEmailRetentionPolicy() : retentionPolicy;
        this.directEmailSender = Objects.requireNonNull(directEmailSender, "directEmailSender");
        this.clock = clock == null ? Clock.systemUTC() : clock;
        this.batchSize = Math.max(1, batchSize);
        this.workerNode = workerNode;
        this.jitterSeed = jitterSeed;
    }

    public AsyncEmailWorker(
        AsyncEmailQueueRepository repository,
        AsyncEmailRetryPolicy retryPolicy,
        AsyncEmailRetentionPolicy retentionPolicy,
        DirectEmailSender directEmailSender,
        Clock clock,
        int batchSize,
        String workerNode
    ) {
        this(repository, retryPolicy, retentionPolicy, directEmailSender, clock, batchSize, workerNode, 0L);
    }

    public AsyncEmailWorker(
        AsyncEmailQueueRepository repository,
        AsyncEmailRetryPolicy retryPolicy,
        AsyncEmailRetentionPolicy retentionPolicy,
        DirectEmailSender directEmailSender,
        Clock clock,
        String workerNode
    ) {
        this(repository, retryPolicy, retentionPolicy, directEmailSender, clock, 50, workerNode, 0L);
    }

    public int runOnce() {
        return runOnce(null);
    }

    public int runOnce(Instant now) {
        Instant effectiveNow = now == null ? Instant.now(clock) : now;
        List<AsyncEmailQueueRecord> rows = repository.claimDueRows(batchSize, workerNode, effectiveNow);
        for (AsyncEmailQueueRecord row : rows) {
            if (row == null) {
                continue;
            }
            try {
                directEmailSender.send(row);
                repository.markSent(row.id(), workerNode, effectiveNow);
                repository.scrubPayload(row.id(), effectiveNow);
            } catch (Throwable failure) {
                handleFailure(row, failure, effectiveNow);
            }
        }
        Instant retentionCutoff = retentionPolicy.cutoffAt(effectiveNow);
        repository.deleteExpiredRows(retentionCutoff);
        return rows.size();
    }

    private void handleFailure(AsyncEmailQueueRecord row, Throwable failure, Instant now) {
        String summary = failure == null ? "unknown failure" : failure.getMessage();
        int nextRetry = Math.max(1, row.retryCount() + 1);
        Duration retryDelay = retryPolicy.calculateNextAttemptDelay(nextRetry, jitterSeed);
        if (retryPolicy.shouldRetry(nextRetry, failure) && retryDelay != null) {
            repository.markRetryable(row.id(), summary, nextRetry, now.plus(retryDelay), workerNode, now);
            return;
        }
        repository.markDeadLetter(row.id(), summary, nextRetry, workerNode, now);
        repository.scrubPayload(row.id(), now);
    }
}

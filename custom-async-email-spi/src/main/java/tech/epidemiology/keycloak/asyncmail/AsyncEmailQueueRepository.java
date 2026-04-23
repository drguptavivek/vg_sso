package tech.epidemiology.keycloak.asyncmail;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

public class AsyncEmailQueueRepository {

    private static final int MAX_ERROR_SUMMARY = 512;

    private final ConcurrentMap<String, AsyncEmailQueueRecord> rows = new ConcurrentHashMap<>();
    private final Object lock = new Object();
    private final Clock clock;

    public AsyncEmailQueueRepository() {
        this(Clock.systemUTC());
    }

    public AsyncEmailQueueRepository(Clock clock) {
        this.clock = clock == null ? Clock.systemUTC() : clock;
    }

    public AsyncEmailQueueRecord enqueue(AsyncEmailContext context, String payloadJson, Instant now) {
        Instant effectiveNow = now == null ? Instant.now(clock) : now;
        AsyncEmailContext safeContext = sanitizeContext(context);
        AsyncEmailQueueRecord record = new AsyncEmailQueueRecord(
            UUID.randomUUID().toString(),
            safeContext.realmName(),
            normalizeCategory(safeContext),
            AsyncEmailQueueRecord.Status.QUEUED,
            safeContext.maskedRecipient(),
            safeContext.recipientDomain(),
            safeContext.subject(),
            safeContext.templateName(),
            safeContext.eventType(),
            safeContext.userId(),
            safeContext.username(),
            effectiveNow,
            effectiveNow,
            effectiveNow,
            effectiveNow,
            null,
            null,
            0,
            null,
            payloadJson,
            false,
            null
        );
        rows.put(record.id(), record);
        return record;
    }

    public List<AsyncEmailQueueRecord> claimDueRows(int limit, String workerNode, Instant now) {
        Instant effectiveNow = now == null ? Instant.now(clock) : now;
        if (limit <= 0) {
            return List.of();
        }

        synchronized (lock) {
            List<AsyncEmailQueueRecord> dueRows = rows.values().stream()
                .filter(this::isClaimableStatus)
                .filter(row -> isDue(row, effectiveNow))
                .sorted(Comparator.comparing(AsyncEmailQueueRecord::createdAt, Comparator.nullsLast(Comparator.naturalOrder()))
                    .thenComparing(AsyncEmailQueueRecord::id))
                .limit(limit)
                .toList();

            List<AsyncEmailQueueRecord> claimed = new ArrayList<>(dueRows.size());
            for (AsyncEmailQueueRecord row : dueRows) {
                AsyncEmailQueueRecord current = rows.get(row.id());
                if (current == null || !isClaimableStatus(current) || !isDue(current, effectiveNow)) {
                    continue;
                }
                AsyncEmailQueueRecord updated = new AsyncEmailQueueRecord(
                    current.id(),
                    current.realmName(),
                    current.category(),
                    AsyncEmailQueueRecord.Status.SENDING,
                    current.recipientMasked(),
                    current.recipientDomain(),
                    current.subject(),
                    current.templateName(),
                    current.eventType(),
                    current.userId(),
                    current.username(),
                    current.createdAt(),
                    effectiveNow,
                    current.queuedAt(),
                    current.nextAttemptAt(),
                    current.sentAt(),
                    current.failedAt(),
                    current.retryCount(),
                    current.lastErrorSummary(),
                    current.payloadJson(),
                    current.payloadScrubbed(),
                    workerNode
                );
                rows.put(updated.id(), updated);
                claimed.add(updated);
            }
            return claimed;
        }
    }

    public void markSent(String id, String workerNode, Instant now) {
        Instant effectiveNow = now == null ? Instant.now(clock) : now;
        synchronized (lock) {
            AsyncEmailQueueRecord current = rows.get(id);
            if (current == null || !matchesWorker(current, workerNode)
                || !(current.status() == AsyncEmailQueueRecord.Status.SENDING
                || current.status() == AsyncEmailQueueRecord.Status.QUEUED
                || current.status() == AsyncEmailQueueRecord.Status.FAILED_RETRYABLE)) {
                return;
            }
            rows.put(id, new AsyncEmailQueueRecord(
                current.id(),
                current.realmName(),
                current.category(),
                AsyncEmailQueueRecord.Status.SENT,
                current.recipientMasked(),
                current.recipientDomain(),
                current.subject(),
                current.templateName(),
                current.eventType(),
                current.userId(),
                current.username(),
                current.createdAt(),
                effectiveNow,
                current.queuedAt(),
                null,
                effectiveNow,
                current.failedAt(),
                current.retryCount(),
                current.lastErrorSummary(),
                current.payloadJson(),
                current.payloadScrubbed(),
                current.workerNode()
            ));
        }
    }

    public void markRetryable(
        String id,
        String errorSummary,
        int retryCount,
        Instant nextAttemptAt,
        String workerNode,
        Instant now
    ) {
        Instant effectiveNow = now == null ? Instant.now(clock) : now;
        synchronized (lock) {
            AsyncEmailQueueRecord current = rows.get(id);
            if (current == null || !matchesWorker(current, workerNode) || !isRetryTransitionAllowed(current.status())) {
                return;
            }
            rows.put(id, new AsyncEmailQueueRecord(
                current.id(),
                current.realmName(),
                current.category(),
                AsyncEmailQueueRecord.Status.FAILED_RETRYABLE,
                current.recipientMasked(),
                current.recipientDomain(),
                current.subject(),
                current.templateName(),
                current.eventType(),
                current.userId(),
                current.username(),
                current.createdAt(),
                effectiveNow,
                current.queuedAt(),
                nextAttemptAt == null ? effectiveNow : nextAttemptAt,
                current.sentAt(),
                effectiveNow,
                retryCount,
                trimErrorSummary(errorSummary),
                current.payloadJson(),
                current.payloadScrubbed(),
                current.workerNode()
            ));
        }
    }

    public void markDeadLetter(String id, String errorSummary, int retryCount, String workerNode, Instant now) {
        Instant effectiveNow = now == null ? Instant.now(clock) : now;
        synchronized (lock) {
            AsyncEmailQueueRecord current = rows.get(id);
            if (current == null || !matchesWorker(current, workerNode) || !isDeadLetterTransitionAllowed(current.status())) {
                return;
            }
            rows.put(id, new AsyncEmailQueueRecord(
                current.id(),
                current.realmName(),
                current.category(),
                AsyncEmailQueueRecord.Status.DEAD_LETTER,
                current.recipientMasked(),
                current.recipientDomain(),
                current.subject(),
                current.templateName(),
                current.eventType(),
                current.userId(),
                current.username(),
                current.createdAt(),
                effectiveNow,
                current.queuedAt(),
                null,
                current.sentAt(),
                effectiveNow,
                retryCount,
                trimErrorSummary(errorSummary),
                current.payloadJson(),
                current.payloadScrubbed(),
                current.workerNode()
            ));
        }
    }

    public void scrubPayload(String id, Instant now) {
        Instant effectiveNow = now == null ? Instant.now(clock) : now;
        synchronized (lock) {
            AsyncEmailQueueRecord current = rows.get(id);
            if (current == null) {
                return;
            }
            rows.put(id, new AsyncEmailQueueRecord(
                current.id(),
                current.realmName(),
                current.category(),
                current.status(),
                current.recipientMasked(),
                current.recipientDomain(),
                current.subject(),
                current.templateName(),
                current.eventType(),
                current.userId(),
                current.username(),
                current.createdAt(),
                effectiveNow,
                current.queuedAt(),
                current.nextAttemptAt(),
                current.sentAt(),
                current.failedAt(),
                current.retryCount(),
                current.lastErrorSummary(),
                null,
                true,
                current.workerNode()
            ));
        }
    }

    public int deleteExpiredRows(Instant cutoff) {
        if (cutoff == null) {
            return 0;
        }
        int deleted = 0;
        for (AsyncEmailQueueRecord row : new ArrayList<>(rows.values())) {
            if (row.createdAt() == null || !row.createdAt().isBefore(cutoff)) {
                continue;
            }
            if (rows.remove(row.id(), row)) {
                deleted++;
            }
        }
        return deleted;
    }

    public Map<AsyncEmailQueueRecord.Status, Long> countByStatus(String realmName) {
        Map<AsyncEmailQueueRecord.Status, Long> counts = new EnumMap<>(AsyncEmailQueueRecord.Status.class);
        for (AsyncEmailQueueRecord.Status status : AsyncEmailQueueRecord.Status.values()) {
            counts.put(status, 0L);
        }
        rows.values().stream()
            .filter(row -> isSameRealm(realmName, row.realmName()))
            .forEach(row -> counts.put(row.status(), counts.get(row.status()) + 1L));
        return counts;
    }

    public Map<AsyncEmailQueueRecord.Category, Long> countByCategory(String realmName) {
        Map<AsyncEmailQueueRecord.Category, Long> counts = new EnumMap<>(AsyncEmailQueueRecord.Category.class);
        for (AsyncEmailQueueRecord.Category category : AsyncEmailQueueRecord.Category.values()) {
            counts.put(category, 0L);
        }
        rows.values().stream()
            .filter(row -> isSameRealm(realmName, row.realmName()))
            .forEach(row -> counts.put(row.category(), counts.get(row.category()) + 1L));
        return counts;
    }

    public List<AsyncEmailQueueRecord> listMessages(
        String realmName,
        int maxRows,
        AsyncEmailQueueRecord.Status status,
        AsyncEmailQueueRecord.Category category,
        String textFilter
    ) {
        String normalizedText = normalizeText(textFilter);
        int safeMax = Math.max(1, maxRows);
        return rows.values().stream()
            .filter(row -> isSameRealm(realmName, row.realmName()))
            .filter(row -> status == null || row.status() == status)
            .filter(row -> category == null || row.category() == category)
            .filter(row -> matchesText(row, normalizedText))
            .sorted(Comparator.comparing(AsyncEmailQueueRecord::createdAt, Comparator.nullsLast(Comparator.reverseOrder()))
                .thenComparing(AsyncEmailQueueRecord::id))
            .limit(safeMax)
            .toList();
    }

    public List<AsyncEmailQueueRecord> listFailures(String realmName, int maxRows) {
        int safeMax = Math.max(1, maxRows);
        return rows.values().stream()
            .filter(row -> isSameRealm(realmName, row.realmName()))
            .filter(row -> row.status() == AsyncEmailQueueRecord.Status.FAILED_RETRYABLE
                || row.status() == AsyncEmailQueueRecord.Status.DEAD_LETTER)
            .sorted(Comparator.comparing(AsyncEmailQueueRecord::failedAt, Comparator.nullsLast(Comparator.reverseOrder()))
                .thenComparing(AsyncEmailQueueRecord::updatedAt, Comparator.nullsLast(Comparator.reverseOrder()))
                .thenComparing(AsyncEmailQueueRecord::createdAt, Comparator.nullsLast(Comparator.reverseOrder())))
            .limit(safeMax)
            .toList();
    }

    public AsyncEmailQueueRecord findById(String id) {
        return rows.get(id);
    }

    private AsyncEmailContext sanitizeContext(AsyncEmailContext context) {
        return context == null
            ? new AsyncEmailContext("default", "", AsyncEmailQueueRecord.Category.UNKNOWN, "", "", "", "", "", null, null)
            : context;
    }

    private AsyncEmailQueueRecord.Category normalizeCategory(AsyncEmailContext context) {
        if (context.category() != null) {
            return context.category();
        }
        return AsyncEmailCategoryResolver.resolve(context.templateName(), context.eventType());
    }

    private boolean isClaimableStatus(AsyncEmailQueueRecord row) {
        return row.status() == AsyncEmailQueueRecord.Status.QUEUED
            || row.status() == AsyncEmailQueueRecord.Status.FAILED_RETRYABLE;
    }

    private boolean isRetryTransitionAllowed(AsyncEmailQueueRecord.Status status) {
        return status == AsyncEmailQueueRecord.Status.SENDING
            || status == AsyncEmailQueueRecord.Status.QUEUED
            || status == AsyncEmailQueueRecord.Status.FAILED_RETRYABLE;
    }

    private boolean isDeadLetterTransitionAllowed(AsyncEmailQueueRecord.Status status) {
        return status == AsyncEmailQueueRecord.Status.SENDING
            || status == AsyncEmailQueueRecord.Status.QUEUED
            || status == AsyncEmailQueueRecord.Status.FAILED_RETRYABLE;
    }

    private boolean matchesWorker(AsyncEmailQueueRecord row, String workerNode) {
        if (workerNode == null || row.workerNode() == null) {
            return true;
        }
        return workerNode.equals(row.workerNode());
    }

    private boolean isDue(AsyncEmailQueueRecord row, Instant now) {
        if (row == null || now == null) {
            return false;
        }
        return row.nextAttemptAt() == null || !row.nextAttemptAt().isAfter(now);
    }

    private boolean isSameRealm(String expectedRealm, String actualRealm) {
        return expectedRealm == null || expectedRealm.isBlank() || expectedRealm.equals(actualRealm);
    }

    private boolean matchesText(AsyncEmailQueueRecord row, String normalizedText) {
        if (normalizedText == null || normalizedText.isBlank()) {
            return true;
        }
        return containsNormalized(row.subject(), normalizedText)
            || containsNormalized(row.username(), normalizedText)
            || containsNormalized(row.recipientMasked(), normalizedText)
            || containsNormalized(row.userId(), normalizedText);
    }

    private boolean containsNormalized(String value, String normalizedText) {
        return value != null && value.toLowerCase(Locale.ROOT).contains(normalizedText);
    }

    private String normalizeText(String value) {
        if (value == null) {
            return null;
        }
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        return normalized.isBlank() ? null : normalized;
    }

    private String trimErrorSummary(String summary) {
        if (summary == null) {
            return null;
        }
        String normalized = summary.trim();
        return normalized.length() <= MAX_ERROR_SUMMARY ? normalized : normalized.substring(0, MAX_ERROR_SUMMARY);
    }
}

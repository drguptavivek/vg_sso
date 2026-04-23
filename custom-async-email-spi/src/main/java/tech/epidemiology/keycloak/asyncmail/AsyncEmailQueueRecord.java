package tech.epidemiology.keycloak.asyncmail;

import java.time.Instant;
import java.util.EnumSet;
import java.util.Locale;
import java.util.Optional;

public record AsyncEmailQueueRecord(
    String id,
    String realmName,
    Category category,
    Status status,
    String recipientMasked,
    String recipientDomain,
    String subject,
    String templateName,
    String eventType,
    String userId,
    String username,
    Instant createdAt,
    Instant updatedAt,
    Instant queuedAt,
    Instant nextAttemptAt,
    Instant sentAt,
    Instant failedAt,
    int retryCount,
    String lastErrorSummary,
    String payloadJson,
    boolean payloadScrubbed,
    String workerNode
) {

    public AsyncEmailQueueRecord {
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("id must not be blank");
        }
        category = category == null ? Category.UNKNOWN : category;
        status = status == null ? Status.QUEUED : status;
    }

    public AsyncEmailQueueRecord withStatus(Status newStatus, Instant now) {
        return new AsyncEmailQueueRecord(
            id,
            realmName,
            category,
            newStatus,
            recipientMasked,
            recipientDomain,
            subject,
            templateName,
            eventType,
            userId,
            username,
            createdAt,
            now,
            queuedAt,
            nextAttemptAt,
            newStatus == Status.SENT ? now : sentAt,
            failedAt,
            retryCount,
            lastErrorSummary,
            payloadJson,
            payloadScrubbed,
            workerNode
        );
    }

    public AsyncEmailQueueRecord withRetry(int count, Instant nextAttemptAt, String errorSummary, Instant now) {
        return new AsyncEmailQueueRecord(
            id,
            realmName,
            category,
            Status.FAILED_RETRYABLE,
            recipientMasked,
            recipientDomain,
            subject,
            templateName,
            eventType,
            userId,
            username,
            createdAt,
            now,
            queuedAt,
            nextAttemptAt,
            sentAt,
            failedAt,
            count,
            errorSummary,
            payloadJson,
            payloadScrubbed,
            workerNode
        );
    }

    public AsyncEmailQueueRecord withDeadLetter(String errorSummary, int count, Instant now) {
        return new AsyncEmailQueueRecord(
            id,
            realmName,
            category,
            Status.DEAD_LETTER,
            recipientMasked,
            recipientDomain,
            subject,
            templateName,
            eventType,
            userId,
            username,
            createdAt,
            now,
            queuedAt,
            null,
            sentAt,
            now,
            count,
            errorSummary,
            payloadJson,
            payloadScrubbed,
            workerNode
        );
    }

    public AsyncEmailQueueRecord withWorkerNode(String newWorkerNode, Instant now) {
        return new AsyncEmailQueueRecord(
            id,
            realmName,
            category,
            status,
            recipientMasked,
            recipientDomain,
            subject,
            templateName,
            eventType,
            userId,
            username,
            createdAt,
            now,
            queuedAt,
            nextAttemptAt,
            sentAt,
            failedAt,
            retryCount,
            lastErrorSummary,
            payloadJson,
            payloadScrubbed,
            newWorkerNode
        );
    }

    public AsyncEmailQueueRecord withPayloadScrubbed() {
        return new AsyncEmailQueueRecord(
            id,
            realmName,
            category,
            status,
            recipientMasked,
            recipientDomain,
            subject,
            templateName,
            eventType,
            userId,
            username,
            createdAt,
            updatedAt,
            queuedAt,
            nextAttemptAt,
            sentAt,
            failedAt,
            retryCount,
            lastErrorSummary,
            null,
            true,
            workerNode
        );
    }

    public boolean isQueuedOrRetryable() {
        return status == Status.QUEUED || status == Status.FAILED_RETRYABLE;
    }

    public boolean isDone() {
        return status == Status.SENT || status == Status.DEAD_LETTER;
    }

    public enum Status {
        QUEUED("queued"),
        SENDING("sending"),
        SENT("sent"),
        FAILED_RETRYABLE("failed_retryable"),
        DEAD_LETTER("dead_letter");

        private static final EnumSet<Status> ACTIVE = EnumSet.of(QUEUED, SENDING, FAILED_RETRYABLE);
        private static final EnumSet<Status> TERMINAL = EnumSet.of(SENT, DEAD_LETTER);

        private final String value;

        Status(String value) {
            this.value = value;
        }

        public String value() {
            return value;
        }

        public boolean isActive() {
            return ACTIVE.contains(this);
        }

        public boolean isTerminal() {
            return TERMINAL.contains(this);
        }

        public static Optional<Status> from(String value) {
            if (value == null) {
                return Optional.empty();
            }
            for (Status status : values()) {
                if (status.value.equalsIgnoreCase(value.trim())) {
                    return Optional.of(status);
                }
            }
            return Optional.empty();
        }

        public static Status fromValueOrQueued(String value) {
            return from(value).orElse(QUEUED);
        }
    }

    public enum Category {
        EXECUTE_ACTIONS("execute-actions"),
        VERIFY_EMAIL("verify-email"),
        PASSWORD_RESET("password-reset"),
        EMAIL_UPDATE_CONFIRMATION("email-update-confirmation"),
        ORG_INVITE("org-invite"),
        SMTP_TEST("smtp-test"),
        EVENT_NOTIFICATION("event-notification"),
        GENERIC_TEMPLATE("generic-template"),
        UNKNOWN("unknown");

        private final String value;

        Category(String value) {
            this.value = value;
        }

        public String value() {
            return value;
        }

        public static Optional<Category> from(String value) {
            if (value == null) {
                return Optional.empty();
            }
            String normalized = value.trim().toLowerCase(Locale.ROOT);
            for (Category category : values()) {
                if (category.value.equals(normalized)) {
                    return Optional.of(category);
                }
            }
            return Optional.empty();
        }

        public static Category fromValueOrUnknown(String value) {
            return from(value).orElse(UNKNOWN);
        }
    }
}

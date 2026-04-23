package tech.epidemiology.keycloak.asyncmail;

import java.util.Locale;
import java.util.Map;

public final class AsyncEmailConfig {

    public static final String ENV_RETENTION_DAYS = "KC_ASYNC_EMAIL_RETENTION_DAYS";
    public static final String ENV_RETRY_MAX_ATTEMPTS = "KC_ASYNC_EMAIL_RETRY_MAX_ATTEMPTS";
    public static final String ENV_WORKER_ENABLED = "KC_ASYNC_EMAIL_WORKER_ENABLED";
    public static final String ENV_EXPORT_MAX_ROWS = "KC_ASYNC_EMAIL_EXPORT_MAX_ROWS";
    public static final String ENV_WORKER_POLL_SECONDS = "KC_ASYNC_EMAIL_WORKER_POLL_SECONDS";
    public static final String ENV_WORKER_BATCH_SIZE = "KC_ASYNC_EMAIL_WORKER_BATCH_SIZE";
    public static final String ENV_STALE_SENDING_MINUTES = "KC_ASYNC_EMAIL_STALE_SENDING_MINUTES";

    public static final int DEFAULT_RETENTION_DAYS = 180;
    public static final int DEFAULT_RETRY_MAX_ATTEMPTS = 5;
    public static final boolean DEFAULT_WORKER_ENABLED = true;
    public static final int DEFAULT_EXPORT_MAX_ROWS = 10_000;
    public static final int DEFAULT_WORKER_POLL_SECONDS = 20;
    public static final int DEFAULT_WORKER_BATCH_SIZE = 50;
    public static final int DEFAULT_STALE_SENDING_MINUTES = 30;

    private final int retentionDays;
    private final int retryMaxAttempts;
    private final boolean workerEnabled;
    private final int exportMaxRows;
    private final int workerPollSeconds;
    private final int workerBatchSize;
    private final int staleSendingMinutes;

    private AsyncEmailConfig(
        int retentionDays,
        int retryMaxAttempts,
        boolean workerEnabled,
        int exportMaxRows,
        int workerPollSeconds,
        int workerBatchSize,
        int staleSendingMinutes
    ) {
        this.retentionDays = normalizePositive(retentionDays, DEFAULT_RETENTION_DAYS);
        this.retryMaxAttempts = Math.max(1, retryMaxAttempts);
        this.workerEnabled = workerEnabled;
        this.exportMaxRows = normalizePositive(exportMaxRows, DEFAULT_EXPORT_MAX_ROWS);
        this.workerPollSeconds = normalizePositive(workerPollSeconds, DEFAULT_WORKER_POLL_SECONDS);
        this.workerBatchSize = normalizePositive(workerBatchSize, DEFAULT_WORKER_BATCH_SIZE);
        this.staleSendingMinutes = normalizePositive(staleSendingMinutes, DEFAULT_STALE_SENDING_MINUTES);
    }

    public static AsyncEmailConfig fromEnvironment(Map<String, String> env) {
        return new AsyncEmailConfig(
            parseInt(env.get(ENV_RETENTION_DAYS), DEFAULT_RETENTION_DAYS),
            parseInt(env.get(ENV_RETRY_MAX_ATTEMPTS), DEFAULT_RETRY_MAX_ATTEMPTS),
            parseBoolean(env.get(ENV_WORKER_ENABLED), DEFAULT_WORKER_ENABLED),
            parseInt(env.get(ENV_EXPORT_MAX_ROWS), DEFAULT_EXPORT_MAX_ROWS),
            parseInt(env.get(ENV_WORKER_POLL_SECONDS), DEFAULT_WORKER_POLL_SECONDS),
            parseInt(env.get(ENV_WORKER_BATCH_SIZE), DEFAULT_WORKER_BATCH_SIZE),
            parseInt(env.get(ENV_STALE_SENDING_MINUTES), DEFAULT_STALE_SENDING_MINUTES)
        );
    }

    public static AsyncEmailConfig defaults() {
        return fromEnvironment(Map.of());
    }

    public int retentionDays() {
        return retentionDays;
    }

    public int retryMaxAttempts() {
        return retryMaxAttempts;
    }

    public boolean workerEnabled() {
        return workerEnabled;
    }

    public int exportMaxRows() {
        return exportMaxRows;
    }

    public int workerPollSeconds() {
        return workerPollSeconds;
    }

    public int workerBatchSize() {
        return workerBatchSize;
    }

    public int staleSendingMinutes() {
        return staleSendingMinutes;
    }

    private static int parseInt(String value, int defaultValue) {
        if (value == null || value.isBlank()) {
            return defaultValue;
        }
        try {
            return Integer.parseInt(value.trim());
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }

    private static boolean parseBoolean(String value, boolean defaultValue) {
        if (value == null || value.isBlank()) {
            return defaultValue;
        }
        return Boolean.parseBoolean(value.trim().toLowerCase(Locale.ROOT));
    }

    private static int normalizePositive(int value, int fallback) {
        return value > 0 ? value : fallback;
    }
}

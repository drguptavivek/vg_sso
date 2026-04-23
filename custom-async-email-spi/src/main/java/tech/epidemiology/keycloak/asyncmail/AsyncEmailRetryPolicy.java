package tech.epidemiology.keycloak.asyncmail;

import java.time.Duration;
import java.util.Locale;

public final class AsyncEmailRetryPolicy {

    public static final int DEFAULT_MAX_ATTEMPTS = 5;
    public static final long DEFAULT_JITTER_SEED = 17L;
    private static final int[] DEFAULT_BACKOFF_SECONDS = {30, 120, 600, 1800};
    private static final int RETRY_NOT_CONFIGURED = 0;

    private final int maxAttempts;
    private final long jitterSeed;

    public AsyncEmailRetryPolicy() {
        this(DEFAULT_MAX_ATTEMPTS);
    }

    public AsyncEmailRetryPolicy(int maxAttempts) {
        this(maxAttempts, DEFAULT_JITTER_SEED);
    }

    public AsyncEmailRetryPolicy(int maxAttempts, long jitterSeed) {
        this.maxAttempts = normalizePositive(maxAttempts, DEFAULT_MAX_ATTEMPTS);
        this.jitterSeed = jitterSeed;
    }

    public int maxAttempts() {
        return maxAttempts;
    }

    public boolean shouldRetry(int retryCount, Throwable failure) {
        return retryCount >= RETRY_NOT_CONFIGURED
            && retryCount < maxAttempts
            && isRetryableFailure(failure);
    }

    public boolean isRetryableFailure(Throwable failure) {
        if (failure == null || failure.getMessage() == null) {
            return false;
        }

        String message = failure.getMessage().toLowerCase(Locale.ROOT);
        return message.contains("timeout")
            || message.contains("timed out")
            || message.contains("temporary")
            || message.contains("smtp 4")
            || message.contains("4.")
            || message.contains("dns")
            || message.contains("connection reset")
            || message.contains("connection refused")
            || message.contains("connect")
            || message.contains("unreachable");
    }

    public Duration calculateNextAttemptDelay(int retryCount, long jitterSeed) {
        if (retryCount < RETRY_NOT_CONFIGURED || retryCount >= maxAttempts) {
            return null;
        }

        int baseSeconds = baseDelaySecondsForAttempt(retryCount);
        long jitter = computeDeterministicJitter(baseSeconds, retryCount, jitterSeed);
        long finalSeconds = Math.max(1L, baseSeconds + jitter);
        return Duration.ofSeconds(finalSeconds);
    }

    public Duration calculateNextAttemptDelay(int retryCount) {
        return calculateNextAttemptDelay(retryCount, jitterSeed);
    }

    private int baseDelaySecondsForAttempt(int retryCount) {
        if (retryCount <= 0) {
            return 0;
        }
        if (retryCount <= DEFAULT_BACKOFF_SECONDS.length) {
            return DEFAULT_BACKOFF_SECONDS[retryCount - 1];
        }
        return DEFAULT_BACKOFF_SECONDS[DEFAULT_BACKOFF_SECONDS.length - 1] * retryCount;
    }

    private long computeDeterministicJitter(int baseSeconds, int retryCount, long jitterSeed) {
        if (jitterSeed == 0L) {
            return 0L;
        }
        long seed = mixSeed(baseSeconds, retryCount, jitterSeed);
        long bounded = Math.floorMod(seed, 21L);
        long percentOffset = bounded - 10L;
        return Math.round(baseSeconds * percentOffset / 100.0d);
    }

    private long mixSeed(int baseSeconds, int retryCount, long jitterSeed) {
        long mixed = jitterSeed;
        mixed = (mixed * 1315423911L) ^ (baseSeconds * 2654435761L);
        mixed ^= retryCount * 2654435761L;
        return mixed;
    }

    private int normalizePositive(int value, int fallback) {
        return value > 0 ? value : fallback;
    }
}

package tech.epidemiology.keycloak.asyncmail;

import java.time.Instant;

public final class AsyncEmailRetentionPolicy {

    public static final int DEFAULT_RETENTION_DAYS = AsyncEmailConfig.DEFAULT_RETENTION_DAYS;

    private final int retentionDays;

    public AsyncEmailRetentionPolicy() {
        this(DEFAULT_RETENTION_DAYS);
    }

    public AsyncEmailRetentionPolicy(int retentionDays) {
        this.retentionDays = retentionDays > 0 ? retentionDays : DEFAULT_RETENTION_DAYS;
    }

    public int retentionDays() {
        return retentionDays;
    }

    public Instant cutoffAt(Instant now) {
        return now.minusSeconds(retentionDays * 24L * 60L * 60L);
    }

    public boolean isExpired(Instant createdAt, Instant now) {
        if (createdAt == null) {
            return true;
        }
        return createdAt.isBefore(cutoffAt(now));
    }
}

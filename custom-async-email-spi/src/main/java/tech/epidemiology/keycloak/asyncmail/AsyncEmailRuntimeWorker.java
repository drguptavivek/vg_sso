package tech.epidemiology.keycloak.asyncmail;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.jboss.logging.Logger;
import org.keycloak.email.DefaultEmailSenderProviderFactory;
import org.keycloak.email.EmailException;
import org.keycloak.email.EmailSenderProvider;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.models.RealmModel;
import org.keycloak.models.utils.KeycloakModelUtils;

public final class AsyncEmailRuntimeWorker implements AutoCloseable {
    private static final Logger LOG = Logger.getLogger(AsyncEmailRuntimeWorker.class);

    private final KeycloakSessionFactory sessionFactory;
    private final DefaultEmailSenderProviderFactory defaultDelegate;
    private final AsyncEmailConfig config;
    private final AsyncEmailRetryPolicy retryPolicy;
    private final AsyncEmailRetentionPolicy retentionPolicy;
    private final String workerNode;

    private ScheduledExecutorService scheduler;

    public AsyncEmailRuntimeWorker(
        KeycloakSessionFactory sessionFactory,
        DefaultEmailSenderProviderFactory defaultDelegate,
        AsyncEmailConfig config
    ) {
        this.sessionFactory = sessionFactory;
        this.defaultDelegate = defaultDelegate;
        this.config = config == null ? AsyncEmailConfig.defaults() : config;
        this.retryPolicy = new AsyncEmailRetryPolicy(this.config.retryMaxAttempts(), 0L);
        this.retentionPolicy = new AsyncEmailRetentionPolicy(this.config.retentionDays());
        this.workerNode = "async-email-" + UUID.randomUUID();
    }

    public synchronized void start() {
        if (scheduler != null) {
            return;
        }
        scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread thread = new Thread(r, "async-email-worker");
            thread.setDaemon(true);
            return thread;
        });
        scheduler.scheduleAtFixedRate(this::safeRun, 0L, config.workerPollSeconds(), TimeUnit.SECONDS);
        LOG.infof("ASYNC_EMAIL: worker started node=%s pollSeconds=%d batchSize=%d",
            workerNode, config.workerPollSeconds(), config.workerBatchSize());
    }

    private void safeRun() {
        try {
            runOnce();
        } catch (Throwable t) {
            LOG.errorf(t, "ASYNC_EMAIL: worker run failed node=%s", workerNode);
        }
    }

    void runOnce() {
        Instant now = Instant.now();
        List<AsyncEmailQueueRecord> claimed = claimDueRows(now);
        for (AsyncEmailQueueRecord row : claimed) {
            sendClaimedRow(row, now);
        }
        cleanupExpiredRows(now);
    }

    private List<AsyncEmailQueueRecord> claimDueRows(Instant now) {
        final List<AsyncEmailQueueRecord>[] claimed = new List[]{List.of()};
        KeycloakModelUtils.runJobInTransaction(sessionFactory, session -> {
            claimed[0] = new AsyncEmailDatabaseRepository(session)
                .claimDueRows(config.workerBatchSize(), workerNode, now);
        });
        return claimed[0];
    }

    private void sendClaimedRow(AsyncEmailQueueRecord row, Instant now) {
        try {
            KeycloakModelUtils.runJobInTransaction(sessionFactory, session -> {
                try {
                    RealmModel realm = session.realms().getRealmByName(row.realmName());
                    if (realm == null) {
                        throw new EmailException("Realm not found for queued email: " + row.realmName());
                    }
                    session.getContext().setRealm(realm);
                    AsyncEmailDatabaseRepository repository = new AsyncEmailDatabaseRepository(session);
                    AsyncEmailDatabaseRepository.DeliveryPayload payload = repository.decodePayload(row.payloadJson());
                    Map<String, String> smtpConfig = realm.getSmtpConfig();
                    EmailSenderProvider directSender = defaultDelegate.create(session);
                    directSender.send(smtpConfig, payload.recipient(), row.subject(), payload.textBody(), payload.htmlBody());
                    repository.markSent(row.id(), workerNode, now);
                    repository.scrubPayload(row.id(), now);
                } catch (EmailException e) {
                    throw new RuntimeException(e);
                }
            });
        } catch (Throwable failure) {
            handleFailure(row, failure, now);
        }
    }

    private void handleFailure(AsyncEmailQueueRecord row, Throwable failure, Instant now) {
        String summary = failure == null ? "unknown failure" : String.valueOf(failure.getMessage());
        int nextRetry = Math.max(1, row.retryCount() + 1);
        java.time.Duration retryDelay = retryPolicy.calculateNextAttemptDelay(nextRetry, 0L);
        boolean shouldRetry = retryPolicy.shouldRetry(nextRetry, failure) && retryDelay != null;

        KeycloakModelUtils.runJobInTransaction(sessionFactory, session -> {
            AsyncEmailDatabaseRepository repository = new AsyncEmailDatabaseRepository(session);
            if (shouldRetry) {
                repository.markRetryable(row.id(), summary, nextRetry, now.plus(retryDelay), workerNode, now);
                return;
            }
            repository.markDeadLetter(row.id(), summary, nextRetry, workerNode, now);
            repository.scrubPayload(row.id(), now);
        });
        if (shouldRetry) {
            LOG.warnf("ASYNC_EMAIL: send failed, retry scheduled id=%s realm=%s retry=%d error=%s",
                row.id(), row.realmName(), nextRetry, summary);
        } else {
            LOG.errorf("ASYNC_EMAIL: send failed, dead-lettered id=%s realm=%s retry=%d error=%s",
                row.id(), row.realmName(), nextRetry, summary);
        }
    }

    private void cleanupExpiredRows(Instant now) {
        KeycloakModelUtils.runJobInTransaction(sessionFactory, session -> {
            new AsyncEmailDatabaseRepository(session).deleteExpiredRows(retentionPolicy.cutoffAt(now));
        });
    }

    @Override
    public synchronized void close() {
        if (scheduler != null) {
            scheduler.shutdownNow();
            scheduler = null;
        }
    }
}

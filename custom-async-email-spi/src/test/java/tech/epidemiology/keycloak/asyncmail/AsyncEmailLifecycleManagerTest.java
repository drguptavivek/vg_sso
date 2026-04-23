package tech.epidemiology.keycloak.asyncmail;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class AsyncEmailLifecycleManagerTest {

    @Test
    void controlsWorkerLifecycleStateAndCanRunOnDemand() {
        AsyncEmailQueueRepository repository = new AsyncEmailQueueRepository();
        AsyncEmailWorker worker = new AsyncEmailWorker(
            repository,
            new AsyncEmailRetryPolicy(3, 1),
            new AsyncEmailRetentionPolicy(30),
            message -> {
            },
            Clock.fixed(Instant.parse("2026-04-23T10:00:00Z"), java.time.ZoneOffset.UTC),
            10,
            "worker-lifecycle"
        );

        AsyncEmailLifecycleManager manager = new AsyncEmailLifecycleManager(worker, Clock.systemUTC(), Duration.ofSeconds(1));

        assertThat(manager.isRunning()).isFalse();
        manager.start();
        assertThat(manager.isRunning()).isTrue();
        repository.enqueue(
            context("realm-a", "alice@example.org"),
            "{\"payload\":\"ok\"}",
            Instant.parse("2026-04-23T10:00:00Z"));
        manager.run();
        manager.stop();
        assertThat(manager.isRunning()).isFalse();
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

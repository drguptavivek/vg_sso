package tech.epidemiology.keycloak.asyncmail;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public final class AsyncEmailLifecycleManager {

    private final AsyncEmailWorker worker;
    private final Clock clock;
    private final Duration pollInterval;
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final Object lock = new Object();

    private ScheduledExecutorService scheduler;
    private ScheduledFuture<?> scheduledTask;

    public AsyncEmailLifecycleManager(AsyncEmailWorker worker, long pollSeconds) {
        this(worker, Clock.systemUTC(), Duration.ofSeconds(pollSeconds));
    }

    public AsyncEmailLifecycleManager(AsyncEmailWorker worker, Clock clock, long pollSeconds) {
        this(worker, clock, Duration.ofSeconds(Math.max(1, pollSeconds)));
    }

    public AsyncEmailLifecycleManager(AsyncEmailWorker worker, Clock clock, Duration pollInterval) {
        if (worker == null) {
            throw new IllegalArgumentException("worker must not be null");
        }
        this.worker = worker;
        this.clock = clock == null ? Clock.systemUTC() : clock;
        this.pollInterval = pollInterval == null || pollInterval.toMillis() <= 0 ? Duration.ofSeconds(20) : pollInterval;
    }

    public void start() {
        if (!running.compareAndSet(false, true)) {
            return;
        }
        synchronized (lock) {
            if (scheduler != null) {
                scheduler.shutdownNow();
            }
            scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "async-email-worker");
                t.setDaemon(true);
                return t;
            });
            scheduledTask = scheduler.scheduleAtFixedRate(this::run, 0L, pollInterval.toSeconds(), TimeUnit.SECONDS);
        }
    }

    public void stop() {
        if (!running.compareAndSet(true, false)) {
            return;
        }
        synchronized (lock) {
            if (scheduledTask != null) {
                scheduledTask.cancel(false);
            }
            if (scheduler != null) {
                scheduler.shutdownNow();
                scheduler = null;
            }
            scheduledTask = null;
        }
    }

    public void run() {
        if (!running.get()) {
            return;
        }
        worker.runOnce(Instant.now(clock));
    }

    public boolean isRunning() {
        return running.get();
    }
}

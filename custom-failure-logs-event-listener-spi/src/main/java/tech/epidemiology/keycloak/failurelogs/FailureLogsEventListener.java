package tech.epidemiology.keycloak.failurelogs;

import org.keycloak.events.Event;
import org.keycloak.events.EventListenerProvider;
import org.keycloak.events.admin.AdminEvent;
import java.util.logging.Level;
import java.util.logging.Logger;

final class FailureLogsEventListener implements EventListenerProvider {
    private static final Logger LOG = Logger.getLogger(FailureLogsEventListener.class.getName());

    private final FailureLogsLogWriter writer;

    FailureLogsEventListener(FailureLogsLogWriter writer) {
        this.writer = writer;
    }

    @Override
    public void onEvent(Event event) {
        if (!FailureLogsEventFormatter.shouldLog(event)) {
            return;
        }
        try {
            writer.writeLine(FailureLogsEventFormatter.toJsonLine(event));
        } catch (RuntimeException e) {
            LOG.log(Level.WARNING,
                String.format("FAILURE_LOGS: failed to write user event type=%s realm=%s", event.getType(), event.getRealmName()),
                e);
        }
    }

    @Override
    public void onEvent(AdminEvent event, boolean includeRepresentation) {
        if (!FailureLogsEventFormatter.shouldLog(event)) {
            return;
        }
        try {
            writer.writeLine(FailureLogsEventFormatter.toJsonLine(event));
        } catch (RuntimeException e) {
            LOG.log(Level.WARNING,
                String.format("FAILURE_LOGS: failed to write admin event op=%s realm=%s", event.getOperationType(), event.getRealmName()),
                e);
        }
    }

    @Override
    public void close() {
        // no-op
    }
}

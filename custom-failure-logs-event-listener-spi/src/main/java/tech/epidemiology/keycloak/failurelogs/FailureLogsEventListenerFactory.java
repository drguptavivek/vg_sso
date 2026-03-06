package tech.epidemiology.keycloak.failurelogs;

import java.nio.file.Path;

import org.keycloak.Config;
import org.keycloak.events.EventListenerProvider;
import org.keycloak.events.EventListenerProviderFactory;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;

public class FailureLogsEventListenerFactory implements EventListenerProviderFactory {
    public static final String PROVIDER_ID = "failure-logs-file";
    public static final String DEFAULT_LOG_FILE = "/var/log/keycloak/failure-auth.log";

    private volatile Path logFile;

    @Override
    public EventListenerProvider create(KeycloakSession session) {
        return new FailureLogsEventListener(new FailureLogsLogWriter(logFile));
    }

    @Override
    public void init(Config.Scope config) {
        String path = config.get("logFile");
        if (path == null || path.isBlank()) {
            path = System.getenv("KC_FAILURE_LOG_FILE");
        }
        if (path == null || path.isBlank()) {
            path = DEFAULT_LOG_FILE;
        }
        this.logFile = Path.of(path);
    }

    @Override
    public void postInit(KeycloakSessionFactory factory) {
        // no-op
    }

    @Override
    public void close() {
        // no-op
    }

    @Override
    public String getId() {
        return PROVIDER_ID;
    }
}

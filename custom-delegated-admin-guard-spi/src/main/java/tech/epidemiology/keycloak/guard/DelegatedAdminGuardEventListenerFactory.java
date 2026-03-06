package tech.epidemiology.keycloak.guard;

import org.keycloak.Config;
import org.keycloak.events.EventListenerProvider;
import org.keycloak.events.EventListenerProviderFactory;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;

/**
 * Factory for DelegatedAdminGuardEventListener.
 *
 * Register in realm event listeners as: "delegated-admin-guard"
 */
public class DelegatedAdminGuardEventListenerFactory implements EventListenerProviderFactory {

    public static final String PROVIDER_ID = "delegated-admin-guard";

    @Override
    public EventListenerProvider create(KeycloakSession session) {
        return new DelegatedAdminGuardEventListener(session);
    }

    @Override
    public void init(Config.Scope config) {
        // No configuration needed
    }

    @Override
    public void postInit(KeycloakSessionFactory factory) {
        // No post-init needed
    }

    @Override
    public void close() {
        // Nothing to close
    }

    @Override
    public String getId() {
        return PROVIDER_ID;
    }
}

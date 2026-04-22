package tech.epidemiology.keycloak.onboarding;

import java.util.Map;
import java.util.Set;

import org.keycloak.Config;
import org.keycloak.events.EventListenerProvider;
import org.keycloak.events.EventListenerProviderFactory;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;

public final class UserOnboardingEmailEventListenerFactory implements EventListenerProviderFactory {
    public static final String PROVIDER_ID = "user-onboarding-email";

    private volatile int tokenLifespanSeconds = UserOnboardingEmailPolicy.DEFAULT_TOKEN_LIFESPAN_SECONDS;
    private volatile Set<String> skipUsernames = Set.of();
    private volatile Set<String> enabledRealms = Set.of();

    @Override
    public EventListenerProvider create(KeycloakSession session) {
        return new UserOnboardingEmailEventListener(
            session,
            tokenLifespanSeconds,
            skipUsernames,
            enabledRealms
        );
    }

    @Override
    public void init(Config.Scope config) {
        this.tokenLifespanSeconds = UserOnboardingEmailPolicy.tokenLifespanSeconds(config);
        this.skipUsernames = UserOnboardingEmailPolicy.skipUsernames(config, System.getenv());
        this.enabledRealms = UserOnboardingEmailPolicy.enabledRealms(config);
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

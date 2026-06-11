package tech.epidemiology.keycloak.onboarding;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.jboss.logging.Logger;
import org.keycloak.Config;
import org.keycloak.events.EventListenerProvider;
import org.keycloak.events.EventListenerProviderFactory;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;

public final class UserOnboardingEmailEventListenerFactory implements EventListenerProviderFactory {
    private static final Logger LOG = Logger.getLogger(UserOnboardingEmailEventListenerFactory.class);
    public static final String PROVIDER_ID = "user-onboarding-email";

    private volatile int tokenLifespanSeconds = UserOnboardingEmailPolicy.DEFAULT_TOKEN_LIFESPAN_SECONDS;
    private volatile Set<String> skipUsernames = Set.of();
    private volatile Set<String> enabledRealms = Set.of();
    private volatile String publicBaseUrl;
    private volatile KeycloakSessionFactory sessionFactory;
    private volatile ExecutorService executor;

    @Override
    public EventListenerProvider create(KeycloakSession session) {
        LOG.infof("USER_ONBOARDING: creating event listener provider sessionFactoryReady=%s executorReady=%s publicBaseUrl=%s enabledRealms=%s", sessionFactory != null, executor != null, publicBaseUrl, enabledRealms);
        return new UserOnboardingEmailEventListener(
            session,
            sessionFactory,
            executor,
            publicBaseUrl,
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
        this.publicBaseUrl = UserOnboardingEmailPolicy.publicBaseUrl(config, System.getenv());
    }

    @Override
    public void postInit(KeycloakSessionFactory factory) {
        this.sessionFactory = factory;
        LOG.info("USER_ONBOARDING: factory postInit complete");
        this.executor = Executors.newSingleThreadExecutor(r -> {
            Thread thread = new Thread(r, "user-onboarding-email");
            thread.setDaemon(true);
            return thread;
        });
    }

    @Override
    public void close() {
        ExecutorService currentExecutor = executor;
        if (currentExecutor != null) {
            currentExecutor.shutdown();
        }
    }

    @Override
    public String getId() {
        return PROVIDER_ID;
    }
}

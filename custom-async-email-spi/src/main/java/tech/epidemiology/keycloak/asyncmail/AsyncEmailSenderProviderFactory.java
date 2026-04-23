package tech.epidemiology.keycloak.asyncmail;

import org.keycloak.Config;
import org.keycloak.email.DefaultEmailSenderProviderFactory;
import org.keycloak.email.EmailSenderProvider;
import org.keycloak.email.EmailSenderProviderFactory;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.jboss.logging.Logger;

public class AsyncEmailSenderProviderFactory implements EmailSenderProviderFactory {
    private static final Logger LOG = Logger.getLogger(AsyncEmailSenderProviderFactory.class);
    public static final String PROVIDER_ID = "default";
    private final DefaultEmailSenderProviderFactory defaultDelegate = new DefaultEmailSenderProviderFactory();
    private volatile AsyncEmailRuntimeWorker runtimeWorker;

    @Override
    public EmailSenderProvider create(KeycloakSession session) {
        ensureWorkerStarted(session.getKeycloakSessionFactory());
        return new AsyncEmailSenderProvider(
            defaultDelegate.create(session),
            (config, context, address, subject, textBody, htmlBody, user) -> {
                if (session.getContext().getRealm() == null) {
                    throw new org.keycloak.email.EmailException("No realm context available for async email queueing");
                }
                new AsyncEmailDatabaseRepository(session).enqueue(
                    session.getContext().getRealm(),
                    context,
                    address,
                    subject,
                    textBody,
                    htmlBody,
                    user);
            });
    }

    @Override
    public void init(Config.Scope config) {
        defaultDelegate.init(config);
    }

    @Override
    public void postInit(KeycloakSessionFactory factory) {
        ensureWorkerStarted(factory);
    }

    @Override
    public void close() {
        if (runtimeWorker != null) {
            runtimeWorker.close();
            runtimeWorker = null;
        }
        defaultDelegate.close();
    }

    @Override
    public String getId() {
        return PROVIDER_ID;
    }

    @Override
    public int order() {
        return 100;
    }

    private void ensureWorkerStarted(KeycloakSessionFactory factory) {
        if (factory == null) {
            return;
        }
        AsyncEmailConfig asyncEmailConfig = AsyncEmailConfig.fromEnvironment(System.getenv());
        if (!asyncEmailConfig.workerEnabled()) {
            LOG.info("ASYNC_EMAIL: runtime worker disabled by configuration");
            return;
        }
        synchronized (this) {
            if (runtimeWorker != null) {
                return;
            }
            runtimeWorker = new AsyncEmailRuntimeWorker(factory, defaultDelegate, asyncEmailConfig);
            runtimeWorker.start();
        }
    }
}

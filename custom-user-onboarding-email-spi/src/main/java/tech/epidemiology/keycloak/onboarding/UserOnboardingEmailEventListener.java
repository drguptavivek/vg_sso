package tech.epidemiology.keycloak.onboarding;

import java.net.URI;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;

import org.jboss.logging.Logger;
import org.keycloak.authentication.actiontoken.execactions.ExecuteActionsActionToken;
import org.keycloak.common.util.Time;
import org.keycloak.email.EmailException;
import org.keycloak.email.EmailTemplateProvider;
import org.keycloak.events.Event;
import org.keycloak.events.EventListenerProvider;
import org.keycloak.events.admin.AdminEvent;
import org.keycloak.models.AbstractKeycloakTransaction;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.keycloak.models.utils.KeycloakModelUtils;

final class UserOnboardingEmailEventListener implements EventListenerProvider {
    private static final Logger LOG = Logger.getLogger(UserOnboardingEmailEventListener.class);

    private final KeycloakSession session;
    private final KeycloakSessionFactory sessionFactory;
    private final ExecutorService executor;
    private final String publicBaseUrl;
    private final int tokenLifespanSeconds;
    private final Set<String> skipUsernames;
    private final Set<String> enabledRealms;

    UserOnboardingEmailEventListener(
        KeycloakSession session,
        KeycloakSessionFactory sessionFactory,
        ExecutorService executor,
        String publicBaseUrl,
        int tokenLifespanSeconds,
        Set<String> skipUsernames,
        Set<String> enabledRealms
    ) {
        this.session = session;
        this.sessionFactory = sessionFactory;
        this.executor = executor;
        this.publicBaseUrl = publicBaseUrl;
        this.tokenLifespanSeconds = tokenLifespanSeconds;
        this.skipUsernames = skipUsernames;
        this.enabledRealms = enabledRealms;
    }

    @Override
    public void onEvent(Event event) {
        // No user-facing event handling required.
    }

    @Override
    public void onEvent(AdminEvent event, boolean includeRepresentation) {
        if (!UserOnboardingEmailPolicy.isUserCreateEvent(event)) {
            return;
        }

        RealmModel realm = resolveRealm(event);
        if (realm == null) {
            LOG.warnf(
                "USER_ONBOARDING: unable to resolve realm for admin event realmId=%s resourcePath=%s",
                event.getRealmId(),
                event.getResourcePath()
            );
            return;
        }

        String userId = UserOnboardingEmailPolicy.userIdFromResourcePath(event.getResourcePath());
        if (userId == null) {
            LOG.warnf("USER_ONBOARDING: unexpected user create resource path realm=%s path=%s", realm.getName(), event.getResourcePath());
            return;
        }

        UserModel user = session.users().getUserById(realm, userId);
        if (!UserOnboardingEmailPolicy.shouldSend(realm, user, skipUsernames, enabledRealms)) {
            return;
        }
        if (!UserOnboardingEmailPolicy.hasUsableSmtpConfig(realm)) {
            LOG.warnf("USER_ONBOARDING: smtp config incomplete, skipping user=%s realm=%s", user.getUsername(), realm.getName());
            return;
        }

        enqueueAsyncSend(realm.getId(), realm.getName(), user.getId(), user.getUsername(), user.getEmail());
    }

    @Override
    public void close() {
        // no-op
    }

    private RealmModel resolveRealm(AdminEvent event) {
        if (event != null && event.getRealmId() != null) {
            RealmModel realmById = session.realms().getRealm(event.getRealmId());
            if (realmById != null) {
                return realmById;
            }
        }
        return session.getContext().getRealm();
    }

    private void enqueueAsyncSend(String realmId, String realmName, String userId, String username, String email) {
        if (sessionFactory == null || executor == null) {
            LOG.warnf("USER_ONBOARDING: async infrastructure unavailable user=%s realm=%s", username, realmName);
            return;
        }

        session.getTransactionManager().enlistAfterCompletion(new AbstractKeycloakTransaction() {
            @Override
            protected void commitImpl() {
                LOG.infof("USER_ONBOARDING: queued onboarding email user=%s realm=%s email=%s", username, realmName, email);
                executor.submit(() -> {
                    try {
                        KeycloakModelUtils.runJobInTransaction(sessionFactory, asyncSession -> {
                            RealmModel asyncRealm = asyncSession.realms().getRealm(realmId);
                            if (asyncRealm == null) {
                                LOG.warnf("USER_ONBOARDING: async realm not found realmId=%s user=%s", realmId, username);
                                return;
                            }

                            asyncSession.getContext().setRealm(asyncRealm);

                            UserModel asyncUser = asyncSession.users().getUserById(asyncRealm, userId);
                            if (!UserOnboardingEmailPolicy.shouldSend(asyncRealm, asyncUser, skipUsernames, enabledRealms)) {
                                LOG.infof("USER_ONBOARDING: async send skipped user=%s realm=%s", username, asyncRealm.getName());
                                return;
                            }

                            try {
                        String link = buildExecuteActionsLink(asyncSession, asyncRealm, asyncUser, UserOnboardingEmailPolicy.REQUIRED_ACTIONS);
                                LOG.infof(
                                    "USER_ONBOARDING: sending onboarding email user=%s realm=%s email=%s link=%s",
                                    asyncUser.getUsername(),
                                    asyncRealm.getName(),
                                    asyncUser.getEmail(),
                                    link
                                );
                                sendExecuteActionsEmail(asyncSession, asyncRealm, asyncUser, link, UserOnboardingEmailPolicy.REQUIRED_ACTIONS);
                                LOG.infof("USER_ONBOARDING: sent onboarding email to user=%s realm=%s", asyncUser.getUsername(), asyncRealm.getName());

                                String sentAt = Instant.now().toString();
                                asyncUser.setSingleAttribute(UserOnboardingEmailPolicy.SENT_AT_ATTRIBUTE, sentAt);
                                LOG.infof(
                                    "USER_ONBOARDING: saved user attribute %s=%s user=%s realm=%s",
                                    UserOnboardingEmailPolicy.SENT_AT_ATTRIBUTE,
                                    sentAt,
                                    asyncUser.getUsername(),
                                    asyncRealm.getName()
                                );
                            } catch (Exception e) {
                                LOG.warnf(e, "USER_ONBOARDING: failed to send onboarding email to user=%s realm=%s", username, asyncRealm.getName());
                            }
                        });
                    } catch (Exception e) {
                        LOG.warnf(e, "USER_ONBOARDING: async executor failed before send user=%s realm=%s", username, realmName);
                    }
                });
            }

            @Override
            protected void rollbackImpl() {
                // no-op
            }
        });
    }

    private void sendExecuteActionsEmail(
        KeycloakSession currentSession,
        RealmModel realm,
        UserModel user,
        String link,
        List<String> requiredActions
    ) throws EmailException {
        currentSession.getProvider(EmailTemplateProvider.class)
            .setAttribute("requiredActions", requiredActions)
            .setAttribute("IGNORE_ACCEPT_LANGUAGE_HEADER", Boolean.TRUE)
            .setRealm(realm)
            .setUser(user)
            .sendExecuteActions(link, TimeUnit.SECONDS.toMinutes(tokenLifespanSeconds));
    }

    private String buildExecuteActionsLink(
        KeycloakSession currentSession,
        RealmModel realm,
        UserModel user,
        List<String> requiredActions
    ) {
        String baseUrl = trimToNull(publicBaseUrl);
        if (baseUrl == null) {
            throw new IllegalStateException("Missing publicBaseUrl for async onboarding email link generation");
        }

        int expiration = Time.currentTime() + tokenLifespanSeconds;
        ExecuteActionsActionToken token = new ExecuteActionsActionToken(
            user.getId(),
            user.getEmail(),
            expiration,
            requiredActions,
            null,
            null
        );
        String serialized = token.serialize(currentSession, realm, null);
        URI uri = URI.create(baseUrl);
        String basePath = normalizePath(uri.getPath());
        String finalPath = basePath + "/realms/" + realm.getName() + "/login-actions/action-token";
        String port = uri.getPort() >= 0 ? ":" + uri.getPort() : "";
        return uri.getScheme() + "://" + uri.getHost() + port + finalPath + "?key=" + serialized;
    }

    private String normalizePath(String path) {
        if (path == null || path.isBlank() || "/".equals(path)) {
            return "";
        }
        String normalized = path.startsWith("/") ? path : "/" + path;
        return normalized.endsWith("/") ? normalized.substring(0, normalized.length() - 1) : normalized;
    }

    private String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}

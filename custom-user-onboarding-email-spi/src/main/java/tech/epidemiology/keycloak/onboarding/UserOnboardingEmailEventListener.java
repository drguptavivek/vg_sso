package tech.epidemiology.keycloak.onboarding;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import org.jboss.logging.Logger;
import org.keycloak.authentication.actiontoken.execactions.ExecuteActionsActionToken;
import org.keycloak.common.util.Time;
import org.keycloak.email.EmailException;
import org.keycloak.email.EmailTemplateProvider;
import org.keycloak.events.Event;
import org.keycloak.events.EventListenerProvider;
import org.keycloak.events.admin.AdminEvent;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.keycloak.services.resources.LoginActionsService;

import jakarta.ws.rs.core.UriBuilder;

final class UserOnboardingEmailEventListener implements EventListenerProvider {
    private static final Logger LOG = Logger.getLogger(UserOnboardingEmailEventListener.class);

    private final KeycloakSession session;
    private final int tokenLifespanSeconds;
    private final Set<String> skipUsernames;
    private final Set<String> enabledRealms;

    UserOnboardingEmailEventListener(
        KeycloakSession session,
        int tokenLifespanSeconds,
        Set<String> skipUsernames,
        Set<String> enabledRealms
    ) {
        this.session = session;
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

        try {
            String link = buildExecuteActionsLink(realm, user, UserOnboardingEmailPolicy.REQUIRED_ACTIONS);
            LOG.infof(
                "USER_ONBOARDING: sending onboarding email user=%s realm=%s email=%s link=%s",
                user.getUsername(),
                realm.getName(),
                user.getEmail(),
                link
            );
            sendExecuteActionsEmail(realm, user, link, UserOnboardingEmailPolicy.REQUIRED_ACTIONS);
            LOG.infof("USER_ONBOARDING: sent onboarding email to user=%s realm=%s", user.getUsername(), realm.getName());

            String sentAt = Instant.now().toString();
            user.setSingleAttribute(UserOnboardingEmailPolicy.SENT_AT_ATTRIBUTE, sentAt);
            LOG.infof(
                "USER_ONBOARDING: saved user attribute %s=%s user=%s realm=%s",
                UserOnboardingEmailPolicy.SENT_AT_ATTRIBUTE,
                sentAt,
                user.getUsername(),
                realm.getName()
            );
        } catch (Exception e) {
            LOG.warnf(e, "USER_ONBOARDING: failed to send onboarding email to user=%s realm=%s", user.getUsername(), realm.getName());
        }
    }

    private void sendExecuteActionsEmail(RealmModel realm, UserModel user, String link, List<String> requiredActions) throws EmailException {
        session.getProvider(EmailTemplateProvider.class)
            .setAttribute("requiredActions", requiredActions)
            .setAttribute("IGNORE_ACCEPT_LANGUAGE_HEADER", Boolean.TRUE)
            .setRealm(realm)
            .setUser(user)
            .sendExecuteActions(link, TimeUnit.SECONDS.toMinutes(tokenLifespanSeconds));
    }

    private String buildExecuteActionsLink(RealmModel realm, UserModel user, List<String> requiredActions) {
        int expiration = Time.currentTime() + tokenLifespanSeconds;
        ExecuteActionsActionToken token = new ExecuteActionsActionToken(
            user.getId(),
            user.getEmail(),
            expiration,
            requiredActions,
            null,
            null
        );

        UriBuilder builder = LoginActionsService.actionTokenProcessor(session.getContext().getUri());
        builder.queryParam("key", token.serialize(session, realm, session.getContext().getUri()));
        String link = builder.build(realm.getName()).toString();
        return link;
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

}

package tech.epidemiology.keycloak.asyncmail;

import java.util.List;
import java.util.Map;

import org.keycloak.email.EmailException;
import org.keycloak.email.EmailTemplateProvider;
import org.keycloak.email.freemarker.FreeMarkerEmailTemplateProvider;
import org.keycloak.events.Event;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.OrganizationModel;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.keycloak.sessions.AuthenticationSessionModel;

public class AsyncEmailTemplateProvider extends FreeMarkerEmailTemplateProvider {

    public AsyncEmailTemplateProvider(KeycloakSession session) {
        super(session);
    }

    @Override
    public EmailTemplateProvider setAuthenticationSession(AuthenticationSessionModel authenticationSession) {
        return super.setAuthenticationSession(authenticationSession);
    }

    @Override
    public EmailTemplateProvider setRealm(RealmModel realm) {
        return super.setRealm(realm);
    }

    @Override
    public EmailTemplateProvider setUser(UserModel user) {
        return super.setUser(user);
    }

    @Override
    public EmailTemplateProvider setAttribute(String name, Object value) {
        return super.setAttribute(name, value);
    }

    @Override
    public void sendEvent(Event event) throws EmailException {
        AsyncEmailSenderProvider.withContext(
            AsyncEmailQueueRecord.Category.EVENT_NOTIFICATION,
            "event-" + event.getType().toString().toLowerCase() + ".ftl",
            event.getType().toString(),
            () -> super.sendEvent(event));
    }

    @Override
    public void sendPasswordReset(String link, long expirationInMinutes) throws EmailException {
        AsyncEmailSenderProvider.withContext(AsyncEmailQueueRecord.Category.PASSWORD_RESET, "password-reset.ftl", "", () ->
            super.sendPasswordReset(link, expirationInMinutes));
    }

    @Override
    public void sendSmtpTestEmail(Map<String, String> config, UserModel user) throws EmailException {
        AsyncEmailSenderProvider.withContext(AsyncEmailQueueRecord.Category.SMTP_TEST, "email-test.ftl", "", () ->
            super.sendSmtpTestEmail(config, user));
    }

    @Override
    public void sendConfirmIdentityBrokerLink(String link, long expirationInMinutes) throws EmailException {
        AsyncEmailSenderProvider.withContext(AsyncEmailQueueRecord.Category.GENERIC_TEMPLATE, "identity-provider-link.ftl", "",
            () -> super.sendConfirmIdentityBrokerLink(link, expirationInMinutes));
    }

    @Override
    public void sendExecuteActions(String link, long expirationInMinutes) throws EmailException {
        AsyncEmailSenderProvider.withContext(AsyncEmailQueueRecord.Category.EXECUTE_ACTIONS, "executeActions.ftl", "", () ->
            super.sendExecuteActions(link, expirationInMinutes));
    }

    @Override
    public void sendVerifyEmail(String link, long expirationInMinutes) throws EmailException {
        AsyncEmailSenderProvider.withContext(AsyncEmailQueueRecord.Category.VERIFY_EMAIL, "email-verification.ftl", "", () ->
            super.sendVerifyEmail(link, expirationInMinutes));
    }

    @Override
    public void sendOrgInviteEmail(OrganizationModel organization, String link, long expirationInMinutes) throws EmailException {
        AsyncEmailSenderProvider.withContext(AsyncEmailQueueRecord.Category.ORG_INVITE, "org-invite.ftl", "",
            () -> super.sendOrgInviteEmail(organization, link, expirationInMinutes));
    }

    @Override
    public void sendEmailUpdateConfirmation(String link, long expirationInMinutes, String address) throws EmailException {
        AsyncEmailSenderProvider.withContext(AsyncEmailQueueRecord.Category.EMAIL_UPDATE_CONFIRMATION, "email-update-confirmation.ftl", "",
            () -> super.sendEmailUpdateConfirmation(link, expirationInMinutes, address));
    }

    @Override
    public void send(String subjectFormatKey, String bodyTemplate, Map<String, Object> bodyAttributes) throws EmailException {
        AsyncEmailSenderProvider.withContext(AsyncEmailCategoryResolver.resolve(bodyTemplate), bodyTemplate, "",
            () -> super.send(subjectFormatKey, bodyTemplate, bodyAttributes));
    }

    @Override
    public void send(String subjectFormatKey, List<Object> subjectAttributes, String bodyTemplate, Map<String, Object> bodyAttributes)
        throws EmailException {
        AsyncEmailSenderProvider.withContext(AsyncEmailCategoryResolver.resolve(bodyTemplate), bodyTemplate, "",
            () -> super.send(subjectFormatKey, subjectAttributes, bodyTemplate, bodyAttributes));
    }
}

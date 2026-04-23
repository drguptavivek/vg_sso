package tech.epidemiology.keycloak.asyncmail;

public record AsyncEmailContext(
    String realmName,
    String recipient,
    AsyncEmailQueueRecord.Category category,
    String templateName,
    String eventType,
    String userId,
    String username,
    String subject,
    String payloadHtml,
    String payloadText
) {
    public AsyncEmailContext {
        if (realmName == null || realmName.isBlank()) {
            throw new IllegalArgumentException("realmName must not be blank");
        }
        recipient = recipient == null ? "" : recipient.trim();
        templateName = templateName == null ? "" : templateName.trim();
        eventType = eventType == null ? "" : eventType.trim();
        userId = userId == null ? "" : userId.trim();
        username = username == null ? "" : username.trim();
        subject = subject == null ? "" : subject.trim();
        payloadHtml = payloadHtml == null ? "" : payloadHtml;
        payloadText = payloadText == null ? "" : payloadText;
    }

    public String maskedRecipient() {
        return AsyncEmailMasking.maskEmail(recipient);
    }

    public String recipientDomain() {
        int at = recipient.indexOf('@');
        if (at < 0 || at + 1 >= recipient.length()) {
            return "";
        }
        return recipient.substring(at + 1).toLowerCase();
    }

    public static AsyncEmailContext withDefaults(
        String realmName,
        String recipient,
        String templateName,
        String eventType,
        String userId,
        String username,
        String subject
    ) {
        return new AsyncEmailContext(
            realmName,
            recipient,
            null,
            templateName,
            eventType,
            userId,
            username,
            subject,
            null,
            null
        );
    }
}

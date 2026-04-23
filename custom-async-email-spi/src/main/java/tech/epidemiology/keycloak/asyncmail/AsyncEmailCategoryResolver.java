package tech.epidemiology.keycloak.asyncmail;

import java.util.Locale;

public final class AsyncEmailCategoryResolver {
    private AsyncEmailCategoryResolver() {
    }

    public static AsyncEmailQueueRecord.Category resolve(String templateName) {
        return resolve(templateName, null);
    }

    public static AsyncEmailQueueRecord.Category resolve(String templateName, String eventType) {
        AsyncEmailQueueRecord.Category fromTemplate = resolveFromTemplate(templateName);
        if (fromTemplate != null) {
            return fromTemplate;
        }

        AsyncEmailQueueRecord.Category fromEvent = resolveFromEventType(eventType);
        if (fromEvent != null) {
            return fromEvent;
        }

        return AsyncEmailQueueRecord.Category.UNKNOWN;
    }

    private static AsyncEmailQueueRecord.Category resolveFromTemplate(String templateName) {
        if (templateName == null || templateName.isBlank()) {
            return null;
        }

        String normalized = templateName.toLowerCase(Locale.ROOT);
        if (normalized.contains("execute") && normalized.contains("action")) {
            return AsyncEmailQueueRecord.Category.EXECUTE_ACTIONS;
        }

        if (normalized.contains("verify") && normalized.contains("email")) {
            return AsyncEmailQueueRecord.Category.VERIFY_EMAIL;
        }

        if (normalized.contains("email") && normalized.contains("verification")) {
            return AsyncEmailQueueRecord.Category.VERIFY_EMAIL;
        }

        if (normalized.contains("password") && normalized.contains("reset")) {
            return AsyncEmailQueueRecord.Category.PASSWORD_RESET;
        }

        if (normalized.contains("email") && normalized.contains("update") && normalized.contains("confirm")) {
            return AsyncEmailQueueRecord.Category.EMAIL_UPDATE_CONFIRMATION;
        }

        if (normalized.contains("confirmation") && normalized.contains("email") && normalized.contains("update")) {
            return AsyncEmailQueueRecord.Category.EMAIL_UPDATE_CONFIRMATION;
        }

        if (normalized.contains("org") && normalized.contains("invite")) {
            return AsyncEmailQueueRecord.Category.ORG_INVITE;
        }

        if (normalized.contains("smtp") && normalized.contains("test")) {
            return AsyncEmailQueueRecord.Category.SMTP_TEST;
        }

        if (normalized.contains("event")) {
            return AsyncEmailQueueRecord.Category.EVENT_NOTIFICATION;
        }

        if (normalized.contains("template")) {
            return AsyncEmailQueueRecord.Category.GENERIC_TEMPLATE;
        }

        if (normalized.equals("verify-email") || normalized.equals("email-verification")) {
            return AsyncEmailQueueRecord.Category.VERIFY_EMAIL;
        }

        if (normalized.equals("password-reset") || normalized.equals("password-reset-fallback")) {
            return AsyncEmailQueueRecord.Category.PASSWORD_RESET;
        }

        return null;
    }

    private static AsyncEmailQueueRecord.Category resolveFromEventType(String eventType) {
        if (eventType == null || eventType.isBlank()) {
            return null;
        }
        String normalized = eventType.toLowerCase(Locale.ROOT);
        if (normalized.contains("verify") || normalized.contains("verify_email") || normalized.contains("verify-email")) {
            return AsyncEmailQueueRecord.Category.VERIFY_EMAIL;
        }

        if (normalized.contains("reset") || normalized.contains("password")) {
            return AsyncEmailQueueRecord.Category.PASSWORD_RESET;
        }

        if (normalized.contains("execute")) {
            return AsyncEmailQueueRecord.Category.EXECUTE_ACTIONS;
        }

        return null;
    }
}

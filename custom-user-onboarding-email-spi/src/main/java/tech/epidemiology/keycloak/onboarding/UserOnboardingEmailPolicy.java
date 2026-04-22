package tech.epidemiology.keycloak.onboarding;

import java.util.Arrays;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

import org.keycloak.Config;
import org.keycloak.events.admin.AdminEvent;
import org.keycloak.events.admin.OperationType;
import org.keycloak.events.admin.ResourceType;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;

final class UserOnboardingEmailPolicy {
    static final String SENT_AT_ATTRIBUTE = "onboarding_email_sent_at";
    static final List<String> REQUIRED_ACTIONS = List.of(
        "VERIFY_EMAIL",
        "UPDATE_PASSWORD",
        "CONFIGURE_TOTP",
        "CONFIGURE_RECOVERY_AUTHN_CODES"
    );
    static final int DEFAULT_TOKEN_LIFESPAN_SECONDS = 12 * 60 * 60;

    private UserOnboardingEmailPolicy() {
    }

    static boolean isUserCreateEvent(AdminEvent event) {
        return event != null
            && event.getResourceType() == ResourceType.USER
            && event.getOperationType() == OperationType.CREATE;
    }

    static String userIdFromResourcePath(String resourcePath) {
        if (resourcePath == null || !resourcePath.startsWith("users/")) {
            return null;
        }
        String suffix = resourcePath.substring("users/".length());
        if (suffix.isBlank() || suffix.contains("/")) {
            return null;
        }
        return suffix;
    }

    static boolean shouldSend(
        RealmModel realm,
        UserModel user,
        Set<String> skipUsernames,
        Set<String> enabledRealms
    ) {
        if (realm == null || user == null) {
            return false;
        }
        if ("master".equals(realm.getName())) {
            return false;
        }
        if (!enabledRealms.isEmpty() && !enabledRealms.contains(realm.getName())) {
            return false;
        }
        if (!user.isEnabled()) {
            return false;
        }
        String email = trimToNull(user.getEmail());
        if (email == null) {
            return false;
        }
        if (user.isEmailVerified()) {
            return false;
        }
        String username = trimToNull(user.getUsername());
        if (username != null && skipUsernames.contains(username)) {
            return false;
        }
        return trimToNull(user.getFirstAttribute(SENT_AT_ATTRIBUTE)) == null;
    }

    static boolean hasUsableSmtpConfig(RealmModel realm) {
        if (realm == null) {
            return false;
        }
        Map<String, String> smtpConfig = realm.getSmtpConfig();
        if (smtpConfig == null || smtpConfig.isEmpty()) {
            return false;
        }
        return trimToNull(smtpConfig.get("host")) != null
            && trimToNull(smtpConfig.get("from")) != null;
    }

    static int tokenLifespanSeconds(Config.Scope config) {
        Integer configured = config == null ? null : config.getInt("tokenLifespanSeconds", DEFAULT_TOKEN_LIFESPAN_SECONDS);
        return configured == null || configured <= 0 ? DEFAULT_TOKEN_LIFESPAN_SECONDS : configured;
    }

    static Set<String> skipUsernames(Config.Scope config, Map<String, String> env) {
        LinkedHashSet<String> usernames = new LinkedHashSet<>();
        addAll(usernames, config == null ? null : config.getArray("skipUsernames"));
        addIfPresent(usernames, env.get("KC_BOOTSTRAP_ADMIN_USERNAME"));
        addIfPresent(usernames, env.get("KC_MASTER_ADMIN_USER"));
        addIfPresent(usernames, env.get("KC_NEW_REALM_ADMIN_USER"));
        return Set.copyOf(usernames);
    }

    static Set<String> enabledRealms(Config.Scope config) {
        LinkedHashSet<String> realms = new LinkedHashSet<>();
        addAll(realms, config == null ? null : config.getArray("enabledRealms"));
        return Set.copyOf(realms);
    }

    private static void addAll(Collection<String> target, String[] values) {
        if (values == null) {
            return;
        }
        Arrays.stream(values)
            .map(UserOnboardingEmailPolicy::trimToNull)
            .filter(Objects::nonNull)
            .forEach(target::add);
    }

    private static void addIfPresent(Collection<String> target, String value) {
        String trimmed = trimToNull(value);
        if (trimmed != null) {
            target.add(trimmed);
        }
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}

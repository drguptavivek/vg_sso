package tech.epidemiology.keycloak.onboarding;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Proxy;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.keycloak.Config;
import org.keycloak.events.admin.AdminEvent;
import org.keycloak.events.admin.OperationType;
import org.keycloak.events.admin.ResourceType;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;

class UserOnboardingEmailPolicyTest {

    @Test
    void identifiesUserCreateEvent() {
        AdminEvent event = new AdminEvent();
        event.setResourceType(ResourceType.USER);
        event.setOperationType(OperationType.CREATE);

        assertThat(UserOnboardingEmailPolicy.isUserCreateEvent(event)).isTrue();
    }

    @Test
    void parsesUserIdFromResourcePath() {
        assertThat(UserOnboardingEmailPolicy.userIdFromResourcePath("users/abc123")).isEqualTo("abc123");
        assertThat(UserOnboardingEmailPolicy.userIdFromResourcePath("users/abc/groups/1")).isNull();
        assertThat(UserOnboardingEmailPolicy.userIdFromResourcePath("clients/abc")).isNull();
    }

    @Test
    void skipsMasterRealmAndAlreadyMarkedUsers() {
        RealmModel realm = realm("master", Map.of("host", "smtp.example.org", "from", "noreply@example.org"));
        UserModel user = user("alice", "alice@example.org", true, false, Map.of(
            UserOnboardingEmailPolicy.SENT_AT_ATTRIBUTE, "2025-01-01T00:00:00Z"
        ));

        assertThat(UserOnboardingEmailPolicy.shouldSend(realm, user, Set.of(), Set.of())).isFalse();
    }

    @Test
    void requiresEnabledUserEmailAndUnverifiedAddress() {
        RealmModel realm = realm("aiims-new-delhi", Map.of("host", "smtp.example.org", "from", "noreply@example.org"));

        assertThat(UserOnboardingEmailPolicy.shouldSend(
            realm,
            user("alice", "alice@example.org", true, false, Map.of()),
            Set.of(),
            Set.of()
        )).isTrue();

        assertThat(UserOnboardingEmailPolicy.shouldSend(
            realm,
            user("alice", null, true, false, Map.of()),
            Set.of(),
            Set.of()
        )).isFalse();

        assertThat(UserOnboardingEmailPolicy.shouldSend(
            realm,
            user("alice", "alice@example.org", false, false, Map.of()),
            Set.of(),
            Set.of()
        )).isFalse();

        assertThat(UserOnboardingEmailPolicy.shouldSend(
            realm,
            user("alice", "alice@example.org", true, true, Map.of()),
            Set.of(),
            Set.of()
        )).isFalse();
    }

    @Test
    void honorsSkipUsernamesAndEnabledRealms() {
        RealmModel realm = realm("aiims-new-delhi", Map.of("host", "smtp.example.org", "from", "noreply@example.org"));
        UserModel user = user("aiims_realm_admin", "admin@example.org", true, false, Map.of());

        assertThat(UserOnboardingEmailPolicy.shouldSend(
            realm,
            user,
            Set.of("aiims_realm_admin"),
            Set.of()
        )).isFalse();

        assertThat(UserOnboardingEmailPolicy.shouldSend(
            realm,
            user("alice", "alice@example.org", true, false, Map.of()),
            Set.of(),
            Set.of("other-realm")
        )).isFalse();
    }

    @Test
    void checksSmtpRequirements() {
        assertThat(UserOnboardingEmailPolicy.hasUsableSmtpConfig(
            realm("aiims-new-delhi", Map.of("host", "smtp.example.org", "from", "noreply@example.org"))
        )).isTrue();
        assertThat(UserOnboardingEmailPolicy.hasUsableSmtpConfig(
            realm("aiims-new-delhi", Map.of("host", "smtp.example.org"))
        )).isFalse();
    }

    @Test
    void buildsSkipUsernamesFromConfigAndEnv() {
        TestScope scope = new TestScope(Map.of(), Map.of("skipUsernames", new String[] {"custom-admin", "  "} ));

        Set<String> usernames = UserOnboardingEmailPolicy.skipUsernames(scope, Map.of(
            "KC_BOOTSTRAP_ADMIN_USERNAME", "ssoadmin",
            "KC_MASTER_ADMIN_USER", "masteradmin",
            "KC_NEW_REALM_ADMIN_USER", "realmadmin"
        ));

        assertThat(usernames).containsExactly("custom-admin", "ssoadmin", "masteradmin", "realmadmin");
    }

    @Test
    void usesConfiguredLifespanWithDefaultFallback() {
        assertThat(UserOnboardingEmailPolicy.tokenLifespanSeconds(new TestScope(Map.of("tokenLifespanSeconds", 900), Map.of())))
            .isEqualTo(900);
        assertThat(UserOnboardingEmailPolicy.tokenLifespanSeconds(new TestScope(Map.of("tokenLifespanSeconds", 0), Map.of())))
            .isEqualTo(UserOnboardingEmailPolicy.DEFAULT_TOKEN_LIFESPAN_SECONDS);
    }

    private RealmModel realm(String name, Map<String, String> smtpConfig) {
        return (RealmModel) Proxy.newProxyInstance(
            RealmModel.class.getClassLoader(),
            new Class<?>[] {RealmModel.class},
            (proxy, method, args) -> switch (method.getName()) {
                case "getName" -> name;
                case "getSmtpConfig" -> smtpConfig;
                default -> throw new UnsupportedOperationException(method.getName());
            }
        );
    }

    private UserModel user(String username, String email, boolean enabled, boolean emailVerified, Map<String, String> attributes) {
        return (UserModel) Proxy.newProxyInstance(
            UserModel.class.getClassLoader(),
            new Class<?>[] {UserModel.class},
            (proxy, method, args) -> switch (method.getName()) {
                case "getUsername" -> username;
                case "getEmail" -> email;
                case "isEnabled" -> enabled;
                case "isEmailVerified" -> emailVerified;
                case "getFirstAttribute" -> attributes.get(args[0]);
                default -> throw new UnsupportedOperationException(method.getName());
            }
        );
    }

    private record TestScope(Map<String, Integer> ints, Map<String, String[]> arrays) implements Config.Scope {
        @Override
        public String get(String key) {
            return null;
        }

        @Override
        public String get(String key, String defaultValue) {
            return defaultValue;
        }

        @Override
        public String[] getArray(String key) {
            return arrays.get(key);
        }

        @Override
        public Integer getInt(String key, Integer defaultValue) {
            return ints.getOrDefault(key, defaultValue);
        }

        @Override
        public Long getLong(String key, Long defaultValue) {
            return defaultValue;
        }

        @Override
        public Boolean getBoolean(String key, Boolean defaultValue) {
            return defaultValue;
        }

        @Override
        public Config.Scope scope(String... scope) {
            return this;
        }

        @Override
        public java.util.Set<String> getPropertyNames() {
            return java.util.Set.of();
        }

        @Override
        public Config.Scope root() {
            return this;
        }
    }
}

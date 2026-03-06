package tech.epidemiology.keycloak.password;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import org.keycloak.models.PasswordPolicy;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.keycloak.policy.PasswordPolicyProvider;
import org.keycloak.policy.PolicyError;

public class ForbiddenTermsPasswordPolicyProvider implements PasswordPolicyProvider {
    private static final String ERROR_MESSAGE = "invalidPasswordBlacklistedMessage";

    @Override
    public PolicyError validate(RealmModel realm, UserModel user, String password) {
        if (realm == null || password == null || password.isBlank()) {
            return null;
        }

        PasswordPolicy policy = realm.getPasswordPolicy();
        if (policy == null) {
            return null;
        }

        String rawConfig = policy.getPolicyConfig(ForbiddenTermsPasswordPolicyProviderFactory.ID);
        if (rawConfig == null || rawConfig.isBlank()) {
            return null;
        }

        return containsForbiddenTerm(password, rawConfig) ? new PolicyError(ERROR_MESSAGE) : null;
    }

    @Override
    public PolicyError validate(String username, String password) {
        return null;
    }

    @Override
    public Object parseConfig(String value) {
        return value == null ? "" : value.trim();
    }

    @Override
    public void close() {
        // No-op.
    }

    static boolean containsForbiddenTerm(String password, String config) {
        if (password == null || config == null) {
            return false;
        }

        String passwordLower = password.toLowerCase(Locale.ROOT);
        String passwordNormalized = normalize(passwordLower);

        for (String term : splitTerms(config)) {
            if (term.isBlank()) {
                continue;
            }

            String lowerTerm = term.toLowerCase(Locale.ROOT);
            if (passwordLower.contains(lowerTerm)) {
                return true;
            }

            String normalizedTerm = normalize(lowerTerm);
            if (!normalizedTerm.isBlank() && passwordNormalized.contains(normalizedTerm)) {
                return true;
            }
        }

        return false;
    }

    static List<String> splitTerms(String config) {
        List<String> terms = new ArrayList<>();
        if (config == null || config.isBlank()) {
            return terms;
        }

        for (String token : config.split("[,;\\n\\r]+")) {
            String cleaned = token.trim();
            if (!cleaned.isEmpty()) {
                terms.add(cleaned);
            }
        }
        return terms;
    }

    private static String normalize(String value) {
        return value.replaceAll("[^a-z0-9]", "");
    }
}

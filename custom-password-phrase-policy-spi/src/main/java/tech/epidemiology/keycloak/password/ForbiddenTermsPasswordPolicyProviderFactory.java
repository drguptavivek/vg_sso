package tech.epidemiology.keycloak.password;

import org.keycloak.Config;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.policy.PasswordPolicyProvider;
import org.keycloak.policy.PasswordPolicyProviderFactory;

public class ForbiddenTermsPasswordPolicyProviderFactory implements PasswordPolicyProviderFactory {
    public static final String ID = "forbiddenTerms";

    @Override
    public String getId() {
        return ID;
    }

    @Override
    public PasswordPolicyProvider create(KeycloakSession session) {
        return new ForbiddenTermsPasswordPolicyProvider();
    }

    @Override
    public void init(Config.Scope config) {
        // No global provider config; terms are realm-specific via password policy UI.
    }

    @Override
    public void postInit(KeycloakSessionFactory factory) {
        // No-op.
    }

    @Override
    public String getDisplayName() {
        return "Forbidden Terms";
    }

    @Override
    public String getConfigType() {
        return PasswordPolicyProvider.STRING_CONFIG_TYPE;
    }

    @Override
    public String getDefaultConfigValue() {
        return "password,admin,welcome";
    }

    @Override
    public boolean isMultiplSupported() {
        return false;
    }

    @Override
    public void close() {
        // No-op.
    }
}

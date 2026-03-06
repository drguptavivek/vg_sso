package tech.epidemiology.keycloak.expiry;

import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.keycloak.Config;
import org.keycloak.authentication.Authenticator;
import org.keycloak.authentication.AuthenticatorFactory;
import org.keycloak.authentication.ConfigurableAuthenticatorFactory;
import org.keycloak.models.AuthenticationExecutionModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.provider.ProviderConfigProperty;

public class AccountExpiryAuthenticatorFactory implements AuthenticatorFactory, ConfigurableAuthenticatorFactory {

  public static final String PROVIDER_ID = "account-expiry-check-authenticator";
  private static final AccountExpiryAuthenticator SINGLETON = new AccountExpiryAuthenticator();
  private static final AuthenticationExecutionModel.Requirement[] REQUIREMENTS = {
      AuthenticationExecutionModel.Requirement.REQUIRED,
      AuthenticationExecutionModel.Requirement.ALTERNATIVE,
      AuthenticationExecutionModel.Requirement.DISABLED
  };

  @Override
  public String getId() {
    return PROVIDER_ID;
  }

  @Override
  public String getDisplayType() {
    return "Account Expiry Check (Custom)";
  }

  @Override
  public String getHelpText() {
    return "Stops authentication when local date expiry is reached using account_expiry_date + timezone.";
  }

  @Override
  public String getReferenceCategory() {
    return "account-expiry";
  }

  @Override
  public boolean isConfigurable() {
    return true;
  }

  @Override
  public AuthenticationExecutionModel.Requirement[] getRequirementChoices() {
    return REQUIREMENTS;
  }

  @Override
  public boolean isUserSetupAllowed() {
    return false;
  }

  @Override
  public List<ProviderConfigProperty> getConfigProperties() {
    List<ProviderConfigProperty> props = new ArrayList<>();
    props.add(prop("expiry.date.attr.name", "Date expiry attribute name", ProviderConfigProperty.STRING_TYPE,
        AccountExpiryUtil.ATTR_EXPIRY_DATE));
    props.add(prop("expiry.timezone.attr.name", "Timezone attribute name", ProviderConfigProperty.STRING_TYPE,
        AccountExpiryUtil.ATTR_EXPIRY_TIMEZONE));
    props.add(timezoneDropdownProp("expiry.default.timezone", "Default timezone (optional override)",
        AccountExpiryUtil.DEFAULT_TIMEZONE));
    props.add(prop("expiry.date.end.of.day.inclusive", "Date expires at local end-of-day", ProviderConfigProperty.BOOLEAN_TYPE,
        "true"));
    props.add(prop("expiry.block.on.parse.error", "Block auth on invalid expiry format", ProviderConfigProperty.BOOLEAN_TYPE,
        "true"));
    props.add(prop("expiry.deny.message", "Message shown when account is expired", ProviderConfigProperty.STRING_TYPE,
        "Account expired. Please contact your administrator."));
    return props;
  }

  @Override
  public Authenticator create(KeycloakSession session) {
    return SINGLETON;
  }

  @Override
  public void init(Config.Scope config) {
  }

  @Override
  public void postInit(KeycloakSessionFactory factory) {
  }

  @Override
  public void close() {
  }

  private static ProviderConfigProperty prop(String name, String label, String type, String defaultValue) {
    ProviderConfigProperty p = new ProviderConfigProperty();
    p.setName(name);
    p.setLabel(label);
    p.setType(type);
    p.setDefaultValue(defaultValue);
    return p;
  }

  private static ProviderConfigProperty timezoneDropdownProp(String name, String label, String defaultValue) {
    ProviderConfigProperty p = new ProviderConfigProperty();
    p.setName(name);
    p.setLabel(label);
    p.setType(ProviderConfigProperty.LIST_TYPE);
    p.setDefaultValue(defaultValue);
    List<String> zones = ZoneId.getAvailableZoneIds().stream()
        .sorted(Comparator.naturalOrder())
        .toList();
    p.setOptions(zones);
    return p;
  }
}

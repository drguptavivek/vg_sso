package tech.epidemiology.keycloak.auth;

import java.util.ArrayList;
import java.util.List;
import org.keycloak.Config;
import org.keycloak.authentication.Authenticator;
import org.keycloak.authentication.AuthenticatorFactory;
import org.keycloak.authentication.ConfigurableAuthenticatorFactory;
import org.keycloak.models.AuthenticationExecutionModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.provider.ProviderConfigProperty;

public class PhoneOtpAuthenticatorFactory implements AuthenticatorFactory, ConfigurableAuthenticatorFactory {

  public static final String PROVIDER_ID = "phone-otp-authenticator";
  private static final PhoneOtpAuthenticator SINGLETON = new PhoneOtpAuthenticator();
  private static final AuthenticationExecutionModel.Requirement[] REQUIREMENTS = {
      AuthenticationExecutionModel.Requirement.REQUIRED,
      AuthenticationExecutionModel.Requirement.DISABLED
  };

  @Override
  public String getId() {
    return PROVIDER_ID;
  }

  @Override
  public String getDisplayType() {
    return "Phone OTP Authenticator (Custom)";
  }

  @Override
  public String getHelpText() {
    return "Sends OTP to configured HTTP endpoint and verifies code once per user.";
  }

  @Override
  public String getReferenceCategory() {
    return "phone-otp";
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
    props.add(prop("otp.endpoint.primary", "Primary OTP endpoint URL", ProviderConfigProperty.STRING_TYPE));
    props.add(prop("otp.endpoint.backup", "Backup OTP endpoint URL", ProviderConfigProperty.STRING_TYPE));
    props.add(prop("otp.auth.bearer", "Bearer token for OTP API", ProviderConfigProperty.PASSWORD));
    props.add(prop("otp.sms.message.template", "SMS message template", ProviderConfigProperty.STRING_TYPE,
        "OTP For VG SSO Verification is: {{otp}}"));
    props.add(prop("otp.sms.mobile.field", "SMS mobile field name", ProviderConfigProperty.STRING_TYPE, "mobile"));
    props.add(prop("otp.sms.message.field", "SMS message field name", ProviderConfigProperty.STRING_TYPE, "message"));
    props.add(prop("otp.length", "OTP length", ProviderConfigProperty.STRING_TYPE, "6"));
    props.add(prop("otp.ttl.seconds", "OTP TTL seconds", ProviderConfigProperty.STRING_TYPE, "300"));
    props.add(prop("otp.max.attempts", "Max OTP verify attempts", ProviderConfigProperty.STRING_TYPE, "5"));
    props.add(prop("otp.retry.max", "HTTP retry count per endpoint", ProviderConfigProperty.STRING_TYPE, "2"));
    props.add(prop("otp.retry.backoff.ms", "Retry backoff base ms", ProviderConfigProperty.STRING_TYPE, "500"));
    props.add(prop("otp.request.token.header", "Header key for generated OTP token", ProviderConfigProperty.STRING_TYPE, "X-OTP-Token"));
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

  private static ProviderConfigProperty prop(String name, String label, String type) {
    return prop(name, label, type, null);
  }

  private static ProviderConfigProperty prop(String name, String label, String type, String defaultValue) {
    ProviderConfigProperty p = new ProviderConfigProperty();
    p.setName(name);
    p.setLabel(label);
    p.setType(type);
    p.setDefaultValue(defaultValue);
    return p;
  }
}

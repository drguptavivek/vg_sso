package tech.epidemiology.keycloak.expiry;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.ProtocolMapperModel;
import org.keycloak.models.UserSessionModel;
import org.keycloak.protocol.ProtocolMapper;
import org.keycloak.protocol.oidc.mappers.AbstractOIDCProtocolMapper;
import org.keycloak.protocol.oidc.mappers.OIDCAccessTokenMapper;
import org.keycloak.protocol.oidc.mappers.OIDCAttributeMapperHelper;
import org.keycloak.protocol.oidc.mappers.OIDCIDTokenMapper;
import org.keycloak.protocol.oidc.mappers.UserInfoTokenMapper;
import org.keycloak.provider.ProviderConfigProperty;
import org.keycloak.representations.IDToken;

public class AccountExpiryWarningProtocolMapper extends AbstractOIDCProtocolMapper
    implements OIDCAccessTokenMapper, OIDCIDTokenMapper, UserInfoTokenMapper {

  public static final String PROVIDER_ID = "oidc-account-expiry-warning-mapper";
  private static final String CFG_DATE_ATTR_NAME = "expiry.date.attr.name";
  private static final String CFG_TIMEZONE_ATTR_NAME = "expiry.timezone.attr.name";
  private static final String CFG_DEFAULT_TIMEZONE = "expiry.default.timezone";
  private static final String CFG_WARNING_WINDOW_DAYS = "warning.window.days";

  private static final List<ProviderConfigProperty> CONFIG_PROPERTIES = new ArrayList<>();

  static {
    OIDCAttributeMapperHelper.addTokenClaimNameConfig(CONFIG_PROPERTIES);
    OIDCAttributeMapperHelper.addIncludeInTokensConfig(CONFIG_PROPERTIES, AccountExpiryWarningProtocolMapper.class);

    CONFIG_PROPERTIES.add(property(
        CFG_DATE_ATTR_NAME,
        "Date expiry attribute name",
        ProviderConfigProperty.STRING_TYPE,
        AccountExpiryUtil.ATTR_EXPIRY_DATE,
        "User attribute that stores local expiry date."));
    CONFIG_PROPERTIES.add(property(
        CFG_TIMEZONE_ATTR_NAME,
        "Timezone attribute name",
        ProviderConfigProperty.STRING_TYPE,
        AccountExpiryUtil.ATTR_EXPIRY_TIMEZONE,
        "User attribute that stores the IANA timezone."));
    CONFIG_PROPERTIES.add(property(
        CFG_DEFAULT_TIMEZONE,
        "Default timezone override",
        ProviderConfigProperty.STRING_TYPE,
        "",
        "Optional timezone fallback before realm default."));
    CONFIG_PROPERTIES.add(property(
        CFG_WARNING_WINDOW_DAYS,
        "Warning window days",
        ProviderConfigProperty.STRING_TYPE,
        String.valueOf(AccountExpiryUtil.DEFAULT_WARNING_WINDOW_DAYS),
        "Number of days before expiry that should set warning=true."));
  }

  @Override
  public String getId() {
    return PROVIDER_ID;
  }

  @Override
  public String getDisplayType() {
    return "Account Expiry Warning Mapper";
  }

  @Override
  public String getDisplayCategory() {
    return TOKEN_MAPPER_CATEGORY;
  }

  @Override
  public String getHelpText() {
    return "Adds account expiry warning metadata for banner rendering and reminder logic.";
  }

  @Override
  public List<ProviderConfigProperty> getConfigProperties() {
    return CONFIG_PROPERTIES;
  }

  @Override
  protected void setClaim(
      IDToken token,
      ProtocolMapperModel mappingModel,
      UserSessionModel userSession,
      KeycloakSession keycloakSession,
      org.keycloak.models.ClientSessionContext clientSessionCtx) {
    if (userSession == null || userSession.getUser() == null) {
      return;
    }

    int warningWindowDays = parseWarningWindowDays(mappingModel);
    String dateAttrName = getConfig(mappingModel, CFG_DATE_ATTR_NAME, AccountExpiryUtil.ATTR_EXPIRY_DATE);
    String timezoneAttrName = getConfig(mappingModel, CFG_TIMEZONE_ATTR_NAME, AccountExpiryUtil.ATTR_EXPIRY_TIMEZONE);
    String defaultTimezone = getConfig(mappingModel, CFG_DEFAULT_TIMEZONE, "");

    Map<String, Object> claim = new LinkedHashMap<>();
    claim.put("configured", false);
    claim.put("warning", false);
    claim.put("expired", false);
    claim.put("warningWindowDays", warningWindowDays);

    try {
      AccountExpiryUtil.ExpiryStatus status = AccountExpiryUtil.resolveExpiryStatus(
          userSession.getUser(),
          keycloakSession.getContext().getRealm(),
          dateAttrName,
          timezoneAttrName,
          defaultTimezone,
          true,
          Instant.now());
      if (status == null) {
        OIDCAttributeMapperHelper.mapClaim(token, mappingModel, claim);
        return;
      }

      claim.put("configured", true);
      claim.put("warning", AccountExpiryUtil.isWithinWarningWindow(status.daysRemaining(), warningWindowDays) && !status.expired());
      claim.put("expired", status.expired());
      claim.put("daysRemaining", status.daysRemaining());
      claim.put("localDate", status.localDate());
      claim.put("timeZone", status.timeZone());
      claim.put("expiryUtc", status.expiryInstant().toString());
    } catch (Exception e) {
      claim.put("configured", true);
      claim.put("misconfigured", true);
    }

    OIDCAttributeMapperHelper.mapClaim(token, mappingModel, claim);
  }

  private static ProviderConfigProperty property(
      String name,
      String label,
      String type,
      String defaultValue,
      String helpText) {
    ProviderConfigProperty property = new ProviderConfigProperty();
    property.setName(name);
    property.setLabel(label);
    property.setType(type);
    property.setDefaultValue(defaultValue);
    property.setHelpText(helpText);
    return property;
  }

  private static String getConfig(ProtocolMapperModel model, String key, String defaultValue) {
    if (model == null || model.getConfig() == null) {
      return defaultValue;
    }
    return model.getConfig().getOrDefault(key, defaultValue);
  }

  private static int parseWarningWindowDays(ProtocolMapperModel model) {
    try {
      return AccountExpiryUtil.normalizeWarningWindowDays(
          Integer.parseInt(getConfig(model, CFG_WARNING_WINDOW_DAYS, String.valueOf(AccountExpiryUtil.DEFAULT_WARNING_WINDOW_DAYS))));
    } catch (NumberFormatException e) {
      return AccountExpiryUtil.DEFAULT_WARNING_WINDOW_DAYS;
    }
  }

  public static ProtocolMapperModel create(
      String name,
      String claimName,
      int warningWindowDays,
      boolean includeInAccessToken,
      boolean includeInIdToken,
      boolean includeInUserInfo) {
    ProtocolMapperModel mapper = new ProtocolMapperModel();
    mapper.setName(name);
    mapper.setProtocolMapper(PROVIDER_ID);
    mapper.setProtocol("openid-connect");

    Map<String, String> config = new LinkedHashMap<>();
    config.put("claim.name", claimName);
    config.put("jsonType.label", "JSON");
    config.put(CFG_DATE_ATTR_NAME, AccountExpiryUtil.ATTR_EXPIRY_DATE);
    config.put(CFG_TIMEZONE_ATTR_NAME, AccountExpiryUtil.ATTR_EXPIRY_TIMEZONE);
    config.put(CFG_DEFAULT_TIMEZONE, "");
    config.put(CFG_WARNING_WINDOW_DAYS, String.valueOf(AccountExpiryUtil.normalizeWarningWindowDays(warningWindowDays)));
    config.put("access.token.claim", String.valueOf(includeInAccessToken));
    config.put("id.token.claim", String.valueOf(includeInIdToken));
    config.put("userinfo.token.claim", String.valueOf(includeInUserInfo));
    mapper.setConfig(config);
    return mapper;
  }
}

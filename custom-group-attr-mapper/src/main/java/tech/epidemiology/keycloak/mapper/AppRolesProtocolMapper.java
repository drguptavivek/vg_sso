package tech.epidemiology.keycloak.mapper;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.keycloak.models.GroupModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.ProtocolMapperModel;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserSessionModel;
import org.keycloak.models.utils.KeycloakModelUtils;
import org.keycloak.protocol.oidc.mappers.AbstractOIDCProtocolMapper;
import org.keycloak.protocol.oidc.mappers.OIDCAccessTokenMapper;
import org.keycloak.protocol.oidc.mappers.OIDCAttributeMapperHelper;
import org.keycloak.protocol.oidc.mappers.OIDCIDTokenMapper;
import org.keycloak.protocol.oidc.mappers.UserInfoTokenMapper;
import org.keycloak.provider.ProviderConfigProperty;
import org.keycloak.representations.IDToken;

/**
 * Emits a flattened list claim for app role groups under:
 *   /AppRoles/{current-client-id}/...
 *
 * Example output for current client "temp222":
 *   "appRoles": ["doctor", "billing/senior"]
 */
public class AppRolesProtocolMapper extends AbstractOIDCProtocolMapper
    implements OIDCAccessTokenMapper, OIDCIDTokenMapper, UserInfoTokenMapper {

  public static final String PROVIDER_ID = "oidc-approles-mapper";
  private static final String CFG_APP_ROLES_ROOT = "approles.root.group";

  private static final List<ProviderConfigProperty> CONFIG_PROPERTIES = new ArrayList<>();

  static {
    OIDCAttributeMapperHelper.addTokenClaimNameConfig(CONFIG_PROPERTIES);
    OIDCAttributeMapperHelper.addIncludeInTokensConfig(CONFIG_PROPERTIES, AppRolesProtocolMapper.class);

    ProviderConfigProperty rootGroup = new ProviderConfigProperty();
    rootGroup.setName(CFG_APP_ROLES_ROOT);
    rootGroup.setLabel("AppRoles root group");
    rootGroup.setType(ProviderConfigProperty.STRING_TYPE);
    rootGroup.setDefaultValue("AppRoles");
    rootGroup.setHelpText("Root Keycloak group that contains per-client app role trees.");
    CONFIG_PROPERTIES.add(rootGroup);
  }

  @Override
  public String getId() {
    return PROVIDER_ID;
  }

  @Override
  public String getDisplayType() {
    return "AppRoles Mapper";
  }

  @Override
  public String getDisplayCategory() {
    return TOKEN_MAPPER_CATEGORY;
  }

  @Override
  public String getHelpText() {
    return "Adds a flattened list of role/subgroup paths from /AppRoles/{clientId}/... to token claim.";
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

    String claimName = mappingModel.getConfig().getOrDefault("claim.name", "appRoles");
    String rootGroupName = mappingModel.getConfig().getOrDefault(CFG_APP_ROLES_ROOT, "AppRoles");
    String clientId = resolveCurrentClientId(clientSessionCtx);
    RealmModel realm = keycloakSession.getContext().getRealm();

    List<String> appRoles = new ArrayList<>();
    if (realm != null && clientId != null && !clientId.isBlank()) {
      GroupModel appRolesRoot = keycloakSession.groups().getGroupByName(realm, null, rootGroupName);
      if (appRolesRoot != null) {
        String prefix = "/" + rootGroupName + "/" + clientId + "/";
        appRoles = userSession.getUser().getGroupsStream()
            .map(KeycloakModelUtils::buildGroupPath)
            .filter(path -> path != null && path.startsWith(prefix))
            .map(path -> path.substring(prefix.length()))
            .filter(relative -> !relative.isBlank())
            .distinct()
            .sorted(String.CASE_INSENSITIVE_ORDER)
            .collect(Collectors.toList());
      }
    }

    // Respect configured claim name while still using OIDC helper for standard behavior.
    Map<String, String> cfg = mappingModel.getConfig();
    if (cfg == null) {
      cfg = new LinkedHashMap<>();
      mappingModel.setConfig(cfg);
    }
    if (!cfg.containsKey("claim.name")) {
      cfg.put("claim.name", claimName);
    }
    OIDCAttributeMapperHelper.mapClaim(token, mappingModel, appRoles);
  }

  private String resolveCurrentClientId(org.keycloak.models.ClientSessionContext clientSessionCtx) {
    try {
      if (clientSessionCtx == null || clientSessionCtx.getClientSession() == null) return null;
      if (clientSessionCtx.getClientSession().getClient() == null) return null;
      return clientSessionCtx.getClientSession().getClient().getClientId();
    } catch (Exception ignored) {
      return null;
    }
  }
}


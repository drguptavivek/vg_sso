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
import org.keycloak.models.UserSessionModel;
import org.keycloak.models.utils.KeycloakModelUtils;
import org.keycloak.protocol.ProtocolMapper;
import org.keycloak.protocol.oidc.mappers.AbstractOIDCProtocolMapper;
import org.keycloak.protocol.oidc.mappers.OIDCAccessTokenMapper;
import org.keycloak.protocol.oidc.mappers.OIDCAttributeMapperHelper;
import org.keycloak.protocol.oidc.mappers.OIDCIDTokenMapper;
import org.keycloak.protocol.oidc.mappers.UserInfoTokenMapper;
import org.keycloak.provider.ProviderConfigProperty;
import org.keycloak.representations.IDToken;

public class GroupAttributesProtocolMapper extends AbstractOIDCProtocolMapper
    implements OIDCAccessTokenMapper, OIDCIDTokenMapper, UserInfoTokenMapper {

  public static final String PROVIDER_ID = "oidc-group-attributes-mapper";
  private static final String CFG_FULL_PATH = "full.path";
  private static final String CFG_INCLUDE_ATTRIBUTES = "include.attributes";

  private static final List<ProviderConfigProperty> CONFIG_PROPERTIES = new ArrayList<>();

  static {
    OIDCAttributeMapperHelper.addTokenClaimNameConfig(CONFIG_PROPERTIES);
    OIDCAttributeMapperHelper.addIncludeInTokensConfig(CONFIG_PROPERTIES, GroupAttributesProtocolMapper.class);

    ProviderConfigProperty fullPath = new ProviderConfigProperty();
    fullPath.setName(CFG_FULL_PATH);
    fullPath.setLabel("Full group path");
    fullPath.setType(ProviderConfigProperty.BOOLEAN_TYPE);
    fullPath.setDefaultValue("true");
    fullPath.setHelpText("If true, includes full group path (e.g. /Departments/Cardiology).");
    CONFIG_PROPERTIES.add(fullPath);

    ProviderConfigProperty includeAttrs = new ProviderConfigProperty();
    includeAttrs.setName(CFG_INCLUDE_ATTRIBUTES);
    includeAttrs.setLabel("Include group attributes");
    includeAttrs.setType(ProviderConfigProperty.BOOLEAN_TYPE);
    includeAttrs.setDefaultValue("true");
    includeAttrs.setHelpText("If true, includes Keycloak group attributes.");
    CONFIG_PROPERTIES.add(includeAttrs);
  }

  @Override
  public String getId() {
    return PROVIDER_ID;
  }

  @Override
  public String getDisplayType() {
    return "Group Attributes Mapper";
  }

  @Override
  public String getDisplayCategory() {
    return TOKEN_MAPPER_CATEGORY;
  }

  @Override
  public String getHelpText() {
    return "Adds user's groups with optional group attributes into a JSON token claim.";
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

    boolean fullPath = Boolean.parseBoolean(mappingModel.getConfig().getOrDefault(CFG_FULL_PATH, "true"));
    boolean includeAttrs =
        Boolean.parseBoolean(mappingModel.getConfig().getOrDefault(CFG_INCLUDE_ATTRIBUTES, "true"));

    Map<String, Map<String, Object>> groupsByPath = new LinkedHashMap<>();
    List<GroupModel> directGroups = userSession.getUser().getGroupsStream().collect(Collectors.toList());
    for (GroupModel group : directGroups) {
      addGroupWithAncestors(groupsByPath, group, fullPath, includeAttrs);
    }

    List<Map<String, Object>> groups = groupsByPath.values().stream()
        .filter(group -> isRootNode(group, groupsByPath))
        .sorted(groupNodeComparator())
        .map(this::sanitizeGroupJson)
        .collect(Collectors.toList());

    OIDCAttributeMapperHelper.mapClaim(token, mappingModel, groups);
  }

  private void addGroupWithAncestors(
      Map<String, Map<String, Object>> groupsByPath,
      GroupModel group,
      boolean fullPath,
      boolean includeAttrs) {
    String path = KeycloakModelUtils.buildGroupPath(group);
    Map<String, Object> current = groupsByPath.get(path);
    if (current == null) {
      current = toGroupJson(group, fullPath, includeAttrs);
      groupsByPath.put(path, current);
    }

    GroupModel parent = group.getParent();
    if (parent == null) {
      return;
    }

    addGroupWithAncestors(groupsByPath, parent, fullPath, includeAttrs);
    String parentPath = KeycloakModelUtils.buildGroupPath(parent);
    Map<String, Object> parentNode = groupsByPath.get(parentPath);
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> children = (List<Map<String, Object>>) parentNode.get("grps");
    boolean alreadyPresent = children.stream().anyMatch(child -> path.equals(child.get("path")));
    if (!alreadyPresent) {
      children.add(current);
    }
  }

  private boolean isRootNode(Map<String, Object> group, Map<String, Map<String, Object>> groupsByPath) {
    String path = (String) group.get("path");
    int lastSlash = path.lastIndexOf('/');
    if (lastSlash <= 0) {
      return true;
    }
    String parentPath = path.substring(0, lastSlash);
    return !groupsByPath.containsKey(parentPath);
  }

  private Map<String, Object> sanitizeGroupJson(Map<String, Object> group) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("name", group.get("name"));
    @SuppressWarnings("unchecked")
    Map<String, List<String>> attrs = (Map<String, List<String>>) group.get("attrs");
    if (attrs != null && !attrs.isEmpty()) {
      out.put("attrs", attrs);
    }
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> children = (List<Map<String, Object>>) group.get("grps");
    List<Map<String, Object>> sanitizedChildren = children.stream()
        .sorted(groupNodeComparator())
        .map(this::sanitizeGroupJson)
        .collect(Collectors.toList());
    if (!sanitizedChildren.isEmpty()) {
      out.put("grps", sanitizedChildren);
    }
    return out;
  }

  private Comparator<Map<String, Object>> groupNodeComparator() {
    return Comparator.comparing(group -> (String) group.get("name"), String.CASE_INSENSITIVE_ORDER);
  }

  private Map<String, Object> toGroupJson(GroupModel group, boolean fullPath, boolean includeAttrs) {
    Map<String, Object> out = new LinkedHashMap<>();
    String groupPath = fullPath ? KeycloakModelUtils.buildGroupPath(group) : group.getName();
    out.put("name", group.getName());
    out.put("path", groupPath);
    if (includeAttrs) {
      out.put("attrs", group.getAttributes());
    } else {
      out.put("attrs", new LinkedHashMap<String, List<String>>());
    }
    out.put("grps", new ArrayList<Map<String, Object>>());
    return out;
  }

  public static ProtocolMapperModel create(
      String name,
      String claimName,
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
    config.put("multivalued", "true");
    config.put(CFG_FULL_PATH, "true");
    config.put(CFG_INCLUDE_ATTRIBUTES, "true");
    config.put("access.token.claim", String.valueOf(includeInAccessToken));
    config.put("id.token.claim", String.valueOf(includeInIdToken));
    config.put("userinfo.token.claim", String.valueOf(includeInUserInfo));
    mapper.setConfig(config);
    return mapper;
  }
}

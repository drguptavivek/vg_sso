package tech.epidemiology.keycloak.expiry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.keycloak.models.ClientSessionContext;
import org.keycloak.models.KeycloakContext;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.ProtocolMapperModel;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.keycloak.models.UserSessionModel;
import org.keycloak.representations.AccessToken;

class AccountExpiryWarningProtocolMapperTest {

  @Test
  void setClaim_marksWarningForUserInsideWindow() {
    AccountExpiryWarningProtocolMapper mapper = new AccountExpiryWarningProtocolMapper();
    ProtocolMapperModel model = AccountExpiryWarningProtocolMapper.create(
        "account-expiry",
        "account_expiry",
        28,
        true,
        true,
        true);

    UserModel user = mock(UserModel.class);
    when(user.getFirstAttribute(AccountExpiryUtil.ATTR_EXPIRY_DATE)).thenReturn(Instant.now().plusSeconds(14 * 86400L).atZone(java.time.ZoneId.of("Asia/Kolkata")).toLocalDate().toString());
    when(user.getFirstAttribute(AccountExpiryUtil.ATTR_EXPIRY_TIMEZONE)).thenReturn("Asia/Kolkata");

    RealmModel realm = mock(RealmModel.class);
    when(realm.getAttribute(AccountExpiryUtil.REALM_ATTR_DEFAULT_TIMEZONE)).thenReturn("Asia/Kolkata");

    UserSessionModel userSession = mock(UserSessionModel.class);
    when(userSession.getUser()).thenReturn(user);

    KeycloakContext context = mock(KeycloakContext.class);
    when(context.getRealm()).thenReturn(realm);

    KeycloakSession session = mock(KeycloakSession.class);
    when(session.getContext()).thenReturn(context);

    AccessToken token = new AccessToken();
    mapper.setClaim(token, model, userSession, session, mock(ClientSessionContext.class));

    @SuppressWarnings("unchecked")
    Map<String, Object> claim = (Map<String, Object>) token.getOtherClaims().get("account_expiry");
    assertThat(claim).isNotNull();
    assertThat(claim.get("configured")).isEqualTo(true);
    assertThat(claim.get("warning")).isEqualTo(true);
    assertThat(claim.get("expired")).isEqualTo(false);
    assertThat(claim.get("timeZone")).isEqualTo("Asia/Kolkata");
    assertThat(((Number) claim.get("daysRemaining")).longValue()).isBetween(13L, 14L);
  }

  @Test
  void setClaim_marksUnconfiguredUserWithoutExpiry() {
    AccountExpiryWarningProtocolMapper mapper = new AccountExpiryWarningProtocolMapper();
    ProtocolMapperModel model = AccountExpiryWarningProtocolMapper.create(
        "account-expiry",
        "account_expiry",
        28,
        true,
        true,
        true);

    UserModel user = mock(UserModel.class);
    when(user.getFirstAttribute(AccountExpiryUtil.ATTR_EXPIRY_DATE)).thenReturn(null);

    RealmModel realm = mock(RealmModel.class);
    UserSessionModel userSession = mock(UserSessionModel.class);
    when(userSession.getUser()).thenReturn(user);

    KeycloakContext context = mock(KeycloakContext.class);
    when(context.getRealm()).thenReturn(realm);

    KeycloakSession session = mock(KeycloakSession.class);
    when(session.getContext()).thenReturn(context);

    AccessToken token = new AccessToken();
    mapper.setClaim(token, model, userSession, session, mock(ClientSessionContext.class));

    @SuppressWarnings("unchecked")
    Map<String, Object> claim = (Map<String, Object>) token.getOtherClaims().get("account_expiry");
    assertThat(claim).isNotNull();
    assertThat(claim.get("configured")).isEqualTo(false);
    assertThat(claim.get("warning")).isEqualTo(false);
    assertThat(claim.get("expired")).isEqualTo(false);
  }
}

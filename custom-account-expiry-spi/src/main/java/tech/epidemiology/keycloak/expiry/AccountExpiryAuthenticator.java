package tech.epidemiology.keycloak.expiry;

import jakarta.ws.rs.core.Response;
import java.time.Instant;
import org.jboss.logging.Logger;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.AuthenticationFlowError;
import org.keycloak.authentication.Authenticator;
import org.keycloak.models.AuthenticatorConfigModel;
import org.keycloak.models.UserModel;

public class AccountExpiryAuthenticator implements Authenticator {
  private static final Logger LOG = Logger.getLogger(AccountExpiryAuthenticator.class);

  @Override
  public void authenticate(AuthenticationFlowContext context) {
    UserModel user = context.getUser();
    if (user == null) {
      context.failure(AuthenticationFlowError.UNKNOWN_USER);
      return;
    }

    AuthenticatorConfigModel cfg = context.getAuthenticatorConfig();
    String dateAttrName = getString(cfg, "expiry.date.attr.name", AccountExpiryUtil.ATTR_EXPIRY_DATE);
    String timezoneAttrName = getString(cfg, "expiry.timezone.attr.name", AccountExpiryUtil.ATTR_EXPIRY_TIMEZONE);
    String configuredDefaultTz = getString(cfg, "expiry.default.timezone", "");
    boolean dateEndOfDayInclusive = getBoolean(cfg, "expiry.date.end.of.day.inclusive", true);
    boolean blockParseError = getBoolean(cfg, "expiry.block.on.parse.error", true);
    String denyMessage = getString(cfg, "expiry.deny.message", "Account expired. Please contact your administrator.");
    String source = dateAttrName + "+" + timezoneAttrName;
    String rawDate = user.getFirstAttribute(dateAttrName);
    if (AccountExpiryUtil.isBlank(rawDate)) {
      context.success();
      return;
    }
    try {
      AccountExpiryUtil.ExpiryStatus status = AccountExpiryUtil.resolveExpiryStatus(
          user,
          context.getRealm(),
          dateAttrName,
          timezoneAttrName,
          configuredDefaultTz,
          dateEndOfDayInclusive,
          Instant.now());
      if (status == null) {
        context.success();
        return;
      }

      if (status.expired()) {
        LOG.infof("ACCOUNT_EXPIRED_BLOCK realm=%s userId=%s username=%s expiry=%s", context.getRealm().getName(),
            user.getId(), user.getUsername(), status.expiryInstant());
        context.failureChallenge(AuthenticationFlowError.USER_DISABLED,
            context.form().setError(denyMessage).createErrorPage(Response.Status.FORBIDDEN));
        return;
      }
    } catch (Exception ex) {
      String tz = AccountExpiryUtil.resolveEffectiveTimezone(user, context.getRealm(), timezoneAttrName, configuredDefaultTz);
      handleParseError(context, blockParseError, user, rawDate + " @ " + tz, source);
      return;
    }

    context.success();
  }

  @Override
  public void action(AuthenticationFlowContext context) {
    context.success();
  }

  @Override
  public boolean requiresUser() {
    return true;
  }

  @Override
  public boolean configuredFor(org.keycloak.models.KeycloakSession session, org.keycloak.models.RealmModel realm,
      UserModel user) {
    return true;
  }

  @Override
  public void setRequiredActions(org.keycloak.models.KeycloakSession session, org.keycloak.models.RealmModel realm,
      UserModel user) {
  }

  @Override
  public void close() {
  }

  private static String getString(AuthenticatorConfigModel cfg, String key, String def) {
    if (cfg == null || cfg.getConfig() == null) {
      return def;
    }
    return cfg.getConfig().getOrDefault(key, def);
  }

  private static boolean getBoolean(AuthenticatorConfigModel cfg, String key, boolean def) {
    return Boolean.parseBoolean(getString(cfg, key, String.valueOf(def)));
  }

  private void handleParseError(AuthenticationFlowContext context, boolean blockParseError, UserModel user, String raw,
      String source) {
    LOG.warnf("ACCOUNT_EXPIRY_PARSE_ERROR realm=%s userId=%s username=%s source=%s value=%s",
        context.getRealm().getName(), user.getId(), user.getUsername(), source, raw);
    if (blockParseError) {
      context.failureChallenge(AuthenticationFlowError.INTERNAL_ERROR,
          context.form().setError("Account expiry is misconfigured").createErrorPage(Response.Status.FORBIDDEN));
    } else {
      context.success();
    }
  }

}

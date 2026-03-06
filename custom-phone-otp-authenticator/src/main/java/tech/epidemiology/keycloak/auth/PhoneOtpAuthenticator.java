package tech.epidemiology.keycloak.auth;

import jakarta.ws.rs.core.MultivaluedMap;
import jakarta.ws.rs.core.Response;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.jboss.logging.Logger;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.AuthenticationFlowError;
import org.keycloak.authentication.Authenticator;
import org.keycloak.models.AuthenticatorConfigModel;
import org.keycloak.models.UserModel;

public class PhoneOtpAuthenticator implements Authenticator {
  private static final Logger LOG = Logger.getLogger(PhoneOtpAuthenticator.class);
  private static final SecureRandom SECURE_RANDOM = new SecureRandom();
  private static final String NOTE_OTP_HASH = "phone_otp_hash";
  private static final String NOTE_OTP_EXPIRES_AT = "phone_otp_expires_at";
  private static final String NOTE_OTP_ATTEMPTS = "phone_otp_attempts";
  private static final String NOTE_OTP_TOKEN = "phone_otp_token";

  private final SmsHttpSender smsSender;

  public PhoneOtpAuthenticator() {
    this(new SmsHttpSender());
  }

  public PhoneOtpAuthenticator(SmsHttpSender smsSender) {
    this.smsSender = smsSender;
  }

  @Override
  public void authenticate(AuthenticationFlowContext context) {
    UserModel user = context.getUser();
    if (user == null) {
      context.failure(AuthenticationFlowError.UNKNOWN_USER);
      return;
    }

    if ("true".equalsIgnoreCase(user.getFirstAttribute("phone_verified"))) {
      context.success();
      return;
    }

    AuthenticatorConfigModel cfg = context.getAuthenticatorConfig();
    String phone = user.getFirstAttribute("phone_number");
    if (phone == null || phone.isBlank()) {
      LOG.warnf("OTP_PHONE_MISSING userId=%s username=%s realm=%s", user.getId(), user.getUsername(),
          context.getRealm().getName());
      context.failureChallenge(AuthenticationFlowError.INVALID_USER,
          context.form().setError("Phone number missing").createErrorPage(Response.Status.BAD_REQUEST));
      return;
    }

    String otp = generateOtp(getInt(cfg, "otp.length", 6));
    String otpToken = UUID.randomUUID().toString();
    long expiresAt = Instant.now().plusSeconds(getInt(cfg, "otp.ttl.seconds", 300)).getEpochSecond();

    context.getAuthenticationSession().setAuthNote(NOTE_OTP_HASH, sha256Hex(otp));
    context.getAuthenticationSession().setAuthNote(NOTE_OTP_EXPIRES_AT, String.valueOf(expiresAt));
    context.getAuthenticationSession().setAuthNote(NOTE_OTP_ATTEMPTS, "0");
    context.getAuthenticationSession().setAuthNote(NOTE_OTP_TOKEN, otpToken);

    boolean sent = sendOtp(context, user, phone, otp, otpToken);
    if (!sent) {
      context.failureChallenge(AuthenticationFlowError.INTERNAL_ERROR,
          context.form().setError("Could not send OTP").createErrorPage(Response.Status.BAD_GATEWAY));
      return;
    }

    LOG.infof("OTP_SENT userId=%s username=%s realm=%s", user.getId(), user.getUsername(), context.getRealm().getName());
    context.challenge(context.form().createForm("login-otp.ftl"));
  }

  @Override
  public void action(AuthenticationFlowContext context) {
    UserModel user = context.getUser();
    MultivaluedMap<String, String> formData = context.getHttpRequest().getDecodedFormParameters();
    String entered = formData.getFirst("otp");

    String hash = context.getAuthenticationSession().getAuthNote(NOTE_OTP_HASH);
    String expiresAtRaw = context.getAuthenticationSession().getAuthNote(NOTE_OTP_EXPIRES_AT);
    int attempts = parseInt(context.getAuthenticationSession().getAuthNote(NOTE_OTP_ATTEMPTS), 0);
    int maxAttempts = getInt(context.getAuthenticatorConfig(), "otp.max.attempts", 5);

    if (entered == null || entered.isBlank() || hash == null || expiresAtRaw == null) {
      context.failureChallenge(AuthenticationFlowError.INVALID_CREDENTIALS,
          context.form().setError("Invalid OTP flow state").createForm("login-otp.ftl"));
      return;
    }

    long expiresAt = parseLong(expiresAtRaw, 0L);
    if (Instant.now().getEpochSecond() > expiresAt) {
      LOG.warnf("OTP_EXPIRED userId=%s username=%s", user.getId(), user.getUsername());
      context.failureChallenge(AuthenticationFlowError.EXPIRED_CODE,
          context.form().setError("OTP expired").createForm("login-otp.ftl"));
      return;
    }

    if (!secureHashEquals(entered, hash)) {
      attempts++;
      context.getAuthenticationSession().setAuthNote(NOTE_OTP_ATTEMPTS, String.valueOf(attempts));
      LOG.warnf("OTP_VERIFY_FAIL userId=%s username=%s attempts=%d", user.getId(), user.getUsername(), attempts);
      if (attempts >= maxAttempts) {
        context.failureChallenge(AuthenticationFlowError.INVALID_CREDENTIALS,
            context.form().setError("Max OTP attempts reached").createErrorPage(Response.Status.FORBIDDEN));
        return;
      }
      context.failureChallenge(AuthenticationFlowError.INVALID_CREDENTIALS,
          context.form().setError("Invalid OTP").createForm("login-otp.ftl"));
      return;
    }

    user.setSingleAttribute("phone_verified", "true");
    user.setSingleAttribute("phone_verified_at", Instant.now().toString());
    LOG.infof("OTP_VERIFY_SUCCESS userId=%s username=%s realm=%s", user.getId(), user.getUsername(),
        context.getRealm().getName());
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

  private boolean sendOtp(AuthenticationFlowContext context, UserModel user, String phone, String otp, String otpToken) {
    AuthenticatorConfigModel cfg = context.getAuthenticatorConfig();
    String primary = getString(cfg, "otp.endpoint.primary", "");
    String backup = getString(cfg, "otp.endpoint.backup", "");
    int retries = getInt(cfg, "otp.retry.max", 2);
    int backoffMs = getInt(cfg, "otp.retry.backoff.ms", 500);

    String mobileField = getString(cfg, "otp.sms.mobile.field", "mobile");
    String messageField = getString(cfg, "otp.sms.message.field", "message");
    String messageTemplate = getString(cfg, "otp.sms.message.template", "OTP For VG SSO Verification is: {{otp}}");
    String message = messageTemplate.replace("{{otp}}", otp).replace("#####", otp);

    String bearer = getString(cfg, "otp.auth.bearer", "");
    String tokenHeader = getString(cfg, "otp.request.token.header", "X-OTP-Token");
    Map<String, Object> payload = SmsHttpSender.buildSmsPayload(mobileField, messageField, phone, message);
    return smsSender.sendWithRetry(primary, backup, bearer, tokenHeader, otpToken, payload, retries, backoffMs,
        user.getUsername(), user.getId());
  }

  private static String generateOtp(int len) {
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < len; i++) {
      sb.append(SECURE_RANDOM.nextInt(10));
    }
    return sb.toString();
  }

  private static boolean secureHashEquals(String rawInput, String expectedHashHex) {
    String enteredHash = sha256Hex(rawInput);
    return MessageDigest.isEqual(
        enteredHash.getBytes(StandardCharsets.UTF_8),
        expectedHashHex.getBytes(StandardCharsets.UTF_8));
  }

  private static String sha256Hex(String input) {
    try {
      MessageDigest md = MessageDigest.getInstance("SHA-256");
      byte[] bytes = md.digest(input.getBytes(StandardCharsets.UTF_8));
      StringBuilder out = new StringBuilder(bytes.length * 2);
      for (byte b : bytes) {
        out.append(String.format("%02x", b));
      }
      return out.toString();
    } catch (Exception e) {
      throw new RuntimeException(e);
    }
  }

  private static String getString(AuthenticatorConfigModel cfg, String key, String def) {
    if (cfg == null || cfg.getConfig() == null) {
      return def;
    }
    return cfg.getConfig().getOrDefault(key, def);
  }

  private static int getInt(AuthenticatorConfigModel cfg, String key, int def) {
    return parseInt(getString(cfg, key, String.valueOf(def)), def);
  }

  private static int parseInt(String v, int def) {
    try {
      return Integer.parseInt(v);
    } catch (Exception ignored) {
      return def;
    }
  }

  private static long parseLong(String v, long def) {
    try {
      return Long.parseLong(v);
    } catch (Exception ignored) {
      return def;
    }
  }
}

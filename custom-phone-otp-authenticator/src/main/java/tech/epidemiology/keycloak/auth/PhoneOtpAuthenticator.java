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
  private static final String NOTE_RESEND_COUNT = "phone_otp_resend_count";
  private static final String NOTE_LAST_SENT_AT = "phone_otp_last_sent_at";
  private static final String NOTE_RESEND_BLOCK_UNTIL = "phone_otp_resend_block_until";
  private static final String FORM_TEMPLATE = "login-phone-otp.ftl";

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

    boolean sent = sendOtp(context, user, phone, otp, otpToken);
    if (!sent) {
      context.failureChallenge(AuthenticationFlowError.INTERNAL_ERROR,
          context.form().setError("Could not send OTP").createErrorPage(Response.Status.BAD_GATEWAY));
      return;
    }

    storeOtpState(context, otp, otpToken, expiresAt, true);

    LOG.infof("OTP_SENT userId=%s username=%s realm=%s", user.getId(), user.getUsername(), context.getRealm().getName());
    challenge(context, null);
  }

  @Override
  public void action(AuthenticationFlowContext context) {
    UserModel user = context.getUser();
    if (user == null) {
      context.failure(AuthenticationFlowError.UNKNOWN_USER);
      return;
    }

    MultivaluedMap<String, String> formData = context.getHttpRequest().getDecodedFormParameters();
    if (isResendRequest(formData)) {
      handleResend(context, user);
      return;
    }

    String entered = formData.getFirst("otp");

    String hash = context.getAuthenticationSession().getAuthNote(NOTE_OTP_HASH);
    String expiresAtRaw = context.getAuthenticationSession().getAuthNote(NOTE_OTP_EXPIRES_AT);
    int attempts = parseInt(context.getAuthenticationSession().getAuthNote(NOTE_OTP_ATTEMPTS), 0);
    int maxAttempts = getInt(context.getAuthenticatorConfig(), "otp.max.attempts", 5);

    if (entered == null || entered.isBlank() || hash == null || expiresAtRaw == null) {
      challengeFailure(context, AuthenticationFlowError.INVALID_CREDENTIALS, "phoneOtpInvalidFlowState");
      return;
    }

    long expiresAt = parseLong(expiresAtRaw, 0L);
    if (Instant.now().getEpochSecond() > expiresAt) {
      LOG.warnf("OTP_EXPIRED userId=%s username=%s", user.getId(), user.getUsername());
      challengeFailure(context, AuthenticationFlowError.EXPIRED_CODE, "phoneOtpExpired");
      return;
    }

    if (!secureHashEquals(entered, hash)) {
      attempts++;
      context.getAuthenticationSession().setAuthNote(NOTE_OTP_ATTEMPTS, String.valueOf(attempts));
      LOG.warnf("OTP_VERIFY_FAIL userId=%s username=%s attempts=%d", user.getId(), user.getUsername(), attempts);
      if (attempts >= maxAttempts) {
        context.failureChallenge(AuthenticationFlowError.INVALID_CREDENTIALS,
            context.form().setError("phoneOtpMaxAttemptsReached").createErrorPage(Response.Status.FORBIDDEN));
        return;
      }
      challengeFailure(context, AuthenticationFlowError.INVALID_CREDENTIALS, "phoneOtpInvalid");
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

  private void handleResend(AuthenticationFlowContext context, UserModel user) {
    AuthenticatorConfigModel cfg = context.getAuthenticatorConfig();
    long now = Instant.now().getEpochSecond();
    long lastSentAt = parseLong(context.getAuthenticationSession().getAuthNote(NOTE_LAST_SENT_AT), 0L);
    int resendCount = parseInt(context.getAuthenticationSession().getAuthNote(NOTE_RESEND_COUNT), 0);
    long blockUntil = parseLong(context.getAuthenticationSession().getAuthNote(NOTE_RESEND_BLOCK_UNTIL), 0L);
    int resendMax = getInt(cfg, "otp.resend.max", 3);
    int resendIntervalSeconds = getInt(cfg, "otp.resend.interval.seconds", 30);
    int resendBlockSeconds = getInt(cfg, "otp.resend.block.seconds", 900);

    if (blockUntil > now) {
      challenge(context, "phoneOtpResendBlocked");
      return;
    }

    long nextAllowedAt = lastSentAt + resendIntervalSeconds;
    if (lastSentAt > 0 && nextAllowedAt > now) {
      context.form().setAttribute("phoneOtpResendWaitSeconds", nextAllowedAt - now);
      challenge(context, "phoneOtpResendTooSoon");
      return;
    }

    if (resendCount >= resendMax) {
      context.getAuthenticationSession().setAuthNote(NOTE_RESEND_BLOCK_UNTIL, String.valueOf(now + resendBlockSeconds));
      context.form().setAttribute("phoneOtpResendBlockSeconds", resendBlockSeconds);
      challenge(context, "phoneOtpResendBlocked");
      return;
    }

    String phone = user.getFirstAttribute("phone_number");
    if (phone == null || phone.isBlank()) {
      context.failureChallenge(AuthenticationFlowError.INVALID_USER,
          context.form().setError("Phone number missing").createErrorPage(Response.Status.BAD_REQUEST));
      return;
    }

    String otp = generateOtp(getInt(cfg, "otp.length", 6));
    String otpToken = UUID.randomUUID().toString();
    long expiresAt = Instant.now().plusSeconds(getInt(cfg, "otp.ttl.seconds", 300)).getEpochSecond();
    boolean sent = sendOtp(context, user, phone, otp, otpToken);
    if (!sent) {
      context.failureChallenge(AuthenticationFlowError.INTERNAL_ERROR,
          context.form().setError("Could not send OTP").createErrorPage(Response.Status.BAD_GATEWAY));
      return;
    }

    storeOtpState(context, otp, otpToken, expiresAt, false);
    context.getAuthenticationSession().setAuthNote(NOTE_RESEND_COUNT, String.valueOf(resendCount + 1));
    challenge(context, "phoneOtpResent");
  }

  private void storeOtpState(AuthenticationFlowContext context, String otp, String otpToken, long expiresAt, boolean initialSend) {
    long now = Instant.now().getEpochSecond();
    context.getAuthenticationSession().setAuthNote(NOTE_OTP_HASH, sha256Hex(otp));
    context.getAuthenticationSession().setAuthNote(NOTE_OTP_EXPIRES_AT, String.valueOf(expiresAt));
    context.getAuthenticationSession().setAuthNote(NOTE_OTP_ATTEMPTS, "0");
    context.getAuthenticationSession().setAuthNote(NOTE_OTP_TOKEN, otpToken);
    context.getAuthenticationSession().setAuthNote(NOTE_LAST_SENT_AT, String.valueOf(now));
    context.getAuthenticationSession().removeAuthNote(NOTE_RESEND_BLOCK_UNTIL);
    if (initialSend && context.getAuthenticationSession().getAuthNote(NOTE_RESEND_COUNT) == null) {
      context.getAuthenticationSession().setAuthNote(NOTE_RESEND_COUNT, "0");
    }
  }

  private void challengeFailure(AuthenticationFlowContext context, AuthenticationFlowError error, String messageKey) {
    context.failureChallenge(error, context.form().setError(messageKey).createForm(FORM_TEMPLATE));
  }

  private void challenge(AuthenticationFlowContext context, String messageKey) {
    String phone = context.getUser() == null ? "" : maskPhone(context.getUser().getFirstAttribute("phone_number"));
    context.form().setAttribute("phoneOtpMaskedPhone", phone);
    if (messageKey != null && !messageKey.isBlank()) {
      context.form().setSuccess(messageKey);
    }
    context.challenge(context.form().createForm(FORM_TEMPLATE));
  }

  private static boolean isResendRequest(MultivaluedMap<String, String> formData) {
    return formData != null && formData.containsKey("resend");
  }

  private static String maskPhone(String phone) {
    if (phone == null || phone.isBlank()) {
      return "";
    }
    String digitsOnly = phone.replaceAll("\\s+", "");
    if (digitsOnly.length() <= 4) {
      return digitsOnly;
    }
    return "*".repeat(Math.max(0, digitsOnly.length() - 4)) + digitsOnly.substring(digitsOnly.length() - 4);
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

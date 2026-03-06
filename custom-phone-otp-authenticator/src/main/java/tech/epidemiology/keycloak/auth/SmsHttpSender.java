package tech.epidemiology.keycloak.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.jboss.logging.Logger;

public final class SmsHttpSender {
  private static final Logger LOG = Logger.getLogger(SmsHttpSender.class);
  private static final ObjectMapper JSON = new ObjectMapper();
  private final HttpClient httpClient;

  public SmsHttpSender() {
    this(HttpClient.newBuilder().build());
  }

  public SmsHttpSender(HttpClient httpClient) {
    this.httpClient = httpClient;
  }

  public boolean sendWithRetry(
      String primaryEndpoint,
      String backupEndpoint,
      String bearer,
      String tokenHeader,
      String requestToken,
      Map<String, Object> payload,
      int retries,
      int backoffMs,
      String username,
      String userId) {
    if (primaryEndpoint != null && !primaryEndpoint.isBlank()
        && postWithRetry(primaryEndpoint, payload, bearer, tokenHeader, requestToken, retries, backoffMs, "primary",
            username, userId)) {
      return true;
    }
    return backupEndpoint != null
        && !backupEndpoint.isBlank()
        && postWithRetry(backupEndpoint, payload, bearer, tokenHeader, requestToken, retries, backoffMs, "backup",
            username, userId);
  }

  public static Map<String, Object> buildSmsPayload(String mobileField, String messageField, String mobile, String message) {
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put(mobileField, mobile);
    payload.put(messageField, message);
    return payload;
  }

  private boolean postWithRetry(
      String endpoint,
      Map<String, Object> payload,
      String bearer,
      String tokenHeader,
      String requestToken,
      int retries,
      int backoffMs,
      String endpointName,
      String username,
      String userId) {
    for (int i = 0; i <= retries; i++) {
      try {
        String body = JSON.writeValueAsString(payload);
        HttpRequest.Builder req = HttpRequest.newBuilder()
            .uri(URI.create(endpoint))
            .header("Content-Type", "application/json")
            .header(tokenHeader, requestToken)
            .POST(HttpRequest.BodyPublishers.ofString(body));
        if (bearer != null && !bearer.isBlank()) {
          req.header("Authorization", "Bearer " + bearer);
        }
        HttpResponse<String> resp = httpClient.send(req.build(), HttpResponse.BodyHandlers.ofString());
        int status = resp.statusCode();
        if (status >= 200 && status < 300) {
          LOG.infof("OTP_SEND_OK userId=%s username=%s endpoint=%s status=%d at=%s",
              userId, username, endpointName, status, Instant.now());
          return true;
        }
        LOG.warnf("OTP_SEND_FAIL userId=%s username=%s endpoint=%s status=%d try=%d",
            userId, username, endpointName, status, i + 1);
      } catch (Exception e) {
        LOG.warnf("OTP_SEND_ERROR userId=%s username=%s endpoint=%s try=%d msg=%s",
            userId, username, endpointName, i + 1, e.getMessage());
      }
      sleep(backoffMs * Math.max(1, i + 1));
    }
    return false;
  }

  private void sleep(long ms) {
    try {
      Thread.sleep(ms);
    } catch (InterruptedException ignored) {
      Thread.currentThread().interrupt();
    }
  }
}

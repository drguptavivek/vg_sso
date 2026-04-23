package tech.epidemiology.keycloak.asyncmail;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import org.junit.jupiter.api.Test;

class AsyncEmailRetryPolicyTest {

  @Test
  void appliesDefaultConfiguration() {
    AsyncEmailRetryPolicy policy = new AsyncEmailRetryPolicy();
    assertThat(policy.maxAttempts()).isEqualTo(AsyncEmailRetryPolicy.DEFAULT_MAX_ATTEMPTS);
  }

  @Test
  void classifiesTransientFailuresAsRetryable() {
    AsyncEmailRetryPolicy policy = new AsyncEmailRetryPolicy();
    assertThat(policy.isRetryableFailure(new RuntimeException("connection timed out while sending"))).isTrue();
    assertThat(policy.isRetryableFailure(new RuntimeException("Read timed out"))).isTrue();
    assertThat(policy.isRetryableFailure(new RuntimeException("SMTP 4.2.1 temporary failure"))).isTrue();
  }

  @Test
  void classifiesPermanentFailuresAsNonRetryable() {
    AsyncEmailRetryPolicy policy = new AsyncEmailRetryPolicy();
    assertThat(policy.isRetryableFailure(new RuntimeException("550 invalid recipient"))).isFalse();
    assertThat(policy.isRetryableFailure(new RuntimeException("Malformed message"))).isFalse();
    assertThat(policy.isRetryableFailure(new IllegalArgumentException("bad recipient address"))).isFalse();
  }

  @Test
  void computesExponentialBackoffWithJitterDeterministically() {
    AsyncEmailRetryPolicy policy = new AsyncEmailRetryPolicy(5, 5);

    assertThat(policy.calculateNextAttemptDelay(1, 0)).isEqualTo(Duration.ofSeconds(30));
    assertThat(policy.calculateNextAttemptDelay(2, 0)).isEqualTo(Duration.ofMinutes(2));
    assertThat(policy.calculateNextAttemptDelay(3, 0)).isEqualTo(Duration.ofMinutes(10));
    assertThat(policy.calculateNextAttemptDelay(4, 0)).isEqualTo(Duration.ofMinutes(30));

    assertThat(policy.calculateNextAttemptDelay(1, 500)).isEqualTo(policy.calculateNextAttemptDelay(1, 500));
    assertThat(policy.calculateNextAttemptDelay(2, 500)).isEqualTo(policy.calculateNextAttemptDelay(2, 500));
    assertThat(policy.calculateNextAttemptDelay(1, 100)).isBetween(Duration.ofSeconds(15), Duration.ofSeconds(33));
    assertThat(policy.calculateNextAttemptDelay(2, 100)).isBetween(Duration.ofSeconds(90), Duration.ofSeconds(150));
  }

  @Test
  void stopsRetryingAfterMaxAttempts() {
    AsyncEmailRetryPolicy policy = new AsyncEmailRetryPolicy(3, 0);

    assertThat(policy.shouldRetry(1, new RuntimeException("timeout"))).isTrue();
    assertThat(policy.shouldRetry(2, new RuntimeException("timeout"))).isTrue();
    assertThat(policy.shouldRetry(3, new RuntimeException("timeout"))).isFalse();

    assertThat(policy.calculateNextAttemptDelay(4, 0)).isNull();
  }
}

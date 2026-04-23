package tech.epidemiology.keycloak.asyncmail;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.junit.jupiter.api.Test;

class AsyncEmailRetentionPolicyTest {

  @Test
  void defaultRetentionIs180Days() {
    AsyncEmailRetentionPolicy policy = new AsyncEmailRetentionPolicy();
    assertThat(policy.retentionDays()).isEqualTo(180);
  }

  @Test
  void computesCutoffFromNow() {
    AsyncEmailRetentionPolicy policy = new AsyncEmailRetentionPolicy(10);
    Instant now = Instant.parse("2026-04-23T00:00:00Z");
    assertThat(policy.cutoffAt(now)).isEqualTo(Instant.parse("2026-04-13T00:00:00Z"));
  }

  @Test
  void rejectsNonPositiveRetentionDays() {
    AsyncEmailRetentionPolicy policy = new AsyncEmailRetentionPolicy(0);
    assertThat(policy.retentionDays()).isEqualTo(180);
  }
}

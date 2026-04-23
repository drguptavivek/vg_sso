package tech.epidemiology.keycloak.asyncmail;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;

class AsyncEmailConfigTest {

  @Test
  void loadsDefaultsWhenNotConfigured() {
    AsyncEmailConfig config = AsyncEmailConfig.fromEnvironment(Map.of());
    assertThat(config.retentionDays()).isEqualTo(180);
    assertThat(config.retryMaxAttempts()).isEqualTo(5);
    assertThat(config.workerEnabled()).isTrue();
  }

  @Test
  void parsesConfiguredOverrides() {
    AsyncEmailConfig config = AsyncEmailConfig.fromEnvironment(Map.of(
        "KC_ASYNC_EMAIL_RETENTION_DAYS", "30",
        "KC_ASYNC_EMAIL_RETRY_MAX_ATTEMPTS", "7",
        "KC_ASYNC_EMAIL_WORKER_ENABLED", "false",
        "KC_ASYNC_EMAIL_EXPORT_MAX_ROWS", "2500"
    ));

    assertThat(config.retentionDays()).isEqualTo(30);
    assertThat(config.retryMaxAttempts()).isEqualTo(7);
    assertThat(config.workerEnabled()).isFalse();
    assertThat(config.exportMaxRows()).isEqualTo(2500);
  }

  @Test
  void ignoresInvalidNumericValuesByFallingBackToDefaults() {
    AsyncEmailConfig config = AsyncEmailConfig.fromEnvironment(Map.of(
        "KC_ASYNC_EMAIL_RETENTION_DAYS", "bad",
        "KC_ASYNC_EMAIL_RETRY_MAX_ATTEMPTS", "not-a-number"
    ));
    assertThat(config.retentionDays()).isEqualTo(180);
    assertThat(config.retryMaxAttempts()).isEqualTo(5);
  }
}

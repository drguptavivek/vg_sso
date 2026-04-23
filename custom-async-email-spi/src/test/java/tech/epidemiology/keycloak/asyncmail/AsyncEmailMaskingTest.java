package tech.epidemiology.keycloak.asyncmail;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class AsyncEmailMaskingTest {

  @Test
  void masksStandardEmailAddress() {
    assertThat(AsyncEmailMasking.maskEmail("alice@example.org")).isEqualTo("a***e@example.org");
  }

  @Test
  void masksShortLocalPart() {
    assertThat(AsyncEmailMasking.maskEmail("ab@EXAMPLE.org")).isEqualTo("a***b@example.org");
    assertThat(AsyncEmailMasking.maskEmail("x@y.io")).isEqualTo("x***x@y.io");
  }

  @Test
  void keepsDomainVisibleAndTrimsWhitespace() {
    assertThat(AsyncEmailMasking.maskEmail("  bob@Example.COM  ")).isEqualTo("b***b@example.com");
  }

  @Test
  void handlesInvalidEmailsByFallingBackToHash() {
    assertThat(AsyncEmailMasking.maskEmail("noreply")).startsWith("***");
    assertThat(AsyncEmailMasking.maskEmail("noreply")).hasSize(9);
  }

  @Test
  void returnsEmptyForBlankInput() {
    assertThat(AsyncEmailMasking.maskEmail(" ")).isEmpty();
    assertThat(AsyncEmailMasking.maskEmail(null)).isEmpty();
  }
}

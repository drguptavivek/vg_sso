package tech.epidemiology.keycloak.asyncmail;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class AsyncEmailCategoryResolverTest {

  @Test
  void resolvesFromTemplateNames() {
    assertThat(AsyncEmailCategoryResolver.resolve("executeActions")).isEqualTo(AsyncEmailQueueRecord.Category.EXECUTE_ACTIONS);
    assertThat(AsyncEmailCategoryResolver.resolve("email-verification.ftl")).isEqualTo(AsyncEmailQueueRecord.Category.VERIFY_EMAIL);
    assertThat(AsyncEmailCategoryResolver.resolve("password-reset"))
        .isEqualTo(AsyncEmailQueueRecord.Category.PASSWORD_RESET);
    assertThat(AsyncEmailCategoryResolver.resolve("email-update-confirmation"))
        .isEqualTo(AsyncEmailQueueRecord.Category.EMAIL_UPDATE_CONFIRMATION);
    assertThat(AsyncEmailCategoryResolver.resolve("org-invite")).isEqualTo(AsyncEmailQueueRecord.Category.ORG_INVITE);
    assertThat(AsyncEmailCategoryResolver.resolve("smtp-test"))
        .isEqualTo(AsyncEmailQueueRecord.Category.SMTP_TEST);
  }

  @Test
  void resolvesFromEventTypeWhenTemplateIsUnknown() {
    assertThat(AsyncEmailCategoryResolver.resolve("unknown", "VERIFY_EMAIL")).isEqualTo(AsyncEmailQueueRecord.Category.VERIFY_EMAIL);
    assertThat(AsyncEmailCategoryResolver.resolve("anything", "PASSWORD_RESET"))
        .isEqualTo(AsyncEmailQueueRecord.Category.PASSWORD_RESET);
  }

  @Test
  void resolvesToUnknownWhenNoMatch() {
    assertThat(AsyncEmailCategoryResolver.resolve("does-not-exist")).isEqualTo(AsyncEmailQueueRecord.Category.UNKNOWN);
    assertThat(AsyncEmailCategoryResolver.resolve("does-not-exist", "CUSTOM_EVENT"))
        .isEqualTo(AsyncEmailQueueRecord.Category.UNKNOWN);
  }
}

package tech.epidemiology.keycloak.password;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ForbiddenTermsPasswordPolicyProviderTest {

    @Test
    void shouldDetectDirectSubstring() {
        assertThat(ForbiddenTermsPasswordPolicyProvider.containsForbiddenTerm(
                "StrongPassword@123",
                "password,admin"))
                .isTrue();
    }

    @Test
    void shouldDetectNormalizedSubstringWithSeparators() {
        assertThat(ForbiddenTermsPasswordPolicyProvider.containsForbiddenTerm(
                "Very$Welcome-2026!",
                "welcome"))
                .isTrue();
    }

    @Test
    void shouldAllowWhenNoConfiguredMatch() {
        assertThat(ForbiddenTermsPasswordPolicyProvider.containsForbiddenTerm(
                "S3cur3!AlphaBeta",
                "hospital,oncology,cardiology"))
                .isFalse();
    }

    @Test
    void shouldParseCommaSemicolonAndNewlineTerms() {
        assertThat(ForbiddenTermsPasswordPolicyProvider.splitTerms("one, two;three\nfour\r\nfive"))
                .containsExactly("one", "two", "three", "four", "five");
    }
}

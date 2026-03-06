package tech.epidemiology.keycloak.expiry;

import org.junit.jupiter.api.Test;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;

class AccountExpiryUtilTest {

    @Test
    void testDateToUtcExpiryInstant_EndOfDayInclusive() {
        // 2024-01-01 in Asia/Kolkata (+5:30)
        // End of day inclusive means it expires at 2024-01-02 00:00:00 Asia/Kolkata
        // Which is 2024-01-01 18:30:00 UTC
        Instant result = AccountExpiryUtil.dateToUtcExpiryInstant("2024-01-01", "Asia/Kolkata", true);
        assertThat(result).isEqualTo(Instant.parse("2024-01-01T18:30:00Z"));
    }

    @Test
    void testDateToUtcExpiryInstant_NotEndOfDayInclusive() {
        // 2024-01-01 in Asia/Kolkata (+5:30)
        // Not inclusive means it expires at 2024-01-01 00:00:00 Asia/Kolkata
        // Which is 2023-12-31 18:30:00 UTC
        Instant result = AccountExpiryUtil.dateToUtcExpiryInstant("2024-01-01", "Asia/Kolkata", false);
        assertThat(result).isEqualTo(Instant.parse("2023-12-31T18:30:00Z"));
    }

    @Test
    void testDateToUtcExpiryInstant_InvalidDate() {
        assertThrows(DateTimeParseException.class, () -> {
            AccountExpiryUtil.dateToUtcExpiryInstant("invalid-date", "Asia/Kolkata", true);
        });
    }

    @Test
    void testDateToUtcExpiryInstant_InvalidTimeZone() {
        assertThrows(java.time.zone.ZoneRulesException.class, () -> {
            AccountExpiryUtil.dateToUtcExpiryInstant("2024-01-01", "Invalid/TimeZone", true);
        });
    }

    @Test
    void testResolveExpiryStatus_ComputesDaysRemainingAndTimezone() {
        UserModel user = mock(UserModel.class);
        when(user.getFirstAttribute(AccountExpiryUtil.ATTR_EXPIRY_DATE)).thenReturn("2026-03-29");
        when(user.getFirstAttribute(AccountExpiryUtil.ATTR_EXPIRY_TIMEZONE)).thenReturn("Asia/Kolkata");

        RealmModel realm = mock(RealmModel.class);
        when(realm.getAttribute(AccountExpiryUtil.REALM_ATTR_DEFAULT_TIMEZONE)).thenReturn("Asia/Kolkata");

        AccountExpiryUtil.ExpiryStatus status = AccountExpiryUtil.resolveExpiryStatus(
            user,
            realm,
            AccountExpiryUtil.ATTR_EXPIRY_DATE,
            AccountExpiryUtil.ATTR_EXPIRY_TIMEZONE,
            "",
            true,
            Instant.parse("2026-03-01T00:00:00Z"));

        assertThat(status).isNotNull();
        assertThat(status.timeZone()).isEqualTo("Asia/Kolkata");
        assertThat(status.daysRemaining()).isEqualTo(28);
        assertThat(status.expired()).isFalse();
        assertThat(AccountExpiryUtil.isWithinWarningWindow(status.daysRemaining(), 28)).isTrue();
    }
}

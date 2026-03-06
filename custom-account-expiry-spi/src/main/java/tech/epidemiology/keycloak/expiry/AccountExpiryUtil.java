package tech.epidemiology.keycloak.expiry;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.time.format.DateTimeFormatter;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;

public final class AccountExpiryUtil {
  public static final String REALM_ATTR_DEFAULT_TIMEZONE = "account_expiry_default_timezone";
  public static final String DEFAULT_TIMEZONE = "Asia/Kolkata";
  public static final String ATTR_EXPIRY_DATE = "account_expiry_date";
  public static final String ATTR_EXPIRY_TIMEZONE = "account_expiry_timezone";
  public static final DateTimeFormatter INPUT_DATE_FORMAT = DateTimeFormatter.ISO_LOCAL_DATE;
  public static final int DEFAULT_WARNING_WINDOW_DAYS = 28;

  private AccountExpiryUtil() {
  }

  public static Instant dateToUtcExpiryInstant(String localDate, String timeZone, boolean endOfDayInclusive) {
    LocalDate d = LocalDate.parse(localDate, INPUT_DATE_FORMAT);
    ZoneId zone = ZoneId.of(timeZone);
    if (endOfDayInclusive) {
      // Expire right after local date ends: next day at 00:00 in that timezone.
      return d.plusDays(1).atStartOfDay(zone).toInstant();
    }
    return d.atStartOfDay(zone).toInstant();
  }

  public static ExpiryStatus resolveExpiryStatus(
      UserModel user,
      RealmModel realm,
      String dateAttrName,
      String timezoneAttrName,
      String configuredDefaultTz,
      boolean endOfDayInclusive,
      Instant now) {
    String rawDate = user.getFirstAttribute(dateAttrName);
    if (isBlank(rawDate)) {
      return null;
    }

    LocalDate localDate = LocalDate.parse(rawDate, INPUT_DATE_FORMAT);
    String effectiveTimezone = resolveEffectiveTimezone(user, realm, timezoneAttrName, configuredDefaultTz);
    Instant expiryInstant = dateToUtcExpiryInstant(rawDate, effectiveTimezone, endOfDayInclusive);
    long daysRemaining = ChronoUnit.DAYS.between(now.atZone(ZoneId.of(effectiveTimezone)).toLocalDate(), localDate);
    boolean expired = !now.isBefore(expiryInstant);

    return new ExpiryStatus(rawDate, effectiveTimezone, expiryInstant, daysRemaining, expired);
  }

  public static boolean isWithinWarningWindow(long daysRemaining, int warningWindowDays) {
    int normalizedWindow = normalizeWarningWindowDays(warningWindowDays);
    return daysRemaining >= 0 && daysRemaining <= normalizedWindow;
  }

  public static int normalizeWarningWindowDays(int warningWindowDays) {
    return Math.max(0, warningWindowDays);
  }

  public static String resolveRealmDefaultTimezone(RealmModel realm) {
    if (realm == null) {
      return DEFAULT_TIMEZONE;
    }
    String value = realm.getAttribute(REALM_ATTR_DEFAULT_TIMEZONE);
    return isBlank(value) ? DEFAULT_TIMEZONE : value.trim();
  }

  public static String resolveEffectiveTimezone(
      UserModel user,
      RealmModel realm,
      String timezoneAttrName,
      String configuredDefaultTz) {
    return normalizeZone(
        firstNonBlank(
            user.getFirstAttribute(timezoneAttrName),
            user.getFirstAttribute("zoneinfo"),
            configuredDefaultTz,
            resolveRealmDefaultTimezone(realm),
            DEFAULT_TIMEZONE),
        DEFAULT_TIMEZONE);
  }

  public static String normalizeZone(String value, String fallback) {
    if (isBlank(value)) {
      return fallback;
    }
    try {
      return ZoneId.of(value.trim()).getId();
    } catch (Exception e) {
      return fallback;
    }
  }

  public static String firstNonBlank(String... values) {
    if (values == null) {
      return "";
    }
    for (String value : values) {
      if (!isBlank(value)) {
        return value.trim();
      }
    }
    return "";
  }

  public static boolean isBlank(String value) {
    return value == null || value.isBlank();
  }

  public record ExpiryStatus(
      String localDate,
      String timeZone,
      Instant expiryInstant,
      long daysRemaining,
      boolean expired) {
  }
}

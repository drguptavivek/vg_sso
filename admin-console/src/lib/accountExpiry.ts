import type { KcUser } from "@/types/keycloak";

/** Matches custom-account-expiry-spi: Asia/Kolkata unless the user overrides it. */
export const DEFAULT_EXPIRY_TIMEZONE = "Asia/Kolkata";
/** Accounts within this many days of expiry are flagged as expiring soon. */
export const EXPIRY_WARNING_DAYS = 15;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

export type AccountExpiryState = "expired" | "expiring" | "active";

export interface AccountExpiryStatus {
  date: string;
  timeZone: string;
  /** Days from today to the expiry date; negative once the date has passed. */
  daysRemaining: number;
  state: AccountExpiryState;
  label: string;
}

function resolveTimeZone(value: string | undefined): string {
  const candidate = value?.trim();
  if (!candidate) return DEFAULT_EXPIRY_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: candidate });
    return candidate;
  } catch {
    return DEFAULT_EXPIRY_TIMEZONE;
  }
}

function todayInTimeZone(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Today's date as YYYY-MM-DD in the given timezone, for expiry range filters. */
export function todayIsoDate(timeZone = DEFAULT_EXPIRY_TIMEZONE, now = new Date()): string {
  return todayInTimeZone(resolveTimeZone(timeZone), now);
}

/** Shifts a YYYY-MM-DD date by whole days, staying on the calendar date. */
export function shiftIsoDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * Expiry status for a user, mirroring the authenticator's end-of-day-inclusive
 * rule: an account whose expiry date is today is still usable today.
 * Returns null when the user has no usable expiry date.
 */
export function accountExpiryStatus(
  user: KcUser,
  warningDays = EXPIRY_WARNING_DAYS,
  now = new Date(),
): AccountExpiryStatus | null {
  const date = user.attributes?.account_expiry_date?.[0]?.trim();
  if (!date || !DATE_PATTERN.test(date)) return null;

  const expiry = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(expiry)) return null;

  const timeZone = resolveTimeZone(
    user.attributes?.account_expiry_timezone?.[0] ?? user.attributes?.zoneinfo?.[0],
  );
  const today = Date.parse(`${todayInTimeZone(timeZone, now)}T00:00:00Z`);
  const daysRemaining = Math.round((expiry - today) / MS_PER_DAY);

  const state: AccountExpiryState =
    daysRemaining < 0 ? "expired" : daysRemaining <= warningDays ? "expiring" : "active";

  return { date, timeZone, daysRemaining, state, label: expiryLabel(daysRemaining) };
}

function expiryLabel(daysRemaining: number): string {
  if (daysRemaining < 0) {
    const days = Math.abs(daysRemaining);
    return days === 1 ? "Expired 1d ago" : `Expired ${days}d ago`;
  }
  if (daysRemaining === 0) return "Expires today";
  if (daysRemaining === 1) return "Expires tomorrow";
  return `Expires in ${daysRemaining}d`;
}

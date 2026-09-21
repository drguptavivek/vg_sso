export const INDIAN_MOBILE_PATTERN = /^[6-9]\d{9}$/;

export function normalizePhoneNumber(value: string | null | undefined): string {
  const compact = value?.trim().replace(/\s+/g, "") ?? "";
  if (/^0\d{10}$/.test(compact)) return compact.slice(1);
  if (/^\+91\d{10}$/.test(compact)) return compact.slice(3);
  if (/^91\d{10}$/.test(compact)) return compact.slice(2);
  return compact;
}

export function isValidPhoneNumber(value: string | null | undefined): boolean {
  return INDIAN_MOBILE_PATTERN.test(normalizePhoneNumber(value));
}

export function formatPhoneNumberInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 12);
  const normalized =
    digits.length === 11 && digits.startsWith("0")
      ? digits.slice(1)
      : digits.length === 12 && digits.startsWith("91")
        ? digits.slice(2)
        : digits;
  return normalized.length > 5 ? `${normalized.slice(0, 5)} ${normalized.slice(5)}` : normalized;
}

export const PHONE_NUMBER_ERROR =
  "Enter a valid 10-digit Indian mobile number beginning with 6, 7, 8, or 9. International numbers are not supported.";

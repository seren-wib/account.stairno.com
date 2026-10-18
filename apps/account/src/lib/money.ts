// DR-9: the API sends whole minor units next to a currency code. This only displays them, in the
// page language; nothing is computed from the result.
const MINOR_DIGITS: Record<string, number> = { KRW: 0, USD: 2 };

export function formatMoney(amount: number, currency: string, locale: string): string {
  const digits = MINOR_DIGITS[currency] ?? 0;
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    amount / 10 ** digits,
  );
}

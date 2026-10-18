// DR-9: amounts are whole minor units next to a currency code. Providers that speak decimal
// strings (PayPal's "9.00") are converted at the edge, with integer arithmetic only. A currency
// whose minor unit is not listed here is refused rather than guessed.
const MINOR_DIGITS: Record<string, number> = { KRW: 0, USD: 2 };

function digitsOf(currency: string): number {
  const digits = MINOR_DIGITS[currency];
  if (digits === undefined) throw new Error(`No minor unit is known for ${currency}.`);
  return digits;
}

export function toDecimalString(amount: number, currency: string): string {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error(`Not an amount: ${amount}`);
  const digits = digitsOf(currency);
  if (digits === 0) return String(amount);
  const unit = 10 ** digits;
  return `${Math.floor(amount / unit)}.${String(amount % unit).padStart(digits, '0')}`;
}

export function fromDecimalString(value: string, currency: string): number {
  const digits = digitsOf(currency);
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error(`Not a decimal amount: ${JSON.stringify(value)}`);
  const [, whole = '', fraction = ''] = match;
  if (fraction.length > digits) throw new Error(`Too many decimals for ${currency}: ${value}`);
  const amount = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0') || '0');
  if (!Number.isSafeInteger(amount)) throw new Error(`Amount out of range: ${value}`);
  return amount;
}

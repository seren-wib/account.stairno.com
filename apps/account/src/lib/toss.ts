// Toss's card window (FR-45, UC-5). The SDK is loaded on /payment-methods only, and the page's
// CSP allows Toss there and nowhere else (NFR-7, SDD §7.4).
export const TOSS_SDK_URL = 'https://js.tosspayments.com/v2/standard';

export type CardWindowResult =
  | { kind: 'registered'; authKey: string; customerKey: string }
  | { kind: 'canceled' }
  | { kind: 'failed' };

// Toss sends the visitor back with ?customerKey&authKey on success and ?code&message on failure
// (Toss billing guide). PAY_PROCESS_CANCELED is the visitor closing the window.
export function cardWindowResult(query: URLSearchParams): CardWindowResult | null {
  const authKey = query.get('authKey');
  const customerKey = query.get('customerKey');
  if (authKey && customerKey) return { kind: 'registered', authKey, customerKey };
  const code = query.get('code');
  if (!code) return null;
  return code === 'PAY_PROCESS_CANCELED' ? { kind: 'canceled' } : { kind: 'failed' };
}

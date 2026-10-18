// Toss's card window (FR-45, UC-5). The SDK is loaded on /payment-methods only, and the page's
// CSP allows Toss there and nowhere else (NFR-7, SDD §7.4).
export const TOSS_SDK_URL = 'https://js.tosspayments.com/v2/standard';

// Before it moves the page to Toss, the SDK calls Toss's gateway (apigw-sandbox in test) and its
// log and event hosts; a CSP that blocks them leaves the button doing nothing (checked 2026-10-18).
export const TOSS_CONNECT_SRC = ['https://*.tosspayments.com'];

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

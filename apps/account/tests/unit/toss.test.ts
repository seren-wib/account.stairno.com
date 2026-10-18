import { describe, expect, it } from 'vitest';
import { cardWindowResult, TOSS_CONNECT_SRC, TOSS_SDK_URL } from '../../src/lib/toss';

// UC-5: Toss sends the visitor back to this page with the result in the query (Toss billing guide).

describe('Toss card window', () => {
  it('NFR-7 loads SDK v2 standard from Toss only', () => {
    expect(TOSS_SDK_URL).toBe('https://js.tosspayments.com/v2/standard');
  });

  it('NFR-7 lets the SDK reach Toss hosts and nothing else', () => {
    expect(TOSS_CONNECT_SRC).toEqual(['https://*.tosspayments.com']);
  });

  it('FR-45 reads authKey and customerKey after a registration', () => {
    expect(cardWindowResult(new URLSearchParams('customerKey=cus_abc&authKey=auth_1'))).toEqual({
      kind: 'registered',
      authKey: 'auth_1',
      customerKey: 'cus_abc',
    });
  });

  it('tells a cancel from a failure', () => {
    expect(cardWindowResult(new URLSearchParams('code=PAY_PROCESS_CANCELED&message=x'))).toEqual({
      kind: 'canceled',
    });
    expect(cardWindowResult(new URLSearchParams('code=PAY_PROCESS_ABORTED&message=x'))).toEqual({
      kind: 'failed',
    });
    expect(cardWindowResult(new URLSearchParams('code=INVALID_CARD_NUMBER'))).toEqual({
      kind: 'failed',
    });
  });

  it('is nothing on a plain visit or with half a result', () => {
    expect(cardWindowResult(new URLSearchParams(''))).toBeNull();
    expect(cardWindowResult(new URLSearchParams('authKey=auth_1'))).toBeNull();
  });
});

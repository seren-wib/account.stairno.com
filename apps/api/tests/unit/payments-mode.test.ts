import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { AppEnv, Deps } from '../../src/deps';
import { parsePaymentsMode, requirePayments } from '../../src/payments/mode';

// FR-42, NFR-11: PAYMENTS_MODE picks test, live or off. Anything else counts as off, so a typo
// in the Worker's variables stops payments instead of starting them in an unknown mode.

describe('parsePaymentsMode', () => {
  it.each([
    ['test', 'test'],
    ['live', 'live'],
    ['off', 'off'],
  ] as const)('FR-42 reads %s', (value, mode) => {
    expect(parsePaymentsMode(value)).toBe(mode);
  });

  it.each([undefined, '', 'TEST', 'on', ' live'])('FR-42 treats %j as off', (value) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(parsePaymentsMode(value)).toBe('off');
  });
});

function appWith(paymentsMode: Deps['paymentsMode']) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('deps', { paymentsMode } as Deps);
    await next();
  });
  app.post('/v1/orders', requirePayments, (c) => c.json({ ok: true }, 201));
  return app;
}

describe('requirePayments', () => {
  it('FR-42 answers 503 payments_off when payments are off', async () => {
    const res = await appWith('off').request('/v1/orders', { method: 'POST' });

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'payments_off' } });
  });

  it.each(['test', 'live'] as const)('FR-42 lets the request through in %s mode', async (mode) => {
    const res = await appWith(mode).request('/v1/orders', { method: 'POST' });

    expect(res.status).toBe(201);
  });
});

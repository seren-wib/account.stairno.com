import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  allowedFrom,
  InvalidTransition,
  orderEvents,
  orderStatuses,
  transition,
  type OrderEvent,
  type OrderStatus,
} from '../../src/payments/orders';

const created = new Date('2026-10-18T09:00:00Z');
const expiresAt = new Date('2026-10-18T09:30:00Z');
const now = new Date('2026-10-18T09:10:00Z');

function order(status: OrderStatus) {
  return { status, expiresAt };
}

// FR-36 and SDD §6.2: every move the order may make, and nothing else.
const allowed: [OrderStatus, OrderEvent, OrderStatus][] = [
  ['pending', 'confirm', 'paid'],
  ['pending', 'fail', 'failed'],
  ['pending', 'expire', 'expired'],
  ['paid', 'grant', 'fulfilled'],
  ['paid', 'refund', 'refunded'],
  ['fulfilled', 'refund', 'refunded'],
];

const rejected = orderStatuses.flatMap((from) =>
  orderEvents
    .filter((event) => !allowed.some(([f, e]) => f === from && e === event))
    .map((event) => [from, event] as [OrderStatus, OrderEvent]),
);

describe('order state machine', () => {
  it.each(allowed)('FR-36 %s --%s--> %s', (from, event, to) => {
    const at = event === 'expire' ? expiresAt : now;

    expect(transition(order(from), event, at).status).toBe(to);
  });

  it.each(rejected)('FR-36 rejects %s --%s-->', (from, event) => {
    expect(() => transition(order(from), event, now)).toThrow(InvalidTransition);
  });

  it('FR-36 covers every status and event pair exactly once', () => {
    expect(allowed.length + rejected.length).toBe(orderStatuses.length * orderEvents.length);
  });

  it('FR-36 a rejected move carries the invalid_transition code and both ends', () => {
    try {
      transition(order('refunded'), 'confirm', now);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTransition);
      expect(error).toMatchObject({
        code: 'invalid_transition',
        from: 'refunded',
        event: 'confirm',
      });
    }
  });

  it('FR-36 a pending order expires only once its 30 minutes are over', () => {
    expect(() => transition(order('pending'), 'expire', now)).toThrow(InvalidTransition);
    expect(transition(order('pending'), 'expire', expiresAt).status).toBe('expired');
  });

  it('FR-36 an expired order can no longer be paid', () => {
    const late = new Date('2026-10-18T09:31:00Z');

    expect(() => transition(order('pending'), 'confirm', late)).toThrow(InvalidTransition);
  });

  it('FR-36 stamps the time of each move it makes', () => {
    expect(transition(order('pending'), 'confirm', now)).toEqual({ status: 'paid', paidAt: now });
    expect(transition(order('paid'), 'grant', now)).toEqual({
      status: 'fulfilled',
      fulfilledAt: now,
    });
    expect(transition(order('fulfilled'), 'refund', now)).toEqual({
      status: 'refunded',
      refundedAt: now,
    });
    expect(transition(order('pending'), 'fail', now)).toEqual({ status: 'failed' });
  });

  it('FR-36 returns a change and leaves the order untouched', () => {
    const before = { status: 'pending' as const, expiresAt, createdAt: created };

    transition(before, 'confirm', now);

    expect(before.status).toBe('pending');
  });

  // SDD §6.2: the SQL that applies a move guards on the statuses the table allows for that event,
  // so the database and transition() never disagree.
  it.each(orderEvents)('FR-36 names the statuses %s may leave from', (event) => {
    const expected = allowed.filter(([, e]) => e === event).map(([from]) => from);

    expect(allowedFrom(event).sort()).toEqual(expected.sort());
  });

  it('NFR-13 the state machine knows no payment provider', async () => {
    const source = await readFile(new URL('../../src/payments/orders.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map(([, path]) => path);

    expect(imports.filter((path) => /toss|paypal|fake/.test(path!))).toEqual([]);
  });
});

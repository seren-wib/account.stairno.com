// SDD §6.2, FR-36. The order state machine: one function decides every move, and anything outside
// the table below is rejected. It only computes the change; the caller writes it in the same
// transaction as its side effects (NFR-12). It knows nothing about payment providers (NFR-13).

export const orderStatuses = [
  'pending',
  'paid',
  'fulfilled',
  'failed',
  'refunded',
  'expired',
] as const;
export type OrderStatus = (typeof orderStatuses)[number];

// confirm: the provider approved the right amount. fail: it declined or the amount was wrong.
// grant: the entitlement exists. refund: a full cancel went through. expire: 30 minutes passed.
export const orderEvents = ['confirm', 'fail', 'grant', 'refund', 'expire'] as const;
export type OrderEvent = (typeof orderEvents)[number];

const moves: Partial<Record<OrderStatus, Partial<Record<OrderEvent, OrderStatus>>>> = {
  pending: { confirm: 'paid', fail: 'failed', expire: 'expired' },
  paid: { grant: 'fulfilled', refund: 'refunded' },
  fulfilled: { refund: 'refunded' },
};

export interface OrderChange {
  status: OrderStatus;
  paidAt?: Date;
  fulfilledAt?: Date;
  refundedAt?: Date;
}

export class InvalidTransition extends Error {
  readonly code = 'invalid_transition';

  constructor(
    readonly from: OrderStatus,
    readonly event: OrderEvent,
  ) {
    super(`An order that is ${from} cannot take ${event}.`);
    this.name = 'InvalidTransition';
  }
}

export function transition(
  order: { status: OrderStatus; expiresAt: Date },
  event: OrderEvent,
  now: Date = new Date(),
): OrderChange {
  const to = moves[order.status]?.[event];
  if (!to) throw new InvalidTransition(order.status, event);

  // A pending order is open for exactly its 30 minutes: it cannot expire early or be paid late.
  const overdue = now.getTime() >= order.expiresAt.getTime();
  if (event === 'expire' && !overdue) throw new InvalidTransition(order.status, event);
  if (event === 'confirm' && overdue) throw new InvalidTransition(order.status, event);

  switch (to) {
    case 'paid':
      return { status: to, paidAt: now };
    case 'fulfilled':
      return { status: to, fulfilledAt: now };
    case 'refunded':
      return { status: to, refundedAt: now };
    default:
      return { status: to };
  }
}

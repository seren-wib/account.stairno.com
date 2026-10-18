// SDD §6.1. The one boundary between the API and a payment provider (NFR-13): the order state
// machine and the routes see this interface, never Toss or PayPal. Tests run on the fake (NFR-16).
// Amounts are integers in the currency's smallest unit next to the currency code (DR-9).

export type ProviderId = 'toss' | 'paypal' | 'fake';

// What an adapter needs to know about our order. The provider sees the order id as its own
// order reference (Toss `orderId`, PayPal `custom_id`).
export interface OrderRef {
  id: string;
  amount: number;
  currency: string;
}

export interface PaymentResult {
  // 'done' approved, 'failed' declined, 'canceled' after a cancel or refund
  status: 'done' | 'failed' | 'canceled';
  providerPaymentKey: string;
  // As the provider reports them, to compare with the order (FR-37, FR-50)
  amount: number;
  currency: string;
  // Card company and last four digits, never the card itself (DR-4)
  methodSummary?: string;
  receiptUrl?: string;
  failureReason?: string;
  // The provider's response as received, for the payment row
  raw: unknown;
}

export interface BillingKey {
  billingKey: string;
  customerKey: string;
  cardCompany?: string;
  cardLast4?: string;
}

// A webhook the adapter has verified (signature or a lookup at the provider, FR-70).
export interface WebhookEvent {
  eventId: string;
  eventType: string;
  providerPaymentKey: string;
  status: PaymentResult['status'];
  raw: unknown;
}

export interface PaymentProvider {
  readonly id: ProviderId;
  confirm(input: {
    order: OrderRef;
    providerPaymentKey: string;
    amount: number;
    currency: string;
  }): Promise<PaymentResult>;
  // Full cancel or refund only (FR-47, FR-51)
  cancel(input: { providerPaymentKey: string; reason: string }): Promise<PaymentResult>;
  // Billing keys are Toss only (FR-45, FR-46, FR-53)
  issueBillingKey?(input: { customerKey: string; authKey: string }): Promise<BillingKey>;
  deleteBillingKey?(billingKey: string): Promise<void>;
  chargeBillingKey?(input: {
    billingKey: string;
    customerKey: string;
    order: OrderRef;
  }): Promise<PaymentResult>;
  // null when the request cannot be trusted
  verifyWebhook(req: Request): Promise<WebhookEvent | null>;
}

// The provider could not be reached or answered with something we cannot use. Routes turn it
// into 502 provider_error (SDD §8); a decline is a PaymentResult with status 'failed', not this.
export class ProviderError extends Error {
  readonly code = 'provider_error';

  constructor(
    readonly provider: ProviderId,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

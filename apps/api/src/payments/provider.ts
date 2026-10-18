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
  // 'done' approved, 'failed' declined, 'canceled' after a cancel or refund, 'pending' not final
  // yet (a PayPal payer who has not approved, or a capture PayPal still holds): nothing is written
  status: 'done' | 'failed' | 'canceled' | 'pending';
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
  // Stable across the provider's retries, so a repeated delivery is recognised (FR-68)
  eventId: string;
  eventType: string;
  providerPaymentKey: string;
  status: PaymentResult['status'];
  // Our order id as the provider knows it (Toss orderId, PayPal custom_id); null when absent
  orderRef: string | null;
  // The payment as the provider reports it now, not as the webhook body claims
  payment: PaymentResult | null;
  raw: unknown;
}

export interface Checkout {
  // The provider's own order id; kept on our order so a site cannot swap it (FR-49)
  providerOrderId: string;
  // Where the site sends the payer to approve
  approvalUrl: string;
}

export interface PaymentProvider {
  readonly id: ProviderId;
  // Providers that need their own order before the payer approves (PayPal, FR-49)
  createCheckout?(input: {
    order: OrderRef;
    returnUrl: string;
    cancelUrl: string;
  }): Promise<Checkout>;
  // Toss: confirm the paymentKey. PayPal: capture the provider order id given as the key; the
  // result's providerPaymentKey is then the capture id.
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
  // A decline is a 'failed' result (FR-55 retries it); only the provider failing throws.
  chargeBillingKey?(input: {
    billingKey: string;
    customerKey: string;
    order: OrderRef;
    // What the buyer's statement shows; Toss requires it
    orderName: string;
  }): Promise<PaymentResult>;
  // null when the request cannot be trusted
  verifyWebhook(req: Request): Promise<WebhookEvent | null>;
}

// The provider looked at the request and said no for the buyer's reasons (a card refused at
// registration, FR-45). Routes answer 422; this is not the provider failing.
export class PaymentRefused extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly reason: string,
  ) {
    super(`${provider} refused: ${reason}`);
    this.name = 'PaymentRefused';
  }
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

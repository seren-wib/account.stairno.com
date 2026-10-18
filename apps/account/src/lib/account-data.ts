// What the signed-in pages read from /v1, narrowed to what their sections show. The pages read,
// the sections render, so one page can hold several sections (SDD §7.1).

// GET /v1/sessions (FR-7).
export interface Session {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  browser: string | null;
  os: string | null;
  current: boolean;
}

// GET /v1/connections (FR-21).
export interface Connection {
  clientId: string;
  name: string;
  connectedAt: string;
  lastUsedAt: string;
}

// GET /v1/payment-methods (FR-45, FR-53). The API keeps the billing keys; this is what is safe to show.
export interface Card {
  id: string;
  provider: string;
  cardCompany: string | null;
  cardLast4: string | null;
  isDefault: boolean;
  createdAt: string;
}

export interface CardList {
  items: Card[];
  customerKey: string;
  clientKey: string | null;
}

// GET /v1/subscriptions (FR-32, FR-56).
export interface Subscription {
  id: string;
  name: { ko: string; en: string };
  status: 'active' | 'past_due' | 'canceled' | 'expired';
  amount: number | null;
  currency: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  card: { cardCompany: string | null; cardLast4: string | null } | null;
}

// GET /v1/me/downloads (FR-62).
export interface Download {
  sku: string;
  name: { ko: string; en: string };
  expiresAt: string | null;
}

// FR-2, FR-45: Toss's window opens only for a verified address and once Toss is set up. The page
// asks this to decide its CSP, the section to decide the button.
export function canAddCard(list: CardList | null, emailVerified: boolean): boolean {
  return Boolean(list?.clientKey) && emailVerified;
}

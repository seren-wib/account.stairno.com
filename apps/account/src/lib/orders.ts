// An order as GET /v1/me/orders answers it (FR-32, FR-63).
export interface Order {
  id: string;
  sku: string;
  name: { ko: string; en: string };
  kind: string;
  status: string;
  amount: number;
  currency: string;
  provider: string;
  createdAt: string;
  paidAt: string | null;
  refundedAt: string | null;
  payment: { status: string; methodSummary: string | null; receiptUrl: string | null } | null;
  refundRequest: { status: string; requestedAt: string; resolvedAt: string | null } | null;
}

import { z } from 'zod';

// FR-63: what a site sends for its buyer's refund request. The buyer comes from the forwarded
// access token, never the body. The reason is the buyer's own words for the operator (FR-66).
export const refundRequestInputSchema = z.object({
  orderId: z.uuid(),
  reason: z.string().trim().min(1).max(1000),
});

export type RefundRequestInput = z.infer<typeof refundRequestInputSchema>;

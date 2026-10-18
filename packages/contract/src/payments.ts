import { z } from 'zod';

// FR-43: what a site sends after Toss's success redirect. `orderId` is our order id, which the
// site passed to Toss as its order reference; `amount` is checked against the order (FR-44).
export const confirmTossPaymentInputSchema = z.object({
  paymentKey: z.string().min(1).max(200),
  orderId: z.uuid(),
  amount: z.number().int().positive(),
});

export type ConfirmTossPaymentInput = z.infer<typeof confirmTossPaymentInputSchema>;

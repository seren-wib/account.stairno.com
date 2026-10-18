import { z } from 'zod';

// FR-43: what a site sends after Toss's success redirect. `orderId` is our order id, which the
// site passed to Toss as its order reference; `amount` is checked against the order (FR-44).
export const confirmTossPaymentInputSchema = z.object({
  paymentKey: z.string().min(1).max(200),
  orderId: z.uuid(),
  amount: z.number().int().positive(),
});

export type ConfirmTossPaymentInput = z.infer<typeof confirmTossPaymentInputSchema>;

// FR-49: starting and capturing a PayPal payment both name our order only. The PayPal order id
// stays inside the API, so a site cannot point a capture at another PayPal order.
export const paypalOrderInputSchema = z.object({
  orderId: z.uuid(),
});

export type PayPalOrderInput = z.infer<typeof paypalOrderInputSchema>;

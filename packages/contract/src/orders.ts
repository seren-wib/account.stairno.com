import { z } from 'zod';

// FR-35: what a site sends to create an order. The buyer is never in the body: the API takes the
// user from the access token the site forwards. KRW goes through Toss, USD through PayPal (DR-5).
export const createOrderInputSchema = z.object({
  sku: z.string().min(1),
  currency: z.enum(['KRW', 'USD']),
  // Where the provider sends the buyer back; it must be on the site's own origin.
  returnUrl: z.url({ protocol: /^https$/ }),
});

export type CreateOrderInput = z.infer<typeof createOrderInputSchema>;

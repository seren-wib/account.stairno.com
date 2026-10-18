import { z } from 'zod';

// FR-45: what the account center sends back from Toss's card window. No card number, expiry or
// CVC ever passes through here (DR-4); anything else in the input is dropped.
export const registerTossCardInputSchema = z.object({
  authKey: z.string().min(1).max(300),
  // Toss's rule: 2 to 50 of letters, digits and -_=.@
  customerKey: z.string().regex(/^[A-Za-z0-9_\-=.@]{2,50}$/),
});

export type RegisterTossCardInput = z.infer<typeof registerTossCardInputSchema>;

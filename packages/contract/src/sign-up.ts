import { z } from 'zod';

// The account center's sign-up form (FR-1, FR-9). The API checks the same rules again; the
// checkbox becomes `termsVersion` in the request.
export const signUpInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email(),
  password: z.string().min(8).max(128),
  acceptTerms: z.literal(true),
});

export type SignUpInput = z.infer<typeof signUpInputSchema>;

import { z } from 'zod';

// FR-60: what a site asks about. The product is named by its sku.
export const entitlementQuerySchema = z.object({
  sku: z.string().min(1).max(100),
});

export type EntitlementQuery = z.infer<typeof entitlementQuerySchema>;

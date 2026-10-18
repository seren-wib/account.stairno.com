import { z } from 'zod';

// SDD §8: list pages are `?cursor=&limit=` with at most 50 items. The cursor is opaque.
export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(200).optional(),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

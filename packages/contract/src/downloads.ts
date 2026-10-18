import { z } from 'zod';

// FR-62: the product whose file the user wants.
export const downloadInputSchema = z.object({
  sku: z.string().min(1).max(100),
});

export type DownloadInput = z.infer<typeof downloadInputSchema>;

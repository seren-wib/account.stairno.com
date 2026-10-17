import { z } from 'zod';
import { localeSchema } from './locale';

// FR-6: what the profile form may change. Anything else in the input is dropped.
export const profileUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  locale: localeSchema,
});

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

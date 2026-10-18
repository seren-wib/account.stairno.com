import { z } from 'zod';
import { localeSchema } from './locale';
import { countrySchema, timeZoneSchema } from './region';

// FR-6, FR-84: what the profile form may change. Anything else in the input is dropped. Country
// and time zone are optional; null clears them.
export const profileUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  locale: localeSchema,
  country: countrySchema.nullable().optional(),
  timezone: timeZoneSchema.nullable().optional(),
});

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

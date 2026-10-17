import { z } from 'zod';

// The languages of the account center and the mails (FR-73, FR-76, FR-78). Adding one means a
// new dictionary in both apps; the types then point at every place that needs it.
export const locales = ['ko', 'en'] as const;
export type Locale = (typeof locales)[number];
export const localeSchema = z.enum(locales);

import { z } from 'zod';

// FR-9, FR-31: the version of the terms of service and privacy policy a new user accepts. Bump it
// when either document changes; sign-up then requires the new version.
export const termsVersion = '2026-10-18';
export const termsVersionSchema = z.literal(termsVersion);

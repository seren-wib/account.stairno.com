// Machine-readable error codes of every API error response (FR-24, SDD §8).
export const errorCodes = [
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'validation_failed',
  'rate_limited',
  'payments_off',
  'email_not_verified',
  'invalid_transition',
  'amount_mismatch',
  'provider_error',
  // A subscription needs a saved card first; the site sends the buyer to the account center.
  'payment_method_required',
  // FR-85: a profile photo over 512 KB, or not PNG, JPEG or WebP.
  'payload_too_large',
  'unsupported_media_type',
  // Anything unexpected; the message never carries the cause (NFR-21).
  'internal_error',
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export interface ErrorBody {
  error: { code: ErrorCode; message: string };
}

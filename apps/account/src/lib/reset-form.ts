// Dictionary keys under resetPassword.errors.
export type ResetErrorKey =
  'expired' | 'passwordLength' | 'passwordBreached' | 'tooMany' | 'unavailable';

// FR-5: what Better Auth's reset answer means for the person holding the link.
export function resetError(status: number, code: string | undefined): ResetErrorKey {
  if (code === 'INVALID_TOKEN' || code === 'TOKEN_EXPIRED') return 'expired';
  if (code === 'PASSWORD_COMPROMISED') return 'passwordBreached';
  if (code === 'PASSWORD_TOO_SHORT' || code === 'PASSWORD_TOO_LONG') return 'passwordLength';
  if (status === 429) return 'tooMany';
  return 'unavailable';
}

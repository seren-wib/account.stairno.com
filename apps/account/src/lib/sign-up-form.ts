import { signUpInputSchema } from '@stairno-account/contract';

// Dictionary keys under signUp.errors.
export type SignUpErrorKey =
  | 'name'
  | 'email'
  | 'passwordLength'
  | 'passwordBreached'
  | 'emailTaken'
  | 'terms'
  | 'tooMany'
  | 'unavailable';

export type SignUpField = 'name' | 'email' | 'password' | 'acceptTerms';

const fieldKey: Record<SignUpField, SignUpErrorKey> = {
  name: 'name',
  email: 'email',
  password: 'passwordLength',
  acceptTerms: 'terms',
};

// NFR-17: the same rules as the API (FR-1, FR-9), checked before sending, one message per field.
export function clientErrors(input: unknown): Partial<Record<SignUpField, SignUpErrorKey>> {
  const result = signUpInputSchema.safeParse(input);
  if (result.success) return {};
  const errors: Partial<Record<SignUpField, SignUpErrorKey>> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as SignUpField;
    if (field in fieldKey && !errors[field]) errors[field] = fieldKey[field];
  }
  return errors;
}

// Better Auth's answers, placed next to the field they are about.
export function apiErrorField(
  status: number,
  code: string | undefined,
): { field: SignUpField | 'form'; key: SignUpErrorKey } {
  if (code === 'PASSWORD_COMPROMISED') return { field: 'password', key: 'passwordBreached' };
  if (code === 'PASSWORD_TOO_SHORT' || code === 'PASSWORD_TOO_LONG') {
    return { field: 'password', key: 'passwordLength' };
  }
  if (code?.startsWith('USER_ALREADY_EXISTS')) return { field: 'email', key: 'emailTaken' };
  if (code === 'INVALID_EMAIL') return { field: 'email', key: 'email' };
  if (status === 429) return { field: 'form', key: 'tooMany' };
  return { field: 'form', key: 'unavailable' };
}

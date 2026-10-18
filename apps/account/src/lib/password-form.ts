// FR-83: changing the password while signed in. Keys are under password.errors.

export type PasswordField = 'currentPassword' | 'newPassword';
export type PasswordErrorKey =
  'currentMissing' | 'current' | 'passwordLength' | 'passwordBreached' | 'tooMany' | 'unavailable';

// What the browser can tell before asking the API: the current password is there, and the new
// one has FR-1's length.
export function passwordChangeInput(
  currentPassword: string,
  newPassword: string,
): Partial<Record<PasswordField, PasswordErrorKey>> {
  if (!currentPassword) return { currentPassword: 'currentMissing' };
  if (newPassword.length < 8 || newPassword.length > 128) return { newPassword: 'passwordLength' };
  return {};
}

// What Better Auth's answer means, and which field it belongs next to.
export function passwordChangeError(
  status: number,
  code: string | undefined,
): { field: PasswordField | 'form'; key: PasswordErrorKey } {
  if (code === 'INVALID_PASSWORD') return { field: 'currentPassword', key: 'current' };
  if (code === 'PASSWORD_COMPROMISED') return { field: 'newPassword', key: 'passwordBreached' };
  if (code === 'PASSWORD_TOO_SHORT' || code === 'PASSWORD_TOO_LONG') {
    return { field: 'newPassword', key: 'passwordLength' };
  }
  if (status === 429) return { field: 'form', key: 'tooMany' };
  return { field: 'form', key: 'unavailable' };
}

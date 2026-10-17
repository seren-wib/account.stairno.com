// FR-8: Better Auth answers 400 for a wrong or missing password (the API's own hook refuses a
// deletion without one), so a 400 always belongs next to the password field.
export function deleteError(
  status: number,
  _code: string | undefined,
): { field: 'password' | 'form'; key: 'password' | 'tooMany' | 'unavailable' } {
  if (status === 400) return { field: 'password', key: 'password' };
  if (status === 429) return { field: 'form', key: 'tooMany' };
  return { field: 'form', key: 'unavailable' };
}

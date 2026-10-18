import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ZodError } from 'zod';
import type { ErrorBody, ErrorCode } from '@stairno-account/contract';

// FR-24: every API error has one shape, and `code` is one of the SDD §8 constants.
export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  code: ErrorCode,
  message: string,
) {
  const body: ErrorBody = { error: { code, message } };
  return c.json(body, status);
}

// FR-24: input that fails a contract schema is 422 with the zod issues, so the account center can
// put each message next to its field (NFR-17).
export function validationError(c: Context, error: ZodError) {
  return invalid(
    c,
    error.issues.map(({ path, code, message }) => ({ path, code, message })),
  );
}

// The same 422 for a field that passed the schema but not a rule that needs the database, such as
// a currency the product has no price in.
export function invalidField(c: Context, field: string, message: string) {
  return invalid(c, [{ path: [field], code: 'custom', message }]);
}

function invalid(c: Context, issues: { path: PropertyKey[]; code: string; message: string }[]) {
  return c.json(
    {
      error: {
        code: 'validation_failed' satisfies ErrorCode,
        message: 'The request is not valid.',
        issues,
      },
    },
    422,
  );
}

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
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

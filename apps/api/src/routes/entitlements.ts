import { Hono } from 'hono';
import { entitlementQuerySchema } from '@stairno-account/contract';
import type { AppEnv } from '../deps';
import { apiError, validationError } from '../http/errors';
import { requireUser } from '../middleware/session';
import { describeEntitlement, readEntitlement } from '../payments/entitlement-store';

// FR-58 to FR-61 (SDD §6.8): a site asks, with its user's access token, what the user may use of
// one of its products. A token sees only the products of the site it was issued to; the account
// center's session sees any. The site may keep the answer for a minute, for that user only.

export const entitlementRoutes = new Hono<AppEnv>().use(requireUser).get('/', async (c) => {
  const parsed = entitlementQuerySchema.safeParse({ sku: c.req.query('sku') });
  if (!parsed.success) return validationError(c, parsed.error);

  const row = await readEntitlement(c.var.deps.db, {
    userId: c.var.user.id,
    sku: parsed.data.sku,
    clientId: c.var.tokenClient,
  });
  if (!row) return apiError(c, 404, 'not_found', 'There is no such product.');

  c.header('cache-control', 'private, max-age=60');
  return c.json(describeEntitlement(row));
});

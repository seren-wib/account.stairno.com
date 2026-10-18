import { Hono } from 'hono';
import { downloadInputSchema } from '@stairno-account/contract';
import type { AppEnv } from '../deps';
import { apiError, validationError } from '../http/errors';
import { requireUser } from '../middleware/session';
import { signDownload, verifyDownload } from '../downloads/signed-url';
import { describeEntitlement, readEntitlement } from '../payments/entitlement-store';

// FR-62 (SDD §6.8). A user who may use a desktop product asks for its file (a site with the
// user's token, or the account center) and gets a link for ten minutes. The link is the API's
// own, signed; following it streams the file from R2. Logs carry the sku and the file key only.

const LINK_MINUTES = 10;

export const downloadRoutes = new Hono<AppEnv>().use(requireUser).post('/', async (c) => {
  const { db, downloads, downloadSecret } = c.var.deps;
  const parsed = downloadInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return validationError(c, parsed.error);

  const row = await readEntitlement(db, {
    userId: c.var.user.id,
    sku: parsed.data.sku,
    clientId: c.var.tokenClient,
  });
  if (!row) return apiError(c, 404, 'not_found', 'There is no such product.');
  if (!row.download_key) {
    return apiError(c, 404, 'not_found', 'This product has nothing to download.');
  }
  if (!describeEntitlement(row).downloadable) {
    return apiError(c, 403, 'forbidden', 'You cannot download this product.');
  }
  if (!downloads) {
    return apiError(c, 503, 'payments_off', 'Downloads are not available right now.');
  }

  const expiresAt = Date.now() + LINK_MINUTES * 60_000;
  const token = await signDownload(downloadSecret, row.download_key, expiresAt);
  console.info('download link issued', { sku: row.sku });
  return c.json(
    {
      url: `${new URL(c.req.url).origin}/downloads/${token}`,
      expiresAt: new Date(expiresAt).toISOString(),
    },
    201,
  );
});

// The link itself: no session, the signature is the permission.
export const downloadFileRoutes = new Hono<AppEnv>().get('/:token', async (c) => {
  const { downloads, downloadSecret } = c.var.deps;
  const key = await verifyDownload(downloadSecret, c.req.param('token'));
  if (!key) return apiError(c, 403, 'forbidden', 'This download link is not valid any more.');
  const file = await downloads?.get(key);
  if (!file) {
    console.error('download file missing', { key });
    return apiError(c, 404, 'not_found', 'The file is not there.');
  }
  const name = key
    .split('/')
    .pop()!
    .replace(/["\\\r\n]/g, '');
  return new Response(file.body, {
    headers: {
      'content-type': file.httpMetadata?.contentType ?? 'application/octet-stream',
      'content-length': String(file.size),
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'private, no-store',
    },
  });
});

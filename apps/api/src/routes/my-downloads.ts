import { Hono } from 'hono';
import type { AppEnv } from '../deps';
import { requireCookieSession, requireUser } from '../middleware/session';
import { listDownloads } from '../payments/entitlement-store';

// FR-62, FR-29: the account center's downloads page lists what the user may download from every
// site; each one then asks POST /v1/downloads for its link. Only the account center's session
// reads it, like the order history.
export const myDownloadRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .use(requireCookieSession)
  .get('/', async (c) => {
    const rows = await listDownloads(c.var.deps.db, c.var.user.id);
    return c.json({
      items: rows.map((row) => ({
        sku: row.sku,
        name: { ko: row.name_ko, en: row.name_en },
        expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
      })),
      // SDD §8 list shape; a user owns a handful at most, so one page.
      nextCursor: null,
    });
  });

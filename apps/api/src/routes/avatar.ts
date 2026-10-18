import { Hono } from 'hono';
import type { AppEnv } from '../deps';
import { apiError } from '../http/errors';
import { requireCookieSession, requireUser } from '../middleware/session';
import { MAX_BYTES, photoType, readPhoto, removePhoto, savePhoto } from '../avatars/store';

// FR-85 (SDD §7.6). The account center sends the picture as the request body; only its own
// session may change it.
export const myImageRoutes = new Hono<AppEnv>()
  .use(requireUser, requireCookieSession)
  .put('/', async (c) => {
    const { db, apiUrl, avatars } = c.var.deps;
    if (!avatars) return apiError(c, 503, 'internal_error', 'Photos are not available right now.');
    const declared = Number(c.req.header('content-length') ?? 0);
    if (declared > MAX_BYTES) {
      return apiError(c, 413, 'payload_too_large', 'The photo can be 512 KB at most.');
    }
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) {
      return apiError(c, 413, 'payload_too_large', 'The photo can be 512 KB at most.');
    }
    const type = photoType(c.req.header('content-type'), bytes);
    if (!type) {
      return apiError(c, 415, 'unsupported_media_type', 'The photo must be PNG, JPEG or WebP.');
    }
    const image = await savePhoto({ db, apiUrl, avatars }, c.var.user.id, type, bytes);
    return c.json({ image });
  })
  .delete('/', async (c) => {
    const { db, avatars } = c.var.deps;
    if (!avatars) return apiError(c, 503, 'internal_error', 'Photos are not available right now.');
    await removePhoto({ db, avatars }, c.var.user.id);
    return c.json({ image: null });
  });

// The public address of a photo: no session, the address is the permission. The name changes
// with the picture, so it may be cached for a year.
export const avatarFileRoutes = new Hono<AppEnv>().get('/:userId/:file', async (c) => {
  const found = await readPhoto(c.var.deps.avatars, c.req.param('userId'), c.req.param('file'));
  if (!found) return apiError(c, 404, 'not_found', 'There is no such photo.');
  return new Response(found.object.body, {
    headers: {
      'content-type': found.type,
      'content-length': String(found.object.size),
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
});

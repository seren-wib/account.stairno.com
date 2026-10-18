import { sql } from 'drizzle-orm';
import type { Deps } from '../deps';

// FR-85 (SDD §7.6): profile photos in R2 under avatars/{userId}/. The browser has already made
// the picture small and square; the API only checks its size and type and keeps it. The file name
// is a hash of the bytes, so its public address changes with the picture and can be cached for
// good.

export const MAX_BYTES = 512 * 1024;

const TYPES = {
  'image/png': { ext: 'png', matches: (b: Uint8Array) => startsWith(b, [0x89, 0x50, 0x4e, 0x47]) },
  'image/jpeg': { ext: 'jpg', matches: (b: Uint8Array) => startsWith(b, [0xff, 0xd8, 0xff]) },
  'image/webp': {
    ext: 'webp',
    matches: (b: Uint8Array) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP',
  },
} as const;

export type PhotoType = keyof typeof TYPES;

const EXT_TYPE: Record<string, PhotoType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

function startsWith(bytes: Uint8Array, prefix: number[]) {
  return prefix.every((value, i) => bytes[i] === value);
}

function ascii(bytes: Uint8Array, from: number, to: number) {
  return String.fromCharCode(...bytes.subarray(from, to));
}

// The stated type, when the bytes really are that format; null otherwise.
export function photoType(contentType: string | undefined, bytes: Uint8Array): PhotoType | null {
  const type = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  if (!(type in TYPES)) return null;
  return TYPES[type as PhotoType].matches(bytes) ? (type as PhotoType) : null;
}

const prefixOf = (userId: string) => `avatars/${userId}/`;

async function setImage(db: Deps['db'], userId: string, url: string | null) {
  await db.execute(sql`update "user" set image = ${url}, updated_at = now() where id = ${userId}`);
}

// Every file of the user except `keep`.
async function removeFiles(bucket: NonNullable<Deps['avatars']>, userId: string, keep?: string) {
  const { objects } = await bucket.list({ prefix: prefixOf(userId) });
  const keys = objects.map((o) => o.key).filter((key) => key !== keep);
  if (keys.length > 0) await bucket.delete(keys);
}

export async function savePhoto(
  deps: Pick<Deps, 'db' | 'apiUrl'> & { avatars: NonNullable<Deps['avatars']> },
  userId: string,
  type: PhotoType,
  bytes: Uint8Array,
): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hash = [...digest.subarray(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const file = `${hash}.${TYPES[type].ext}`;
  const key = `${prefixOf(userId)}${file}`;
  await deps.avatars.put(key, bytes, { httpMetadata: { contentType: type } });
  const url = `${deps.apiUrl}/v1/avatars/${userId}/${file}`;
  await setImage(deps.db, userId, url);
  await removeFiles(deps.avatars, userId, key);
  return url;
}

export async function removePhoto(
  deps: Pick<Deps, 'db'> & { avatars: NonNullable<Deps['avatars']> },
  userId: string,
): Promise<void> {
  await setImage(deps.db, userId, null);
  await removeFiles(deps.avatars, userId);
}

// The stored file behind a public address, or null for anything that is not one.
export async function readPhoto(bucket: Deps['avatars'], userId: string, file: string) {
  const name = /^([0-9a-f]{16})\.(png|jpg|webp)$/.exec(file);
  if (!bucket || !name || !/^[0-9a-f-]{36}$/.test(userId)) return null;
  const object = await bucket.get(`${prefixOf(userId)}${file}`);
  return object ? { object, type: EXT_TYPE[name[2]!]! } : null;
}

// FR-8: the photos go with the account. A failure is logged by user id and does not hold the
// deletion up; the files can then be removed by hand under the logged prefix.
export async function removeAvatarsOf(deps: Pick<Deps, 'avatars'>, userId: string) {
  if (!deps.avatars) return;
  try {
    await removeFiles(deps.avatars, userId);
  } catch {
    console.error('avatar files left behind; remove them by hand', { userId });
  }
}

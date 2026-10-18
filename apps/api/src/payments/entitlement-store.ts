import { sql, type SQL } from 'drizzle-orm';
import type { Deps } from '../deps';

// FR-58 to FR-61: what a user may use of one product, in one read (NFR-2).

type Db = Deps['db'];

export interface EntitlementRow {
  sku: string;
  kind: string;
  // The R2 key of its file, for desktop products (FR-62)
  download_key: string | null;
  // Every price of the product is 0: the free plan with a card on file (FR-58)
  free: boolean;
  has_card: boolean;
  // null when the user has no entitlement row for the product
  status: string | null;
  expires_at: string | Date | null;
  downloadable: boolean | null;
  unexpired: boolean | null;
}

async function rows<T>(db: Db, query: SQL): Promise<T[]> {
  return ((await db.execute(query)) as { rows: T[] }).rows;
}

// undefined when there is no such product, or it belongs to another site than `clientId`.
export async function readEntitlement(
  db: Db,
  input: { userId: string; sku: string; clientId: string | null },
): Promise<EntitlementRow | undefined> {
  const ofSite = input.clientId === null ? sql`true` : sql`p.client_id = ${input.clientId}`;
  const [row] = await rows<EntitlementRow>(
    db,
    sql`
      select p.sku, p.kind, p.download_key,
             coalesce((select bool_and(pp.amount = 0) from product_price pp
                       where pp.product_id = p.id), false) as free,
             exists (select 1 from payment_method pm
                     where pm.user_id = ${input.userId} and pm.deleted_at is null) as has_card,
             e.status, e.expires_at, e.downloadable,
             e.expires_at is null or e.expires_at > now() as unexpired
      from product p
      left join entitlement e on e.product_id = p.id and e.user_id = ${input.userId}
      where p.sku = ${input.sku} and ${ofSite}`,
  );
  return row;
}

export type EntitlementStatus =
  'active' | 'expired' | 'revoked' | 'none' | 'requires_payment_method';

// What the row means for the user now (FR-58, FR-61).
export function describeEntitlement(row: EntitlementRow) {
  // FR-58: the free plan is the card on file; there is nothing to buy and no row.
  const freePlan = row.kind === 'subscription' && row.free;
  let status: EntitlementStatus;
  if (freePlan) status = row.has_card ? 'active' : 'requires_payment_method';
  else if (row.status === null) status = 'none';
  else if (row.status === 'revoked') status = 'revoked';
  else status = row.unexpired ? 'active' : 'expired';
  return {
    sku: row.sku,
    status,
    active: status === 'active',
    expiresAt:
      !freePlan && row.status !== null && row.expires_at
        ? new Date(row.expires_at).toISOString()
        : null,
    downloadable: status === 'active' && Boolean(row.downloadable),
  };
}

// FR-62: the desktop products the user may download now, oldest entitlement first.
export function listDownloads(db: Db, userId: string) {
  return rows<{ sku: string; name_ko: string; name_en: string; expires_at: string | Date | null }>(
    db,
    sql`
      select p.sku, p.name_ko, p.name_en, e.expires_at
      from entitlement e join product p on p.id = e.product_id
      where e.user_id = ${userId} and e.status = 'active' and e.downloadable
        and p.download_key is not null
        and (e.expires_at is null or e.expires_at > now())
      order by e.created_at, p.sku`,
  );
}

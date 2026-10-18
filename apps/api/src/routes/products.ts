import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { AppEnv } from '../deps';
import { apiError } from '../http/errors';

interface ProductRow {
  sku: string;
  name_ko: string;
  name_en: string;
  kind: 'one_time' | 'subscription';
  interval: 'month' | 'year' | null;
  downloadable: boolean;
  prices: { currency: string; amount: number }[] | null;
}

// FR-34. What a site or the account center shows about a product: names, kind, prices. The R2 key
// stays inside the API; downloads go through FR-62. Inactive products are not for sale and read
// as missing.
export const productRoutes = new Hono<AppEnv>().get('/:sku', async (c) => {
  const result = (await c.var.deps.db.execute(sql`
    select p.sku, p.name_ko, p.name_en, p.kind, p.interval,
           p.download_key is not null as downloadable,
           (select json_agg(json_build_object('currency', pp.currency, 'amount', pp.amount)
                            order by pp.currency)
              from product_price pp where pp.product_id = p.id) as prices
    from product p
    where p.sku = ${c.req.param('sku')} and p.active`)) as { rows: ProductRow[] };
  const [row] = result.rows;
  if (!row) return apiError(c, 404, 'not_found', 'There is no such product.');

  return c.json({
    sku: row.sku,
    name: { ko: row.name_ko, en: row.name_en },
    kind: row.kind,
    interval: row.interval,
    downloadable: row.downloadable,
    prices: row.prices ?? [],
  });
});

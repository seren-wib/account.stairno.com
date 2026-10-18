import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

// FR-34. Products are registered by the operator, never by a site. KRW goes through Toss and USD
// through PayPal (DR-5); amounts are integers in the smallest unit, won or cents (DR-9). A price
// of 0 is a free product whose entitlement needs a card on file (FR-58).

const INT_MAX = 2_147_483_647;

export const productInputSchema = z
  .object({
    sku: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'lower case letters, digits and hyphens'),
    clientId: z.string().min(1),
    nameKo: z.string().trim().min(1),
    nameEn: z.string().trim().min(1),
    kind: z.enum(['one_time', 'subscription']),
    interval: z.enum(['month', 'year']).optional(),
    prices: z
      .array(
        z.object({
          currency: z.enum(['KRW', 'USD']),
          amount: z.number().int().min(0).max(INT_MAX),
        }),
      )
      .min(1),
    downloadKey: z.string().min(1).optional(),
  })
  .refine((p) => (p.kind === 'subscription') === (p.interval !== undefined), {
    message: 'a subscription needs an interval and a one-time product has none',
    path: ['interval'],
  })
  .refine((p) => new Set(p.prices.map((price) => price.currency)).size === p.prices.length, {
    message: 'one price per currency',
    path: ['prices'],
  });

export type ProductInput = z.input<typeof productInputSchema>;

// The input is whatever the operator typed, so it is checked here, not by the caller's types.
// neon-http has no interactive transactions, so the product and its prices go in one statement:
// either all of it is written or none of it is.
export async function addProduct(
  db: { execute(query: SQL): Promise<unknown> },
  input: unknown,
): Promise<{ id: string; sku: string }> {
  const p = productInputSchema.parse(input);
  const prices = sql.join(
    p.prices.map((price) => sql`(${price.currency}::char(3), ${price.amount}::integer)`),
    sql`, `,
  );
  const result = (await db.execute(sql`
    with created as (
      insert into product (sku, client_id, name_ko, name_en, kind, interval, download_key)
      values (${p.sku}, ${p.clientId}, ${p.nameKo}, ${p.nameEn}, ${p.kind},
              ${p.interval ?? null}, ${p.downloadKey ?? null})
      returning id, sku
    ), priced as (
      insert into product_price (product_id, currency, amount)
      select created.id, v.currency, v.amount
      from created cross join (values ${prices}) as v(currency, amount)
    )
    select id, sku from created`)) as { rows: { id: string; sku: string }[] };
  const [row] = result.rows;
  if (!row) throw new Error('the product was not created');
  return row;
}

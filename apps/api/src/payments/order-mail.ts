import { sql } from 'drizzle-orm';
import type { Deps } from '../deps';
import { renderMail, resolveLocale } from '../mail';
import { toDecimalString } from './money';

// FR-65, FR-72 to FR-74: the payment mails. Each kind goes out at most once per order: the
// mail_log row is claimed first (unique per order and template), so a repeated confirm, a late
// webhook or a second refund run sends nothing more. A failed send is recorded and never fails
// the payment. The address stays in mail_log; logs carry ids only (NFR-21).

export type OrderMail = 'receipt' | 'renewalFailed' | 'refunded' | 'refundRejected';

type MailDeps = Pick<Deps, 'db' | 'mailer' | 'origins'>;

// The account center page the button opens (SRS 3.5: cards are a section of the billing page).
const PAGE: Record<OrderMail, string> = {
  receipt: 'orders',
  renewalFailed: 'billing#payment-methods',
  refunded: 'orders',
  refundRejected: 'orders',
};

interface Claimed {
  id: string;
  locale: string;
  to: string;
  name: string;
  name_ko: string;
  name_en: string;
  amount: number;
  currency: string;
}

// The amount as the reader's language writes it. A display only: nothing is computed from it (DR-9).
function money(amount: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'ko-KR', {
    style: 'currency',
    currency,
  }).format(Number(toDecimalString(amount, currency)));
}

export async function sendOrderMail(
  deps: MailDeps,
  input: { orderId: string; template: OrderMail },
): Promise<void> {
  const { db, mailer, origins } = deps;
  const result = (await db.execute(sql`
    with claimed as (
      insert into mail_log (user_id, template, locale, "to", status, order_id)
      select u.id, ${input.template}, coalesce(u.locale, 'ko'), u.email, 'pending', o.id
      from "order" o join "user" u on u.id = o.user_id
      where o.id = ${input.orderId}
      on conflict (order_id, template) where order_id is not null do nothing
      returning id, user_id, locale, "to"
    )
    select c.id, c.locale, c."to", u.name, p.name_ko, p.name_en, o.amount, o.currency
    from claimed c
    join "user" u on u.id = c.user_id
    join "order" o on o.id = ${input.orderId}
    join product p on p.id = o.product_id`)) as { rows: Claimed[] };
  const [claimed] = result.rows;
  // Sent before, or the order has no buyer any more (FR-8).
  if (!claimed) return;

  const locale = resolveLocale(claimed.locale);
  try {
    const sent = await mailer.send({
      to: claimed.to,
      ...renderMail(input.template, locale, {
        name: claimed.name,
        url: `${origins.account}/${locale}/${PAGE[input.template]}`,
        product: locale === 'en' ? claimed.name_en : claimed.name_ko,
        amount: money(claimed.amount, claimed.currency, locale),
      }),
    });
    await db.execute(sql`
      update mail_log set status = ${sent?.skipped ? 'skipped' : 'sent'},
                          provider_id = ${sent?.id ?? null}
      where id = ${claimed.id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('mail failed', {
      template: input.template,
      orderId: input.orderId,
      error: message,
    });
    await db.execute(sql`
      update mail_log set status = 'failed', error = ${message} where id = ${claimed.id}`);
  }
}

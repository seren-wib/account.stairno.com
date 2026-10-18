import { sql } from 'drizzle-orm';
import type { Deps } from '../deps';

// FR-68, FR-69: every verified webhook is kept with its outcome, once per provider and event id.

type Db = Deps['db'];

// Stores the event as received and returns its row id, or null when this event was already
// processed (FR-68). An event that failed before is taken again: the provider is resending it.
export async function receiveWebhookEvent(
  db: Db,
  input: { provider: string; eventId: string; eventType: string; payload: unknown },
): Promise<string | null> {
  const result = (await db.execute(sql`
    insert into webhook_event (provider, event_id, event_type, payload, status)
    values (${input.provider}, ${input.eventId}, ${input.eventType},
            ${JSON.stringify(input.payload ?? null)}::jsonb, 'received')
    on conflict (provider, event_id) do update
      set payload = excluded.payload, status = 'received', error = null, received_at = now()
      where webhook_event.status <> 'processed'
    returning id`)) as { rows: { id: string }[] };
  return result.rows[0]?.id ?? null;
}

// `processed`, or `failed` with the reason so the next delivery takes it again (FR-69).
export async function finishWebhookEvent(db: Db, id: string, error?: string): Promise<void> {
  await db.execute(sql`
    update webhook_event
    set status = ${error ? 'failed' : 'processed'}, error = ${error ?? null},
        processed_at = case when ${error === undefined} then now() else processed_at end
    where id = ${id}`);
}

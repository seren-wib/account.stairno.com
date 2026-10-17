// FR-71. Every mail goes out from this address once the stairno.com domain is verified in Resend.
export const MAIL_FROM = 'Stairno <no-reply@stairno.com>';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// The one thing the auth flows depend on. Production sends through Resend; tests pass a memory
// mailbox, so no test reaches the network.
export interface Mailer {
  // Resolves with the provider's message id when there is one.
  send(message: MailMessage): Promise<{ id?: string } | void>;
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export function createResendMailer(
  apiKey: string,
  fetchFn: Fetch = (input, init) => fetch(input, init),
): Mailer {
  return {
    async send(message) {
      const res = await fetchFn(RESEND_ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: MAIL_FROM,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });
      // The status only: the response body can echo the recipient (NFR-21).
      if (!res.ok) throw new Error(`Resend responded ${res.status}`);
      const body = (await res.json().catch(() => ({}))) as { id?: string };
      return { id: body.id };
    },
  };
}

// Without RESEND_API_KEY (local dev, e2e, before the domain is verified) mail is dropped with a
// warning that names no recipient.
export function createMailer(options: { apiKey: string | undefined; fetch?: Fetch }): Mailer {
  if (options.apiKey) return createResendMailer(options.apiKey, options.fetch);
  return {
    async send() {
      console.warn('mail skipped: RESEND_API_KEY is not set');
    },
  };
}

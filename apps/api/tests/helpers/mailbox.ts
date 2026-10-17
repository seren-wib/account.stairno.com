import type { MailMessage, Mailer } from '../../src/mail';

// Keeps every sent mail in memory so tests can read the links out of them.
export function createMemoryMailbox() {
  const sent: MailMessage[] = [];
  const mailbox: Mailer & { sent: MailMessage[] } = {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
  return mailbox;
}

// The first link to the account center in a mail's text body.
export function linkIn(message: MailMessage | undefined, accountUrl: string): URL {
  const match = message?.text.match(new RegExp(`${accountUrl}\\S+`));
  if (!match) throw new Error('no account center link in the mail');
  return new URL(match[0]);
}

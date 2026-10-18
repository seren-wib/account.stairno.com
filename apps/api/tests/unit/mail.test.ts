import { describe, expect, it, vi } from 'vitest';
import { MAIL_FROM, createMailer, createResendMailer, renderMail } from '../../src/mail';
import { en } from '../../src/mail/templates/en';
import { ko } from '../../src/mail/templates/ko';

// Flattens a dictionary into `template.field` keys with their strings.
function flatten(dict: object): Map<string, string> {
  const out = new Map<string, string>();
  for (const [template, fields] of Object.entries(dict)) {
    for (const [field, value] of Object.entries(fields as Record<string, string>)) {
      out.set(`${template}.${field}`, value);
    }
  }
  return out;
}

const message = {
  to: 'someone@example.com',
  subject: 'Subject',
  html: '<p>Hi</p>',
  text: 'Hi',
};

describe('mail dictionaries', () => {
  it('FR-72 FR-73 ko and en have the same keys and every template of both phases', () => {
    expect([...flatten(en).keys()].sort()).toEqual([...flatten(ko).keys()].sort());
    expect(Object.keys(ko).sort()).toEqual([
      'changeEmail',
      'receipt',
      'refundRejected',
      'refunded',
      'renewalFailed',
      'resetPassword',
      'verifyEmail',
    ]);
    for (const value of [...flatten(ko).values(), ...flatten(en).values()]) {
      expect(value.trim()).not.toBe('');
    }
  });

  it('DR-6 mail copy never calls Stairno a company, group or studio', () => {
    const copy = [...flatten(ko).values(), ...flatten(en).values()].join('\n').toLowerCase();
    for (const word of ['회사', '그룹', '스튜디오', 'company', 'studio']) {
      expect(copy).not.toContain(word);
    }
  });
});

describe('renderMail', () => {
  const vars = { name: 'Yu', url: 'https://account.stairno.com/en/verify-email?token=abc' };

  it('FR-73 renders the template in the user locale', () => {
    const mail = renderMail('verifyEmail', 'en', vars);
    expect(mail.subject).toBe(en.verifyEmail.subject);
    expect(mail.text).toContain(vars.url);
  });

  it('FR-72 fills the product and the amount of a payment mail, escaped in HTML', () => {
    const mail = renderMail('receipt', 'en', {
      name: 'Yu',
      url: 'https://account.stairno.com/en/orders',
      product: 'Atlas <Pro>',
      amount: '₩4,900',
    });
    expect(mail.text).toContain('Atlas <Pro>');
    expect(mail.text).toContain('₩4,900');
    expect(mail.html).toContain('Atlas &lt;Pro&gt;');
    expect(mail.text).not.toMatch(/\{(product|amount|name)\}/);
  });

  it('FR-73 falls back to ko for an unsupported locale', () => {
    expect(renderMail('resetPassword', 'fr', vars).subject).toBe(ko.resetPassword.subject);
  });

  it('FR-72 escapes the user name in HTML and keeps the link in HTML and text', () => {
    const url = 'https://account.stairno.com/ko/verify-email?token=a&b=1';
    const mail = renderMail('verifyEmail', 'ko', { name: '<b>Eve</b>', url });
    expect(mail.html).toContain('&lt;b&gt;Eve&lt;/b&gt;');
    expect(mail.html).not.toContain('<b>Eve</b>');
    expect(mail.html).toContain(
      'href="https://account.stairno.com/ko/verify-email?token=a&amp;b=1"',
    );
    expect(mail.text).toContain(url);
  });
});

describe('Resend mailer', () => {
  it('FR-71 sends through the Resend API from Stairno <no-reply@stairno.com>', async () => {
    const fetchFn = vi.fn(async () => new Response('{"id":"msg_1"}', { status: 200 }));
    await createResendMailer('re_test_key', fetchFn).send(message);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer re_test_key');
    expect(JSON.parse(String(init.body))).toEqual({
      from: MAIL_FROM,
      to: ['someone@example.com'],
      subject: 'Subject',
      html: '<p>Hi</p>',
      text: 'Hi',
    });
    expect(MAIL_FROM).toBe('Stairno <no-reply@stairno.com>');
  });

  it('FR-71 throws when Resend rejects the message, without the address in the error', async () => {
    const fetchFn = vi.fn(async () => new Response('{"message":"invalid"}', { status: 422 }));
    const sending = createResendMailer('re_test_key', fetchFn).send(message);
    await expect(sending).rejects.toThrow('Resend responded 422');
    await expect(sending).rejects.not.toThrow('someone@example.com');
  });

  it('skips sending without an API key and logs no address', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchFn = vi.fn();
    const result = await createMailer({ apiKey: undefined, fetch: fetchFn }).send(message);
    expect(result).toEqual({ skipped: true });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('someone@example.com');
    warn.mockRestore();
  });
});

import { en } from './templates/en';
import { ko } from './templates/ko';
import type { MailDictionary, TemplateName } from './templates/types';

export const locales = ['ko', 'en'] as const;
export type Locale = (typeof locales)[number];

const dictionaries: Record<Locale, MailDictionary> = { ko, en };

// The user's stored locale picks the language (FR-73, FR-78). Anything else falls back to ko.
export function resolveLocale(locale: string | null | undefined): Locale {
  return (locales as readonly string[]).includes(locale ?? '') ? (locale as Locale) : 'ko';
}

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderMail(
  template: TemplateName,
  locale: string | null | undefined,
  vars: { name: string; url: string },
): RenderedMail {
  const lang = resolveLocale(locale);
  const t = dictionaries[lang][template];
  const body = (escape: (s: string) => string) => t.body.replaceAll('{name}', escape(vars.name));
  const url = escapeHtml(vars.url);

  const html = `<!doctype html>
<html lang="${lang}">
<body style="margin:0;padding:24px;background:#f6f6f4;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1c1c1a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px">
<tr><td style="padding:32px">
<p style="margin:0 0 24px;font-weight:700;font-size:18px">Stairno</p>
<h1 style="margin:0 0 16px;font-size:22px">${escapeHtml(t.heading)}</h1>
<p style="margin:0 0 24px;line-height:1.6">${body(escapeHtml)}</p>
<p style="margin:0 0 24px"><a href="${url}" style="display:inline-block;padding:12px 20px;background:#1c1c1a;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(t.action)}</a></p>
<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#5c5c58;word-break:break-all">${url}</p>
<p style="margin:0;font-size:13px;line-height:1.6;color:#5c5c58">${escapeHtml(t.note)}</p>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    t.heading,
    '',
    body((s) => s),
    '',
    `${t.action}: ${vars.url}`,
    '',
    t.note,
    '',
    'Stairno',
  ].join('\n');

  return { subject: t.subject, html, text };
}

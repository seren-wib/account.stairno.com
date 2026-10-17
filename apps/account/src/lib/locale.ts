import { defaultLocale, isLocale, type Locale } from '@stairno/ui/i18n';

// FR-75: the signed-in user's language, else the browser's first language we have, else ko.
export function pickLocale(
  acceptLanguage: string | null | undefined,
  userLocale?: string | null,
): Locale {
  if (userLocale && isLocale(userLocale)) return userLocale;
  const ranked = (acceptLanguage ?? '')
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = Number(
        params
          .find((p) => p.trim().startsWith('q='))
          ?.trim()
          .slice(2) ?? 1,
      );
      return { lang: tag.split('-')[0]?.toLowerCase() ?? '', q: Number.isNaN(q) ? 0 : q, index };
    })
    .filter((entry) => entry.lang && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  return ranked.map((entry) => entry.lang).find(isLocale) ?? defaultLocale;
}

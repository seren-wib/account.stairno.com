import { isLocale } from '@stairno/ui/i18n';

// FR-81: the hub's account menu sends people here with a redirect back to the hub.
export const HUB_ORIGIN = 'https://stairno.com';

// FR-12: where to go after sign-in. Only an account center page of a known locale or a page on an
// allowed site origin; everything else (other hosts, protocol-relative, scripts) goes to the
// overview, so the sign-in page cannot be used as an open redirect.
export function safeRedirect(
  target: string | null | undefined,
  locale: string,
  allowedOrigins: readonly string[] = [],
): string {
  const overview = `/${locale}/`;
  if (!target) return overview;

  if (target.startsWith('/') && !target.startsWith('//') && !target.startsWith('/\\')) {
    const first = target.split(/[/?#]/)[1] ?? '';
    return isLocale(first) ? target : overview;
  }

  try {
    const url = new URL(target);
    return allowedOrigins.includes(url.origin) ? url.href : overview;
  } catch {
    return overview;
  }
}

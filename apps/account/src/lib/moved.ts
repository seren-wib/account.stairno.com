import { localePath, type Locale } from '../i18n';

// FR-30 (SRS 3.5, 2026-10-18): the pages that became sections, and where each one went. Links in
// old mails and bookmarks keep working, and a card window that returns to the old address keeps
// its query so the card still registers (FR-45).
const MOVED = {
  profile: ['account', 'profile'],
  devices: ['security', 'devices'],
  connections: ['security', 'connections'],
  delete: ['account', 'delete-account'],
  'payment-methods': ['billing', 'payment-methods'],
  subscriptions: ['billing', 'subscriptions'],
  downloads: ['library', 'downloads'],
} as const;

export type MovedPage = keyof typeof MOVED;

export function movedTo(locale: Locale, page: MovedPage, search = ''): string {
  const [path, section] = MOVED[page];
  return `${localePath(locale, path)}${search}#${section}`;
}

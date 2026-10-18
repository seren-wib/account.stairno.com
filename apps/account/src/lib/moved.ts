import { localePath, type Locale } from '../i18n';

// FR-30 (SRS 3.5, 2026-10-18): the pages that became places on the one account page. Links in
// old mails and bookmarks keep working, and a card window that returns to the old address keeps
// its query so the card still registers (FR-45).
const MOVED = {
  profile: 'profile',
  devices: 'devices',
  connections: 'connections',
  delete: 'delete-account',
  'payment-methods': 'payment-methods',
  subscriptions: 'subscriptions',
  downloads: 'downloads',
} as const;

export type MovedPage = keyof typeof MOVED;

export function movedTo(locale: Locale, page: MovedPage, search = ''): string {
  return `${localePath(locale, '')}${search}#${MOVED[page]}`;
}

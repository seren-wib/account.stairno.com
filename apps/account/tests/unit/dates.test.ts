import { describe, expect, it } from 'vitest';
import { formatDate } from '../../src/lib/api';

// FR-84: dates in the account center follow the user's time zone when one is set, else UTC.
describe('formatDate', () => {
  const lateEvening = '2026-10-18T16:30:00.000Z';

  it('FR-84 writes the date in UTC when the user has no time zone', () => {
    expect(formatDate(lateEvening, 'en')).toBe('Oct 18, 2026');
    expect(formatDate(lateEvening, 'en', null)).toBe('Oct 18, 2026');
  });

  it("FR-84 writes the date in the user's time zone", () => {
    expect(formatDate(lateEvening, 'en', 'Asia/Seoul')).toBe('Oct 19, 2026');
    expect(formatDate(lateEvening, 'en', 'America/Los_Angeles')).toBe('Oct 18, 2026');
  });

  it('FR-84 falls back to UTC for a zone the runtime does not know', () => {
    expect(formatDate(lateEvening, 'en', 'Mars/Base')).toBe('Oct 18, 2026');
  });
});

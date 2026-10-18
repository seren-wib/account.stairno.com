import { describe, expect, it } from 'vitest';
import { countries, countrySchema, profileUpdateSchema, timeZoneSchema } from '../src';

describe('countries', () => {
  it('FR-84 are the 249 ISO 3166-1 alpha-2 codes', () => {
    expect(countries).toHaveLength(249);
    expect(new Set(countries).size).toBe(249);
    for (const code of ['KR', 'US', 'JP', 'GB', 'DE']) expect(countries).toContain(code);
  });

  it('FR-84 refuses codes outside the list, in lower case, or for groups', () => {
    for (const code of ['XX', 'kr', 'EU', 'UN', 'UK', 'KOR', '']) {
      expect(countrySchema.safeParse(code).success, code).toBe(false);
    }
  });
});

describe('time zones', () => {
  it('FR-84 accepts IANA names and UTC', () => {
    for (const zone of ['Asia/Seoul', 'America/New_York', 'Europe/London', 'UTC']) {
      expect(timeZoneSchema.safeParse(zone).success, zone).toBe(true);
    }
  });

  it('FR-84 refuses unknown names, offsets and empty values', () => {
    for (const zone of ['Mars/Base', '+09:00', 'GMT+9', '', 'a'.repeat(65)]) {
      expect(timeZoneSchema.safeParse(zone).success, zone).toBe(false);
    }
  });
});

describe('profile update with a region', () => {
  it('FR-84 keeps the country and the time zone, and lets either be cleared', () => {
    expect(
      profileUpdateSchema.parse({
        name: 'Yu',
        locale: 'ko',
        country: 'KR',
        timezone: 'Asia/Seoul',
      }),
    ).toEqual({ name: 'Yu', locale: 'ko', country: 'KR', timezone: 'Asia/Seoul' });
    expect(
      profileUpdateSchema.parse({ name: 'Yu', locale: 'ko', country: null, timezone: null }),
    ).toEqual({ name: 'Yu', locale: 'ko', country: null, timezone: null });
    expect(profileUpdateSchema.parse({ name: 'Yu', locale: 'ko' })).toEqual({
      name: 'Yu',
      locale: 'ko',
    });
  });

  it('FR-84 refuses a wrong country or time zone', () => {
    expect(profileUpdateSchema.safeParse({ name: 'Yu', locale: 'ko', country: 'XX' }).success).toBe(
      false,
    );
    expect(
      profileUpdateSchema.safeParse({ name: 'Yu', locale: 'ko', timezone: 'Mars/Base' }).success,
    ).toBe(false);
  });
});

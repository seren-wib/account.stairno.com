import { describe, expect, it } from 'vitest';
import { en } from '../../src/i18n/en';
import { ko } from '../../src/i18n/ko';

// Every leaf string with its dotted key.
function flatten(value: unknown, prefix = ''): [string, string][] {
  if (typeof value === 'string') return [[prefix, value]];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('account center dictionaries', () => {
  it('FR-76 ko and en have the same keys and no empty strings', () => {
    const koKeys = flatten(ko).map(([k]) => k);
    const enKeys = flatten(en).map(([k]) => k);
    expect(enKeys.sort()).toEqual(koKeys.sort());
    for (const [key, text] of [...flatten(ko), ...flatten(en)]) {
      expect(text.trim(), key).not.toBe('');
    }
  });

  it('FR-1 tells people the minimum password length only, never the 128-character cap', () => {
    for (const [key, text] of [...flatten(ko), ...flatten(en)]) {
      expect(text, key).not.toMatch(/128/);
    }
  });

  it('DR-6 never calls Stairno a company, group or studio', () => {
    const copy = [...flatten(ko), ...flatten(en)].map(([, text]) => text.toLowerCase()).join('\n');
    for (const word of ['회사', '그룹', '스튜디오', 'company', 'studio']) {
      expect(copy).not.toContain(word);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { safeRedirect } from '../../src/lib/redirect';

const sites = ['https://stairnolabs.com'];

describe('safeRedirect', () => {
  it.each([
    ['/ko/profile', '/ko/profile'],
    ['/en/devices?tab=all', '/en/devices?tab=all'],
    ['/ko/', '/ko/'],
    ['https://stairnolabs.com/after-login', 'https://stairnolabs.com/after-login'],
  ])('FR-12 keeps %s', (target, expected) => {
    expect(safeRedirect(target, 'ko', sites)).toBe(expected);
  });

  it.each([
    ['//evil.example/ko/profile'],
    ['https://evil.example/'],
    ['http://stairnolabs.com/after-login'],
    ['https://stairnolabs.com.evil.example/'],
    ['javascript:alert(1)'],
    ['/fr/profile'],
    ['/\\evil.example'],
    ['profile'],
    [''],
    [null],
  ])('FR-12 sends %s to the overview instead', (target) => {
    expect(safeRedirect(target, 'en', sites)).toBe('/en/');
  });
});

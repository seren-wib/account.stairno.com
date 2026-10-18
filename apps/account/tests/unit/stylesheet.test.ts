import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/styles/account.css', import.meta.url), 'utf8');

describe('account.css', () => {
  it('FR-27 keeps sections marked hidden out of view even when their class sets display', () => {
    // .form-done and .form set display: grid, which beats the browser's own [hidden] rule.
    expect(css).toMatch(/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
  });
});

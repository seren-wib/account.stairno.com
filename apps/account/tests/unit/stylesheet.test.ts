import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/styles/account.css', import.meta.url), 'utf8');

describe('account.css', () => {
  it('FR-27 keeps sections marked hidden out of view even when their class sets display', () => {
    // .form-done and .form set display: grid, which beats the browser's own [hidden] rule.
    expect(css).toMatch(/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
  });

  // `.page-body a` outranks a single class, so a link drawn as a button (the orders list's
  // "자세히", "전체 주문 보기") kept the text-link underline.
  it('FR-32 leaves links drawn as buttons without the text-link underline', () => {
    const rule = css.match(/\.page-body a([^{]*)\{[^}]*text-decoration:\s*underline/);
    expect(rule?.[1]).toMatch(/:not\([^)]*\.form-submit/);
    expect(rule?.[1]).toMatch(/:not\([^)]*\.item-action/);
  });

  // A <button> centres its label on its own; a link with the same class does not.
  it('FR-32 centres the label of a link drawn as a row action', () => {
    const rule = css.match(/a\.item-action\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/display:\s*inline-flex/);
    expect(rule).toMatch(/align-items:\s*center/);
  });
});

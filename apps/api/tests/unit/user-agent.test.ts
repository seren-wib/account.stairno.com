import { describe, expect, it } from 'vitest';
import { summarizeUserAgent } from '../../src/lib/user-agent';

const cases: [string, string | null, string | null, string][] = [
  [
    'Chrome on Windows',
    'Chrome',
    'Windows',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  ],
  [
    'Edge on Windows',
    'Edge',
    'Windows',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  ],
  [
    'Safari on iPhone',
    'Safari',
    'iOS',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  ],
  [
    'Safari on macOS',
    'Safari',
    'macOS',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  ],
  [
    'Firefox on Linux',
    'Firefox',
    'Linux',
    'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
  ],
  [
    'Samsung Internet on Android',
    'Samsung Internet',
    'Android',
    'Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  ],
  [
    'Chrome on Android',
    'Chrome',
    'Android',
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  ],
  [
    'Chrome on iPhone',
    'Chrome',
    'iOS',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1',
  ],
];

describe('summarizeUserAgent', () => {
  it.each(cases)('FR-7 summarizes %s', (_, browser, os, ua) => {
    expect(summarizeUserAgent(ua)).toEqual({ browser, os });
  });

  it('FR-7 returns nulls for a missing or unknown user agent', () => {
    expect(summarizeUserAgent(null)).toEqual({ browser: null, os: null });
    expect(summarizeUserAgent('curl/8.9.1')).toEqual({ browser: null, os: null });
  });
});

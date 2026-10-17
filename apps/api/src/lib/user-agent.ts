// FR-7: a short device label for the session list. Order matters: most browsers also claim to be
// Chrome or Safari, so the specific tokens come first.
const browsers: [RegExp, string][] = [
  [/Edg(A|iOS)?\//, 'Edge'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/OPR\/|Opera/, 'Opera'],
  [/Whale\//, 'Whale'],
  [/CriOS\//, 'Chrome'],
  [/FxiOS\/|Firefox\//, 'Firefox'],
  [/Chrome\/|Chromium\//, 'Chrome'],
  [/Version\/[\d.]+.*Safari\//, 'Safari'],
];

const systems: [RegExp, string][] = [
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/CrOS/, 'ChromeOS'],
  [/Macintosh|Mac OS X/, 'macOS'],
  [/Linux/, 'Linux'],
];

function match(table: [RegExp, string][], ua: string): string | null {
  return table.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
}

export function summarizeUserAgent(ua: string | null | undefined): {
  browser: string | null;
  os: string | null;
} {
  if (!ua) return { browser: null, os: null };
  return { browser: match(browsers, ua), os: match(systems, ua) };
}

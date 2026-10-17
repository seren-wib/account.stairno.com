import { createHash } from 'node:crypto';
import { vi } from 'vitest';

const RANGE_API = 'https://api.pwnedpasswords.com/range/';

// Answers the Have I Been Pwned range API locally: the listed passwords are reported as
// breached, everything else as clean. Other requests go to the real fetch.
export function stubPwnedPasswords(pwned: string[] = []) {
  const realFetch = globalThis.fetch;
  const hashes = pwned.map((p) => createHash('sha1').update(p).digest('hex').toUpperCase());
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith(RANGE_API)) return realFetch(input, init);
    const prefix = url.slice(RANGE_API.length, RANGE_API.length + 5).toUpperCase();
    calls.push(prefix);
    const lines = hashes.filter((h) => h.startsWith(prefix)).map((h) => `${h.slice(5)}:42`);
    lines.push('0000000000000000000000000000000000A:0');
    return new Response(lines.join('\r\n'), { status: 200 });
  });
  return { calls };
}

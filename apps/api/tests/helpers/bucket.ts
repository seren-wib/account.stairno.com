import type { DownloadBucket } from '../../src/deps';

// An R2 bucket in memory: the files a test put there, read the way R2's binding answers.
export function createMemoryBucket() {
  const files = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  const bucket: DownloadBucket & {
    put(key: string, text: string, contentType?: string): void;
    reads: string[];
  } = {
    reads: [],
    put(key, text, contentType) {
      files.set(key, {
        bytes: new TextEncoder().encode(text),
        ...(contentType ? { contentType } : {}),
      });
    },
    async get(key) {
      bucket.reads.push(key);
      const file = files.get(key);
      if (!file) return null;
      return {
        body: new Response(file.bytes).body!,
        size: file.bytes.byteLength,
        httpMetadata: file.contentType ? { contentType: file.contentType } : {},
      };
    },
  };
  return bucket;
}

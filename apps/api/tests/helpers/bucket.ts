import type { AvatarBucket, DownloadBucket } from '../../src/deps';

// The photo bucket in memory (FR-85): what the API put, listed and deleted the way R2 answers.
export function createMemoryAvatarBucket() {
  const files = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  const bucket: AvatarBucket & { keys(): string[]; failDeletes: boolean } = {
    failDeletes: false,
    keys: () => [...files.keys()].sort(),
    async put(key, value, options) {
      files.set(key, {
        bytes: new Uint8Array(value),
        ...(options?.httpMetadata?.contentType
          ? { contentType: options.httpMetadata.contentType }
          : {}),
      });
      return null;
    },
    async get(key) {
      const file = files.get(key);
      if (!file) return null;
      return {
        body: new Response(file.bytes).body!,
        size: file.bytes.byteLength,
        httpMetadata: file.contentType ? { contentType: file.contentType } : {},
      };
    },
    async list(options) {
      const prefix = options?.prefix ?? '';
      return {
        objects: [...files.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })),
      };
    },
    async delete(keys) {
      if (bucket.failDeletes) throw new Error('R2 is down');
      for (const key of Array.isArray(keys) ? keys : [keys]) files.delete(key);
    },
  };
  return bucket;
}

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

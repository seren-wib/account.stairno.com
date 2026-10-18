import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { TestProject } from 'vitest/node';
import * as schema from '../src/db/schema';

declare module 'vitest' {
  export interface ProvidedContext {
    // A PGlite data directory with every production migration applied, as a tar file.
    migratedDataDir: string;
  }
}

// Starting a PGlite takes about a second and migrating it a bit more; loading a ready data
// directory takes a fraction of that. So the whole run migrates once, here, and every test
// database starts from this snapshot (tests/helpers/app.ts).
export default async function setup(project: TestProject) {
  const migrationsFolder = fileURLToPath(new URL('../src/db/migrations', import.meta.url));
  const client = new PGlite();
  await migrate(drizzle(client, { schema }), { migrationsFolder });
  const dump = await client.dumpDataDir('none');
  await client.close();

  const dir = await mkdtemp(join(tmpdir(), 'stairno-api-tests-'));
  const file = join(dir, 'migrated.tar');
  await writeFile(file, Buffer.from(await dump.arrayBuffer()));
  project.provide('migratedDataDir', file);

  return () => rm(dir, { recursive: true, force: true });
}

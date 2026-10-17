// The memory adapter expects one array per model to exist up front and clones the whole
// object with structuredClone, so it has to be a plain object. Build it from the auth schema.
import { getAuthTables } from "@better-auth/core/db";

export function memoryDb(options) {
  const db = {};
  for (const table of Object.values(getAuthTables(options))) db[table.modelName] = [];
  return db;
}

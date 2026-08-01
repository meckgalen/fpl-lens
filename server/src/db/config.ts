/**
 * Database connection config.
 *
 * The .env lives at the repo root, not in server/, because docker-compose.yml
 * reads the same file for POSTGRES_USER/PASSWORD/DB/PORT. One source of truth
 * for the credentials means the container and the client cannot drift apart.
 */

import { config as loadEnv } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// server/src/db -> server/src -> server -> repo root
const repoRoot = join(here, '..', '..', '..');

// quiet: dotenv v17 otherwise prints a promotional banner on every boot.
loadEnv({ path: join(repoRoot, '.env'), quiet: true });

/**
 * Fail loudly rather than falling back to a default connection string. A
 * silent default is how you end up ingesting 250k rows into the wrong
 * database and not noticing.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env at the repo root.`
    );
  }
  return value;
}

export const dbConfig = {
  connectionString: requireEnv('DATABASE_URL'),
};

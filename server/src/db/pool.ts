/**
 * The single pg connection pool for the process.
 *
 * Not wired into index.ts yet. Routes keep reading the live FPL API until
 * Phase 0 step 5 (repository and cutover).
 */

import pg from 'pg';
import { dbConfig } from './config.js';

export const pool = new pg.Pool({
  connectionString: dbConfig.connectionString,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle Postgres client', err);
});

export function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}

export function closePool(): Promise<void> {
  return pool.end();
}

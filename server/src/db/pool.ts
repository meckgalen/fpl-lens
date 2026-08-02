/**
 * The single pg connection pool for the process.
 *
 * Read by the repositories in ../repositories, which the routes call. The
 * ingest scripts connect through the same pool.
 */

import pg from 'pg';
import { dbConfig } from './config.js';

/**
 * Anything that can run a query: the pool itself, or a client checked out of
 * it inside a transaction. Repository functions take one of these as their
 * first argument rather than reaching for the pool directly, so a caller can
 * run them inside an existing transaction and a test can pass a stub.
 */
export type Queryable = Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>;

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

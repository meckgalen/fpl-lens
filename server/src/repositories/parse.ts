/**
 * Turning what node-postgres returns into what the domain types promise.
 *
 * The driver maps int2 and int4 to JS numbers, but `numeric` and int8 — which
 * is what SUM over an integer column produces — come back as strings, because
 * neither fits a double without possible loss. That is the right default for a
 * driver and the wrong shape for an API: it leaked all the way to the client,
 * where every consumer called parseFloat by hand and a sort on a string column
 * ordered "9.1" above "10.4".
 *
 * These parse explicitly and throw on anything unparseable. A cast (`as
 * number`) would have compiled and shipped the string; a silent `Number(x) || 0`
 * would have turned a null into a zero, which rule 6 spends a paragraph
 * forbidding. Failing loudly at the boundary is the only option that cannot be
 * mistaken for data.
 */

/** A value as it may arrive from the driver for a numeric or int8 column. */
export type DbNumeric = string | number;

/**
 * Parse a column that is NOT NULL in the schema, or aggregated with COALESCE.
 * Throws if it is null: that means the query changed and the type no longer
 * describes it, which should stop the request rather than reach the client.
 */
export function num(value: DbNumeric | null, field: string): number {
  if (value === null || value === undefined) {
    throw new Error(`${field}: expected a number, got ${value}. Is the column nullable?`);
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${field}: expected a number, got ${JSON.stringify(value)}`);
  }
  return n;
}

/**
 * Parse a column that is genuinely nullable — a stat a season never measured.
 * Null passes through as null and is never coerced to 0 (rule 6): 0 asserts a
 * measurement, null records its absence, and they are the same width in a
 * table cell.
 */
export function numOrNull(value: DbNumeric | null, field: string): number | null {
  if (value === null || value === undefined) return null;
  return num(value, field);
}

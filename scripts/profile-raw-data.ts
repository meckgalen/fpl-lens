/**
 * Phase 0, step 1: profile the raw CSVs and write docs/data-profile.md.
 *
 * This is a read-only reconnaissance pass. It designs no schema and ingests
 * nothing; it only reports what the data actually looks like, season by season,
 * so step 2+ can be planned against reality rather than assumptions.
 *
 * Reports (per CLAUDE.md, plus four extras):
 *   - character encoding actually DETECTED per file (chardet, not assumed)
 *   - merged_gw column-presence matrix per season
 *   - first/last appearance season for every drifting (non-universal) column
 *   - distinct element_type values per season (players_raw.csv)
 *   - distinct position strings per season (merged_gw.csv)
 *   - row and distinct-element counts per season (merged_gw.csv)
 *   - whether `code` exists in players_raw.csv for every season
 *   - format of the merged_gw `name` column per season, with a sample value
 *   - rows that fail to parse, with season and line number
 *   - min and max `round` value per season
 *
 * Run: npx tsx scripts/profile-raw-data.ts
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse';
import { finished } from 'node:stream/promises';
import chardet from 'chardet';

const SEASONS = [
  '2016-17',
  '2017-18',
  '2018-19',
  '2019-20',
  '2020-21',
  '2021-22',
  '2022-23',
  '2023-24',
  '2024-25',
  '2025-26',
];

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_ROOT = join(PROJECT_ROOT, 'data', 'raw');
const OUT_PATH = join(PROJECT_ROOT, 'docs', 'data-profile.md');

interface ParseError {
  line: number | undefined;
  code: string;
}

interface LoadedCsv {
  present: boolean;
  encoding: string; // as reported by chardet
  hasNonAscii: boolean; // whether any byte is > 0x7F
  header: string[];
  rows: string[][];
  parseErrors: ParseError[];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Map a chardet label to a WHATWG TextDecoder label we can decode with. */
function decoderLabel(detected: string | null): string {
  const d = (detected ?? '').toLowerCase();
  if (d.includes('utf-8') || d === 'ascii') return 'utf-8';
  if (d.includes('utf-16')) return d.includes('be') ? 'utf-16be' : 'utf-16le';
  if (d.includes('1252')) return 'windows-1252';
  if (d.includes('8859') || d.includes('latin')) return 'latin1';
  return 'utf-8';
}

async function loadCsv(path: string): Promise<LoadedCsv> {
  if (!(await exists(path))) {
    return { present: false, encoding: '—', hasNonAscii: false, header: [], rows: [], parseErrors: [] };
  }

  const buf = await readFile(path);
  const detected = chardet.detect(buf) ?? 'unknown';
  const hasNonAscii = buf.some((b) => b > 0x7f);
  const text = new TextDecoder(decoderLabel(detected)).decode(buf);

  const rows: string[][] = [];
  const parseErrors: ParseError[] = [];

  // columns:false -> arrays; relax_column_count stays false so rows with the
  // wrong field count raise a per-record error, which skip_records_with_error
  // turns into a 'skip' event carrying the real source line number. That is our
  // "rows that fail to parse" signal.
  const parser = parse({
    bom: true,
    columns: false,
    skip_records_with_error: true,
    relax_quotes: false,
  });

  parser.on('readable', () => {
    let rec: string[] | null;
    while ((rec = parser.read() as string[] | null) !== null) rows.push(rec);
  });
  parser.on('skip', (err: { lines?: number; code?: string }) => {
    parseErrors.push({ line: err.lines, code: err.code ?? 'UNKNOWN' });
  });

  parser.write(text);
  parser.end();
  await finished(parser);

  const header = rows.shift() ?? [];
  return { present: true, encoding: detected, hasNonAscii, header, rows, parseErrors };
}

/** Index of a column name in a header, or -1. */
function col(header: string[], name: string): number {
  return header.indexOf(name);
}

function mdTable(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
  return `${head}\n${sep}\n${body}`;
}

/** Classify the merged_gw `name` column format from a sample of values. */
function classifyNameFormat(sample: string): string {
  if (/^[^_ ]+(_[^_ ]+)+_\d+$/.test(sample)) return 'First_Last_id (underscores, trailing element id)';
  if (/_/.test(sample) && !/ /.test(sample)) return 'First_Last (underscore-separated, no id)';
  if (/ /.test(sample) && !/_/.test(sample)) return 'First Last (space-separated, no id)';
  return 'other';
}

async function main() {
  // ---- Load everything up front -------------------------------------------
  interface SeasonData {
    season: string;
    players: LoadedCsv;
    teams: LoadedCsv;
    gw: LoadedCsv;
  }

  const data: SeasonData[] = [];
  for (const season of SEASONS) {
    data.push({
      season,
      players: await loadCsv(join(RAW_ROOT, season, 'players_raw.csv')),
      teams: await loadCsv(join(RAW_ROOT, season, 'teams.csv')),
      gw: await loadCsv(join(RAW_ROOT, season, 'gws', 'merged_gw.csv')),
    });
  }

  const out: string[] = [];
  const p = (s = '') => out.push(s);

  p('# FPL Lens — Raw Data Profile');
  p();
  p('_Generated by `scripts/profile-raw-data.ts`. Read-only reconnaissance for');
  p('Phase 0. No schema is designed here._');
  p();
  p(`Source: vaastav/Fantasy-Premier-League, seasons ${SEASONS[0]} – ${SEASONS.at(-1)}.`);
  p();

  // ---- 1. File presence + detected encoding -------------------------------
  p('## 1. File presence & detected character encoding');
  p();
  p('Encoding is what `chardet` actually detected from the bytes, not assumed.');
  p('`teams.csv` is not published upstream for the three earliest seasons.');
  p();
  p('**Caveat:** `chardet` is a statistical guess. Where a cell reads e.g.');
  p('`ISO-8859-1` but the file has **no** non-ASCII bytes (`non-ASCII? = no`), that');
  p('label is moot — the file is pure ASCII and decodes identically as UTF-8. Only');
  p('files flagged `non-ASCII? = yes` actually require the detected encoding at');
  p('ingest, so those are the only rows worth trusting the label on.');
  p();
  const encCell = (c: LoadedCsv, missing: string) =>
    c.present ? `${c.encoding} (non-ASCII? ${c.hasNonAscii ? 'yes' : 'no'})` : missing;
  p(
    mdTable(
      ['Season', 'players_raw.csv', 'teams.csv', 'gws/merged_gw.csv'],
      data.map((d) => [
        d.season,
        encCell(d.players, 'MISSING'),
        encCell(d.teams, 'MISSING (404)'),
        encCell(d.gw, 'MISSING'),
      ]),
    ),
  );
  p();

  // ---- 2. players_raw.csv: code column + element_type ----------------------
  p('## 2. `players_raw.csv`: `code` column & `element_type` values');
  p();
  p('The ingest join chain depends on `code` being present in every season.');
  p();
  p(
    mdTable(
      ['Season', 'has `code`?', 'has `id`?', 'has `opta_code`?', 'has `birth_date`?', 'distinct `element_type`'],
      data.map((d) => {
        const h = d.players.header;
        if (!d.players.present) return [d.season, '—', '—', '—', '—', 'MISSING'];
        const etIdx = col(h, 'element_type');
        const ets =
          etIdx >= 0
            ? [...new Set(d.players.rows.map((r) => r[etIdx]).filter((v) => v !== undefined && v !== ''))]
                .sort((a, b) => Number(a) - Number(b))
                .join(', ')
            : 'no column';
        return [
          d.season,
          col(h, 'code') >= 0 ? 'yes' : '**NO**',
          col(h, 'id') >= 0 ? 'yes' : 'no',
          col(h, 'opta_code') >= 0 ? 'yes' : 'no',
          col(h, 'birth_date') >= 0 ? 'yes' : 'no',
          ets,
        ];
      }),
    ),
  );
  p();

  // ---- 3. merged_gw counts, name format, round range ----------------------
  p('## 3. `gws/merged_gw.csv`: counts, `name` format, `round` range');
  p();
  p('Distinct-element count uses the `element` column (season-scoped player id).');
  p();
  p(
    mdTable(
      ['Season', 'data rows', 'distinct `element`', '`name` format', 'sample `name`', 'min `round`', 'max `round`'],
      data.map((d) => {
        if (!d.gw.present) return [d.season, 'MISSING', '—', '—', '—', '—', '—'];
        const h = d.gw.header;
        const elIdx = col(h, 'element');
        const nameIdx = col(h, 'name');
        const roundIdx = col(h, 'round');

        const distinctEl =
          elIdx >= 0 ? new Set(d.gw.rows.map((r) => r[elIdx])).size.toLocaleString() : 'no column';

        const sampleName = nameIdx >= 0 && d.gw.rows.length ? d.gw.rows[0][nameIdx] : '';
        const nameFmt = nameIdx >= 0 ? classifyNameFormat(sampleName) : 'no column';

        let minR = 'no column';
        let maxR = 'no column';
        if (roundIdx >= 0) {
          const rounds = d.gw.rows
            .map((r) => Number(r[roundIdx]))
            .filter((n) => Number.isFinite(n));
          if (rounds.length) {
            minR = String(Math.min(...rounds));
            maxR = String(Math.max(...rounds));
          }
        }
        return [
          d.season,
          d.gw.rows.length.toLocaleString(),
          distinctEl,
          nameFmt,
          sampleName ? `\`${sampleName}\`` : '—',
          minR,
          maxR,
        ];
      }),
    ),
  );
  p();

  // ---- 4. distinct position strings (merged_gw) ---------------------------
  p('## 4. Distinct `position` strings per season (`merged_gw.csv`)');
  p();
  p('Older seasons have no `position` column in the gameweek file; position must');
  p('be derived from `players_raw.element_type` there. Watch for `GK` vs `GKP`.');
  p();
  p(
    mdTable(
      ['Season', 'distinct `position` values'],
      data.map((d) => {
        if (!d.gw.present) return [d.season, 'MISSING'];
        const idx = col(d.gw.header, 'position');
        if (idx < 0) return [d.season, '_no `position` column_'];
        const vals = [...new Set(d.gw.rows.map((r) => r[idx]).filter((v) => v !== undefined && v !== ''))].sort();
        return [d.season, vals.length ? vals.join(', ') : '_(empty)_'];
      }),
    ),
  );
  p();

  // ---- 5. drifting columns: first/last appearance --------------------------
  p('## 5. Drifting columns in `merged_gw.csv` (first / last appearance)');
  p();
  p('Every column that is NOT present in all available seasons. A column present');
  p('in later seasons only is a stat that started being measured; a column that');
  p('stops is one the upstream feed dropped. Absent columns must be stored NULL,');
  p('never 0.');
  p();
  const gwSeasons = data.filter((d) => d.gw.present);
  const allCols = new Set<string>();
  for (const d of gwSeasons) for (const c of d.gw.header) allCols.add(c);
  const drifting = [...allCols].filter(
    (c) => !gwSeasons.every((d) => d.gw.header.includes(c)),
  );
  const colFirstLast = (c: string) => {
    const present = gwSeasons.filter((d) => d.gw.header.includes(c)).map((d) => d.season);
    return { first: present[0], last: present.at(-1), count: present.length };
  };
  drifting.sort((a, b) => {
    const fa = colFirstLast(a).first!;
    const fb = colFirstLast(b).first!;
    return fa === fb ? a.localeCompare(b) : fa.localeCompare(fb);
  });
  p(
    mdTable(
      ['Column', 'first season', 'last season', 'seasons present'],
      drifting.map((c) => {
        const { first, last, count } = colFirstLast(c);
        return [`\`${c}\``, first!, last!, `${count}/${gwSeasons.length}`];
      }),
    ),
  );
  p();

  // ---- 6. full column-presence matrix -------------------------------------
  p('## 6. Full `merged_gw.csv` column-presence matrix');
  p();
  p('`✓` present, `·` absent. Columns sorted by first appearance then name.');
  p();
  const sortedCols = [...allCols].sort((a, b) => {
    const fa = colFirstLast(a).first!;
    const fb = colFirstLast(b).first!;
    return fa === fb ? a.localeCompare(b) : fa.localeCompare(fb);
  });
  p(
    mdTable(
      ['Column', ...gwSeasons.map((d) => d.season.slice(2))],
      sortedCols.map((c) => [
        `\`${c}\``,
        ...gwSeasons.map((d) => (d.gw.header.includes(c) ? '✓' : '·')),
      ]),
    ),
  );
  p();

  // ---- 7. parse failures ---------------------------------------------------
  p('## 7. Rows that failed to parse');
  p();
  const anyErrors = data.some(
    (d) => d.players.parseErrors.length || d.teams.parseErrors.length || d.gw.parseErrors.length,
  );
  if (!anyErrors) {
    p('None. Every row in every present file parsed cleanly (consistent field');
    p('counts, well-formed quoting).');
  } else {
    const rows: string[][] = [];
    for (const d of data) {
      const files: [string, LoadedCsv][] = [
        ['players_raw.csv', d.players],
        ['teams.csv', d.teams],
        ['gws/merged_gw.csv', d.gw],
      ];
      for (const [fname, csv] of files) {
        for (const e of csv.parseErrors) {
          rows.push([d.season, fname, e.line !== undefined ? String(e.line) : '?', e.code]);
        }
      }
    }
    p(mdTable(['Season', 'File', 'Source line', 'Error code'], rows));
  }
  p();

  p('---');
  p();
  p(`_Profiled ${gwSeasons.length} gameweek files, ${data.filter((d) => d.players.present).length} player files, ${data.filter((d) => d.teams.present).length} team files._`);
  p();

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, out.join('\n'));
  console.log(`Wrote ${OUT_PATH}`);
  console.log(
    `Seasons: ${SEASONS.length} | drifting merged_gw columns: ${drifting.length} | total merged_gw columns seen: ${allCols.size} | parse errors: ${anyErrors ? 'see report' : 'none'}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

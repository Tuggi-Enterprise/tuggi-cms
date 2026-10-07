/**
 * The app database schema, read from where it lives since #869: the `db-tuggiApp` repository.
 *
 * `tuggi-cms/supabase/migrations/` was removed on 2026-10-06; the canonical history became the
 * baseline `20261006120000` (a schema-only `pg_dump` of production) plus the migrations after it.
 * Tests that assert a fact of the database read it here, never from a copy inside this repo.
 *
 * The repo is found at `DB_TUGGIAPP_DIR`, or as a sibling of this one (`../db-tuggiApp`). When it
 * is absent (CI checks out only this repo), the SQL-side assertions skip with `APP_SCHEMA_SKIP`,
 * the same convention as `name-search.test.ts`.
 *
 * The text is normalized once: double quotes and `::text` casts are stripped, so a test can match
 * `CONSTRAINT fx_rates_source_ck CHECK ((length(btrim(source)) > 0))` instead of pg_dump quoting.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const BASELINE = '20261006120000_baseline_remote_schema.sql'
const MIGRATIONS = join(
  process.env.DB_TUGGIAPP_DIR ?? resolve(import.meta.dirname, '../../../../db-tuggiApp'),
  'supabase/migrations'
)

export const APP_SCHEMA_SKIP: string | false = existsSync(join(MIGRATIONS, BASELINE))
  ? false
  : `db-tuggiApp com o baseline ${BASELINE} nao esta ao lado deste repositorio nem em DB_TUGGIAPP_DIR`

let cache: string | null = null

/** Baseline + every later migration, in order, normalized. */
export function appSchema(): string {
  if (cache === null) {
    cache = readdirSync(MIGRATIONS)
      .filter((file) => file.endsWith('.sql') && file >= BASELINE)
      .sort()
      .map((file) => readFileSync(join(MIGRATIONS, file), 'utf8'))
      .join('\n')
      .replace(/"/g, '')
      .replace(/::text\b/g, '')
  }
  return cache
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The `CREATE TABLE <schema.table> (...);` statement of the baseline. */
export function tableDdl(qualified: string): string {
  const schema = appSchema()
  const start = schema.search(new RegExp(`CREATE TABLE IF NOT EXISTS ${escape(qualified)} \\(`))
  if (start < 0) throw new Error(`${qualified} not found in the app schema`)
  return schema.slice(start, schema.indexOf('\n);', start) + 3)
}

/** Every `GRANT ... ON TABLE <schema.table> TO ...;` line. */
export function grantsOn(qualified: string): string[] {
  const re = new RegExp(`^GRANT .* ON TABLE ${escape(qualified)} TO .*;$`, 'gm')
  return appSchema().match(re) ?? []
}

/** The LAST definition of a function (`CREATE OR REPLACE FUNCTION <schema.name>(`), body included. */
export function functionDef(qualified: string): string {
  const schema = appSchema()
  const re = new RegExp(`CREATE OR REPLACE FUNCTION ${escape(qualified)}\\(`, 'gi')
  let start = -1
  for (const match of schema.matchAll(re)) start = match.index
  if (start < 0) throw new Error(`function ${qualified} not found in the app schema`)
  const open = schema.slice(start).match(/AS (\$[a-z_]*\$)/i)
  if (!open || open.index === undefined) throw new Error(`function ${qualified} has no dollar-quoted body`)
  const bodyStart = start + open.index + open[0].length
  return schema.slice(start, schema.indexOf(open[1], bodyStart) + open[1].length)
}

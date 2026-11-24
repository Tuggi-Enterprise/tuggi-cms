/**
 * #1014: the CMS reads `core.attraction_descriptions` without `generated_by_*`.
 *
 * Those columns say which person triggered a generation, next to a POI and a timestamp. The fix is
 * a column grant in the database that takes them away from `anon` and `authenticated`; once it is
 * in, any `select('*')` the operator's session sends answers 42501 and the content screen goes
 * empty. So the readers list columns, from one constant, and this suite keeps it that way.
 *
 * Mutations that turn this suite red:
 *  · putting `generated_by_email` or `generated_by_user_id` back in `DESCRIPTION_COLUMNS`;
 *  · dropping a column the screens read, or a column added to the table and not listed here;
 *  · a reader under app/, lib/ or components/ going back to `select('*')` on the table.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  DESCRIPTION_COLUMNS,
  fetchDescriptions,
  upsertPortugueseDescription,
} from '../../lib/core/poi-descriptions-service'
import { APP_SCHEMA_SKIP, tableDdl } from './setup/app-schema'

const ROOT = resolve(import.meta.dirname, '../..')
const listed = DESCRIPTION_COLUMNS.split(',').map((c) => c.trim())

/** A client that answers every query with no rows and records each `select` argument. */
function recordingClient() {
  const selects: string[] = []
  const chain: Record<string, unknown> = {}
  for (const method of ['schema', 'from', 'or', 'eq', 'order', 'update', 'insert']) {
    chain[method] = () => chain
  }
  chain.select = (columns: string) => {
    selects.push(columns)
    return chain
  }
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null })
  chain.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok)
  return { client: chain, selects }
}

test('#1014: DESCRIPTION_COLUMNS has no generated_by column and no wildcard', () => {
  assert.equal(listed.filter((c) => c.startsWith('generated_by')).length, 0)
  assert.ok(!listed.includes('*'))
  assert.equal(new Set(listed).size, listed.length, 'a column is listed twice')
})

test(
  '#1014: DESCRIPTION_COLUMNS is every column of the table except generated_by_*',
  { skip: APP_SCHEMA_SKIP },
  () => {
    // This table ends in `)\nWITH (autovacuum ...)`, not `);`, so `tableDdl` runs into the next
    // statements; the column list stops at the first line that closes the parenthesis.
    const full = tableDdl('core.attraction_descriptions')
    const ddl = full.slice(0, full.search(/\n\)/))
    const columns = [...ddl.matchAll(/^\s{4}([a-z_]+) /gm)].map((m) => m[1])
    const expected = columns.filter((c) => !c.startsWith('generated_by')).sort()
    assert.deepEqual([...listed].sort(), expected)
  },
)

test('#1014: fetchDescriptions and upsertPortugueseDescription send an explicit column list', async () => {
  const { client, selects } = recordingClient()
  await fetchDescriptions(client, 'poi-1')
  await upsertPortugueseDescription(client, 'poi-1', 'texto').catch(() => undefined)
  assert.deepEqual(selects, [DESCRIPTION_COLUMNS, 'id, description'])
})

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(path)
    return /\.tsx?$/.test(name) ? [path] : []
  })
}

test('#1014: no reader in app/, lib/ or components/ selects every column of the table', () => {
  const star = /from\(\s*['"]attraction_descriptions['"]\s*\)\s*\.select\(\s*(['"]\*['"])?\s*\)/
  const embed = /attraction_descriptions\s*\(\s*\*/
  const offenders = ['app', 'lib', 'components']
    .flatMap((dir) => sourceFiles(join(ROOT, dir)))
    .filter((file) => {
      const text = readFileSync(file, 'utf8')
      return star.test(text) || embed.test(text)
    })
    .map((file) => file.slice(ROOT.length + 1))
  assert.deepEqual(offenders, [])
})

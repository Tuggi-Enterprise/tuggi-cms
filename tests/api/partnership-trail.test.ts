/**
 * #909 — the trail's publication lines. A place published before `PUBLISH_PARTNER_PLACE` existed
 * has no `publishedBy`, and it used to vanish from the trail while band 5 said it was in the app.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { trailPublishedLines } from '@/components/admin/partnerships/trail-text'
import { formatDate } from '@/components/admin/partner-proposals/format'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const publish = JSON.parse(readFileSync(resolve(REPO_ROOT, 'messages/pt.json'), 'utf8'))
  .Partnerships.publish as Record<string, string>

/** The `Partnerships` translator, interpolating `{name}` the way next-intl does. */
const t = ((key: string, values: Record<string, string> = {}) => {
  const template = publish[key.replace(/^publish\./, '')]
  assert.equal(typeof template, 'string', `missing message ${key}`)
  return template.replace(/\{(\w+)\}/g, (_, name: string) => values[name])
}) as unknown as Parameters<typeof trailPublishedLines>[1]

const PUBLISHED_AT = '2026-08-15T10:32:00.000Z'

function place(name: string, published: boolean, publishedBy: { at: string; by: string | null } | null) {
  return { publishedBy, readiness: { published, place: { name } } } as Parameters<
    typeof trailPublishedLines
  >[0][number]
}

test('#909: a published place WITH a publication record reads name, date and person', () => {
  const lines = trailPublishedLines(
    [place('Cantina do Zé', true, { at: PUBLISHED_AT, by: 'ops@tuggi.app' })],
    t
  )
  assert.deepEqual(lines, [`Cantina do Zé publicado em ${formatDate(PUBLISHED_AT)} por ops@tuggi.app.`])
})

test('#909: a published place WITHOUT a publication record reads its name and no date', () => {
  const lines = trailPublishedLines([place('Mangia Que Cresce Pizzaria', true, null)], t)
  assert.deepEqual(lines, ['Mangia Que Cresce Pizzaria publicado.'])
})

test('#909: a place that is not published gets no line', () => {
  assert.deepEqual(trailPublishedLines([place('Ainda Não', false, null)], t), [])
})

test('#909: the undated line comes after the dated ones', () => {
  const lines = trailPublishedLines(
    [
      place('Sem Data', true, null),
      place('Com Data', true, { at: PUBLISHED_AT, by: null }),
    ],
    t
  )
  assert.deepEqual(lines, [`Com Data publicado em ${formatDate(PUBLISHED_AT)}.`, 'Sem Data publicado.'])
})

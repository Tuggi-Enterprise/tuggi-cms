/**
 * #1139 — the record of an approved creator, influencer or driver saves in the client editor.
 * BR-B2B-066 item 4 and item 6.a (the commission is edited in the Fiscal tab after the approval),
 * contract `docs/contracts/parceiro-sem-local.md` §4.4: their `tax_id_type` is `cpf` or `cnpj`
 * and the database refuses the save (`TGP22 tax_id`) when it does not match the document.
 *
 * Before this card the editor wrote the country's type on every save, `cnpj` for Brazil, so the
 * first save of a CPF partner with a country set was refused — commission included.
 *
 * Mutations that turn this suite red:
 *  · the country's type winning for an app partner;
 *  · the modal dropping `taxConfigOfClient` for the old `taxConfigFor(country)`.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { taxConfigOfClient } from '@/components/admin/clients/shared/countries'

const ROOT = resolve(import.meta.dirname, '../..')

test('BR-B2B-066 item 4: a CPF partner in Brazil keeps the cpf type', () => {
  assert.equal(taxConfigOfClient('creator', 'Brazil', '529.982.247-25').type, 'cpf')
  assert.equal(taxConfigOfClient('creator', 'Brazil', '529.982.247-25').label, 'CPF')
})

test('BR-B2B-066 item 4: a CNPJ partner, numeric or alphanumeric, gets cnpj', () => {
  assert.equal(taxConfigOfClient('influencer', 'Brazil', '11.222.333/0001-81').type, 'cnpj')
  assert.equal(taxConfigOfClient('driver', '', '12ABC34501DE35').type, 'cnpj')
})

test('every other client keeps the document of its country', () => {
  assert.equal(taxConfigOfClient('venue', 'Brazil', '529.982.247-25').type, 'cnpj')
  assert.equal(taxConfigOfClient('venue', 'Portugal', null).type, 'nipc')
  assert.equal(taxConfigOfClient('tour_guide', 'Brazil', '52998224725').type, 'cnpj')
})

test('the editor sends the type of the document, not of the country, for the app partner', () => {
  const modal = readFileSync(resolve(ROOT, 'components/admin/clients/ClientEditorModal.tsx'), 'utf8')
  assert.ok(/payload\.tax_id_type = taxConfigOfClient\(/.test(modal))
  assert.ok(!/taxConfigFor\(/.test(modal))
})

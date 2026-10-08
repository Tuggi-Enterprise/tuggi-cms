/**
 * #910 — Validação and Parceria are one tab, Parceria (spec `docs/design/spec-cms-ficha-aba-parceria-2026-10.md`).
 *
 * The browser half of §11 is `tests/ct/partnership-tab-910.spec.tsx`. This file holds what a mount
 * cannot reach: the address the page reads (§11 item 2: `?validation=` and the old `tab=validation`
 * land on Parceria), the tab list itself, and the copy the spec fixed or retired.
 *
 * Mutations that turn it red: putting `validation` back in `TABS`; dropping the `tab=validation`
 * alias; changing a label from the spec's table; leaving a retired key in `messages/`.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(import.meta.dirname, '../..', path), 'utf8')
const messages = (locale: string) => JSON.parse(read(`messages/${locale}.json`))

test('#910 §11 item 1: the tab list has no validation, and Parceria comes first', () => {
  const modal = read('components/admin/clients/ClientEditorModal.tsx')
  const tabs = modal.slice(modal.indexOf('const TABS'), modal.indexOf('export function ClientEditorModal'))
  const ids = Array.from(tabs.matchAll(/id: '(\w+)'/g), (m) => m[1])
  assert.equal(ids[0], 'partnership')
  assert.equal(ids.indexOf('validation'), -1)
  assert.doesNotMatch(modal, /\| 'validation'/, 'ClientEditorTab has no validation member')
  // The dot of a submission in review moved with it.
  assert.match(modal, /tab\.id === 'partnership' && review\?\.status === 'in_review'/)
  // The pre-registration keeps one tab open, and it is this one.
  assert.match(modal, /preRegistration\s*\?\s*tab\.id !== 'partnership'/)
})

test('#910 §11 item 2: `?validation=<id>` and the old `tab=validation` open Parceria', () => {
  const page = read('components/admin/AdminClientsPageContent.tsx')
  assert.match(page, /initialTab=\{validationId \? 'partnership' : initialTab\}/)
  assert.match(page, /requestedTab === 'validation' \? 'partnership'/)
})

test('#910: the new labels are the spec table, word for word', () => {
  const pt = messages('pt')
  assert.deepEqual(
    {
      blockPlace: pt.Partnerships.detail.blockPlace,
      blockPublication: pt.Partnerships.detail.blockPublication,
      blockContract: pt.Partnerships.detail.blockContract,
      regularityLine: pt.Partnerships.detail.regularityLine,
      regularityLineAnonymous: pt.Partnerships.detail.regularityLineAnonymous,
      portalTermsLine: pt.Partnerships.detail.portalTermsLine,
      noPlaceLinked: pt.Partnerships.detail.noPlaceLinked,
      linkInPlaces: pt.Partnerships.detail.linkInPlaces,
      submissionSummary: pt.PartnerValidation.submissionSummary,
    },
    {
      blockPlace: 'O local',
      blockPublication: 'Publicação',
      blockContract: 'Contrato',
      regularityLine: 'Regularidade conferida por {person} em {date}.',
      regularityLineAnonymous: 'Regularidade conferida em {date}.',
      portalTermsLine: 'Termo {version} aceito em {date}.',
      noPlaceLinked: 'Nenhum local vinculado.',
      linkInPlaces: 'Vincular em Locais',
      submissionSummary: 'Ver o cadastro enviado em {date}',
    }
  )
})

test('#910: the keys the spec retires have no reader and are gone from every locale', () => {
  const retiredDetail = [
    'bands', 'bandStatus', 'toggle', 'proposalMissing', 'conferenceNone', 'conferenceDerived',
    'clientSeparateActs', 'openClient', 'publicationBefore', 'trail', 'trailEmpty',
  ]
  const pt = messages('pt')
  for (const key of retiredDetail) {
    assert.equal(pt.Partnerships.detail[key], undefined, `Partnerships.detail.${key}`)
  }
  for (const key of ['linked', 'openContract', 'openFiscal']) {
    assert.equal(pt.PartnerValidation.acceptance[key], undefined, `PartnerValidation.acceptance.${key}`)
  }
  assert.equal(pt.PartnerValidation.history.empty, undefined)
  for (const locale of ['pt', 'en', 'es']) {
    const m = messages(locale)
    assert.equal(m.Clients.editor.tabs.validation, undefined, `${locale}: Clients.editor.tabs.validation`)
    for (const key of ['isPlatformOwner', 'taxIdType', 'taxIdAutoCountry']) {
      assert.equal(m.Clients.fiscal.fields[key], undefined, `${locale}: Clients.fiscal.fields.${key}`)
    }
  }
})

test('#910 §9: Fiscal & Pagamentos changed its layout only — the same fields reach `updateField`', () => {
  const fiscal = read('components/admin/clients/tabs/FiscalPaymentsTab.tsx')
  const written = Array.from(fiscal.matchAll(/updateField\(\s*'(\w+)'/g), (m) => m[1]).sort()
  assert.deepEqual(written, [
    'bank_account_number', 'bank_name', 'bank_routing_number', 'bic_swift', 'billing_email',
    'commission_rate', 'courtesy_reason', 'iban', 'is_courtesy', 'is_platform_owner',
    'legal_representative_name', 'legal_representative_role', 'monthly_fee_cents', 'notes', 'tax_id',
  ])
})

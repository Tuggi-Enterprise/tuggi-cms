/**
 * #886 — O QUE O PARCEIRO INFORMOU, QUE O EDITOR DO LOCAL MOSTRA SOMENTE LEITURA.
 *
 * `partnerRegistrationSummary` é uma ALLOWLIST: o cadastro carrega também o representante (nome,
 * CPF, e-mail, telefone — BR-B2B-030), e o que sai daqui vai ao navegador do curador. Esta suíte
 * entrega respostas que CONTÊM tudo isso e prova que nada atravessa — nem como chave, nem dentro
 * de um valor serializado.
 *
 * Mutações que a deixam vermelha: trocar a allowlist por `...answers`; incluir um campo
 * `representative_*` no resumo; deixar o `story_script` do portal de fora.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { partnerRegistrationSummary } from '@/lib/partnerships/partner-registration'
import type { PartnerAnswers } from '@/lib/partner-form/schema'

/** Answers the way the form and the portal store them, representative included. */
const REPRESENTATIVE = {
  representative_name: 'Maria Souza Representante',
  representative_cpf: '123.456.789-09',
  representative_email: 'maria.rep@padaria.com.br',
  representative_phone: '+55 21 99999-8888',
  signer_cpf: '987.654.321-00',
  contact_email: 'contato@padaria.com.br',
  contact_phone: '2133334444',
  contact_whatsapp: '21999998888',
  tax_id: '11222333000181',
} as const

function answers(over: Record<string, string> = {}): PartnerAnswers {
  return {
    signature_item: 'Pão de queijo recheado',
    languages: JSON.stringify(['pt', 'en']),
    instagram: '@padariasantaclara',
    subtypes: JSON.stringify(['bakery', 'cafe']),
    story_founder: 'Dona Clara abriu em 1971.',
    story_script: 'Roteiro do portal.',
    ...REPRESENTATIVE,
    ...over,
  } as PartnerAnswers
}

test('BR-B2B-030 · nothing of the representative, CPF, e-mail or phone survives, as key or as value', () => {
  const summary = partnerRegistrationSummary(answers(), 'portal')
  assert.ok(summary)
  const wire = JSON.stringify(summary)
  for (const [key, value] of Object.entries(REPRESENTATIVE)) {
    assert.ok(!wire.includes(value), `${key} value leaked`)
    assert.ok(!wire.includes(key), `${key} name leaked`)
  }
  assert.deepEqual(Object.keys(summary).sort(), ['instagram', 'languages', 'signatureItem', 'source', 'story', 'subtypes'])
})

test('BR-B2B-030 · the allowlist is what is shown: the answered fields come through, as the partner wrote them', () => {
  const summary = partnerRegistrationSummary(answers(), 'portal')
  assert.deepEqual(summary, {
    source: 'portal',
    signatureItem: 'Pão de queijo recheado',
    languages: ['pt', 'en'],
    instagram: '@padariasantaclara',
    subtypes: ['bakery', 'cafe'],
    story: [
      { id: 'story_founder', answer: 'Dona Clara abriu em 1971.' },
      { id: 'story_script', answer: 'Roteiro do portal.' },
    ],
  })
})

test('BR-B2B-030 · a representative-only registration has nothing to show: null, not an empty panel', () => {
  assert.equal(partnerRegistrationSummary(REPRESENTATIVE as unknown as PartnerAnswers, 'proposal'), null)
  assert.equal(partnerRegistrationSummary(null, 'portal'), null)
  assert.equal(partnerRegistrationSummary({}, 'portal'), null)
})

test('BR-B2B-030 · a representative value typed INTO an allowlisted field is the partner\'s own text, shown as is — and still no key leaks', () => {
  // The allowlist guards by field, not by content: what the partner typed in a field the panel
  // shows is shown. This pins that boundary so nobody mistakes the guard for a content filter.
  const summary = partnerRegistrationSummary(answers({ signature_item: 'ligue 2133334444' }), 'proposal')
  assert.equal(summary?.signatureItem, 'ligue 2133334444')
  assert.ok(!JSON.stringify(summary).includes('representative_'))
})

test('#886 · blank and malformed answers are omitted, never rendered as empty labels', () => {
  const summary = partnerRegistrationSummary(
    answers({ signature_item: '   ', instagram: '', languages: 'not json', subtypes: '{"a":1}', story_founder: ' ', story_script: '' }),
    'proposal'
  )
  assert.equal(summary, null)
})

test('#886 · the source travels with the answers (portal or promoted proposal)', () => {
  assert.equal(partnerRegistrationSummary(answers(), 'proposal')?.source, 'proposal')
  assert.equal(partnerRegistrationSummary(answers(), 'portal')?.source, 'portal')
})

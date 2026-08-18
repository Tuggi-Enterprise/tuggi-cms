/**
 * Os dois colchetes que ninguém podia mandar a um parceiro — e o país que o modelo não alcança.
 *
 * `[ÍNDICE A DEFINIR PELO JURÍDICO]` e `[FORO A DEFINIR PELO JURÍDICO]` eram buracos corretos
 * enquanto ninguém tinha decidido: BR-B2B-023, item 2, proíbe nomear o índice antes de o
 * advogado escolher. O que faltava era a trava — nada no software impedia gerar um contrato com
 * os colchetes impressos no corpo, e um documento assim é pior que um campo vazio, porque ele
 * parece pronto.
 *
 * O operador decidiu os dois em 2026-08-18: IPCA e foro de São Paulo, sede da TUGGI.
 *
 * E A TRAVA QUE O BANCO PEDIU. O cadastro aceita nove países (`countries.ts` conhece NIPC, NIF,
 * VAT, EIN), mas o modelo é um instrumento brasileiro de ponta a ponta: diz `inscrita no CNPJ`,
 * exige alvará, invoca a MP 2.200-2, elege foro em São Paulo e oferece Pix ou boleto. Havia um
 * cliente português no cadastro quando isto foi escrito. Gerar para ele imprimiria `CNPJ` sobre
 * um NIPC — afirmação falsa sobre a contraparte, dentro do instrumento que ela assina.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ADJUSTMENT_INDEX_PLACEHOLDER,
  JURISDICTION_CITY,
  JURISDICTION_STATE,
  activeTemplate,
  pendingReviewPlaceholder,
  renderClauses,
} from '@/lib/contract/template'
import { contractChecklist } from '@/lib/contract/snapshot'
import { EMPTY_CONFERENCE } from '@/lib/partner-form/regularity'
import type { ContractSnapshot } from '@/lib/contract/snapshot'
import type { Client } from '@/types/clients'

function snapshot(tier: 'free' | 'paid' = 'paid'): ContractSnapshot {
  return {
    templateVersion: activeTemplate().version,
    tier,
    provider: {
      legalName: 'Tuggi Tecnologia Ltda',
      taxId: '11222333000144',
      addressLine: 'São Paulo, SP',
      representativeName: 'Marta',
      representativeRole: 'Sócia',
    },
    partner: {
      clientId: 'c1',
      legalName: 'Restaurante do Porto Ltda',
      tradeName: 'Restaurante do Porto',
      taxId: '12345678000190',
      addressLine: 'Santos, SP',
      representativeName: 'Ana',
      representativeRole: 'Sócia',
    },
    monthlyFeeCents: tier === 'paid' ? 10000 : null,
    isCourtesy: false,
    courtesyReason: null,
    paymentMethod: 'pix',
    commissionRate: 0.1,
    qrDeliveryDays: 30,
    generatedAt: '2026-08-18T12:00:00.000Z',
  }
}

test('o marcador do índice segue aberto — a escolha é do advogado, não de um agente', () => {
  const price = renderClauses(snapshot())
    .find((clause) => clause.id === 'price_and_payment')!
    .paragraphs.join(' ')

  // BR-B2B-023, item 2. O operador perguntou qual índice é o usual em 2026-08-18 e a resposta
  // foi IPCA; responder não é decidir, e nomear a sigla aqui seria um agente escolhendo no
  // lugar de quem a regra nomeia.
  assert.match(price, /índice que legalmente o substituir/)
  assert.ok(price.includes(ADJUSTMENT_INDEX_PLACEHOLDER))
  for (const index of [/IPCA/, /IGP-M/, /INPC/, /IGPM/]) assert.doesNotMatch(price, index)
})

test('enquanto houver marcador, o contrato pago não é gerado — e o gratuito não tem o que travar', () => {
  // A trava que faltava: o buraco era correto e nada impedia mandá-lo ao parceiro impresso.
  // Um contrato com colchete no corpo é pior que um campo vazio, porque parece pronto.
  assert.equal(pendingReviewPlaceholder('paid'), ADJUSTMENT_INDEX_PLACEHOLDER)

  // A faixa gratuita não recebe a cláusula de preço, então não tem índice a definir e não fica
  // bloqueada por uma decisão que não a alcança. A trava lê o texto RENDERIZADO por faixa, e é
  // por isso que ela acerta isto sem ninguém ter escrito a exceção.
  assert.equal(pendingReviewPlaceholder('free'), null)

  const blocked = checklistFor(client())
  assert.equal(blocked.ready, false, 'com marcador aberto, a geração é recusada')
  assert.ok(blocked.missing.find((item) => item.id === 'template_placeholder'))

  // E quando o jurídico fechar o buraco, é ESTE teste que solta a geração: sem marcador, o
  // item some do checklist.
  const free = contractChecklist(
    client(),
    { tier: 'paid', paymentMethod: 'pix', qrDeliveryDays: 30 },
    {
      platformOwner: { state: 'found', client: client({ id: 'owner' }) },
      regularity: {
        conference: {
          ...EMPTY_CONFERENCE,
          documentsSeen: ['business_license', 'incorporation'],
          licenseNumber: '1',
          licenseIssuer: 'Santos/SP',
          licenseValidUntil: '2099-01-01',
        },
      } as never,
      templateMarker: null,
    }
  )
  assert.equal(
    free.missing.some((item) => item.id === 'template_placeholder'),
    false,
    'sem marcador, o item some do checklist'
  )
  // O que sobra é o cadastro, e é o que já era: esta suíte prova a TRAVA, não a completude da
  // ficha. `contract-checklist-target.test.ts` cobre os campos.
  assert.equal(
    free.missing.every((item) => item.id !== 'template_placeholder'),
    true
  )
})

test('o foro é a comarca da sede de quem redige — CPC, art. 63, §3º', () => {
  const law = renderClauses(snapshot())
    .find((clause) => clause.id === 'governing_law')!
    .paragraphs.join(' ')

  assert.match(law, new RegExp(`comarca de ${JURISDICTION_CITY}`))
  assert.match(law, new RegExp(`Estado de ${JURISDICTION_STATE}`))
  // Num contrato de adesão, a eleição que acompanha a sede é a defensável; uma comarca sem
  // relação com ninguém é a que o juiz reputa abusiva de ofício.
  assert.match(law, /sede\s+da TUGGI/)
})

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: 'c1',
    status: 'approved',
    name: 'Restaurante do Porto',
    company_name: 'Restaurante do Porto Ltda',
    tax_id: '12345678000190',
    address: 'Av. Beira Mar, 200',
    legal_representative_name: 'Ana Prado',
    legal_representative_role: 'Sócia',
    commission_rate: 0.1,
    monthly_fee_cents: 10000,
    country: 'Brazil',
    ...overrides,
  } as unknown as Client
}

const checklistFor = (partner: Client) =>
  contractChecklist(
    partner,
    { tier: 'paid', paymentMethod: 'pix', qrDeliveryDays: 30 },
    {
      platformOwner: { state: 'found', client: client({ id: 'owner' }) },
      regularity: {
        conference: {
          ...EMPTY_CONFERENCE,
          documentsSeen: ['business_license', 'incorporation'],
          licenseNumber: '1',
          licenseIssuer: 'Santos/SP',
          licenseValidUntil: '2099-01-01',
        },
      } as never,
      templateMarker: pendingReviewPlaceholder('paid'),
    }
  )

test('um estabelecimento brasileiro passa; um de fora não gera contrato nenhum', () => {
  assert.equal(
    checklistFor(client()).missing.some((item) => item.id === 'foreign_establishment'),
    false,
    'o Brasil é o país do modelo'
  )

  // `BR` e cadastro sem país também passam: a base tem as duas grafias e o cadastro antigo é
  // brasileiro por origem.
  for (const country of ['BR', '', null]) {
    assert.equal(
      checklistFor(client({ country: country as never })).missing.some(
        (item) => item.id === 'foreign_establishment'
      ),
      false,
      `\`${country}\` deveria passar`
    )
  }

  // Portugal, não. Havia um cliente assim no cadastro em 2026-08-18.
  const foreign = checklistFor(client({ country: 'Portugal' }))
  assert.equal(foreign.ready, false)
  const blocked = foreign.missing.find((item) => item.id === 'foreign_establishment')
  assert.ok(blocked, 'gerar para fora do Brasil imprimiria CNPJ sobre um NIPC')
  assert.match(blocked!.label, /Portugal/)
})

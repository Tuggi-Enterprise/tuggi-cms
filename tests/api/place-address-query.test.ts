/**
 * A consulta que centraliza o mapa do local leva o endereço INTEIRO.
 *
 * O QUE FOI MEDIDO em 26/08/2026, no `Cozi +`. `core.attractions.formatted_address` do local que
 * a aprovação do parceiro cria é o que `joinAddress` monta — rua, complemento e bairro, e nada
 * mais: `Av Assunção 606, São Bento`. Era essa a string que ia inteira para `places:searchText`,
 * que então procurava uma avenida por nome no Brasil todo. Cidade, estado e CEP sempre estiveram
 * no registro (`core.cms_create_place` insere `city` e `country` NOT NULL); faltava perguntá-los
 * junto.
 *
 * A geocodificação continua movendo uma CÂMERA e nada mais (#371, decisão do operador em
 * 2026-08-17). Nada aqui vira coordenada.
 *
 * Mutações que deixam esta suíte vermelha:
 *  · a consulta voltar a ser só `formatted_address`;
 *  · repetir a cidade que o endereço já contém;
 *  · `getDetails` parar de trazer `postal_code`.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { buildAddressQuery } from '../../lib/maps/place-address-query'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

/** O fonte SEM comentários — toda asserção sobre o que um arquivo FAZ lê isto. */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

test('o local do parceiro deixa de procurar a avenida no Brasil inteiro', () => {
  assert.equal(
    buildAddressQuery({
      address: 'Av Assunção 606, São Bento',
      postalCode: '28906-200',
      city: 'Cabo Frio',
      state: 'Rio de Janeiro',
      country: 'Brazil',
    }),
    'Av Assunção 606, São Bento, 28906-200, Cabo Frio, Rio de Janeiro, Brazil'
  )
})

test('parte que o endereço já contém não se repete', () => {
  // `formatted_address` de um POI importado do Google costuma trazer cidade e estado dentro.
  assert.equal(
    buildAddressQuery({
      address: 'Rua Raul Veiga, 558 - Centro, Cabo Frio - RJ',
      city: 'Cabo Frio',
      state: 'RJ',
      country: 'Brazil',
    }),
    'Rua Raul Veiga, 558 - Centro, Cabo Frio - RJ, Brazil'
  )
})

test('a comparação ignora acento e caixa — é a mesma parte por duas mãos', () => {
  assert.equal(
    buildAddressQuery({ address: 'Rua X, SAO BENTO', city: 'São Bento', country: 'Brazil' }),
    'Rua X, SAO BENTO, Brazil'
  )
})

test('sem endereço, a cidade ainda vale uma câmera', () => {
  // Melhor abrir sobre a cidade certa do que sobre São Paulo, que é o fallback.
  assert.equal(
    buildAddressQuery({ address: null, city: 'Búzios', state: 'Rio de Janeiro', country: 'Brazil' }),
    'Búzios, Rio de Janeiro, Brazil'
  )
})

test('sem nada, a consulta é vazia — e vazia é resposta, não erro', () => {
  // `geocodeAddress` devolve `null` para uma string em branco e o mapa abre onde abria antes.
  assert.equal(buildAddressQuery({}), '')
  assert.equal(buildAddressQuery({ address: '  ', city: null, state: '', country: undefined }), '')
})

test('o mapa do local recebe a consulta montada, e não a coluna crua', () => {
  const modal = code('components/place-management/PlaceFormModal.tsx')

  // A consulta é montada UMA vez e passa a ser lida em dois lugares — o mapa procura por ela e a
  // aba Detalhes a EXIBE (2026-08-26). Por isso a asserção é sobre a montagem e sobre quem a
  // recebe, e não sobre `buildAddressQuery` estar escrito dentro da prop: montá-la uma segunda vez
  // para a tela é justamente o defeito que faria o operador ler um endereço e o buscador receber
  // outro.
  assert.match(modal, /const addressQuery = buildAddressQuery\(\{/)
  assert.match(modal, /address=\{addressQuery\}/)
  assert.match(modal, /postalCode: details\?\.postal_code \?\? null/)
  // Os campos do FORMULÁRIO: a cidade que o curador acabou de corrigir é a que deve mirar.
  assert.match(modal, /city: form\.city/)
  assert.match(modal, /state: form\.state/)
  // Uma montagem só. Duas seria a tela e o mapa podendo discordar.
  assert.equal(modal.split('buildAddressQuery({').length - 1, 1)
})

test('`postal_code` chega junto com `formatted_address`, na mesma leitura', () => {
  const service = code('lib/core/place-service.ts')

  assert.match(service, /\.select\('formatted_address, postal_code'\)/)
  assert.match(service, /getAddressColumns/)
  // Uma leitura só: `getFormattedAddress` continua existindo e passa a ler por aqui.
  assert.equal(service.indexOf(".select('formatted_address')"), -1)
})

test('a aba Detalhes MOSTRA o endereço, e mostra a mesma string que o mapa procura', () => {
  // Pedido do operador em 2026-08-26: "na parte de detalhes, mostre o endereço do local". O valor
  // exibido é `addressQuery` — a mesma consulta que desce para o `LocationPicker` —, e é isso que
  // faz a linha na tela EXPLICAR um pino que caiu errado em vez de ser mais um dado a conferir.
  const modal = code('components/place-management/PlaceFormModal.tsx')

  assert.match(modal, /\{hasStreetAddress \? addressQuery : t\('address_none'\)\}/)
  assert.match(modal, /L\('address'\)/)
  // A RUA é o que decide se há endereço a mostrar: sem ela sobra `Cabo Frio, Rio de Janeiro,
  // Brazil`, que é a repetição dos três campos logo acima e não é endereço nenhum.
  assert.match(modal, /const hasStreetAddress = !!\(details\?\.formatted_address \?\? ''\)\.trim\(\)/)
})

test('o rótulo e o vazio do endereço existem nos três locales', () => {
  for (const locale of ['pt', 'en', 'es']) {
    const messages = JSON.parse(read(`messages/${locale}.json`))
    const label = messages.Modals?.PlaceDetails?.labels?.address
    const none = messages.Modals?.PlaceDetails?.address_none
    assert.equal(typeof label, 'string', `${locale} is missing Modals.PlaceDetails.labels.address`)
    assert.equal(typeof none, 'string', `${locale} is missing Modals.PlaceDetails.address_none`)
    assert.equal(label.trim().length > 0 && none.trim().length > 0, true, `${locale} has an empty one`)
  }
})

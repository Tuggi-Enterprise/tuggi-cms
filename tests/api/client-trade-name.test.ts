/**
 * Nome fantasia e razão social — qual coluna é qual, dito uma vez e provado nas quatro pontas.
 *
 * O DEFEITO, relatado pelo operador em 2026-08-26 e medido no cliente `Cozi +`. O formulário do
 * parceiro pergunta as duas coisas e `promotion.ts` grava cada uma na sua coluna:
 *
 *     trade_name  'Cozi +'                        →  partner.clients.name
 *     legal_name  'Cozimais Restaurante e Café'   →  partner.clients.company_name
 *
 * A aba Perfil rotulava `name` como `Nome / Razão social` e `company_name` como `Nome comercial`
 * — exatamente ao contrário —, e o cabeçalho do registro mostrava a razão social. Os rótulos
 * eram o erro, não o dado: é de `company_name` que `lib/contract/snapshot.ts` tira o `legalName`
 * impresso no contrato, e um rótulo invertido convida o operador a corrigir o dado certo.
 *
 * E ISSO ALCANÇAVA A URL PÚBLICA. `partner.ensure_client_slug` montava o slug com
 * `COALESCE(NULLIF(company_name,''), name)` — a razão social primeiro —, e `/d/{slug}` saiu
 * `cozimais-restaurante-e-cafe` para um estabelecimento cuja fachada diz `Cozi +`. A ordem
 * inverte na migration `20260826_01`; slug existente NÃO é regenerado, porque ele já foi para
 * QR code e material impresso.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const messages = (locale: string) => JSON.parse(read(`messages/${locale}.json`))

const MIGRATION = 'supabase/migrations/20260826_01_client_slug_from_trade_name.sql'

/** O fonte SEM comentários — toda asserção sobre o que um arquivo FAZ lê isto. */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

test('o formulário grava o fantasia em `name` e a razão social em `company_name`', () => {
  const promotion = code('lib/partner-form/promotion.ts')

  assert.match(promotion, /\{ column: 'name', source: \{ kind: 'field', field: 'trade_name' \} \}/)
  assert.match(promotion, /\{ column: 'company_name', source: \{ kind: 'field', field: 'legal_name' \} \}/)
})

test('o contrato imprime `company_name` como razão social — é ele quem decide de quem é o nome', () => {
  const snapshot = code('lib/contract/snapshot.ts')
  assert.match(snapshot, /legalName = owner\.company_name\?\.trim\(\) \|\| owner\.name\?\.trim\(\)/)
})

test('os rótulos da aba Perfil dizem o que a coluna guarda, nos três idiomas', () => {
  const expected: Record<string, { name: RegExp; companyName: RegExp }> = {
    pt: { name: /comercial/i, companyName: /raz[aã]o social/i },
    en: { name: /trade/i, companyName: /legal/i },
    es: { name: /comercial/i, companyName: /raz[oó]n social/i },
  }

  for (const [locale, want] of Object.entries(expected)) {
    const fields = messages(locale).Clients.profile.fields
    assert.match(fields.name, want.name, `${locale}: \`name\` guarda o nome fantasia`)
    assert.match(fields.companyName, want.companyName, `${locale}: \`company_name\` guarda a razão social`)
    // A inversão que existia: `name` rotulado como razão social.
    assert.doesNotMatch(fields.name, want.companyName, `${locale}: rótulo invertido de volta`)
  }
})

test('o registro se identifica pelo fantasia, que é o que está na fachada', () => {
  const modal = code('components/admin/clients/ClientEditorModal.tsx')
  assert.match(
    modal,
    /edited\.name \|\| client\?\.name \|\| edited\.company_name \|\| client\?\.company_name/
  )
})

test('o slug de /d/{slug} nasce do fantasia', () => {
  // SEM os comentários: o cabeçalho cita a ordem ANTIGA para dizer como voltar atrás, e é o
  // corpo executável que decide de qual coluna o slug nasce.
  const migration = read(MIGRATION).replace(/^\s*--.*$/gm, '')

  const generations = [...migration.matchAll(/next_unique_client_slug\(/g)].length
  const fromTradeName = [
    ...migration.matchAll(
      /next_unique_client_slug\(COALESCE\(NULLIF\(NEW\.name, ''\), NEW\.company_name\), NULL\)/g
    ),
  ].length

  assert.equal(generations, 2, 'os dois ramos de INSERT que geram o slug')
  assert.equal(fromTradeName, 2, 'os dois partem do fantasia, com a razão social de reserva')
  // A ordem antiga, que produziu `/d/cozimais-restaurante-e-cafe`.
  assert.equal(migration.indexOf("COALESCE(NULLIF(NEW.company_name, ''), NEW.name)"), -1)
})

test('a migration não regenera slug que já existe — ele foi impresso em QR code', () => {
  const migration = read(MIGRATION)

  // O ramo UPDATE devolve o slug antigo quando o campo vem vazio: nada nesta migration
  // reescreve dado, só a definição da função.
  assert.match(migration, /ELSIF TG_OP = 'UPDATE' THEN[\s\S]*?NEW\.slug := OLD\.slug/)
  for (const forbidden of ['UPDATE partner.clients', 'DELETE', 'DROP', 'TRUNCATE']) {
    assert.equal(migration.toUpperCase().indexOf(forbidden.toUpperCase()), -1, `a migration não pode conter ${forbidden}`)
  }
  // Rollback escrito, como manda o gatilho de mudança de schema.
  assert.match(migration, /ROLLBACK:/)
})

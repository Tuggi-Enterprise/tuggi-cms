/**
 * Trade name and legal name: which column holds which, said once and proven at the four ends.
 *
 * THE DEFECT, reported by the operator on 2026-08-26 and measured on the client `Cozi +`. The
 * partner form asks for both and `promotion.ts` writes each one to its own column:
 *
 *     trade_name  'Cozi +'                        ->  partner.clients.name
 *     legal_name  'Cozimais Restaurante e Café'   ->  partner.clients.company_name
 *
 * The Profile tab labelled `name` as the legal name and `company_name` as the trade name, exactly
 * backwards, and the record header showed the legal name. The labels were wrong, not the data:
 * `lib/contract/snapshot.ts` takes the printed `legalName` from `company_name`, and an inverted
 * label invites the operator to "fix" the right data.
 *
 * AND IT REACHED THE PUBLIC URL. `partner.ensure_client_slug` built the slug from
 * `COALESCE(NULLIF(company_name,''), name)`, legal name first, and `/d/{slug}` came out as
 * `cozimais-restaurante-e-cafe` for a place whose facade reads `Cozi +`. Migration `20261007110000`
 * of db-tuggiApp (#896) builds it from the trade name plus the city; an existing slug is NOT
 * regenerated, because it is already on QR codes and printed material (BR-B2B-037).
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { APP_SCHEMA_SKIP, functionDef } from './setup/app-schema'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const messages = (locale: string) => JSON.parse(read(`messages/${locale}.json`))

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

// BR-B2B-037 · #896 · #897: a new client slug is born from the trade name plus the city (operator
// decision, 2026-10-07), falling back to the legal name when the trade name is blank. The source is
// the last definition of the function in the db-tuggiApp history, today `20261007110000`.
const SLUG_BASE =
  "next_unique_client_slug(COALESCE(NULLIF(btrim(NEW.name), ''), NEW.company_name) || ' ' || COALESCE(NEW.city, ''), NULL)"

test('BR-B2B-037: the /d/{slug} slug is born from the trade name and the city', { skip: APP_SCHEMA_SKIP }, () => {
  const fn = functionDef('partner.ensure_client_slug').replace(/^\s*--.*$/gm, '')
  const insert = fn.slice(0, fn.indexOf("ELSIF TG_OP = 'UPDATE'"))

  assert.equal(insert.split('next_unique_client_slug(').length - 1, 2, 'the two INSERT branches that generate the slug')
  assert.equal(insert.split(SLUG_BASE).length - 1, 2, 'both start from the trade name and the city')
  assert.equal(fn.indexOf("COALESCE(NULLIF(NEW.company_name, ''), NEW.name)"), -1, 'the legal name no longer comes first')
})

test('BR-B2B-037 item 4: an existing slug is never regenerated, it is printed on a QR code', { skip: APP_SCHEMA_SKIP }, () => {
  assert.match(functionDef('partner.ensure_client_slug'), /ELSIF TG_OP = 'UPDATE' THEN[\s\S]*?NEW\.slug := OLD\.slug/)
})

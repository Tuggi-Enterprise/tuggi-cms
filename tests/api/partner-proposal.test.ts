/**
 * What is left of the partnership proposal in this repository — #396.
 *
 * The FORM moved to `tuggi-enterprise` (`/partners/proposal`), and its guarantees moved with
 * it: the CNPJ validation, the field allowlist, the per-address limit, the local draft, the
 * copy of every state. `tuggi-enterprise/tests/e2e/partner-proposal.spec.ts` is where they are
 * now, and this file deliberately does not keep a second, weaker copy of them.
 *
 * What stayed here is the READING side, and it is the half that a cross-repository move can
 * break in silence:
 *
 *  1. **The mirror of the field list.** The conference indexes
 *     `partner.partner_form_submissions.answers` by the ids in `lib/partner-form/fields.ts`, which
 *     is a copy of a list owned by another repository. What binds them is
 *     `docs/contracts/partner-proposal-answers.md`; what fails when the copy rots is here.
 *  2. **The deduplication key.** `tax_id_normalized` is `GENERATED ALWAYS ... STORED` — measured
 *     on the live database on 2026-08-17, and probed by the migration that created it — so the
 *     database refuses a writer that supplies the column, and the key is correct as long as
 *     `normalizedTaxId` mirrors the expression exactly. (#396 recorded the opposite here; #398
 *     measured it again and put it back.)
 *  3. **The 301.** The commercial team e-mailed `/pt/parceria` to real establishments. Deleting
 *     the page without the redirect answers 404 to material already handed out.
 *  4. **The labels.** The reviewer reads the same question the merchant answered, and that only
 *     holds while `PartnerForm.fields.<id>.label` exists for all 21 ids and is handed to the
 *     conference page.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  PARTNER_FIELD_IDS,
  PARTNER_FORM_FIELDS,
  PARTNER_CATEGORIES,
  PARTNER_DOCUMENT_KINDS,
  fieldsOfStep,
} from '@/lib/partner-form/fields'
import { storyNudge } from '@/lib/partner-form/schema'
import { answerLabel } from '@/components/admin/partner-proposals/format'
import { normalizedTaxId } from '@/lib/partner-form/tax-id-key'
import { isValidCnpj } from '@/lib/validation/cnpj'
import { CLIENT_ADMIN_ONLY_FIELDS } from '@/lib/services/client-editable-fields'
import { PUBLIC_PATH_PREFIXES, isPublicPath } from '@/lib/roles'

const REPO_ROOT = resolve(import.meta.dirname, '../..')

const read = (relative: string) => readFileSync(resolve(REPO_ROOT, relative), 'utf8')

/**
 * The same file with its comments removed.
 *
 * A static ruler that reads prose flags the sentence that EXPLAINS the rule as a breach of it —
 * this file failed twice on its own docstrings before the strip existed, once on the word
 * `required` inside "the reader does not declare `required`" and once on `permanent: true`
 * inside "301 and not `permanent: true`". Whether a symbol is DECLARED is a question about
 * code, so the question is asked of the code.
 */
const code = (relative: string) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
const messages = () => JSON.parse(read('messages/pt.json'))

/**
 * The URL the proposal answers at now. Written out because the two repositories cannot import
 * each other's route map — that is precisely the fact `docs/contracts/partner-proposal-answers.md`
 * exists to record, and this constant is the assertion that makes a slug change here loud.
 */
const PROPOSAL_URL = 'https://www.tuggi.app/pt/parcerias/proposta'

// ── 1. The mirror ───────────────────────────────────────────────────────────────────────

test('#396: the reader mirrors the 24 answer keys, and nothing more', () => {
  // The count is the contract's. A key that exists on the writing side and not here is an
  // answer the conference never shows; a key that exists here and not there is a column the
  // reviewer is told is empty when it was never asked.
  assert.equal(PARTNER_FORM_FIELDS.length, 24)
  assert.equal(new Set(PARTNER_FIELD_IDS).size, 24, 'no id is declared twice')

  assert.deepEqual(
    fieldsOfStep(1).map((field) => field.id),
    [
      'trade_name',
      'legal_name',
      'tax_id',
      'category',
      'address',
      'address_complement',
      'district',
      'postal_code',
      'city',
      'state',
      'instagram',
      'opening_hours',
      'website',
    ]
  )
  assert.deepEqual(
    fieldsOfStep(2).map((field) => field.id),
    ['representative_name', 'representative_role', 'representative_email', 'representative_phone']
  )
  // The three quantities moved out of step 1 on 2026-08-19: it carried 16 of the 24 fields and
  // its own subtitle ("a gente começa pelo que está na fachada e no CNPJ") had stopped
  // describing it. The STEP is what the conference screen groups by, so the mirror moved with
  // the writer — `docs/contracts/partner-proposal-answers.md` is the document that says so, and
  // this assertion is where the two repositories are held to it.
  assert.deepEqual(
    fieldsOfStep(3).map((field) => field.id),
    [
      'story_founder',
      'story_before',
      'story_unique',
      'story_event',
      'material_sticker_qty',
      'material_table_display_qty',
      'material_counter_display_qty',
    ]
  )
})

test('#404: a choice is shown by its label, never by its identifier', () => {
  // The conference grid rendered `answers[field.id]` raw, so the curator read `bar_cafe` where
  // the merchant had picked "Bar ou café" — on the one screen where a person decides about a
  // real proposal. Mutation: return `value` for `category` again and this goes red.
  const form = (key: string) => (key === 'categories.bar_cafe' ? 'Bar ou café' : key)

  assert.equal(answerLabel('category', 'bar_cafe', form), 'Bar ou café')
  assert.notEqual(answerLabel('category', 'bar_cafe', form), 'bar_cafe')
  assert.equal(answerLabel('state', 'RJ', form), 'RJ — Rio de Janeiro')

  // Free text is returned untouched: this is a display helper, not a validator, and inventing a
  // label for something that is not a closed list is how a screen starts lying about the answer.
  assert.equal(answerLabel('trade_name', 'Cantina do Zé', form), 'Cantina do Zé')
  // An identifier that is not in the list is shown as it is, rather than as a missing key.
  assert.equal(answerLabel('category', 'nao_existe', form), 'nao_existe')
})

test('#396: the mirror carries no rule it does not apply', () => {
  // `required`, `maxLength`, `type`, `autoComplete` and the option lists belong to the surface
  // that VALIDATES, and that surface is in another repository. A copy of them here would keep
  // claiming the old limit the day the form widened one, and nothing would say so.
  const source = code('lib/partner-form/fields.ts')
  for (const property of ['required', 'maxLength', 'autoComplete', 'FORBIDDEN_FIELDS']) {
    assert.equal(
      source.includes(property),
      false,
      `${property} is the writing side's; a reader that declares it is a second owner`
    )
  }
})

test('BR-B2B-022: the two documents stay on the internal side, and the proposal never asked for them', () => {
  // The alvará and the contrato social are checked in person before an establishment is
  // invited (operator, 2026-08-16). The names survive because the RULE survives whole — the
  // evidence is what the team registers on the conference screen — and no answer key carries
  // one.
  assert.deepEqual([...PARTNER_DOCUMENT_KINDS], ['business_license', 'incorporation_document'])
  for (const kind of PARTNER_DOCUMENT_KINDS) {
    assert.equal(
      (PARTNER_FIELD_IDS as readonly string[]).includes(kind),
      false,
      `${kind} must not be an answer key`
    )
  }
})

test('BR-B2B-026: what the proposal collects that only an admin may write is in the admin allowlist', () => {
  // Not a formality: `tax_id` and the legal representative sit in CLIENT_ADMIN_ONLY_FIELDS and
  // `pickEditableFields` drops them. A public path that tried to write `partner.clients` would
  // persist nothing and report success — which is why the submission is a proposal and the
  // promotion is authenticated (BR-B2B-026, item 4).
  const adminOnly = new Set<string>(CLIENT_ADMIN_ONLY_FIELDS as readonly string[])
  assert.equal(adminOnly.has('tax_id'), true)
  assert.equal(adminOnly.has('legal_representative_name'), true)
  assert.equal(adminOnly.has('legal_representative_role'), true)
})

// ── 2. The deduplication key ────────────────────────────────────────────────────────────

test('BR-B2B-026: one company has one key, whatever shape it was typed in', () => {
  const key = normalizedTaxId('12.ABC.345/01DE-35')
  assert.equal(key, '12ABC34501DE35')
  assert.equal(normalizedTaxId('12abc34501de35'), key, 'case is a shape, not a company')
  assert.equal(normalizedTaxId(' 12 ABC 345 01DE 35 '), key, 'and so is anything typed around it')
  assert.equal(normalizedTaxId(''), '', 'nothing typed is no key, never a key that matches')
})

test('BR-B2B-026: two companies whose digits collide do not share a key', () => {
  // `12.ABC.345/01DE-35` and `12.AAD.345/01CN-35` are two real, valid, DIFFERENT companies:
  // same digit sequence, same check digits. Throwing the letters away (`[^0-9]`) turns both
  // into `123450135`, and the `data` measured the consequence against the live database — the
  // second one is told it is already our client.
  assert.equal(isValidCnpj('12ABC34501DE35'), true)
  assert.equal(isValidCnpj('12AAD34501CN35'), true)
  assert.notEqual(
    normalizedTaxId('12.ABC.345/01DE-35'),
    normalizedTaxId('12.AAD.345/01CN-35'),
    'the letters are part of the CNPJ, so they are part of the key'
  )
})

test('BR-B2B-026: the key strips first and upper-cases second — the order is the contract', () => {
  // Upper-casing first lets case folding INVENT characters that the strip then keeps: `ß`
  // upper-cases to `SS`, `ﬁ` to `FI`. The same value would then key differently depending on
  // which end normalised it, and the database's `upper(regexp_replace(...))` is the end that
  // wins. This vector is the one the `data` ran in Postgres: it answers `12ABC345XYZ` there.
  assert.equal(normalizedTaxId('Çã12.abc-3/45 xyz_ß'), '12ABC345XYZ')
  assert.equal(
    'Çã12.abc-3/45 xyz_ß'.toUpperCase().replace(/[^0-9A-Za-z]/g, ''),
    '12ABC345XYZSS',
    'this is what the inverted order produces — kept here so the difference is not theoretical'
  )
})

test('#398: the mirror says the column is GENERATED ALWAYS, because the safety of the key depends on it', () => {
  // This assertion was inverted between #396 and #398, and the inversion is the point: #396
  // recorded "column DEFAULT" from a bad reading, and a test then held the wrong sentence in
  // place. The difference is not pedantry — `GENERATED ALWAYS` REFUSES an INSERT that supplies
  // the column (428C9), a DEFAULT would silently yield to it — and whoever reads this module has
  // to learn which one it is, because the writer is in another repository and this is the only
  // place the obligation is stated on this side.
  //
  // Measured on the live database on 2026-08-17: `is_generated = 'ALWAYS'`,
  // `column_default = NULL`, `pg_attribute.attgenerated = 's'`. The migration
  // `20260814140000_issue341_proposta_do_parceiro_em_formulario_unico` declares it and probes it.
  const source = read('lib/partner-form/tax-id-key.ts')
  assert.ok(
    source.includes('GENERATED ALWAYS ... STORED'),
    'the docstring must name what the column actually is'
  )
  assert.ok(
    source.includes('428C9'),
    'and the SQLSTATE the database answers, which is what makes the guarantee structural'
  )
  assert.ok(
    source.includes('docs/contracts/partner-proposal-answers.md'),
    'and must point at the contract that binds the writer to omitting the column'
  )
})

// ── 3. The 301 ──────────────────────────────────────────────────────────────────────────

test('#396: the old address answers 301 to the site, in every locale and with no locale', () => {
  const config = code('next.config.js')

  assert.equal(
    existsSync(resolve(REPO_ROOT, 'app/[locale]/parceria/page.tsx')),
    false,
    'the page moved; a page still here would be answered before the redirect'
  )

  // The redirect is the whole reason the deletion is safe. `/pt/parceria` was e-mailed to real
  // establishments, so this assertion is the one that says the material already handed out
  // still works.
  assert.ok(config.includes(`'${PROPOSAL_URL}'`), 'the destination is the new public URL')
  assert.ok(config.includes("source: '/:locale(en|pt|es)/parceria'"), 'the localized address')
  assert.ok(config.includes("source: '/parceria'"), 'and the address with no locale segment')

  // 301 and not `permanent: true` — Next emits 308 for that, and 301 is what the mail clients
  // and crawlers that already saw this URL handle without surprises.
  assert.equal(config.includes('statusCode: 301'), true)
  assert.equal(
    /permanent:\s*true/.test(config),
    false,
    'permanent: true would emit 308 and is mutually exclusive with statusCode'
  )
})

test('#396: `/parceria` is no longer a public prefix of this CMS', () => {
  // Config redirects run at step 2 of Next 16's execution order and the proxy at step 3, so the
  // 301 answers BEFORE the auth gate is consulted. Keeping the prefix would not help the
  // redirect; it would keep a session-less door open onto a page that no longer exists.
  assert.deepEqual([...PUBLIC_PATH_PREFIXES], ['/contrato'])
  assert.equal(isPublicPath('/parceria'), false)
  assert.equal(isPublicPath('/contrato/abc'), true, 'the contract is still reached without a session')
})

test('#396: no source file still points at the form that left', () => {
  // A dangling import is caught by `tsc`; a dangling ROUTE is not. These three are the ones
  // that would send somebody to a page this deployment no longer serves.
  for (const file of ['lib/roles.ts', 'lib/contract/link.ts', 'lib/auth-middleware.ts']) {
    const source = read(file)
    assert.equal(
      source.includes('lib/partner-form/link'),
      false,
      `${file} points at a module that moved`
    )
  }
  assert.equal(existsSync(resolve(REPO_ROOT, 'app/api/partner-form/route.ts')), false)
  assert.equal(existsSync(resolve(REPO_ROOT, 'components/partner-form/PartnerForm.tsx')), false)
  assert.equal(
    existsSync(resolve(REPO_ROOT, 'lib/services/partner-proposal-service.ts')),
    false,
    'the public write service left with the route it served'
  )
})

// ── 4. The labels the reviewer reads ────────────────────────────────────────────────────

test('#396: the CMS keeps the labels and nothing else of the form copy', () => {
  const form = messages().PartnerForm

  // Only what the conference renders. The states, the errors, the actions, the step titles and
  // the privacy notice are the FORM's copy, they are published by another repository now, and a
  // copy here would be a second version of a sentence nobody would ever compare.
  assert.deepEqual(Object.keys(form).sort(), ['categories', 'fields'])

  for (const id of PARTNER_FIELD_IDS) {
    assert.ok(form.fields[id]?.label, `${id} has no label for the conference to show`)
    assert.deepEqual(
      Object.keys(form.fields[id]),
      ['label'],
      `${id} carries copy the conference does not render`
    )
  }
  for (const category of PARTNER_CATEGORIES) {
    assert.ok(form.categories[category], `${category} has no label`)
  }
})

test('#341: the conference reads the labels instead of redeclaring them', () => {
  // A reviewer reading a different question from the one the merchant answered is exactly the
  // defect duplicating the labels produces — so the labels must NOT exist under the internal
  // namespace, and the page must hand the Portuguese ones to its children (an absent key in
  // next-intl renders THE KEY NAME).
  const serialized = JSON.stringify(messages().PartnerProposals)
  const form = messages().PartnerForm
  for (const id of ['trade_name', 'representative_name', 'story_founder']) {
    assert.equal(
      serialized.includes(form.fields[id].label),
      false,
      `${id} label is duplicated into PartnerProposals`
    )
  }

  const page = read('app/[locale]/admin/partnerships/proposals/[submissionId]/page.tsx')
  assert.ok(page.includes('ptMessages.PartnerForm'), 'the page does not provide the labels')
})

test('DS-COPY-018: no copy left here tells a merchant to use the link somebody passed on', () => {
  // The three sentences that said it lived in the form's states, and they were rewritten on the
  // way out because on a landing page there is no person who passed a link. What remains here
  // is 28 labels; this asserts the sentences did not survive in a corner of them.
  const serialized = JSON.stringify(messages().PartnerForm).toLowerCase()
  assert.equal(serialized.includes('este link'), false)
})

test('BR-B2B-030: the conference fields exist only on the internal side', () => {
  // Item 5 of the rule: nothing in the trail is claimed on a public surface. The merchant is
  // never asked for a licence number, and no label mentions one.
  const serialized = JSON.stringify(messages().PartnerForm).toLowerCase()
  for (const forbidden of ['número do alvará', 'município que emitiu', 'alvará']) {
    assert.equal(serialized.includes(forbidden), false, `the labels must not mention "${forbidden}"`)
  }
})

// ── 5. The one judgement that runs on both sides ────────────────────────────────────────

test('DS-COPY-015: the quality nudge classifies and never blocks', () => {
  // It runs on the site while the merchant types, and here when a curator reads the answer
  // back. Same words on both sides, by the contract — if the two lists drift, a story nudged on
  // the way in stops being flagged on the way out and nobody sees it.
  assert.equal(storyNudge('Nosso cardápio tem rodízio de pizza aos sábados'), 'offer')
  assert.equal(storyNudge('Consulte o cardápio'), 'offer')
  assert.equal(storyNudge('Curto', { required: true }), 'short')
  assert.equal(
    storyNudge('Meu avô abriu a casa em 1961 num galpão da fábrica de guarda-chuvas do bairro', {
      required: true,
    }),
    null
  )
  assert.equal(storyNudge(''), null, 'an empty answer is not a bad answer, it is no answer')
})

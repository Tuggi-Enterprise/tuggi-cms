/**
 * The third way of reading a contract: on paper.
 *
 * The spec of `design` (§4.2) gives two — the text on the page and the PDF for filing — because
 * CDC art. 46 does not let this company bind somebody to what they could not read. There is a
 * third that nobody designed and everybody uses, Ctrl+P, and until 2026-08-17 it printed the
 * navigation, the generation form and the audit trail along with the instrument.
 *
 * WHAT THESE ASSERTIONS PROTECT is a distinction, not a stylesheet: the chrome does not print,
 * and the DOCUMENT does. Getting it backwards is worse than not printing at all — a page whose
 * only printable part is the checklist looks like a contract to whoever files it.
 *
 * THE UNSIGNED ACCEPTANCE FORM IS THE SUBTLE ONE. It is hidden on paper because a sheet with
 * two checkboxes and a name field invites somebody to sign something that records nothing: the
 * acceptance is an act against the server, with IP, user agent and a hash (BR-B2B-026). The
 * RECEIPT prints — a signed contract with its verification code is exactly what gets filed.
 *
 * Mutations that turn this suite red:
 *  · printing the operator's checklist or trail;
 *  · hiding `ContractText` on paper, which would print an empty page;
 *  · putting the unsigned acceptance form on paper;
 *  · hiding the signed receipt.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(import.meta.dirname, '../..', path), 'utf8')

const MANAGER = 'components/admin/contract/ContractManager.tsx'
const SIGNING_PAGE = 'app/[locale]/contrato/[token]/page.tsx'
const SIGNING_BLOCK = 'components/contract/SigningBlock.tsx'
const SURFACE = 'components/contract/SigningSurface.tsx'
const TEXT = 'components/contract/ContractText.tsx'

test('the operator screen prints the document and nothing around it', () => {
  const manager = read(MANAGER)

  // The panels that are not the instrument.
  const chrome = [
    /<header className=\{`\$\{CARD\} p-6 print:hidden`\}>/,
    /Trilha do aceite/,
    /Gerar contrato/,
  ]
  for (const pattern of chrome) assert.match(manager, pattern)

  // Four `print:hidden` at least: the return bar, the header, the generation panel and the
  // trail. Counted rather than named, so adding a panel without hiding it is visible here.
  const hidden = manager.match(/print:hidden/g) ?? []
  assert.ok(hidden.length >= 4, `expected the chrome to be hidden on paper, found ${hidden.length}`)

  // And the document is NOT hidden — it drops the card instead.
  assert.match(
    manager,
    /print:border-0 print:bg-transparent print:p-0 print:shadow-none/,
    'the preview sheds the card on paper; it never hides'
  )
  const preview = manager.slice(manager.indexOf('{state.contract && preview'))
  const previewBlock = preview.slice(0, preview.indexOf('</section>'))
  assert.equal(
    previewBlock.indexOf('print:hidden'),
    -1,
    'hiding the preview would print a page with no contract on it'
  )
})

test('the partner page prints the contract, not the buttons', () => {
  const page = read(SIGNING_PAGE)

  // The orientation line, the PDF button with the skip link, and `Voltar ao topo`.
  assert.ok((page.match(/print:hidden/g) ?? []).length >= 3)
  // The text itself carries no print rule at all: it is the default, which is to print.
  assert.equal(read(TEXT).indexOf('print:'), -1, 'the document needs no permission to print')
})

test('an unsigned acceptance form never reaches paper, and a signed receipt always does', () => {
  assert.match(
    read(SIGNING_BLOCK),
    /aria-labelledby="aceite"[^>]*print:hidden/,
    'a printed form with checkboxes invites a signature that records nothing'
  )
  assert.equal(
    read(SURFACE).indexOf('print:hidden'),
    -1,
    'the receipt is what somebody files — it prints'
  )
})

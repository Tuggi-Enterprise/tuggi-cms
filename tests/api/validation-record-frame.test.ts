/**
 * #870 — the validation and the proposal conference live in the record's frame, and approving
 * does not promise publication (BR-B2B-049 items 7-8). #890 put the validation in the client record;
 * #910 made it part of the Parceria tab (`PortalSubmission.tsx`, placed by `PartnershipDetail`), and
 * `ValidationReview`/`ValidationModal`/`ValidationTab` no longer exist. The browser half is
 * `tests/ct/validation-tab.spec.tsx` and `tests/ct/partnership-tab-910.spec.tsx`; this is the part that has to break at
 * `npm run test:api` speed.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pt from '../../messages/pt.json'
import { recordHref, boardPath } from '../../lib/clients/record-href'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

// Comments mention `sticky`/`top-24` to explain why they are gone; only code counts.
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const FRAMES = [
  'components/admin/clients/ClientEditorModal.tsx',
  'components/admin/partner-proposals/ProposalReview.tsx',
]

test('#890 · #910: the validation is part of the Parceria tab — ValidationReview, ValidationModal and ValidationTab are gone', () => {
  for (const gone of [
    'components/admin/partner-proposals/ValidationReview.tsx',
    'components/admin/partner-proposals/ValidationModal.tsx',
    'components/admin/clients/tabs/ValidationTab.tsx',
  ]) {
    assert.equal(existsSync(join(process.cwd(), gone)), false, `${gone} must not come back`)
  }
  assert.equal(existsSync(join(process.cwd(), 'components/admin/clients/shared/PortalSubmission.tsx')), true)
  const modal = read('components/admin/clients/ClientEditorModal.tsx')
  assert.match(modal, /<PartnershipTab\b[\s\S]{0,200}submission=\{/)
  assert.match(read('components/admin/partnerships/PartnershipDetail.tsx'), /<SubmissionBlocks\b/)
})

test('#870: the modal and the proposal conference use the one RecordShell', () => {
  for (const file of FRAMES) {
    const source = read(file)
    assert.match(source, /import \{ RecordShell \} from '@\/components\/admin\/clients\/shared\/RecordShell'/, file)
    assert.match(source, /<RecordShell\b/, file)
  }
})

test('#870: the validation header is outside the scrolling area — no sticky, no top-24', () => {
  for (const file of [
    'components/admin/clients/shared/PortalSubmission.tsx',
    'components/admin/partnerships/PartnershipDetail.tsx',
    'components/admin/partner-proposals/ValidationDecision.tsx',
  ]) {
    const source = code(read(file))
    assert.doesNotMatch(source, /\bsticky\b/, `${file} still has a sticky`)
    assert.doesNotMatch(source, /\btop-24\b/, `${file} still has top-24`)
  }
  // The frame itself: the bar is `shrink-0`, the body clips and each column scrolls on its own.
  const shell = read('components/admin/clients/shared/RecordShell.tsx')
  assert.match(shell, /border-b[^"]*shrink-0/)
  assert.match(shell, /flex-1 flex flex-col lg:flex-row overflow-hidden/)
  assert.doesNotMatch(code(shell), /\bsticky\b/)
})

test('#890: the old validation route redirects to the record (?validation=), keeping the board filters of returnTo', () => {
  const page = read('app/[locale]/admin/partnerships/validation/[submissionId]/page.tsx')
  assert.match(page, /redirect\(recordHref\(locale, board, \{ kind: 'validation', submissionId \}\)\)/)
  assert.match(page, /RETURN_TO_PARAM/)
  assert.match(page, /parseReturnTo/)
})

test('#870: the validation "X" returns to the board with its filters, and not to the record that was open', () => {
  const href = recordHref('pt', new URLSearchParams('view=table&state=in_validation&clientId=c1&tab=places'), {
    kind: 'validation',
    submissionId: 's1',
  })
  // #870 (2026-10-06): a drawer over the board; the record that was open closes, the filters stay.
  const params = new URL(href, 'https://cms.test').searchParams
  assert.equal(params.get('validation'), 's1')
  assert.equal(params.get('clientId'), null)
  assert.equal(params.get('tab'), null)
  assert.equal(boardPath(params), '/admin/clients?view=table&state=in_validation')
  assert.match(href, /^\/pt\/admin\/clients\?/)
})

test('#870 (2026-10-06): opening a client from the validation drawer closes the drawer', () => {
  const href = recordHref('pt', new URLSearchParams('view=table&validation=s1'), { kind: 'client', clientId: 'c1', tab: 'places' })
  assert.equal(href, '/pt/admin/clients?view=table&clientId=c1&tab=places')
})

test('#870 (BR-B2B-049 items 7-8): approved copy does not say the place is already in the app', () => {
  const done = pt.PartnerValidation.done
  assert.equal(done.approvedFree, 'Aprovado. Falta desenhar o boundary e publicar.')
  assert.equal(done.approvedPaid, 'Aprovado. Faltam a narração, o boundary e a publicação.')
  for (const text of [done.approvedFree, done.approvedPaid]) {
    assert.doesNotMatch(text, /já está no app|entra no app/i)
  }
})

test('#890: "Abrir o cadastro do cliente" and the orphan close key are gone; "Abrir o local no editor" stays, once, in the Local section', () => {
  const validation = pt.PartnerValidation as Record<string, unknown>
  const decision = validation.decision as Record<string, string>
  assert.equal(decision.openClient, undefined)
  assert.equal(decision.openPlace, 'Abrir o local no editor')
  assert.equal(validation.close, undefined, 'only the removed ValidationModal read PartnerValidation.close')
  for (const file of [
    'components/admin/clients/shared/PortalSubmission.tsx',
    'components/admin/partner-proposals/ValidationDecision.tsx',
    'components/admin/clients/ClientEditorModal.tsx',
  ]) {
    assert.doesNotMatch(read(file), /decision\.openClient|PartnerValidation\.close/, file)
  }
  const tab = read('components/admin/clients/shared/PortalSubmission.tsx')
  assert.equal((tab.match(/t\('decision\.openPlace'\)/g) ?? []).length, 1)
  assert.equal(
    (read('components/admin/partner-proposals/ValidationDecision.tsx').match(/decision\.openPlace|t\('openPlace'\)/g) ?? []).length,
    0,
    'the header link is gone (#890)'
  )
})

test('#870: the removed decision keys are gone and not used', () => {
  const decision = pt.PartnerValidation.decision as Record<string, string>
  assert.equal(decision.backToQueue, undefined)
  assert.equal(decision.queueEmpty, undefined)
  const source = read('components/admin/partner-proposals/ValidationDecision.tsx')
  assert.doesNotMatch(source, /backToQueue|queueEmpty/)
})

test('#870: the review payload carries clientId, read from partner_client_id, and a failed read leaves it null', () => {
  const source = read('lib/services/portal-submission-review-service.ts')
  assert.match(source, /clientId: string \| null/)
  assert.match(source, /partner_client_id/)
})

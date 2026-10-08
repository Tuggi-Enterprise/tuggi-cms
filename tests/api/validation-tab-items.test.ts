/**
 * #890 — nothing that only the validation knew may be lost in the move into the client record.
 * The spec's list "Só na validação" (12 items) is the checklist: every item must still be rendered
 * by `PortalSubmission.tsx` since #910, placed in the Parceria tab by `PartnershipDetail` (or by the file the spec sends it to: `PortalRecord.tsx` for the acceptance,
 * `ValidationDecision.tsx` for the acts and the summary). Rules: BR-B2B-011 (only the checklist
 * enables "Aprovar"), BR-B2B-048 item 4 (the conference order), BR-B2B-049 (no promise of publication).
 *
 * A SOURCE RULER, not a render: the CMS has no jsdom. That the tab renders, the tabs are disabled,
 * there is one "Aprovar" and A/J/R stay out of the other tabs is `tests/ct/validation-tab.spec.tsx`.
 * What this cannot say: that an item shows up with the right DATA — only that the code still reaches
 * for it. A mutation that turns it red: deleting any one of the patterns below from its file.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import pt from '../../messages/pt.json'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')
const TAB = 'components/admin/clients/shared/PortalSubmission.tsx'
const DETAIL = 'components/admin/partnerships/PartnershipDetail.tsx'
const PORTAL = 'components/admin/clients/shared/PortalRecord.tsx'
const DECISION = 'components/admin/partner-proposals/ValidationDecision.tsx'
const MODAL = 'components/admin/clients/ClientEditorModal.tsx'

const ITEMS: { item: string; file: string; patterns: RegExp[] }[] = [
  { item: '1 · state band, resubmission and the done message', file: TAB, patterns: [/bands\./, /resubmitted/, /done\./] },
  { item: '2 · "Alterado" badge per section', file: TAB, patterns: [/changedBadge/, /areasNamedIn/] },
  { item: '3 · company: duplicate CNPJ, Receita, price band, masked CPF + reveal, cpfDiffers', file: TAB, patterns: [/sameTaxId/, /openReceita/, /price_range/, /revealCpf/, /cpfDiffers/] },
  { item: '4 · place: pin map, facade, Maps link, hint, hours, WhatsApp, amenities, languages', file: TAB, patterns: [/GoogleMapComponent/, /noPin/, /noFacade/, /google\.com\/maps/, /place\.hint/, /place\.closed/, /whatsapp/i, /amenityLabels/, /languageLabels/] },
  { item: '5 · story: word limit, offer in the script, free-plan sentence', file: TAB, patterns: [/STORY_WORD_LIMIT/, /storyOfferExcerpt/, /story\.freePlan/] },
  { item: '6 · offers: the Tuggi/money warning', file: TAB, patterns: [/offerLooksLikeTuggiOrMoney/] },
  { item: '7 · photos: plan limit (paid and free), facade badge, none', file: TAB, patterns: [/photos\.limitPaid/, /photos\.limitFree/, /photos\.none/] },
  { item: '8 · acceptance: login method, marketing consent, Copiar hash, missing', file: PORTAL, patterns: [/authMethod/, /marketingConsent/, /copyHash/, /t\('missing'\)/] },
  // #910 §6: the history is one list with the pipeline's facts, and a block with no entry does not render.
  { item: '9 · history, merged by date, hidden when empty', file: DETAIL, patterns: [/useSubmissionHistory\(review\)/, /mergeHistory\(/, /history\.length > 0 \?/] },
  { item: '10 · decision summary: plan line, voucher, payment/refund, checklist counter and missing', file: DECISION, patterns: [/voucher/, /refund/, /progress/, /missing/] },
  { item: '11 · acts: three dialogs, A/J/R shortcuts, 409 conflict, next in queue', file: DECISION, patterns: [/'approve'/, /'changes'/, /'reject'/, /onConflict/, /keydown/, /\bnext\b/] },
  { item: '12 · load states: loading, read error with retry, not found', file: TAB, patterns: [/loading/, /readError/, /retry/, /notFound/] },
]

for (const { item, file, patterns } of ITEMS) {
  test(`#890 · BR-B2B-048 item 4 · "só na validação" item ${item} is still rendered`, () => {
    const source = read(file)
    for (const pattern of patterns) assert.match(source, pattern, `${file} lost ${pattern}`)
  })
}

// ── the record around it ─────────────────────────────────────────────────────────────────────

test('#890 · the review carries recordClientId = linked client, else the CNPJ lookup the approval makes (one lookup, not two)', () => {
  const service = read('lib/services/portal-submission-review-service.ts')
  assert.match(service, /recordClientId =\s*\n?\s*clientId \?\? \(answers\.tax_id \? \(\(await findClientByTaxId\(answers\.tax_id\)\)\?\.id \?\? null\) : null\)/)
  assert.match(read('lib/services/portal-validation-service.ts'), /findClientByTaxId/)
})

test('#890 · pre-registration: only Parceria is enabled (#910) (title "Disponível depois de aprovar") and the save block is not rendered', () => {
  const modal = read(MODAL)
  assert.match(modal, /const preRegistration = Boolean\(validationId\) && !clientId/)
  assert.match(modal, /disabledTitle=\{preRegistration \? tTabs\('afterApproval'\)/)
  assert.match(modal, /\{preRegistration \? null : saveBlock\}/)
  assert.equal(pt.Clients.editor.tabs.afterApproval, 'Disponível depois de aprovar')
})

test('#890 · one "Aprovar" per header: the submission acts own the controls while undecided, ApprovalHeaderControls only otherwise', () => {
  const modal = read(MODAL)
  assert.match(modal, /review && \(validation\.undecided \|\| !clientId\) \?\s*\(\s*<ValidationDecision/)
  assert.match(modal, /: isEditing && clientId \? \(\s*<ApprovalHeaderControls/)
  assert.equal((modal.match(/<ValidationDecision\b/g) ?? []).length, 1)
  assert.equal((modal.match(/<ApprovalHeaderControls\b/g) ?? []).length, 1)
})

test('#890 · A/J/R are armed only on the Parceria tab (#910); the summary footer only with it open', () => {
  const modal = read(MODAL)
  assert.match(modal, /shortcuts=\{activeTab === 'partnership'\}/)
  assert.match(modal, /\{onValidation \? decisionSummary\(true\) : null\}/)
  const decision = read(DECISION)
  assert.match(decision, /if \(readOnly \|\| !shortcuts\) return/)
})

test('#890 · the Parceria tab unmounts when left, so a revealed CPF goes back to its mask; the CPF only comes from the reveal route', () => {
  const modal = read(MODAL)
  assert.match(modal, /\{activeTab === 'partnership' && \(\s*<PartnershipTab/, 'conditional mount, not display:none — the cpf state dies with it')
  const tab = read(TAB)
  assert.match(tab, /const \[cpf, setCpf\] = useState<string \| null>\(null\)/)
  assert.match(tab, /\?reveal=cpf/)
})

test('#890 · the Diferenças section reads buildPromotionPlan and only when there is a client', () => {
  const tab = read(TAB)
  assert.match(tab, /const promotion = client\s*\?\s*buildPromotionPlan\(/)
  assert.match(tab, /promotion\.entries\.map\(/)
  assert.deepEqual(Object.keys(pt.PartnerValidation.diff).sort(), ['current', 'field', 'hint', 'none', 'portal', 'title', 'unchanged'])
})

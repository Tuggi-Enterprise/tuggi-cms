/**
 * What one row of the directory READS as — the four pieces the table and the board both print.
 *
 * IT LIVES IN ONE PLACE BECAUSE THE TWO VIEWS ARE ONE LIST. The board is not a second screen
 * with its own vocabulary; it is the same rows in columns, and a card that says
 * `2 pendências` while the table says `1 de 3 publicados` for the same partnership is the exact
 * failure the unified directory was built to end. Extracted here when the board arrived (#409);
 * the functions themselves are the table's, unchanged.
 *
 * The `p` parameter is the `Partnerships` translator, in Portuguese: the pipeline's vocabulary
 * is pt-only (#408) while the rest of both screens is translated, so it is handed in rather
 * than looked up here.
 */

import type { useTranslations } from 'next-intl'
import { daysUntil } from '@/lib/partner-form/regularity'
import { derivePartnerPlan, type PartnerPlan } from '@/lib/clients/partner-plan'
import { formatMonthlyFee } from '@/lib/partnerships/publish-plan'
import { COLUMN_STATES, type BoardAct, type BoardColumnId } from '@/lib/clients/board-transitions'
import { nameKey } from '@/lib/shared/name-search'
import type { ClientDirectoryRow } from '@/lib/services/partnership-service'

type Translator = ReturnType<typeof useTranslations>

/** A row is a client, or a proposal that is not one yet — one of the two ids is always there. */
export function rowKey(row: ClientDirectoryRow): string {
  return row.clientId ?? row.submissionId ?? ''
}

export function placeLine(row: ClientDirectoryRow): string {
  /*
   * TWO PARTS AT MOST, MOST SPECIFIC FIRST (DS-COMPONENTE-080).
   *
   * Three shapes shared one screen — seen in the production screenshot of 2026-09-09: a card with
   * no line at all, one reading `Cabo Frio / Rio de Janeiro`, and a third reading
   * `Cabo Frio / Rio de Janeiro / Brazil`. The country is what goes: on a mostly domestic base it
   * does not discriminate, and it is the only ENGLISH text on the screen — `Brazil` is the
   * canonical form from `lib/shared/location-normalize`, written to compare and not to read.
   *
   * It does not vanish from the product: it takes the second slot when it is the second part that
   * exists (a partner with no region, or no city), which is exactly where it discriminates.
   */
  const parts = [row.city, row.region, row.country].filter(Boolean).slice(0, 2)
  return parts.length > 0 ? parts.join(' / ') : '—'
}

/**
 * THE STATES WHOSE WORK IS THE PLACE, and the only ones whose pendencies belong in this column.
 *
 * A place carries its pendencies from the moment it is created, and it is created when the
 * client is approved — before any contract exists. Reading them unconditionally therefore put
 * `1 impede, 2 ficam mudos` on a card sitting in `Contrato enviado`, where the operator cannot
 * touch the place and the thing actually owed is to chase the signature. The column answers
 * `what do I do next`, and a true fact about the wrong step is still the wrong answer.
 */
const PLACE_IS_THE_WORK = ['place_in_curation', 'published', 'refusal_not_communicated']

/**
 * The `O que falta` column — the next step, or the pendency counts of the LEAST ADVANCED place
 * plus the proportion. Never the sum across places: summing hides which one is stuck
 * (DS-COMPONENTE-020, 2nd edge case).
 */
export function whatIsMissing(row: ClientDirectoryRow, p: Translator): string {
  // The act owed to somebody OUTSIDE the company wins the column (DS-COPY-020, points 2 and 5).
  if (row.state === 'refusal_not_communicated') return p('nextSteps.refusal_not_communicated')

  if (PLACE_IS_THE_WORK.indexOf(row.state) < 0) return p(`nextSteps.${row.state}`)

  const parts: string[] = []
  if (row.places.total > 1) {
    parts.push(p('queue.placesProgress', { published: row.places.published, total: row.places.total }))
  }
  if (row.places.blocking > 0) parts.push(p('queue.missingBlocking', { count: row.places.blocking }))
  if (row.places.silencing > 0) parts.push(p('queue.missingSilencing', { count: row.places.silencing }))

  if (parts.length > 0) return parts.join(p('queue.missingSeparator'))
  return p(`nextSteps.${row.state}`)
}

/** `Parado há`, counted on the calendar day by the one function that counts days here. */
export function idleFor(since: string | null, p: Translator): string {
  if (!since) return p('queue.idleUnknown')
  const days = daysUntil(since)
  if (days === null) return p('queue.idleUnknown')
  return p('queue.idleDays', { count: Math.max(0, -days) })
}

/**
 * The money line, and WHOSE answer it is.
 *
 * Three people can answer `is this one paid?` and they answer differently — see
 * `lib/clients/partner-plan` for why a card that picked one of them under a neutral label would
 * be lying. The rule is there and pure; this is only its sentence, in two parts: what it says,
 * and where it came from. The second part is not decoration — `R$ 149,00 por mês` read off a
 * proposal nobody has priced is a number an operator would plan around.
 *
 * `formatMonthlyFee` and not a new formatter: the value beside `Publicar` on the publication
 * panel is the same value, and two currency formatters is how the same fee ends up printed two
 * ways on two screens (BR-B2B-017, 1st edge case — the only currency here is the real).
 */
export function planLine(row: ClientDirectoryRow, t: Translator): string {
  const plan = derivePartnerPlan(row)
  const source = sourceOf(plan, t)
  const value = planValue(plan, t)
  // ONE FUNCTION, ONE SENTENCE, TWO VIEWS. The provenance took a whole line on the card and the
  // table did not print it at all — one fact in two places, in two shapes, one of them missing.
  // It never leaves: it is what stops an operator planning around a number nobody priced.
  return source ? t('plan.withSource', { line: value, source }) : value
}

/** The value alone. Private: everything outside reads the whole sentence. */
function planValue(plan: PartnerPlan, t: Translator): string {
  switch (plan.kind) {
    case 'paid':
      return t('plan.paid', { value: formatMonthlyFee(plan.feeCents ?? 0) })
    case 'courtesy':
      return t('plan.courtesy')
    case 'free':
      return t('plan.free')
    case 'undeclared':
      return t('plan.undeclared')
    default:
      if (plan.requested === 'map_only') return t('plan.requestedMapOnly')
      if (plan.requested === 'map_and_description') return t('plan.requestedMapAndDescription')
      return t('plan.requestedNone')
  }
}

/**
 * The second line under it: the reason of a courtesy, or where the answer came from.
 *
 * A courtesy without its reason is an unexplained discount (BR-B2B-017, item 6) and the reason
 * is the more useful thing to print, so it wins the slot. `requested` says nothing here: the
 * sentence already opens with `Pediu`, and repeating `na proposta` under it is prose.
 */
function sourceOf(plan: PartnerPlan, t: Translator): string | null {
  if (plan.kind === 'courtesy' && plan.courtesyReason) {
    return t('plan.courtesyReason', { reason: plan.courtesyReason })
  }
  if (plan.source === 'contract') return t('plan.fromContract')
  if (plan.source === 'registration') return t('plan.fromRegistration')
  // The free tier the establishment itself asked for: `escolha do parceiro`, not `em contrato`,
  // because nobody has signed anything yet and saying otherwise would name a document that does
  // not exist.
  if (plan.source === 'proposal' && plan.kind === 'free') return t('plan.fromChoice')
  return null
}

/** What the registration and the contract disagree about, in one sentence. */
export function planDivergence(plan: PartnerPlan, t: Translator): string | null {
  if (plan.divergence === 'free_contract_paid_registration') return t('plan.divergesFree')
  if (plan.divergence === 'paid_contract_undeclared_registration') return t('plan.divergesUndeclared')
  if (plan.divergence === 'free_choice_paid_registration') return t('plan.divergesFreeChoice')
  return null
}

/**
 * ── WHAT THE CARD DOES NOT HAVE TO REPEAT ─────────────────────────────────────────────────────
 *
 * `DS-COMPONENTE-079`: a field whose value is the same on every card of the group lives in the
 * group heading, once. Repeated on the card it takes the line a discriminating field would.
 *
 * The rule demands PROOF FROM DATA rather than opinion, and the two functions below are that
 * proof, run at render time — not a hand-written list of columns that ages on the first new one.
 */

/**
 * The state, when it says something the column heading does not.
 *
 * Measured on 2026-09-09: 7 of the 8 columns host EXACTLY ONE state, and in 6 of them
 * `Partnerships.states.<state>` is byte for byte `Clients.board.columns.<column>` — the card
 * printed `Cliente criado` inside the `Cliente criado` column. The two that discriminate remain:
 * `conference` (`Em conferência` is not `Conferência de documentos`) and `closed`, which hosts two.
 *
 * Point 3 of the rule is what this implements literally: the line comes back exactly where it
 * discriminates. Point 2 holds outside this function — the `<article>`'s accessible name carries
 * the state, so nothing is lost to a screen reader.
 */
export function stateUnlessColumnSaysIt(
  row: ClientDirectoryRow,
  column: BoardColumnId,
  p: Translator,
  c: Translator
): string | null {
  const states = COLUMN_STATES[column] ?? []
  const label = p(`states.${row.state}`)
  // Two conditions, both of data: the column hosts a single state, AND the label is the same
  // text. Either one failing gives the line back to the card.
  if (states.length === 1 && label === c(`columns.${column}`)) return null
  return label
}

/**
 * The next step, when the card's own button no longer says it.
 *
 * Measured the same day: in 4 of the 7 steps the text IS the act's label — `Registrar a
 * conferência`, `Criar o local` and `Publicar o local` are byte for byte identical, and
 * `Comunicar a recusa ao parceiro` contains `Comunicar a recusa`. A card that writes the action
 * and then draws a button with the same action spends two lines on one decision.
 *
 * WHERE THEY DIVERGE THE LINE STAYS, and that case is what stops this becoming "no button, no
 * line": in `Proposta recebida` the step is `Conferir a regularidade` — the work — and the button
 * is `Registrar a conferência` — stamping that the work was done. Two different things, both owed
 * to the screen.
 *
 * The comparison folds case, accent and punctuation through `nameKey`, the same ruler the rest of
 * the CMS decides name identity with — never a local `toLowerCase()` that would drift from it.
 */
export function stepUnlessActSaysIt(
  row: ClientDirectoryRow,
  act: BoardAct | null,
  p: Translator,
  t: Translator
): string | null {
  const step = whatIsMissing(row, p)
  if (!act) return step
  const spoken = nameKey(t(`acts.${act}`))
  // `includes` and not equality: the step may be the act plus a complement (`… ao parceiro`), and
  // the button still says the same thing.
  return nameKey(step).includes(spoken) ? null : step
}


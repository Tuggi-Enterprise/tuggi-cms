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
import type { ClientDirectoryRow } from '@/lib/services/partnership-service'

type Translator = ReturnType<typeof useTranslations>

/** A row is a client, or a proposal that is not one yet — one of the two ids is always there. */
export function rowKey(row: ClientDirectoryRow): string {
  return row.clientId ?? row.submissionId ?? ''
}

export function placeLine(row: ClientDirectoryRow): string {
  const parts = [row.city, row.region, row.country].filter(Boolean)
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
export function planSource(plan: PartnerPlan, t: Translator): string | null {
  if (plan.kind === 'courtesy' && plan.courtesyReason) {
    return t('plan.courtesyReason', { reason: plan.courtesyReason })
  }
  if (plan.source === 'contract') return t('plan.fromContract')
  if (plan.source === 'registration') return t('plan.fromRegistration')
  return null
}

/** What the registration and the contract disagree about, in one sentence. */
export function planDivergence(plan: PartnerPlan, t: Translator): string | null {
  if (plan.divergence === 'free_contract_paid_registration') return t('plan.divergesFree')
  if (plan.divergence === 'paid_contract_undeclared_registration') return t('plan.divergesUndeclared')
  return null
}

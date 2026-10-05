/**
 * The pure half of the Portal Locais validation screen (#812, spec
 * `docs/design/spec-validacao-portal-locais-2026-10.md`): which conference items apply, how the
 * CPF is masked, and the two non-blocking warnings (story that looks like an offer, offer that
 * looks like it promises something of the Tuggi). No React, no database — the suite runs it.
 *
 * Nothing here BLOCKS a decision except the operator's own ticks: an automatic warning never
 * disables "Aprovar" (BR-B2B-011, the operator decides).
 */

import { storyNudge } from '@/lib/partner-form/schema'
import type { PartnerAnswers } from '@/lib/partner-form/schema'

/** Closed list of refusal reasons, from the #812 spec. The id goes to the audit log. */
export const PORTAL_REFUSAL_REASONS = [
  'ineligible',
  'duplicate',
  'nothing_to_tell',
  'irregular_company',
  'other',
] as const
export type PortalRefusalReason = (typeof PORTAL_REFUSAL_REASONS)[number]

/** The note the spec asks for: at least 10 characters after trimming. */
export const PORTAL_NOTE_MIN = 10
export const PORTAL_NOTE_MAX = 2000

/** The story budget the narration fits in: 40 words ≈ 15 s (BR-B2B-044, item 3). */
export const STORY_WORD_LIMIT = 40

export type ConferenceItem = 'company' | 'place' | 'story' | 'offers' | 'photos'

export const PAID_PLAN = 'map_and_description'

export function isPaidPlan(planChoice: string | null | undefined): boolean {
  return planChoice === PAID_PLAN
}

export function offersOf(answers: PartnerAnswers): string[] {
  return [answers.offer_free, answers.offer_subscriber].filter(
    (offer): offer is string => typeof offer === 'string' && offer.trim().length > 0
  )
}

/**
 * The blocks the operator has to tick before "Aprovar" (spec §3, item 3): Empresa and Local
 * always; História only on the paid plan; Ofertas only when there is one; Fotos only when
 * there is one.
 */
export function conferenceItems(input: {
  planChoice: string | null | undefined
  hasOffers: boolean
  photoCount: number
}): ConferenceItem[] {
  const items: ConferenceItem[] = ['company', 'place']
  if (isPaidPlan(input.planChoice)) items.push('story')
  if (input.hasOffers) items.push('offers')
  if (input.photoCount > 0) items.push('photos')
  return items
}

export function onlyDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

/**
 * `•••.•••.789-••` — the third group is the only part shown (spec §2, bloco 1). Anything that
 * is not 11 digits is masked whole: a malformed CPF must not leak by failing the format.
 */
export function maskCpf(value: string | null | undefined): string {
  const digits = onlyDigits(value)
  if (digits.length !== 11) return '•••.•••.•••-••'
  return `•••.•••.${digits.slice(6, 9)}-••`
}

/** `123.456.789-09` — only ever built on the explicit reveal. */
export function formatCpf(value: string | null | undefined): string {
  const digits = onlyDigits(value)
  if (digits.length !== 11) return value ?? ''
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
}

export function countWords(text: string | null | undefined): number {
  const trimmed = (text ?? '').trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

/** Letters of any script count as word characters: `\b` alone treats `á` as a boundary. */
function wholeWord(words: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${words})(?![\\p{L}\\p{N}])`, 'iu')
}

const STORY_OFFER_WORDS = wholeWord('desconto|grátis|gratis|promoção|promocao')
const MONEY = /R\$|%/

/**
 * The story is not the place for an offer (BR-B2B-053, item 5: the offer is not narrated). The
 * same detector as the presential review (`storyNudge`), plus the words the spec names, plus an
 * offer of this very submission repeated inside the script. Returns the excerpt that tripped it.
 */
export function storyOfferExcerpt(script: string | null | undefined, offers: string[]): string | null {
  const text = (script ?? '').trim()
  if (!text) return null
  const repeated = offers.find((offer) => text.toLowerCase().includes(offer.trim().toLowerCase()))
  if (repeated) return repeated.trim()
  const match = text.match(MONEY) ?? text.match(STORY_OFFER_WORDS)
  if (match) return excerptAround(text, match.index ?? 0)
  if (storyNudge(text) === 'offer') return excerptAround(text, 0)
  return null
}

function excerptAround(text: string, index: number): string {
  const start = Math.max(0, index - 30)
  const end = Math.min(text.length, index + 40)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

const TUGGI_OR_MONEY_WORDS = wholeWord('horas?|passes?|assinaturas?|tuggi|pix')

/**
 * An offer must be the establishment's own benefit (BR-B2B-053, items 2 and 3): hours, a pass,
 * access to the Tuggi, money or Pix are out. Whole words only — "horário" is not "hora".
 */
export function offerLooksLikeTuggiOrMoney(offer: string | null | undefined): boolean {
  const text = offer ?? ''
  return TUGGI_OR_MONEY_WORDS.test(text) || text.includes('R$')
}

/** The adjustment areas of "Pedir ajuste" (spec §5), in the order the dialog lists them. */
export const ADJUSTMENT_AREAS = ['company', 'place', 'facade', 'story', 'offers', 'photos'] as const
export type AdjustmentArea = (typeof ADJUSTMENT_AREAS)[number]

/**
 * Which areas the last request named, read back from the "Ajustar: …" opening the dialog
 * writes. Feeds the "alterado" badge when the place answers.
 */
export function areasNamedIn(
  message: string | null | undefined,
  labels: Record<AdjustmentArea, string>
): AdjustmentArea[] {
  const firstLine = (message ?? '').split('\n')[0].toLowerCase()
  if (!firstLine.startsWith('ajustar:')) return []
  return ADJUSTMENT_AREAS.filter((area) => firstLine.includes(labels[area].toLowerCase()))
}

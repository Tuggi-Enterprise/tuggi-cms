/**
 * What the server accepts from the public partner form, derived from `fields.ts`.
 *
 * The schema is built from the field list rather than written next to it, so "the form
 * asks X" and "the server accepts X" cannot drift — the drift is the defect this repo
 * already paid for once with the client allowlist.
 *
 * Unknown keys are stripped, not rejected: this is an allowlist. A caller that posts
 * `commission_rate` gets a 200 and no `commission_rate`, because the route is the only
 * barrier left once `service_role` is in play.
 */

import { z } from 'zod'
import { PARTNER_FORM_FIELDS, type PartnerField, type PartnerFieldId } from './fields'
import { isValidCnpj, normalizeCnpj } from '@/lib/validation/cnpj'

export type PartnerAnswers = Partial<Record<PartnerFieldId, string>>

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** Ten or eleven digits: a Brazilian number with area code, mask or no mask. */
const PHONE_DIGITS = /^\d{10,11}$/
const POSTAL_CODE_DIGITS = /^\d{8}$/

function baseSchema(field: PartnerField): z.ZodType<string> {
  return z.string().max(field.maxLength)
}

/**
 * Draft schema: every field optional, because autosave happens on every step change and
 * a half-typed CNPJ must not cost the person the rest of the form.
 */
export const partnerDraftSchema = z.object(
  Object.fromEntries(
    PARTNER_FORM_FIELDS.map((field) => [field.id, baseSchema(field).optional()])
  ) as Record<PartnerFieldId, z.ZodOptional<z.ZodType<string>>>
)

export interface FieldProblem {
  field: PartnerFieldId
  /** Copy key under `PartnerForm.errors`, resolved by whoever renders. */
  code:
    | 'required'
    | 'email_malformed'
    | 'phone_short'
    | 'cnpj_incomplete'
    | 'cnpj_invalid'
    | 'postal_code'
    | 'too_long'
}

/**
 * Everything that is wrong with a set of answers, as data. Rendering is the caller's:
 * the same list backs the server's 400 and the client's error summary, so the two
 * cannot disagree about what is missing.
 */
export function validateAnswers(answers: PartnerAnswers): FieldProblem[] {
  const problems: FieldProblem[] = []

  for (const field of PARTNER_FORM_FIELDS) {
    const raw = (answers[field.id] ?? '').trim()

    if (raw.length > field.maxLength) {
      problems.push({ field: field.id, code: 'too_long' })
      continue
    }

    if (!raw) {
      if (field.required) problems.push({ field: field.id, code: 'required' })
      continue
    }

    switch (field.type) {
      case 'email':
        if (!EMAIL_PATTERN.test(raw)) problems.push({ field: field.id, code: 'email_malformed' })
        break
      case 'tel':
        if (!PHONE_DIGITS.test(raw.replace(/\D/g, ''))) {
          problems.push({ field: field.id, code: 'phone_short' })
        }
        break
      case 'cnpj': {
        const clean = normalizeCnpj(raw).replace(/[^A-Z0-9]/g, '')
        if (clean.length !== 14) problems.push({ field: field.id, code: 'cnpj_incomplete' })
        else if (!isValidCnpj(clean)) problems.push({ field: field.id, code: 'cnpj_invalid' })
        break
      }
      case 'postal_code':
        if (!POSTAL_CODE_DIGITS.test(raw.replace(/\D/g, ''))) {
          problems.push({ field: field.id, code: 'postal_code' })
        }
        break
      case 'select':
        if (field.options && !field.options.includes(raw)) {
          problems.push({ field: field.id, code: 'required' })
        }
        break
      default:
        break
    }
  }

  return problems
}

/** Problems of a single step, for the per-step error summary. */
export function problemsOfStep(problems: FieldProblem[], step: PartnerField['step']): FieldProblem[] {
  const ids = new Set(PARTNER_FORM_FIELDS.filter((f) => f.step === step).map((f) => f.id))
  return problems.filter((problem) => ids.has(problem.field))
}

/**
 * The quality nudges of step 3. They never block the submission and never say
 * "rejected" — the gate-2 decision of BR-B2B-011 has another owner and another moment
 * (DS-COPY-015). This function only says which nudge to show.
 */
const OFFER_WORDS =
  /\b(card[áa]pio|menu|pre[çc]o|promo[çc][ãa]o|delivery|reserva|desconto|quartos?|di[áa]ria)\b|R\$/i

export const STORY_SHORT_THRESHOLD = 60

export type StoryNudge = 'short' | 'offer' | null

export function storyNudge(value: string, options: { required?: boolean } = {}): StoryNudge {
  const text = (value ?? '').trim()
  if (!text) return null
  if (OFFER_WORDS.test(text)) return 'offer'
  if (options.required && text.length < STORY_SHORT_THRESHOLD) return 'short'
  return null
}

/**
 * Normalises what gets persisted: trims, uppercases the CNPJ, strips unknown keys.
 *
 * `null` means the body is not answers, and the caller has to refuse it. It used to
 * return `{}` there, which the route then saved OVER the draft and confirmed with a 200:
 * one non-string value from a client bug erased everything the person had typed and told
 * them it was saved. An empty object is a legitimate draft; a rejected body is not one.
 */
export function normalizeAnswers(input: unknown): PartnerAnswers | null {
  const parsed = partnerDraftSchema.safeParse(input ?? {})
  if (!parsed.success) return null

  const answers: PartnerAnswers = {}
  for (const field of PARTNER_FORM_FIELDS) {
    const raw = (parsed.data as Record<string, string | undefined>)[field.id]
    if (raw === undefined) continue
    const value = raw.trim()
    if (!value) continue
    answers[field.id] = field.type === 'cnpj' ? normalizeCnpj(value) : value
  }
  return answers
}

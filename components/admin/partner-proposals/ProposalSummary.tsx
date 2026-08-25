'use client'

/**
 * `O essencial` — the five facts that decide the conversation with this partner, above
 * everything the form also collected.
 *
 * WHY A DIGEST EXISTS AT ALL. The screen used to open on a 14-row grid of step 1 where the CEP,
 * the complemento and the Instagram sat at the same weight as the CNPJ, and the ONE answer that
 * decides money — `plan_choice`, *"o que o parceiro quer contratar"* — was on no part of the
 * page at all: the grid renders steps 1 and 2, and the question is step 3. An operator deciding
 * whether to promote could not tell a partner asking for the free tier from one asking for the
 * paid one without opening the database.
 *
 * WHAT THIS IS NOT: a second source of the answers. Every field here is also in
 * `ProposalAnswers`, under the QUESTION THE PARTNER SAW, read from `PartnerForm.fields.*.label`
 * exactly as before. The labels on this card are the operator's own words for a digest — `Onde`
 * over four fields glued into one line is not a rewording of *"Rua e número"*, it is a different
 * object. The guarantee that the reviewer reads the partner's question intact lives one card
 * below, untouched.
 *
 * `plan_choice` is the only field that is HERE AND NOWHERE ELSE, and deliberately: it is the
 * first row, it is what BR-B2B-016 calls the two faixas, and a digest that buries it under the
 * address would be the defect this card was written to close.
 */

import { useTranslations } from 'next-intl'
import { MATERIAL_KINDS, materialFieldId } from '@/lib/partner-form/fields'
import type { PartnerAnswers } from '@/lib/partner-form/schema'
import { answerLabel } from './format'
import { CARD } from './surface'

interface ProposalSummaryProps {
  answers: PartnerAnswers
}

export function ProposalSummary({ answers }: ProposalSummaryProps) {
  const t = useTranslations('PartnerProposals')
  const form = useTranslations('PartnerForm')

  /**
   * The address in one line, in the order somebody reads an envelope. `filter(Boolean)` and not
   * a template with fixed separators: the complemento is optional, and `Rua Marechal Floriano,
   * 113 ·  · São Bento` is how an empty optional field announces itself as a bug.
   */
  const where = [
    answers.address,
    answers.address_complement,
    answers.district,
    [answers.city, answers.state].filter(Boolean).join(' — '),
    answers.postal_code,
  ]
    .filter(Boolean)
    .join(' · ')

  const who = [answers.representative_name, answers.representative_role].filter(Boolean).join(' · ')
  const reach = [answers.representative_phone, answers.representative_email].filter(Boolean).join(' · ')

  /**
   * `2 adesivos · 1 display de balcão`. The short names are this screen's own — the form asks
   * `Adesivos (quantidade)`, a question with its answer's unit inside it, which reads as
   * `2 Adesivos (quantidade)` the moment a number is glued to it. The `kind` ids are
   * `MATERIAL_KINDS`, the same three the CHECK of `partner.material_order_items` carries.
   *
   * ICU plural and not a bare number, because `1 displays de balcão` is what the concatenation
   * produced: the quantities are typed by the partner and one of them is very often 1.
   */
  const material = MATERIAL_KINDS.map((kind) => {
    const quantity = Number.parseInt(answers[materialFieldId(kind)] ?? '', 10)
    if (!Number.isFinite(quantity) || quantity <= 0) return null
    return t(`review.materialKinds.${kind}`, { count: quantity })
  }).filter(Boolean)

  return (
    <section aria-labelledby="essential-heading" className={`${CARD} p-6`}>
      <h2 id="essential-heading" className="text-base font-semibold text-gray-900 dark:text-white">
        {t('review.essentialHeading')}
      </h2>
      <p className="mt-1 text-sm text-gray-800 dark:text-gray-300">{t('review.essentialIntro')}</p>

      <dl className="mt-4 space-y-4">
        {/* THE FIRST ROW, and the one the screen did not have. The label is the form's own —
            it is already written for a reader on this side of the door (`O que o parceiro quer
            contratar`), so there is nothing to reword and nothing to duplicate. */}
        <Row label={form('fields.plan_choice.label')}>
          {answers.plan_choice ? (
            <span className="font-medium text-gray-900 dark:text-white">
              {answerLabel('plan_choice', answers.plan_choice, form)}
            </span>
          ) : (
            /* Not `—`: an unanswered tier is an act for the operator, and the sentence says
               which one (DS-COMPONENTE-020, point 1). */
            <span className="font-medium text-destructive">{t('review.planMissing')}</span>
          )}
        </Row>

        <Row label={t('review.essentialCategory')}>
          {answers.category ? answerLabel('category', answers.category, form) : '—'}
        </Row>

        <Row label={t('review.essentialWhere')}>{where || '—'}</Row>

        <Row label={t('review.essentialWho')}>
          <span className="block">{who || '—'}</span>
          {reach && <span className="block text-gray-800 dark:text-gray-300">{reach}</span>}
        </Row>

        {/* The quantities the promotion turns into a material order, so nobody approves a
            number they never saw. `não pediu` and not an empty row: zero material is an answer. */}
        <Row label={t('review.materialHeading')}>
          {material.length > 0 ? material.join(' · ') : t('review.materialNone')}
        </Row>
      </dl>
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-sm text-gray-700 dark:text-gray-400">{label}</dt>
      <dd className="break-words text-sm text-gray-900 dark:text-white">{children}</dd>
    </div>
  )
}

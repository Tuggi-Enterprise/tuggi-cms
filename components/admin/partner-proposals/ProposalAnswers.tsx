'use client'

/**
 * Everything the partner filled in, under the QUESTION THEY SAW — the block that used to open
 * the screen and now sits below the digest, collapsed.
 *
 * COLLAPSED, NEVER DROPPED. The 20 rows are read rarely and read whole when they are read: a
 * CEP that does not match the city, an Instagram handle to check, a razão social to compare
 * with the CNPJ. The digest above answers the frequent question; this answers the occasional
 * one, and deleting it would move that work to the database.
 *
 * Field labels are READ FROM `PartnerForm.fields.<id>.label` — the same key the partner saw.
 * A reviewer reading a different question from the one that was asked is exactly the defect
 * duplicating the labels would produce, and it is why the digest above never re-labels a field
 * with a rewording: it labels GROUPS.
 *
 * No block of text has `max-height` with `overflow-hidden`: a 1.200-character answer is normal
 * here, and this repo has lost text to that pair with no error at all.
 *
 * `<button aria-expanded>` and not `<details>`: the CMS opens and closes eight other blocks with
 * that triple (`PartnershipDetail`'s bands), and a second mechanism for the same gesture is what
 * makes a keyboard user learn the screen twice.
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { MATERIAL_KINDS, fieldsOfStep, materialFieldId } from '@/lib/partner-form/fields'
import { absenceClassOf } from '@/lib/partner-form/regularity'
import type { PartnerAnswers } from '@/lib/partner-form/schema'
import { answerLabel } from './format'
import { CARD } from './surface'

interface ProposalAnswersProps {
  answers: PartnerAnswers
}

/** Steps 1 and 2, plus the three material quantities. Step 3's story has a card of its own. */
const SHOWN_FIELD_COUNT =
  fieldsOfStep(1).length + fieldsOfStep(2).length + MATERIAL_KINDS.length

export function ProposalAnswers({ answers }: ProposalAnswersProps) {
  const t = useTranslations('PartnerProposals')
  const form = useTranslations('PartnerForm')
  const [open, setOpen] = useState(false)

  return (
    <section aria-labelledby="answers-heading" className={`${CARD} px-6 py-4`}>
      <h2 id="answers-heading" className="text-base font-semibold text-gray-900 dark:text-white">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="answers-body"
          className="flex w-full items-center justify-between gap-3 py-2 text-left"
        >
          <span className="flex items-center gap-2">
            {open ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-primary-800 dark:text-tuggi-blue" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-primary-800 dark:text-tuggi-blue" aria-hidden="true" />
            )}
            {t('review.allAnswersHeading')}
          </span>
          {/* The count is the promise of what opening costs, and it is derived from the field
              list rather than typed: a 21st question must not leave `20` on the button. */}
          <span className="text-sm font-normal text-gray-800 dark:text-gray-300">
            {open ? t('review.allAnswersHide') : t('review.allAnswersShow', { count: SHOWN_FIELD_COUNT })}
          </span>
        </button>
      </h2>

      {open && (
        <div id="answers-body" className="border-t border-gray-200 pt-4 dark:border-gray-800">
          {([1, 2] as const).map((step) => (
            <div key={step} className="mb-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-400">
                {t(`review.step${step}Heading`)}
              </h3>
              <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {fieldsOfStep(step).map((field) => (
                  <div key={field.id}>
                    <dt className="text-xs text-gray-700 dark:text-gray-400">{form(`fields.${field.id}.label`)}</dt>
                    <dd className="break-words text-sm text-gray-900 dark:text-white">
                      {answers[field.id] ? (
                        /* #404: the label of a choice, never its identifier. This grid rendered
                           `answers[field.id]` raw, so the curator read `bar_cafe` on the screen
                           where they decide about a real proposal. */
                        answerLabel(field.id, answers[field.id]!, form)
                      ) : (
                        <span
                          className={
                            absenceClassOf(field.id) === 'contract'
                              ? 'font-medium text-destructive'
                              : 'text-gray-700 dark:text-gray-400'
                          }
                        >
                          {t(`review.absence.${absenceClassOf(field.id)}`)}
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}

          {/* THE PROMOTIONAL MATERIAL, and it needs a block of its own since 2026-08-19. It used
              to be three more rows of the step-1 grid; the step it belongs to is now 3, which
              this screen renders as the story and not as a grid. The digest above shows the same
              three numbers in one line — here they keep the question and the unit. */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-400">
              {t('review.materialHeading')}
            </h3>
            <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {MATERIAL_KINDS.map((kind) => {
                const id = materialFieldId(kind)
                return (
                  <div key={id}>
                    <dt className="text-xs text-gray-700 dark:text-gray-400">{form(`fields.${id}.label`)}</dt>
                    <dd className="text-sm text-gray-900 dark:text-white">
                      {answers[id] ? (
                        answers[id]
                      ) : (
                        <span className="text-gray-700 dark:text-gray-400">{t('review.materialNone')}</span>
                      )}
                    </dd>
                  </div>
                )
              })}
            </dl>
          </div>
        </div>
      )}
    </section>
  )
}

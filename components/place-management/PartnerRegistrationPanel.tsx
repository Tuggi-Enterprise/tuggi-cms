'use client'

/**
 * "O que o parceiro informou" — #886. Read-only: what the registration carries that has no column
 * on the place (`partnerRegistrationSummary`), and the plan tier `describeDescriptionPolicy`
 * already decided for the description tab. Renders nothing for a place with no partner.
 *
 * Nothing of the representative reaches this screen: the allowlist is server-side (BR-B2B-030).
 */

import { useTranslations } from 'next-intl'
import { Handshake } from 'lucide-react'
import { useDescriptionPolicy } from '@/lib/hooks/use-description-policy'

interface Props {
  attractionId: string
  enabled: boolean
  sectionCard: string
  sectionTitle: string
  fieldLabel: string
}

export function PartnerRegistrationPanel({ attractionId, enabled, sectionCard, sectionTitle, fieldLabel }: Props) {
  const t = useTranslations('Modals.PlaceDetails.partner')
  const tStory = useTranslations('Modals.PartnerDescription.questions')
  const { data: view } = useDescriptionPolicy(attractionId, enabled)

  if (!view?.partnerClientId) return null
  const registration = view.registration

  const value = (text: string | null) =>
    text ? (
      <p className="text-sm font-medium text-gray-800 dark:text-gray-200 whitespace-pre-line">{text}</p>
    ) : (
      <p className="text-sm italic text-gray-400 dark:text-gray-500">{t('not_informed')}</p>
    )
  const list = (items: string[]) => value(items.length > 0 ? items.join(', ') : null)

  return (
    <section className={sectionCard}>
      <h4 className={sectionTitle}>
        <Handshake className="h-4 w-4 text-tuggi-blue" />
        {t('heading')}
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <span className={fieldLabel}>{t('tier')}</span>
          {value(t(`tiers.${view.decision.reason}`))}
        </div>
        {registration && (
          <div>
            <span className={fieldLabel}>{t('source')}</span>
            {value(t(`sources.${registration.source}`))}
          </div>
        )}
      </div>

      {!registration ? (
        <p className="mt-4 text-sm italic text-gray-400 dark:text-gray-500">{t('no_registration')}</p>
      ) : (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <span className={fieldLabel}>{t('signature_item')}</span>
            {value(registration.signatureItem)}
          </div>
          <div>
            <span className={fieldLabel}>{t('instagram')}</span>
            {value(registration.instagram)}
          </div>
          <div>
            <span className={fieldLabel}>{t('subtypes')}</span>
            {list(registration.subtypes)}
          </div>
          <div>
            <span className={fieldLabel}>{t('languages')}</span>
            {list(registration.languages.map((code) => code.toUpperCase()))}
          </div>
          {registration.story.map((block) => (
            <div key={block.id} className="md:col-span-2">
              <span className={fieldLabel}>
                {block.id === 'story_script' ? t('story_script') : tStory(block.id)}
              </span>
              {value(block.answer)}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

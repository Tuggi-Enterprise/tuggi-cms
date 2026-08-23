'use client'

/**
 * The client's places — the POIs that reach the tourist, seen from the record that owns the
 * relationship.
 *
 * WHY IT IS HERE AND NOT ONLY IN THE PIPELINE. The place is linked to the client by
 * `core.attractions.partner_client_id`, and until this tab existed that link was visible in
 * exactly one screen, band 4 of `/admin/partnerships/clients/{id}` — so an operator on the
 * client record could not see how many places the client has, whether any of them is on air,
 * or create the one that is missing. The record is the entrance; this is the door to the
 * place from it.
 *
 * WHAT IT IS NOT. It is not the place editor. Description, audio, trigger points and boundary
 * are a different object with a different job and they stay in `/pois/{id}` — which is why
 * every action here LEAVES, carrying `returnTo` so the operator comes back to this tab
 * (DS-LAYOUT-006, points 1 and 2). Copying a place's fields into the client record is how the
 * second source of the same fact gets born.
 *
 * IT COMPUTES NOTHING. The readiness of every place, the pendencies and the classes come from
 * `GET /api/admin/partnerships/clients/{id}` — the same answer the pipeline and the queue
 * read, so the three cannot disagree about what is missing.
 *
 * THE `Partnerships` NAMESPACE TRAVELS WITH IT. That copy lives only in `messages/pt.json`
 * (spec §2), and an absent key in next-intl renders THE KEY NAME on screen — so an operator on
 * `/en/` would read `Partnerships.pendencies...` instead of a pendency. The provider below
 * hands the Portuguese to this subtree and nothing else; the welcome-POI section under it
 * keeps the operator's locale, because its copy is translated in all three.
 */

import { useCallback, useEffect, useState } from 'react'
import { NextIntlClientProvider, useLocale, useTranslations } from 'next-intl'
import { MapPin } from 'lucide-react'
import ptMessages from '@/messages/pt.json'
import { Button } from '@/components/ui/button'
import { SectionHeader } from '@/components/admin/clients/shared/SectionHeader'
import { PlaceLinkPanel } from '@/components/admin/partnerships/PlaceLinkPanel'
import { PendencyList } from '@/components/admin/partnerships/PendencyList'
import { returnParams } from '@/lib/navigation/return-to'
import type { PendencyId } from '@/lib/partnerships/place-readiness'
import type { PartnershipDetail, PartnershipPlace } from '@/lib/services/partnership-service'
import { PoisTab } from './PoisTab'
import type { ClientEditorTabProps } from './ProfileTab'

export function PlacesTab(props: ClientEditorTabProps) {
  // Read OUTSIDE the Portuguese provider below: the vocabulary of the pipeline is pt-only, but
  // the routes it links to are the operator's own, and `/pt/pois/...` for somebody working in
  // `en` is a locale switch nobody asked for.
  const locale = useLocale()

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Portuguese only, and only here — see the docblock. */}
      <NextIntlClientProvider
        locale="pt"
        messages={{ Partnerships: ptMessages.Partnerships }}
      >
        <PartnerPlaces clientId={props.clientId} locale={locale} />
      </NextIntlClientProvider>

      {/* The welcome POI is a different question — WHICH place answers `/d/{slug}` — and its
          copy is translated in all three locales, so it stays outside the provider above. */}
      <PoisTab {...props} />
    </div>
  )
}

function PartnerPlaces({ clientId, locale }: { clientId?: string; locale: string }) {
  const t = useTranslations('Partnerships')
  const [detail, setDetail] = useState<PartnershipDetail | null>(null)
  // A client with no id was never saved, so there is nothing to wait for — derived, not set
  // synchronously inside the effect, which cascades a render for nothing.
  const [loading, setLoading] = useState(Boolean(clientId))
  const [failed, setFailed] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createFailed, setCreateFailed] = useState(false)

  /**
   * The fetch touches no state — `react-hooks/set-state-in-effect` is right that an effect
   * whose body sets state cascades renders, and keeping the two apart also makes the same call
   * reusable after the create below. Same shape as `ContractManager`.
   */
  const fetchDetail = useCallback(async (): Promise<PartnershipDetail | null> => {
    if (!clientId) return null
    try {
      const response = await fetch(`/api/admin/partnerships/clients/${clientId}`)
      const payload = response.ok ? await response.json() : null
      return (payload?.detail as PartnershipDetail | undefined) ?? null
    } catch {
      return null
    }
  }, [clientId])

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    const next = await fetchDetail()
    if (next) setDetail(next)
    else setFailed(true)
    setLoading(false)
  }, [fetchDetail])

  useEffect(() => {
    if (!clientId) return
    let active = true
    void fetchDetail().then((next) => {
      if (!active) return
      if (next) setDetail(next)
      else setFailed(true)
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [clientId, fetchDetail])

  /**
   * Creating the place is the SAME act the partner approval runs (`applyPartnerApprovalEffects`,
   * #360): prefilled from what the partner wrote and linked by `partner_client_id`, born
   * `approved = false` because the triage is a human decision (BR-B2B-011). Not a second
   * implementation of the prefill — this tab only moves the button to where the operator is.
   */
  async function create() {
    if (!clientId) return
    setCreating(true)
    setCreateFailed(false)
    try {
      const response = await fetch(`/api/admin/partnerships/clients/${clientId}/places`, {
        method: 'POST',
      })
      if (!response.ok) setCreateFailed(true)
    } catch {
      setCreateFailed(true)
    }
    // The reload is what answers: a place that appeared is the answer, and a banner saying
    // `created` over a list that did not change is worse than no banner.
    await load()
    setCreating(false)
  }

  if (!clientId) return null

  const backHere = `/admin/clients?clientId=${clientId}&tab=places`
  const returnLabel = t('clientPlaces.returnLabel')

  function placeHref(attractionId: string, pendency?: PendencyId): string {
    // The boundary is drawn inside the trigger-points panel, so it lands there too.
    const query = new URLSearchParams(returnParams(backHere, returnLabel))
    if (pendency) {
      query.set('tab', pendency === 'audio_description' ? 'description' : 'trigger-points')
    }
    return `/pois/${attractionId}?${query.toString()}`
  }

  return (
    <div className="rounded-3xl border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <SectionHeader
        icon={<MapPin className="h-4 w-4 text-primary-800" />}
        title={t('clientPlaces.title')}
      />
      <p className="mb-6 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
        {t('clientPlaces.body')}
      </p>

      {loading && <p className="text-sm text-gray-700 dark:text-gray-300">{t('clientPlaces.loading')}</p>}

      {!loading && failed && (
        <div className="rounded-md border border-gray-200 p-6 text-center dark:border-gray-800">
          <p className="font-medium text-gray-900 dark:text-white">{t('clientPlaces.errorTitle')}</p>
          <Button variant="outline" className="mt-3" onClick={() => void load()}>
            {t('clientPlaces.retry')}
          </Button>
        </div>
      )}

      {!loading && !failed && detail && detail.places.length === 0 && (
        <div className="text-sm">
          <p className="font-semibold text-gray-900 dark:text-white">{t('pendencies.emptyTitle')}</p>
          <p className="mt-1 text-gray-800 dark:text-gray-300">{t('pendencies.emptyBody')}</p>
          {createFailed && (
            <p role="alert" className="mt-3 text-gray-900 dark:text-white">
              {t('clientPlaces.createFailed')}
            </p>
          )}
          {/* SEARCH BEFORE CREATE, and the order is the fix: three of three clients who used
              the create button ended up with an empty second row beside the establishment
              already published (`lib/partnerships/place-link`). */}
          <div className="mt-4">
            <PlaceLinkPanel clientId={clientId} locale={locale} onLinked={load} />
          </div>

          <div className="mt-4">
            <p className="mb-2 text-xs text-gray-700 dark:text-gray-300">{t('placeLink.orCreate')}</p>
            <Button type="button" variant="outline" disabled={creating} onClick={() => void create()}>
              {creating ? t('clientPlaces.creating') : t('pendencies.emptyCreate')}
            </Button>
          </div>
        </div>
      )}

      {!loading && !failed && detail && detail.places.length > 0 && (
        <div className="space-y-5">
          {detail.places.map((place) => (
            <Place
              key={place.readiness.place.attractionId}
              place={place}
              placeHref={placeHref}
            />
          ))}
        </div>
      )}

      {/* The pipeline is where the place is PUBLISHED or REFUSED — that decision belongs to the
          partnership, not to the record, and this tab does not offer it twice. */}
      {!loading && !failed && detail && (
        <a
          href={`/admin/partnerships/clients/${clientId}`}
          className="mt-6 inline-flex min-h-[24px] items-center text-sm font-medium text-primary-800 underline underline-offset-4"
        >
          {t('clientPlaces.pipelineLink')}
        </a>
      )}
    </div>
  )
}

function Place({
  place,
  placeHref,
}: {
  place: PartnershipPlace
  placeHref: (attractionId: string, pendency?: PendencyId) => string
}) {
  const t = useTranslations('Partnerships')
  const attractionId = place.readiness.place.attractionId

  return (
    <article className="rounded-md border border-gray-200 p-4 dark:border-gray-800">
      {/* Never truncated: an 80-character name wraps onto a second line. */}
      <h3 className="break-words text-sm font-semibold text-gray-900 dark:text-white">
        {place.readiness.place.name}
      </h3>

      <div className="mt-3">
        <PendencyList
          readiness={place.readiness}
          // `Abrir o local` navigates rather than opening a modal: this tab already lives
          // inside the client record's drawer, and a modal over a drawer buries the way out.
          onOpenPlace={() => {
            window.location.href = placeHref(attractionId)
          }}
          toolHref={(pendency) => placeHref(attractionId, pendency)}
        />
      </div>

      <a
        href={placeHref(attractionId)}
        className="mt-3 inline-flex min-h-[24px] items-center text-sm font-medium text-primary-800 underline underline-offset-4"
      >
        {t('detail.openPlace')}
      </a>
    </article>
  )
}

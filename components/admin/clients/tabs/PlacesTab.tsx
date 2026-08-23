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
 * THE WELCOME POI IS NOT A SECOND SECTION ANY MORE, and that is the correction of 2026-08-23.
 * Under this tab sat a field where the operator pasted a UUID into `welcome_poi_id`, a second
 * pointer at "this partner's POI" that nothing forced to agree with the link — and of the 10
 * clients that carried one, 10 pointed at a POI that was not the client's place. Linking now
 * adopts it (`../places/link`), and choosing among several is an act on the place itself,
 * below.
 *
 * THE `Partnerships` NAMESPACE TRAVELS WITH IT. That copy lives only in `messages/pt.json`
 * (spec §2), and an absent key in next-intl renders THE KEY NAME on screen — so an operator on
 * `/en/` would read `Partnerships.pendencies...` instead of a pendency. The provider below
 * hands the Portuguese to this subtree and nothing else.
 */

import { useCallback, useEffect, useState } from 'react'
import { NextIntlClientProvider, useLocale, useTranslations } from 'next-intl'
import { MapPin } from 'lucide-react'
import ptMessages from '@/messages/pt.json'
import { Button } from '@/components/ui/button'
import { SectionHeader } from '@/components/admin/clients/shared/SectionHeader'
import { PlaceLinkPanel } from '@/components/admin/partnerships/PlaceLinkPanel'
import { WelcomeDivergenceCard } from '@/components/admin/partnerships/WelcomeDivergenceCard'
import { PendencyList } from '@/components/admin/partnerships/PendencyList'
import { returnParams } from '@/lib/navigation/return-to'
import type { PendencyId } from '@/lib/partnerships/place-readiness'
import type { PartnershipDetail, PartnershipPlace } from '@/lib/services/partnership-service'
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
   * Creating the place is `provisionPartnerPlace`, and since 2026-08-23 this button is the ONLY
   * caller: prefilled from what the partner wrote and linked by `partner_client_id`, born
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

          {/* The client that already points at a POI, above the search — see the card. */}
          {detail.welcomeDivergence && (
            <div className="mt-4">
              <WelcomeDivergenceCard
                clientId={clientId}
                divergence={detail.welcomeDivergence}
                onLinked={load}
              />
            </div>
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
              clientId={clientId}
              isWelcome={place.readiness.place.attractionId === detail.client.welcomePoiId}
              // The act only makes sense where there is a choice: with one place the link
              // already adopted it, and a button that changes nothing is a button that lies.
              canChooseWelcome={detail.places.length > 1}
              onWelcomeChanged={load}
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
  clientId,
  isWelcome,
  canChooseWelcome,
  onWelcomeChanged,
}: {
  place: PartnershipPlace
  placeHref: (attractionId: string, pendency?: PendencyId) => string
  clientId: string
  isWelcome: boolean
  canChooseWelcome: boolean
  onWelcomeChanged: () => Promise<void>
}) {
  const t = useTranslations('Partnerships')
  const attractionId = place.readiness.place.attractionId
  const [choosing, setChoosing] = useState(false)
  const [chooseFailed, setChooseFailed] = useState(false)

  async function chooseWelcome() {
    setChoosing(true)
    setChooseFailed(false)
    try {
      const response = await fetch(
        `/api/admin/partnerships/clients/${clientId}/places/welcome`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attractionId }),
        }
      )
      if (!response.ok) setChooseFailed(true)
    } catch {
      setChooseFailed(true)
    }
    // Same answer as the link: the badge that moved IS the confirmation.
    await onWelcomeChanged()
    setChoosing(false)
  }

  return (
    <article className="rounded-md border border-gray-200 p-4 dark:border-gray-800">
      {/* Never truncated: an 80-character name wraps onto a second line. */}
      <h3 className="break-words text-sm font-semibold text-gray-900 dark:text-white">
        {place.readiness.place.name}
      </h3>

      {/* WHICH place greets the tourist on `/d/{slug}`, said on the place itself — it was a
          separate section with a UUID field, and the two pointers drifted apart in 10 of 10
          clients. */}
      {isWelcome && (
        <p className="mt-1 text-xs font-medium text-primary-800">{t('welcome.badge')}</p>
      )}
      {!isWelcome && canChooseWelcome && (
        <button
          type="button"
          disabled={choosing}
          onClick={() => void chooseWelcome()}
          className="mt-1 inline-flex min-h-[24px] items-center text-xs font-medium text-primary-800 underline underline-offset-4 disabled:opacity-60"
        >
          {choosing ? t('welcome.choosing') : t('welcome.choose')}
        </button>
      )}
      {chooseFailed && (
        <p role="alert" className="mt-1 text-xs text-gray-900 dark:text-white">
          {t('welcome.failed')}
        </p>
      )}

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

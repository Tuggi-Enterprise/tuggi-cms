'use client'

/**
 * One place, addressed by its id — the door `/pois/{id}` already was for the other kind.
 *
 * WHY IT DID NOT EXIST, AND WHAT THAT COST. `core.attractions` holds both kinds, and the Locais
 * module only ever opened its editor from its own list: there was no URL that named one place,
 * so every screen that had to send an operator to a place sent them to `/pois/{id}` instead. For
 * a partner's place — born `entity_kind = 'place'` — that screen answered `POI not found`
 * (operator, 2026-08-25), on a row the list beside it had just drawn. Which tool a kind opens in
 * is `lib/partnerships/place-tool.ts` now; this is the half of it that had nowhere to point.
 *
 * IT READS THROUGH THE RPC, and that is not an implementation detail. `/pois/{id}` selects
 * `core.attractions` directly from the browser, so RLS decides whether the row comes back;
 * `PlaceFormModal` reads `core.get_place_details`, which answers the same for any operator who
 * reached this screen. The module gate is the layout's (`hasPlaces`), where a gate belongs.
 *
 * THE WAY BACK IS THE CALLER'S — DS-LAYOUT-006, point 2. `returnTo` and `returnLabel` are parsed
 * by `lib/navigation/return-to`, the same module the POI route and the client record read: three
 * screens deciding separately what an in-app path is would be three chances to get one security
 * decision wrong. Closing goes back there, and going back re-mounts the caller, which refetches —
 * that is how the pendency the operator just resolved disappears with no manual reload (point 3).
 */

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { PlaceFormModal } from '@/components/place-management/PlaceFormModal'
import {
  RETURN_LABEL_PARAM,
  RETURN_TO_PARAM,
  parseReturnLabel,
  parseReturnTo,
} from '@/lib/navigation/return-to'

/**
 * The tabs another screen may send an operator straight to. An allowlist and not a cast: a
 * `?tab=` nobody implemented would otherwise land the drawer on a blank panel. The four names
 * are the drawer's own, and the POI route allows the same four.
 */
const DEEP_LINK_TABS = ['details', 'description', 'narration-audio', 'trigger-points'] as const
type DeepLinkTab = (typeof DEEP_LINK_TABS)[number]

export default function PlacePage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()

  const id = params?.id as string | undefined

  const returnTo = parseReturnTo(searchParams?.get(RETURN_TO_PARAM))
  const returnLabel = parseReturnLabel(searchParams?.get(RETURN_LABEL_PARAM), returnTo)

  const requestedTab = searchParams?.get('tab')
  const initialTab = DEEP_LINK_TABS.find((tab) => tab === requestedTab) as DeepLinkTab | undefined

  /**
   * `/places` is the fallback and never a guess at the caller: an operator who arrived by typing
   * a URL has no pipeline to go back to, and the catalogue is where this object lives.
   */
  function leave() {
    router.push(returnTo ?? '/places')
  }

  if (!id) return null

  return (
    <>
      {/* THE CONTROL THAT DECLARES THE WAY BACK, and it is not the browser's button —
          DS-LAYOUT-006, point 2, asks for a visible one that NAMES where it goes. The drawer's
          own X leaves through the same `leave()`, so the two cannot disagree about the
          destination; this is what says the destination out loud. Same shape as the POI route. */}
      <div className="fixed top-4 left-4 z-50">
        <button
          type="button"
          onClick={leave}
          className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-gray-700 shadow-lg transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
          {returnLabel ?? 'Voltar para os locais'}
        </button>
      </div>

      {/* Saving does not leave. An operator sent here to resolve one pendency often has a second
          one in the next tab, and bouncing them out after every save would rebuild the round trip
          the pipeline exists to remove. */}
      <PlaceFormModal placeId={id} isOpen initialTab={initialTab} onClose={leave} />
    </>
  )
}

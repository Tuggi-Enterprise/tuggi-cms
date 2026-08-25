/**
 * Which editor a partner's place opens in — ONE rule, because there are two tools and the
 * catalogue is one table.
 *
 * `core.attractions` holds both kinds. A place the partnership provisions is born
 * `entity_kind = 'place'`; a POI the team catalogued by hand and later linked to a client is
 * `'poi'`. They have DIFFERENT editors, and the two are not interchangeable:
 *
 *  · `/pois/{id}` reads `core.attractions` DIRECTLY from the browser, so RLS decides whether the
 *    row comes back at all;
 *  · `/places/{id}` reads `core.get_place_details`, an RPC, which answers the same for any
 *    operator who reached the screen.
 *
 * THE DEFECT THIS CLOSES, reported by the operator on 2026-08-25: every link out of the
 * partnership pointed at `/pois/{id}` whatever the kind, and opening a `place` there returned
 * `POI not found` — the screen said the local did not exist, on a row the list beside it had
 * just drawn. It is the 3rd edge case of DS-COMPONENTE-024 in its literal form: a single
 * catalogue with two kinds underneath has two editors, and sending the object to the wrong one
 * opens a form that cannot answer for it.
 *
 * TWO SCREENS READ THIS, and that is the reason it is a module and not a function inside one of
 * them: `PlacesTab` (the client record) and `PartnershipDetail` (the pipeline) both send the
 * operator to the same place from the same pendency, and a rule written twice is how one of them
 * keeps pointing at the old tool after the other is fixed.
 */

import { returnParams } from '@/lib/navigation/return-to'
import type { PendencyId } from './place-readiness'

export interface PlaceToolTarget {
  locale: string
  attractionId: string
  /** `core.attractions.entity_kind`. Anything that is not `'place'` is edited as a POI. */
  entityKind: string | null
  /**
   * Where the operator goes back to, and what the control that takes them there says.
   *
   * OPTIONAL, because two callers link out without one today — the candidate list of
   * `PlaceLinkPanel` and `WelcomeDivergenceCard`. That is a gap of DS-LAYOUT-006, point 2, and a
   * separate one from the defect this module closes; inventing the copy for it here would hide
   * it. Absent means the editor opens with no declared way back, exactly as it does now.
   */
  returnTo?: string
  returnLabel?: string
  /** The pendency being resolved, when the link exists to resolve one. */
  pendency?: PendencyId
}

/**
 * The tab a pendency is resolved in. The boundary is drawn INSIDE the trigger-points panel
 * (`TriggerPointsManager` renders `BoundaryControls`), so both land there — and both editors
 * name their tabs the same, which is what lets one mapping serve the two.
 */
function tabOf(pendency: PendencyId): string | null {
  if (pendency === 'audio_description') return 'description'
  if (pendency === 'trigger_point' || pendency === 'boundary') return 'trigger-points'
  // `coordinate`, `inactive` and `hidden_from_map` are fields of the record itself, and the
  // record is what the editor opens on.
  return null
}

export function placeToolHref(target: PlaceToolTarget): string {
  const query = new URLSearchParams(
    target.returnTo ? returnParams(target.returnTo, target.returnLabel) : {}
  )
  const tab = target.pendency ? tabOf(target.pendency) : null
  if (tab) query.set('tab', tab)

  // `place` is the only kind with a second editor; everything else is a POI, including a `null`
  // that a row with no `entity_kind` would carry. Guessing the other way would send a real POI
  // to a form that filters it out (`core.get_place_details` filters `entity_kind = 'place'`).
  const tool = target.entityKind === 'place' ? 'places' : 'pois'
  const search = query.toString()
  return `/${target.locale}/${tool}/${target.attractionId}${search ? `?${search}` : ''}`
}

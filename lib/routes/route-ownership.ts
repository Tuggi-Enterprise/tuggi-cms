/**
 * The two route fields of #792 that `upsert_custom_route` does not carry: how the route is
 * travelled and which partner owns it. The CMS writes them the way it writes `country`/`region`,
 * with a direct UPDATE on `core.custom_routes` after the RPC (`app/api/routes`).
 *
 * Kept out of `route-service.ts` on purpose: the editor imports these constants, and that module
 * pulls the OSRM client into the browser bundle.
 */
import { UUID } from '@/lib/finance/input'

/**
 * How the route is TRAVELLED (#792) — `core.custom_routes.travel_mode`, CHECK in the database.
 * Not the trigger-point calculation mode: the `bike` of the TP calculation is another fact.
 */
export const TRAVEL_MODES = ['car', 'walk', 'bike'] as const;
export type TravelMode = typeof TRAVEL_MODES[number];

export function isTravelMode(value: unknown): value is TravelMode {
  return typeof value === 'string' && (TRAVEL_MODES as readonly string[]).includes(value);
}

/** Partner that owns a route (#792) — `core.custom_route_partners`. Public attribution only. */
export interface RoutePartner {
  id: string;
  name: string;
  short_description: string | null;
  logo_url: string | null;
}

export type RouteOwnershipPatch = { travel_mode?: TravelMode; partner_id?: string | null }

/**
 * Reads `travel_mode` and `partner_id` from a request body. A key that is absent stays out of the
 * patch (the column keeps its value); a key that is present and malformed is an error, never a
 * silent default — the route is the only barrier in front of the UPDATE.
 */
export function parseRouteOwnership(
  body: Record<string, unknown>
): { patch: RouteOwnershipPatch } | { error: string } {
  const patch: RouteOwnershipPatch = {}

  if (body.travel_mode !== undefined) {
    if (!isTravelMode(body.travel_mode)) {
      return { error: `travel_mode must be one of ${TRAVEL_MODES.join(', ')}` }
    }
    patch.travel_mode = body.travel_mode
  }

  if (body.partner_id !== undefined) {
    if (body.partner_id === null || body.partner_id === '') {
      patch.partner_id = null
    } else if (typeof body.partner_id === 'string' && UUID.test(body.partner_id)) {
      patch.partner_id = body.partner_id
    } else {
      return { error: 'partner_id must be a uuid or null' }
    }
  }

  return { patch }
}

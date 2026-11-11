/**
 * #1203: the six routes around Santiago and the pure decisions of `scripts/santiago-routes.ts`.
 *
 * A stop is linked to a POI of core.attractions (entity_kind 'poi') only when the POI is within
 * STOP_MATCH_RADIUS_M of the stop AND has a similar name (`isSimilarName`, the rule of the other
 * #1203 scripts). Nearest-without-name, the rule of create-rio-maravilhas.ts, links the Catedral
 * stop to whatever statue stands closer in a dense centre; a stop that matches nothing stays
 * generic, as in the Rio routes.
 *
 * The coordinates of the stops were read from OpenStreetMap on 2026-11-11 (the Overpass cache of
 * output/chile-1203/ and Nominatim). Texts: BR-ROTA-001, the mode says how the route is travelled
 * and nothing about the guide adapting to it; no opening hours, prices or superlatives.
 */
import type { TravelMode } from '../routes/route-ownership'
import type { RouteVisibility } from '../routes/route-publication'
import { GridIndex, nearestSimilar } from './matching'
import type { LatLng } from './admin-areas'

export const STOP_MATCH_RADIUS_M = 200
export const ROUTES_SCRIPT = 'santiago-routes'
export const ROUTES_COUNTRY = 'Chile'
/** BR-ROTA-003: the six are found in the discovery (search, map, lists), not only by link. */
export const ROUTES_VISIBILITY: RouteVisibility = 'public'
/** Raw OSM name of the región where every route starts; the script passes it through normalizeState. */
export const ROUTES_REGION_RAW = 'Región Metropolitana de Santiago'

export type ScenicProfile = 'panoramic' | 'historical' | 'nature' | 'urban' | 'rural'

export interface RouteStop extends LatLng {
  name: string
  /** Other names the catalogue may use for the same place. */
  altNames?: string[]
}

export interface RouteSpec {
  /** Stable key in metadata.route_key: the idempotency key, it survives a rename in the CMS. */
  key: string
  name: string
  description: string
  travelMode: TravelMode
  scenicProfile: ScenicProfile[]
  stops: RouteStop[]
}

export const SANTIAGO_ROUTES: RouteSpec[] = [
  {
    key: 'santiago-centro-historico-a-pe',
    name: 'Santiago a pé: o centro histórico',
    description: 'Caminhada pelo centro de Santiago, do Mercado Central ao Museo Nacional de Bellas Artes. '
      + 'Passa pelo Correo Central, pela Plaza de Armas e pela Catedral, segue para o Museo Chileno de Arte '
      + 'Precolombino e o Palacio de La Moneda, volta pela Bolsa e pelo Paseo Ahumada e atravessa a Alameda '
      + 'até o Cerro Santa Lucía e o bairro Lastarria.',
    travelMode: 'walk',
    scenicProfile: ['historical', 'urban'],
    stops: [
      { name: 'Mercado Central', lat: -33.43362, lng: -70.65102 },
      { name: 'Correo Central', lat: -33.43706, lng: -70.65109, altNames: ['Palacio de Correos'] },
      { name: 'Plaza de Armas de Santiago', lat: -33.43776, lng: -70.65045, altNames: ['Plaza de Armas'] },
      { name: 'Catedral Metropolitana de Santiago', lat: -33.43775, lng: -70.65189, altNames: ['Catedral de Santiago'] },
      { name: 'Museo Chileno de Arte Precolombino', lat: -33.43902, lng: -70.65220, altNames: ['Museo de Arte Precolombino'] },
      { name: 'Palacio de La Moneda', lat: -33.44282, lng: -70.65386, altNames: ['La Moneda'] },
      { name: 'Bolsa de Comercio de Santiago', lat: -33.44259, lng: -70.65163, altNames: ['Paseo Ahumada'] },
      { name: 'Cerro Santa Lucía', lat: -33.44095, lng: -70.64320, altNames: ['Terraza Neptuno'] },
      { name: 'Barrio Lastarria', lat: -33.43797, lng: -70.64102, altNames: ['Lastarria'] },
      { name: 'Museo Nacional de Bellas Artes', lat: -33.43534, lng: -70.64358 },
    ],
  },
  {
    key: 'santiago-casablanca-valparaiso-vina',
    name: 'De Santiago ao Pacífico: Casablanca, Valparaíso e Viña del Mar',
    description: 'Pela Ruta 68, de Santiago até o mar. No caminho, o Túnel Lo Prado, Curacaví e as vinícolas do '
      + 'Valle de Casablanca. Em Valparaíso, a Plaza Sotomayor e os cerros Concepción e Alegre, com o Paseo '
      + 'Gervasoni, o Paseo Atkinson e o Palacio Baburizza, e depois La Sebastiana, a casa de Pablo Neruda. '
      + 'Termina em Viña del Mar, no Reloj de Flores, no Castillo Wulff e na Quinta Vergara.',
    travelMode: 'car',
    scenicProfile: ['panoramic', 'historical', 'urban', 'rural'],
    stops: [
      { name: 'Túnel Lo Prado', lat: -33.45872, lng: -70.94765 },
      { name: 'Curacaví', lat: -33.40221, lng: -71.12937, altNames: ['Plaza de Curacaví', 'Plaza Presidente Balmaceda'] },
      { name: 'Plaza de Armas de Casablanca', lat: -33.32057, lng: -71.41000, altNames: ['Casablanca'] },
      { name: 'Viña Casas del Bosque', lat: -33.31879, lng: -71.43550, altNames: ['Casas del Bosque'] },
      { name: 'Plaza Sotomayor', lat: -33.03876, lng: -71.62912 },
      { name: 'Paseo Gervasoni', lat: -33.04119, lng: -71.62656, altNames: ['Ascensor Concepción', 'Cerro Concepción'] },
      { name: 'Paseo Atkinson', lat: -33.04253, lng: -71.62522 },
      { name: 'Palacio Baburizza', lat: -33.04028, lng: -71.62893, altNames: ['Cerro Alegre', 'Paseo Yugoslavo'] },
      { name: 'La Sebastiana', lat: -33.05368, lng: -71.62295, altNames: ['La Sebastiana (Casa de Pablo Neruda)', 'Casa Museo La Sebastiana'] },
      { name: 'Reloj de Flores', lat: -33.02329, lng: -71.56718 },
      { name: 'Castillo Wulff', lat: -33.01924, lng: -71.56486 },
      { name: 'Quinta Vergara', lat: -33.03284, lng: -71.55218, altNames: ['Parque Quinta Vergara'] },
    ],
  },
  {
    key: 'cajon-del-maipo',
    name: 'Cajón del Maipo: de Puente Alto ao Embalse El Yeso',
    description: 'Subida pelo vale do rio Maipo, de Puente Alto até a cordilheira. Passa por San José de Maipo e '
      + 'por San Alfonso, perto da Cascada de las Ánimas, segue até Baños Morales e termina no Embalse El Yeso.',
    travelMode: 'car',
    scenicProfile: ['panoramic', 'nature', 'rural'],
    stops: [
      { name: 'Plaza de Puente Alto', lat: -33.60952, lng: -70.57584, altNames: ['Puente Alto'] },
      { name: 'San José de Maipo', lat: -33.64037, lng: -70.35289, altNames: ['Plaza de Armas de San José de Maipo'] },
      { name: 'San Alfonso', lat: -33.72829, lng: -70.31811, altNames: ['Plaza de San Alfonso'] },
      { name: 'Cascada de las Ánimas', lat: -33.73542, lng: -70.31489, altNames: ['Centro de Ecoturismo Cascada de las Ánimas'] },
      { name: 'Baños Morales', lat: -33.82288, lng: -70.06102 },
      { name: 'Embalse El Yeso', lat: -33.66514, lng: -70.08526, altNames: ['Represa El Yeso'] },
    ],
  },
  {
    key: 'vinicolas-do-maipo',
    name: 'Vinícolas do Maipo: Pirque, Buin e Paine',
    description: 'Roteiro pelas vinícolas ao sul de Santiago. Começa na Concha y Toro, em Pirque, passa pela Haras '
      + 'de Pirque e pela Santa Rita, em Alto Jahuel, e termina na Pérez Cruz, em Huelquén.',
    travelMode: 'car',
    scenicProfile: ['rural', 'historical'],
    stops: [
      { name: 'Viña Concha y Toro', lat: -33.63291, lng: -70.57618, altNames: ['Concha y Toro', 'Parque Concha y Toro'] },
      { name: 'Viña Haras de Pirque', lat: -33.69489, lng: -70.60933, altNames: ['Haras de Pirque'] },
      { name: 'Viña Santa Rita', lat: -33.72916, lng: -70.67338, altNames: ['Santa Rita', 'Casona Santa Rita'] },
      { name: 'Viña Pérez Cruz', lat: -33.84182, lng: -70.61896, altNames: ['Pérez Cruz'] },
    ],
  },
  {
    key: 'farellones-valle-nevado',
    name: 'Farellones e Valle Nevado pelo Camino a Farellones',
    description: 'Subida pelo Camino a Farellones, a estrada das curvas numeradas, de Las Condes até a montanha. '
      + 'Passa pelos mirantes do caminho, pela vila de Farellones e termina em Valle Nevado.',
    travelMode: 'car',
    scenicProfile: ['panoramic', 'nature'],
    stops: [
      { name: 'Camino a Farellones', lat: -33.36701, lng: -70.49801 },
      { name: 'Mirador Camino Farellones', lat: -33.34379, lng: -70.33788 },
      { name: 'Curva 15 Farellones', lat: -33.33777, lng: -70.33295 },
      { name: 'Curva 39 Farellones', lat: -33.35567, lng: -70.31780 },
      { name: 'Farellones', lat: -33.35080, lng: -70.31294 },
      { name: 'Valle Nevado', lat: -33.35435, lng: -70.24916 },
    ],
  },
  {
    key: 'pomaire-isla-negra',
    name: 'Pomaire e Isla Negra pela Ruta 78',
    description: 'De Pomaire, a vila da cerâmica, até o litoral pela Ruta 78. No caminho, o borde costero de '
      + 'Cartagena; o roteiro termina em Isla Negra, na casa-museu de Pablo Neruda.',
    travelMode: 'car',
    scenicProfile: ['rural', 'panoramic', 'historical'],
    stops: [
      { name: 'Pomaire', lat: -33.65032, lng: -71.15093, altNames: ['Plaza de Pomaire'] },
      { name: 'Borde Costero de Cartagena', lat: -33.54619, lng: -71.60543, altNames: ['Zona Típica Borde Costero de Cartagena', 'Cartagena'] },
      { name: 'Casa Museo Isla Negra', lat: -33.44299, lng: -71.68374, altNames: ['Casa de Pablo Neruda en Isla Negra', 'Isla Negra'] },
    ],
  },
]

/** A POI of core.attractions next to a stop. */
export interface PoiCandidate extends LatLng {
  id: string
  name: string
  approved: boolean | null
}

/** The POI a stop stands for: within radiusM and with a similar name, the nearest; else null. */
export function matchStop(stop: RouteStop, candidates: PoiCandidate[], radiusM = STOP_MATCH_RADIUS_M): PoiCandidate | null {
  if (!candidates.length) return null
  return nearestSimilar(stop, new GridIndex(candidates), radiusM)
}

export type Availability = 'yes' | 'no' | 'unknown'

/** The waypoint shape of create-rio-maravilhas.ts, the one the app already reads. */
export interface EnrichedWaypoint {
  id: string
  lat: number
  lng: number
  metadata: {
    name: string
    attraction_id: string | null
    is_generic: boolean
    wheelchair_access: 'yes' | 'partial' | 'no' | 'unknown'
    parking: Availability
    restrooms: Availability
    rest_areas: Availability
    photogenic_rating: 'low' | 'medium' | 'high' | 'unknown'
  }
}

/** Short alphanumeric id, the project pattern for waypoint ids. */
export function randomWaypointId(): string {
  return Math.random().toString(36).substring(2, 9)
}

/**
 * The stops with their match. A stored route keeps its waypoint ids (a re-run only changes the
 * link), so nothing that points at a waypoint id breaks.
 */
export function buildWaypoints(
  stops: RouteStop[],
  matches: Array<PoiCandidate | null>,
  previous: EnrichedWaypoint[] | null = null,
  newId: () => string = randomWaypointId,
): EnrichedWaypoint[] {
  return stops.map((stop, i) => {
    const match = matches[i] ?? null
    return {
      id: previous?.[i]?.id ?? newId(),
      lat: stop.lat,
      lng: stop.lng,
      metadata: {
        name: match ? match.name : stop.name,
        attraction_id: match ? match.id : null,
        is_generic: !match,
        wheelchair_access: 'unknown',
        parking: 'unknown',
        restrooms: 'unknown',
        rest_areas: 'unknown',
        photogenic_rating: 'unknown',
      },
    }
  })
}

const SAME_POINT_DEG = 1e-6

/** The stored waypoints are still the script's stops, in the same order: nobody redrew the route in the CMS. */
export function sameStops(stored: unknown, stops: RouteStop[]): boolean {
  if (!Array.isArray(stored) || stored.length !== stops.length) return false
  return stops.every((s, i) => {
    const w = stored[i] as { lat?: unknown; lng?: unknown } | null
    return typeof w?.lat === 'number' && typeof w?.lng === 'number'
      && Math.abs(w.lat - s.lat) < SAME_POINT_DEG && Math.abs(w.lng - s.lng) < SAME_POINT_DEG
  })
}

const linkOf = (w: unknown): string | null =>
  ((w as { metadata?: { attraction_id?: unknown } } | null)?.metadata?.attraction_id as string | null | undefined) ?? null

export interface StoredRoute {
  id: string
  waypoints: unknown
}

export type RoutePlan =
  | { action: 'create' }
  | { action: 'recreate'; routeId: string }
  | { action: 'unchanged'; routeId: string }
  | { action: 'update_links'; routeId: string; changed: number[] }
  | { action: 'edited_in_cms'; routeId: string }

/**
 * What a run does with one route. Missing: create. --force: soft delete and create again (the Rio
 * script's rule). Present and still with the script's stops: write only the links that changed
 * (a POI created by santiago-missing-pois-from-osm.ts after the first run). Present with other
 * stops: someone edited it in the CMS, and the run leaves it alone.
 */
export function planRoute(existing: StoredRoute | null, stops: RouteStop[], waypoints: EnrichedWaypoint[], force: boolean): RoutePlan {
  if (!existing) return { action: 'create' }
  if (force) return { action: 'recreate', routeId: existing.id }
  if (!sameStops(existing.waypoints, stops)) return { action: 'edited_in_cms', routeId: existing.id }
  const stored = existing.waypoints as unknown[]
  const changed = waypoints.map((w, i) => (linkOf(stored[i]) === w.metadata.attraction_id ? -1 : i)).filter(i => i >= 0)
  return changed.length ? { action: 'update_links', routeId: existing.id, changed } : { action: 'unchanged', routeId: existing.id }
}

/** Sum of the straight segments, in meters: the dry run's sanity check when routing is not wanted. */
export function straightLengthM(stops: LatLng[], distance: (a: LatLng, b: LatLng) => number): number {
  let total = 0
  for (let i = 1; i < stops.length; i++) total += distance(stops[i - 1], stops[i])
  return total
}

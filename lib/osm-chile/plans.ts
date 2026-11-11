/**
 * #1203: what each Chile script would do, computed without writing anything. The diagnosis script
 * prints the same plans the write scripts apply, so the dry run and the diagnosis cannot disagree.
 */
import {
  type AdminArea, type AdminAreas, type AdminFixPlan, type BBox, type LatLng, type ResolvedAdminArea,
  isChileCountry, isInSantiagoArea, planAdminFix, pointInArea, resolveAdminArea, santiagoAreaBBox,
} from './admin-areas'
import { type AdminRow, type CoreDb, fetchAttractionsByIds, fetchChileByCountry, scanCoordinates } from './catalogue'
import { type CatalogueEntry, CatalogueMatcher, GridIndex, distanceToPolylineM, foldName, isSimilarName, nearestSimilar } from './matching'
import { type OsmElement, type OverpassElement, bboxClause, cachedJson, corridorLine, overpass, toOsmElement } from './osm-sources'
import { type OsmTags, type PlaceVerdict, catalogueTags, classifyPlaceOrAttraction, hasReference, isAttractionCandidate } from './osm-tags'

// ─── Script 2: región and comuna ────────────────────────────────────────────────────────────

export type AdminFixItem =
  | { row: AdminRow; status: 'no_coordinate' }
  | { row: AdminRow; status: AdminFixPlan['status']; plan: AdminFixPlan; resolved: ResolvedAdminArea }

export async function planAdminFixes(db: CoreDb, areas: AdminAreas): Promise<AdminFixItem[]> {
  const rows = (await fetchChileByCountry(db)).filter(r => isChileCountry(r.country))
  return rows.map((row): AdminFixItem => {
    if (row.latitude == null || row.longitude == null) return { row, status: 'no_coordinate' }
    const resolved = resolveAdminArea({ lat: row.latitude, lng: row.longitude }, areas)
    const plan = planAdminFix({ state: row.state, city: row.city }, resolved)
    return { row, status: plan.status, plan, resolved }
  })
}

export function inChile(p: LatLng, areas: AdminAreas): boolean {
  return areas.regions.some(a => pointInArea(p, a))
}

// ─── Script 3: poi -> place ─────────────────────────────────────────────────────────────────

interface PoiRow {
  id: string
  name: string
  category: string | null
  primary_category: string | null
  osm_type: string | null
  osm_id: string | null
  osm_tags: unknown
  amenity: string | null
  shop: string | null
  leisure: string | null
  building: string | null
}

export interface PlaceCandidate {
  id: string
  name: string
  category: string | null
  lat: number
  lng: number
  tagSource: 'own' | 'osm_nearby' | 'none'
  osmRef: string | null
  verdict: PlaceVerdict
}

/** 0.2 degree tiles (about 22 km), fetched only where a cadastro has no OSM tag of its own. */
const PLACE_TILE_DEG = 0.2
const TILE_MARGIN_DEG = 0.002

function placeTileQuery(minLat: number, minLng: number): string {
  const b = bboxClause({
    minLat: minLat - TILE_MARGIN_DEG, maxLat: minLat + PLACE_TILE_DEG + TILE_MARGIN_DEG,
    minLng: minLng - TILE_MARGIN_DEG, maxLng: minLng + PLACE_TILE_DEG + TILE_MARGIN_DEG,
  })
  return `[out:json][timeout:180];(` +
    `nwr["tourism"~"^(hotel|hostel|guest_house|apartment|motel|attraction|museum|viewpoint|artwork|gallery|zoo|aquarium|theme_park)$"]["name"](${b});` +
    `nwr["amenity"~"^(restaurant|bar|cafe|pub|fast_food|place_of_worship|theatre|arts_centre|marketplace)$"]["name"](${b});` +
    `nwr["shop"]["name"](${b});` +
    `nwr["historic"]["name"](${b});` +
    `nwr["leisure"~"^(park|garden|nature_reserve)$"]["name"](${b});` +
    `);out tags bb;`
}

async function placeTile(tileLat: number, tileLng: number): Promise<OsmElement[]> {
  const key = `${tileLat.toFixed(1)}_${tileLng.toFixed(1)}`
  const raw = await cachedJson(`places-tile-${key}.json`, () => overpass(placeTileQuery(tileLat, tileLng), `overpass places tile ${key}`))
  return raw.map(toOsmElement).filter((e): e is OsmElement => !!e && !!e.name)
}

/** Every `poi` in the Santiago area (150 km and inside Chile), with the lugar/attraction verdict. */
export async function planPoisToPlaces(db: CoreDb, areas: AdminAreas): Promise<PlaceCandidate[]> {
  const coords = await scanCoordinates(db, santiagoAreaBBox(), 0.05)
  const inArea = coords.filter(c => {
    const p = { lat: c.latitude, lng: c.longitude }
    return isInSantiagoArea(p) && inChile(p, areas)
  })
  const where = new Map(inArea.map(c => [c.attraction_id, { lat: c.latitude, lng: c.longitude }]))
  const rows = await fetchAttractionsByIds<PoiRow>(
    db, Array.from(where.keys()),
    'id, name, category, primary_category, osm_type, osm_id, osm_tags, amenity, shop, leisure, building',
    'poi',
  )

  const needMatch = rows.filter(r => !catalogueTags(r))
  const tiles = new Map<string, [number, number]>()
  for (const r of needMatch) {
    const p = where.get(r.id)!
    const tLat = Math.floor(p.lat / PLACE_TILE_DEG) * PLACE_TILE_DEG
    const tLng = Math.floor(p.lng / PLACE_TILE_DEG) * PLACE_TILE_DEG
    tiles.set(`${tLat.toFixed(1)}_${tLng.toFixed(1)}`, [tLat, tLng])
  }
  const elements: OsmElement[] = []
  let n = 0
  for (const [tLat, tLng] of Array.from(tiles.values())) {
    elements.push(...await placeTile(tLat, tLng))
    console.log(`  OSM tiles ${++n}/${tiles.size}`)
  }
  const grid = new GridIndex(elements)

  return rows.map((r): PlaceCandidate => {
    const p = where.get(r.id)!
    const own = catalogueTags(r)
    let tags: OsmTags | null = own
    let tagSource: PlaceCandidate['tagSource'] = own ? 'own' : 'none'
    let osmRef = own && r.osm_type && r.osm_id ? `${r.osm_type}/${r.osm_id}` : null
    if (!own) {
      const hit = nearestSimilar({ name: r.name, lat: p.lat, lng: p.lng }, grid)
      if (hit) { tags = hit.tags; tagSource = 'osm_nearby'; osmRef = `${hit.osmType}/${hit.osmId}` }
    }
    return {
      id: r.id, name: r.name, category: r.primary_category ?? r.category, lat: p.lat, lng: p.lng,
      tagSource, osmRef, verdict: classifyPlaceOrAttraction(tags, [r.category, r.primary_category]),
    }
  })
}

// ─── Script 4: missing POIs from OSM ────────────────────────────────────────────────────────

/** Central Santiago: the four comunas the operator named and the ones around them. */
export const CENTER_COMUNAS = [
  'Santiago', 'Providencia', 'Recoleta', 'Las Condes',
  'Ñuñoa', 'Independencia', 'Estación Central', 'Vitacura', 'Quinta Normal',
]

/** The six routes of the card, as waypoints for OSRM. The 2 km band is measured on the routed line. */
export const CORRIDORS: Array<{ key: string; label: string; waypoints: LatLng[] }> = [
  { key: 'ruta68', label: 'Ruta 68 Santiago, Casablanca, Valparaíso, Viña del Mar', waypoints: [
    { lat: -33.4489, lng: -70.6693 }, { lat: -33.3197, lng: -71.4078 }, { lat: -33.0472, lng: -71.6127 }, { lat: -33.0245, lng: -71.5518 },
  ] },
  { key: 'cajon-del-maipo', label: 'Cajón del Maipo to Embalse El Yeso', waypoints: [
    { lat: -33.6117, lng: -70.5758 }, { lat: -33.6410, lng: -70.3530 }, { lat: -33.7790, lng: -70.2400 }, { lat: -33.6760, lng: -70.0880 },
  ] },
  { key: 'pirque-buin', label: 'Pirque and Buin wineries', waypoints: [
    { lat: -33.6352, lng: -70.5737 }, { lat: -33.7290, lng: -70.6450 }, { lat: -33.7320, lng: -70.7420 },
  ] },
  { key: 'farellones', label: 'Farellones and Valle Nevado', waypoints: [
    { lat: -33.3700, lng: -70.5150 }, { lat: -33.3560, lng: -70.3110 }, { lat: -33.3570, lng: -70.2490 },
  ] },
  { key: 'pomaire-isla-negra', label: 'Pomaire and Isla Negra by Ruta 78 and the coast', waypoints: [
    { lat: -33.4489, lng: -70.6693 }, { lat: -33.6520, lng: -71.1640 }, { lat: -33.5930, lng: -71.6110 },
    { lat: -33.5520, lng: -71.6050 }, { lat: -33.4420, lng: -71.6850 },
  ] },
]

export const CORRIDOR_BAND_M = 2000

export interface MissingCandidate {
  element: OsmElement
  scope: string
  match: { id: string; name: string; by: string } | null
  action: 'present' | 'create' | 'list'
  reason: string
  resolved: ResolvedAdminArea | null
}

export interface MissingPlan {
  candidates: MissingCandidate[]
  warnings: string[]
}

interface CatalogueRow { id: string; name: string; alt_name: string | null; osm_type: string | null; osm_id: string | null; wikidata: string | null }

function expand(b: BBox, deg: number): BBox {
  return { minLat: b.minLat - deg, maxLat: b.maxLat + deg, minLng: b.minLng - deg, maxLng: b.maxLng + deg }
}

const TYPE_RANK: Record<string, number> = { relation: 0, way: 1, node: 2 }

export interface MissingPoiScope {
  center: AdminArea[]
  corridors: Array<{ key: string; line: LatLng[]; box: BBox }>
  all: BBox
  warnings: string[]
}

/** The central comunas, the routed corridors and the box that holds both. */
export async function missingPoiScope(areas: AdminAreas): Promise<MissingPoiScope> {
  const warnings: string[] = []
  const wanted = new Set(CENTER_COMUNAS.map(foldName))
  const center = areas.comunas.filter(c => wanted.has(foldName(c.name)))
  const found = new Set(center.map(c => foldName(c.name)))
  for (const n of CENTER_COMUNAS) if (!found.has(foldName(n))) warnings.push(`comuna not found in OSM boundaries: ${n}`)

  const corridors: MissingPoiScope['corridors'] = []
  for (const c of CORRIDORS) {
    const line = await corridorLine(c.key, c.waypoints)
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
    for (const p of line) {
      minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat)
      minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng)
    }
    corridors.push({ key: c.key, line, box: expand({ minLat, maxLat, minLng, maxLng }, 0.02) })
  }

  const boxes = [...center.map(c => c.bbox), ...corridors.map(c => c.box)]
  const all = {
    minLat: Math.min(...boxes.map(b => b.minLat)), maxLat: Math.max(...boxes.map(b => b.maxLat)),
    minLng: Math.min(...boxes.map(b => b.minLng)), maxLng: Math.max(...boxes.map(b => b.maxLng)),
  }
  return { center, corridors, all, warnings }
}

/** Named OSM attractions in the box, one Overpass call, cached. */
export async function santiagoAttractionElements(all: BBox): Promise<OverpassElement[]> {
  const b = bboxClause(all)
  return cachedJson('attractions-santiago.json', () => overpass(
    `[out:json][timeout:180];(` +
    `nwr["tourism"~"^(attraction|museum|viewpoint|artwork|gallery)$"]["name"](${b});` +
    `nwr["historic"]["name"](${b});` +
    `nwr["leisure"="park"]["name"](${b});` +
    `nwr["natural"~"^(peak|waterfall)$"]["name"](${b});` +
    `);out tags bb;`,
    'overpass santiago attractions',
  ))
}

export async function planMissingPois(db: CoreDb, areas: AdminAreas): Promise<MissingPlan> {
  const { center, corridors, all, warnings } = await missingPoiScope(areas)
  const raw = await santiagoAttractionElements(all)

  const inScope: Array<{ element: OsmElement; scope: string }> = []
  for (const e of raw.map(toOsmElement)) {
    if (!e || !isAttractionCandidate(e.tags, e.bboxAreaM2)) continue
    const comuna = center.find(c => pointInArea(e, c))
    if (comuna) { inScope.push({ element: e, scope: `comuna ${comuna.name}` }); continue }
    const corridor = corridors.find(c =>
      e.lat >= c.box.minLat && e.lat <= c.box.maxLat && e.lng >= c.box.minLng && e.lng <= c.box.maxLng &&
      distanceToPolylineM(e, c.line) <= CORRIDOR_BAND_M)
    if (corridor) inScope.push({ element: e, scope: `corridor ${corridor.key}` })
  }

  const coords = await scanCoordinates(db, all, 0.05)
  const at = new Map(coords.map(c => [c.attraction_id, c]))
  const rows = await fetchAttractionsByIds<CatalogueRow>(db, Array.from(at.keys()), 'id, name, alt_name, osm_type, osm_id, wikidata')
  const entries: CatalogueEntry[] = rows.map(r => ({
    id: r.id, name: r.name, altNames: r.alt_name ? [r.alt_name] : [],
    lat: at.get(r.id)!.latitude, lng: at.get(r.id)!.longitude,
    osmType: r.osm_type, osmId: r.osm_id, wikidata: r.wikidata,
  }))
  const matcher = new CatalogueMatcher(entries)

  // The same attraction is often mapped twice (a node and the building way, both named). The one
  // with a reference and the larger geometry is kept; the twin is reported as present.
  inScope.sort((x, y) =>
    Number(hasReference(y.element.tags)) - Number(hasReference(x.element.tags)) ||
    TYPE_RANK[x.element.osmType] - TYPE_RANK[y.element.osmType])
  const accepted: OsmElement[] = []

  const candidates = inScope.map(({ element, scope }): MissingCandidate => {
    const m = matcher.match({ ...element, wikidata: element.tags.wikidata ?? null })
    if (m) return { element, scope, match: { id: m.entry.id, name: m.entry.name, by: m.by }, action: 'present', reason: `in catalogue by ${m.by}`, resolved: null }
    const twin = accepted.find(a =>
      (a.tags.wikidata && a.tags.wikidata === element.tags.wikidata) ||
      (isSimilarName(a.name, element.name) && distanceToPolylineM(element, [a]) <= 150))
    if (twin) return { element, scope, match: null, action: 'present', reason: `same as ${twin.osmType}/${twin.osmId} in this run`, resolved: null }
    accepted.push(element)
    if (!hasReference(element.tags)) return { element, scope, match: null, action: 'list', reason: 'no wikidata or wikipedia tag', resolved: null }
    const resolved = resolveAdminArea(element, areas)
    if (!resolved.state || !resolved.city) return { element, scope, match: null, action: 'list', reason: 'outside the región/comuna polygons', resolved }
    return { element, scope, match: null, action: 'create', reason: 'missing, has a reference', resolved }
  })
  return { candidates, warnings }
}

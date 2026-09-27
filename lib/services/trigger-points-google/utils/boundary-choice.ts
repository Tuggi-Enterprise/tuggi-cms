/**
 * E1 — which OSM element may be the POI border (docs/arquitetura/cms/motor-de-tp.md,
 * INV-E1a/b/c, BR-AUDIO-010). Pure: no network, no DB. The detector fetches, this decides.
 *
 * The rule reads the POI's own tags and category, never its name. Every element that
 * contains the pin and is refused leaves a reason for the trace (E0).
 */
import { tagValue } from '../config/visibility-class';
import { calculatePolygonAreaInM2, isPointInPolygon } from './calculations';

type LatLng = { lat: number; lng: number };
type Tags = Record<string, unknown> | undefined;

/**
 * Largest footprint a monument, statue, bust or artwork may take from a containing polygon
 * (provisional, #775). Above it the polygon is the square, the campus or the hill the POI
 * stands on, not the POI: the Monumento Árvore de Natal took 0.69 km² from a nearby polygon
 * and got 264 m of terrain (#772).
 */
export const POINT_FEATURE_MAX_AREA_M2 = 5_000;

/**
 * Largest landform a summit may take as its border (provisional, #775). Above it the natural=*
 * polygon is the forest of the whole massif, not the hill: the Pico Itaiaci took a 92 km² wood
 * and the far-street search went through 30k streets.
 */
export const RELIEF_MAX_AREA_M2 = 1_000_000;

/** An E1 candidate refused, with the reason, for the trace. */
export interface BoundaryRejection {
  element: string;
  reason: string;
}

/** OSM element as Overpass and the local DB return it (`geometry` = ring points). */
export interface OsmAreaElement {
  type: string;
  id: string | number;
  tags?: Record<string, unknown>;
  geometry?: Array<{ lat: number; lon?: number; lng?: number }>;
}

export interface ChosenBoundary {
  element: OsmAreaElement;
  ring: LatLng[];
  areaM2: number;
}

/**
 * Categories whose nature is a place (neighbourhood, city). The category is the curated field;
 * `osm_tags` is not read here because it mirrors the very element being judged — the Maracanã
 * POI carries `class=place` only because its osm_id points at the neighbourhood node.
 */
const PLACE_CATEGORIES = new Set([
  'neighborhood', 'neighbourhood', 'suburb', 'quarter', 'locality', 'sublocality', 'city', 'town',
  'village', 'hamlet', 'municipality', 'bairro', 'island', 'islet',
]);

export function poiIsPlace(category: string | undefined | null): boolean {
  return PLACE_CATEGORIES.has(String(category ?? '').trim().toLowerCase());
}

/** `place=*` or an administrative boundary: a border only for a POI that is itself a place. */
export function isPlaceElement(tags: Tags): boolean {
  return tagValue(tags, 'place') !== '' || tagValue(tags, 'boundary') === 'administrative';
}

const normName = (s: unknown): string =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/**
 * The curated id is a place area (relation/way) carrying the POI's own name, and the POI has no
 * category saying otherwise: the POI is that place. The Maracanã and Manguinhos POIs are the
 * neighbourhoods, with `category` null and the admin relation as osm_id. A node has no area, and
 * a POI whose name differs (a stadium pointing at its neighbourhood) keeps the refusal.
 */
export function curatedPlaceIsThePoi(
  osmType: string,
  elementTags: Tags,
  poi: { name?: string | null; category?: string | null },
): boolean {
  const uncategorised = !poi.category || poi.category === 'point_of_interest';
  const name = normName(poi.name);
  return osmType !== 'node' && uncategorised && name !== ''
    && [elementTags?.name, elementTags?.['name:pt']].some(n => normName(n) === name);
}

/** Relief: the border is the landform around the summit (natural=*), never a park or a building. */
export function isReliefPoi(tags: Tags): boolean {
  return ['peak', 'hill', 'volcano'].includes(tagValue(tags, 'natural'));
}

/** Monument, statue, bust, memorial, artwork: an object on a square, not the square. */
export function isPointFeature(tags: Tags): boolean {
  const historic = tagValue(tags, 'historic');
  return ['monument', 'memorial', 'statue', 'bust'].includes(historic)
    || tagValue(tags, 'man_made') === 'monument'
    || tagValue(tags, 'tourism') === 'artwork'
    || tagValue(tags, 'memorial') !== ''
    || ['statue', 'bust', 'sculpture'].includes(tagValue(tags, 'artwork_type'));
}

/** Area kinds a point feature never inherits (INV-E1c): they are what it stands on. */
const POINT_FEATURE_REFUSED_KEYS = ['leisure', 'landuse', 'natural', 'place', 'boundary'];

/** Features mapped as lines even when the way closes on itself. */
function isLinearFeature(tags: Tags): boolean {
  return tagValue(tags, 'highway') !== '' || tagValue(tags, 'railway') !== '' || tagValue(tags, 'barrier') !== ''
    || ['coastline', 'cliff', 'ridge', 'tree_row'].includes(tagValue(tags, 'natural'));
}

const toLatLng = (p: { lat: number; lon?: number; lng?: number }): LatLng => ({ lat: p.lat, lng: (p.lng ?? p.lon) as number });

/**
 * The local DB stores a multipolygon as its rings one after another (outer, then inner).
 * Read as one polygon, the hole flips the even-odd test: the Pão de Açúcar summit sits in the
 * hole of its bare_rock and read as outside. Returns the closed rings.
 */
export function splitRings(points: LatLng[]): LatLng[][] {
  const rings: LatLng[][] = [];
  let start = 0;
  for (let i = start + 3; i < points.length; i++) {
    if (points[i].lat === points[start].lat && points[i].lng === points[start].lng) {
      rings.push(points.slice(start, i + 1));
      start = i + 1;
      i = start + 2;
    }
  }
  if (start === 0) return points.length >= 3 ? [points] : [];
  return rings;
}

/** The ring that is the footprint: the largest ring holding the pin; without one, the largest. */
export function outerRing(points: LatLng[], pin: LatLng): LatLng[] {
  const rings = splitRings(points);
  if (rings.length <= 1) return rings[0] ?? points;
  return footprintRing(rings, pin) ?? points;
}

/** Of closed rings, the footprint: the largest holding the pin; without one, the largest. */
export function footprintRing(rings: LatLng[][], pin: LatLng): LatLng[] | undefined {
  const byArea = rings.map(r => ({ r, a: calculatePolygonAreaInM2(r) })).sort((x, y) => y.a - x.a);
  return (byArea.find(x => isPointInPolygon(pin, x.r)) ?? byArea[0])?.r;
}

const samePoint = (a: LatLng, b: LatLng): boolean => a.lat === b.lat && a.lng === b.lng;

/**
 * Overpass returns a relation as members, each outer way with its own geometry, and a border is
 * usually several open ways that meet end to end (Maracanã 5520332: 6 ways, none closed). Joins
 * them into closed rings; a chain that never closes is dropped (incomplete relation).
 */
export function assembleOuterRings(
  members: Array<{ type?: string; role?: string; geometry?: Array<{ lat: number; lon?: number; lng?: number }> | null }> | undefined,
): LatLng[][] {
  const pending = (members ?? [])
    .filter(m => m.type !== 'node' && (m.role === 'outer' || m.role === '') && Array.isArray(m.geometry) && m.geometry.length >= 2)
    .map(m => m.geometry!.map(toLatLng));
  const rings: LatLng[][] = [];
  while (pending.length > 0) {
    let chain = pending.shift()!;
    while (!(chain.length >= 4 && samePoint(chain[0], chain[chain.length - 1]))) {
      const end = chain[chain.length - 1];
      const i = pending.findIndex(w => samePoint(w[0], end) || samePoint(w[w.length - 1], end));
      if (i < 0) break;
      const [next] = pending.splice(i, 1);
      chain = chain.concat((samePoint(next[0], end) ? next : [...next].reverse()).slice(1));
    }
    if (chain.length >= 4 && samePoint(chain[0], chain[chain.length - 1])) rings.push(chain);
  }
  return rings;
}

const isClosed = (ring: LatLng[]): boolean =>
  ring.length >= 4 && ring[0].lat === ring[ring.length - 1].lat && ring[0].lng === ring[ring.length - 1].lng;

/**
 * INV-E1a step "OSM that contains the pin", with INV-E1c: the border holds the pin, and its
 * kind fits the POI. Smallest fitting polygon wins. Only elements holding the pin are judged;
 * without an id the pin is the only evidence that a polygon is the POI.
 */
export function chooseContainingBoundary(
  pin: LatLng,
  poi: { category?: string | null; tags?: Tags },
  elements: OsmAreaElement[],
): { chosen?: ChosenBoundary; rejected: BoundaryRejection[] } {
  const rejected: BoundaryRejection[] = [];
  const place = poiIsPlace(poi.category);
  const relief = isReliefPoi(poi.tags);
  const pointFeature = !relief && isPointFeature(poi.tags);
  const fitting: ChosenBoundary[] = [];
  const seen = new Set<string>();

  for (const el of elements) {
    const key = `${el.type}/${el.id}`;
    if (seen.has(key) || !Array.isArray(el.geometry) || el.geometry.length < 4) continue;
    seen.add(key);
    const points = el.geometry.map(toLatLng);
    const ring = el.type === 'relation' ? outerRing(points, pin) : points;
    if (!isClosed(ring) || isLinearFeature(el.tags) || !isPointInPolygon(pin, ring)) continue;
    const areaM2 = calculatePolygonAreaInM2(ring);
    const reject = (reason: string) => rejected.push({ element: key, reason });

    if (isPlaceElement(el.tags) && !place) { reject('place/boundary element for a POI that is not a place'); continue; }
    if (relief && tagValue(el.tags, 'natural') === '') { reject('relief POI takes a natural=* landform only'); continue; }
    if (relief && areaM2 > RELIEF_MAX_AREA_M2) {
      reject(`relief landform ${Math.round(areaM2)} m² > ${RELIEF_MAX_AREA_M2} m² (the massif, not the hill)`); continue;
    }
    if (pointFeature && POINT_FEATURE_REFUSED_KEYS.some(k => tagValue(el.tags, k) !== '')) {
      reject('monument/statue/bust does not inherit an area polygon'); continue;
    }
    if (pointFeature && areaM2 > POINT_FEATURE_MAX_AREA_M2) {
      reject(`monument/statue/bust footprint ${Math.round(areaM2)} m² > ${POINT_FEATURE_MAX_AREA_M2} m²`); continue;
    }
    fitting.push({ element: el, ring, areaM2 });
  }
  fitting.sort((a, b) => a.areaM2 - b.areaM2);
  return { chosen: fitting[0], rejected };
}

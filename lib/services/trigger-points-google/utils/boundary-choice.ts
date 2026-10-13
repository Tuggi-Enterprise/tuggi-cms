/**
 * E1 — which OSM element may be the POI border (docs/arquitetura/cms/motor-de-tp.md,
 * INV-E1a/b/c, BR-AUDIO-010). Pure: no network, no DB. The detector fetches, this decides.
 *
 * Fixed identity only (operator, 2026-10-11): an OSM id or a `wikidata` id says WHICH element is
 * the POI; a name never does — the spring "Morava" took the 34,226 km² region of the same name.
 * No category or type tag decides either, with one exception, the municipality (BR-POI-010,
 * `isMunicipalElement`). Every element that contains the pin and is refused leaves a reason for
 * the trace (E0).
 */
import { calculatePolygonAreaInM2, isPointInPolygon } from './calculations';
import { isCuratedBoundaryImplausible } from './osm-validation';

type LatLng = { lat: number; lng: number };
type Tags = Record<string, unknown> | undefined;

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
  /** A relation's members as Overpass returns them (the local DB keeps none). */
  members?: Array<{ type?: string; ref?: string | number; role?: string }>;
}

export interface ChosenBoundary {
  element: OsmAreaElement;
  ring: LatLng[];
  areaM2: number;
}

/**
 * BR-POI-010: an administrative area, or the urban area of a city or town, is a POI's border only
 * through the seat mode (`BoundaryDetector#municipalityBoundary`, the `admin_centre`). Neither the
 * same name nor the POI's own id lends it: Lagoa Formosa, the lake, took the municipality's
 * relation 315134 (842 km²) by name; Bom Despacho's own way 936775250 is `place=town`, and the
 * seat is node 246672623 (#779).
 */
export function isMunicipalElement(tags: Tags): boolean {
  if (['city', 'town'].includes(String(tags?.place ?? ''))) return true;
  if (String(tags?.boundary ?? '') !== 'administrative') return false;
  // Municipality or larger (8 in Brazil); a neighbourhood (9, 10) is a POI of its own (Maracanã).
  const level = Number(tags?.admin_level);
  return !Number.isFinite(level) || level <= 8;
}

/** What the POI's own OSM id gave in this run. `unknown`: OSM could not be asked. */
export type OwnIdLookup = 'none' | 'found' | 'gone' | 'municipal' | 'unknown';

/**
 * BR-POI-010 (#779, operator 2026-10-07): what becomes of the stored border. `stored.source` is
 * the RAW `boundary_source` — never the detector's defaulted value (null is not `osm`).
 * 1. curated (manual, manual_drawing, confidence 1, the seat's osm_admin): never touched;
 * 4. the own id is a municipality and the POI is not the seat (the seat returned before): point;
 * 2. the own id is alive: its geometry replaces the stored border, which never comes back;
 * 3. stored `osm` and no id, or the id is gone: point. When OSM could not be asked, `retry`: the
 *    POI fails this run instead of losing a border to a network error.
 * Otherwise (`detect`) detection runs as before; a stored `osm` border is still never a fallback.
 */
export type BoundaryFate =
  | { fate: 'keep'; rule: 1 }
  | { fate: 'own_id'; rule: 2 }
  | { fate: 'point'; rule: 3 | 4 }
  | { fate: 'retry'; rule: 3 }
  | { fate: 'detect'; rule: null };

export function boundaryFate(stored: { source?: string | null; curated?: boolean } | null | undefined, ownId: OwnIdLookup): BoundaryFate {
  if (stored?.curated) return { fate: 'keep', rule: 1 };
  if (ownId === 'municipal') return { fate: 'point', rule: 4 };
  if (ownId === 'found') return { fate: 'own_id', rule: 2 };
  if (stored?.source !== 'osm') return { fate: 'detect', rule: null };
  return ownId === 'unknown' ? { fate: 'retry', rule: 3 } : { fate: 'point', rule: 3 };
}

/**
 * How far around the pin an element tied to the POI by id is looked for (INV-E1c): a pin is often
 * on the street beside its building (Maracanã, 17 m off the stadium, #786). Provisional (#775).
 */
export const IDENTITY_NEAR_PIN_M = 50;

/**
 * Roles of a relation member that place a node on a map without making it part of the relation:
 * the label of an area and the seat of a municipality. A POI that is such a node is not the area.
 */
const NON_IDENTITY_ROLES = new Set(['label', 'admin_centre']);

/** An element refused because no id ties it to the POI, whatever its name. */
export const NO_ID_LINK_REASON = 'no id ties it to the POI (same wikidata, or the POI node as a member): a name is not identity';

/** A closed way that is a via (`highway`, `railway`), not an area: the TP stands on it (E6). */
function isVia(tags: Tags): boolean {
  return String(tags?.highway ?? '') !== '' || String(tags?.railway ?? '') !== '';
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
  // BR-POI-010 (#779): a line that never closes is no ring. Read as one, a river or a road passing
  // the pin became the border of a church (Itaobim, 265 km²).
  return rings;
}

/**
 * The outer rings of a stored geometry: `splitRings` without the holes (a ring starting inside
 * another ring of the same element). A building relation with several outer parts is several
 * buildings: read as one ring, Weitra's relation 2374229 (5 houses up to 1.6k m² each, 14 km
 * apart) became a 25 km² "building" holding 23 POIs, and E11 dropped every TP as inside it
 * (INV-E11b, 2026-10-09).
 */
export function outerRings(points: LatLng[]): LatLng[][] {
  const rings = splitRings(points);
  if (rings.length <= 1) return rings;
  return rings.filter(r => !rings.some(o => o !== r && isPointInPolygon(r[0], o)));
}

/** The ring that is the footprint: the largest ring holding the pin; without one, the largest. Empty when none closes. */
export function outerRing(points: LatLng[], pin: LatLng): LatLng[] {
  const rings = splitRings(points);
  if (rings.length <= 1) return rings[0] ?? [];
  return footprintRing(rings, pin) ?? [];
}

/** Of closed rings, the footprint: the largest holding the pin; without one (or no pin), the largest. */
export function footprintRing(rings: LatLng[][], pin: LatLng | undefined): LatLng[] | undefined {
  const byArea = rings.map(r => ({ r, a: calculatePolygonAreaInM2(r) })).sort((x, y) => y.a - x.a);
  return ((pin && byArea.find(x => isPointInPolygon(pin, x.r))) || byArea[0])?.r;
}

/**
 * Outer rings of a stored GeoJSON border, one per polygon part (BR-POI-009). The pipeline stores
 * MultiPolygons of N parts (Gargalo do Tejo: 128) and GeometryCollections of polygon + stray
 * line (Castelo dos Mouros); reading only part 0 put Rio Douro's TPs on a 5 ha piece 7.5 km from
 * the pin. Holes (inner rings) are not parts; lines and points in a collection are dropped.
 */
export function polygonOuterRings(geometry: any): LatLng[][] {
  const ring = (coords: unknown): LatLng[] =>
    Array.isArray(coords) ? coords.map((c: [number, number]) => ({ lng: c[0], lat: c[1] })) : [];
  switch (geometry?.type) {
    case 'Polygon':
      return [ring(geometry.coordinates?.[0])].filter(r => r.length >= 3);
    case 'MultiPolygon':
      return (geometry.coordinates ?? []).map((p: unknown[]) => ring(p?.[0])).filter((r: LatLng[]) => r.length >= 3);
    case 'GeometryCollection':
      return (geometry.geometries ?? []).flatMap(polygonOuterRings);
    default:
      return [];
  }
}

const samePoint = (a: LatLng, b: LatLng): boolean => a.lat === b.lat && a.lng === b.lng;

/**
 * The GeoJSON the pipeline saves for a border, the inverse of `polygonOuterRings`: a Polygon of
 * the border ring, or — for a municipal border (BR-POI-010) — a MultiPolygon of every part, so
 * islands and exclaves survive the save. Rings are closed.
 */
export function boundaryGeoJson(boundary: { coordinates: LatLng[]; adminParts?: LatLng[][] }): { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown } {
  const closed = (r: LatLng[]) => (samePoint(r[0], r[r.length - 1]) ? r : [...r, r[0]]).map(c => [c.lng, c.lat]);
  return boundary.adminParts?.length
    ? { type: 'MultiPolygon', coordinates: boundary.adminParts.map(p => [closed(p)]) }
    : { type: 'Polygon', coordinates: [closed(boundary.coordinates)] };
}

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
 * INV-E1a step "OSM that contains the pin", with INV-E1c by fixed identity (operator, 2026-10-11).
 * An element is the border of a POI only when an id ties them:
 * - the element carries the POI's own `wikidata` (the castle node and the castle polygon);
 * - the POI is a node and a member of the relation (Overpass `members`), in a role other than
 *   `label` or `admin_centre` (those place a node on an area without making it the area).
 * Of the tied elements, the smallest that is plausible (`isCuratedBoundaryImplausible`: the pin is
 * often on the street beside its building). A municipality never is one (BR-POI-010: only the
 * seat, on its own path). A name ties nothing: the spring "Morava" (Q179251) stood in the historic
 * region "Morava" (Q43266, 34,226 km²) and took it as its border; an unnamed polygon under a pin
 * is the ground, not the POI. Without a tie there is no border here, and the caller draws the
 * point circle (INV-E1b). Elements holding the pin that are refused go to the trace.
 */
export function chooseContainingBoundary(
  pin: LatLng,
  poi: {
    /** The POI's own `wikidata`. */
    wikidata?: string | null;
    /** The POI's OSM node id, when the POI is a node. */
    nodeId?: string | number | null;
  },
  elements: OsmAreaElement[],
): { chosen?: ChosenBoundary; rejected: BoundaryRejection[] } {
  const rejected: BoundaryRejection[] = [];
  const tied: ChosenBoundary[] = [];
  const seen = new Set<string>();
  const wikidata = typeof poi.wikidata === 'string' ? poi.wikidata.trim() : '';
  const nodeId = poi.nodeId == null ? '' : String(poi.nodeId);

  for (const el of elements) {
    const key = `${el.type}/${el.id}`;
    if (seen.has(key) || !Array.isArray(el.geometry) || el.geometry.length < 4) continue;
    seen.add(key);
    const points = el.geometry.map(toLatLng);
    const ring = el.type === 'relation' ? outerRing(points, pin) : points;
    if (!isClosed(ring) || isVia(el.tags)) continue;
    const holdsPin = isPointInPolygon(pin, ring);
    const sameWikidata = wikidata !== '' && String(el.tags?.wikidata ?? '').trim() === wikidata;
    const member = nodeId !== '' && el.type === 'relation' && (el.members ?? []).some(m =>
      m.type === 'node' && String(m.ref) === nodeId && !NON_IDENTITY_ROLES.has(String(m.role ?? '')));
    if (!sameWikidata && !member) {
      if (holdsPin) rejected.push({ element: key, reason: NO_ID_LINK_REASON });
      continue;
    }
    if (isMunicipalElement(el.tags)) {
      rejected.push({ element: key, reason: 'municipality: only the seat takes its border (BR-POI-010)' });
      continue;
    }
    if (!holdsPin && isCuratedBoundaryImplausible(pin, ring)) {
      rejected.push({ element: key, reason: 'tied by id, but the pin is outside and far from its edge' });
      continue;
    }
    tied.push({ element: el, ring, areaM2: calculatePolygonAreaInM2(ring) });
  }
  tied.sort((a, b) => a.areaM2 - b.areaM2);
  return { chosen: tied[0], rejected };
}


// ── A POI mapped as a line (bridge, promenade) — INV-E1a ───────────────────────

/**
 * Half width of the corridor drawn around a POI mapped as open ways, when the way has no
 * `width` of its own. Two carriageways of a motorway sit within it. Provisional (#775).
 */
export const LINE_CORRIDOR_HALF_WIDTH_M = 15;

type Way = { id: string | number; tags?: Record<string, unknown>; geometry?: Array<{ lat: number; lon?: number; lng?: number }> };

/**
 * The POI's curated way is open: the element is a line, and the POI is the whole run of ways TIED
 * TO IT BY ID (`sameIdentityWaysQuery`: same `wikidata`, or members of the same waterway or bridge
 * relation) and of the same via kind, continuing it end to end. The Ponte Rio-Niterói id is one
 * 45-point motorway segment; read as a ring it was a 1,040 m² sliver. A shared name ties nothing
 * (operator, 2026-10-11). Walks both ends, taking at each end the continuation that turns the least.
 */
export function chainSameIdentity(start: Way, tiedWays: Way[]): LatLng[] {
  const line = (w: Way) => (w.geometry ?? []).map(toLatLng);
  const kind = String(start.tags?.highway ?? start.tags?.railway ?? '');
  const pool = tiedWays.filter(w => String(w.id) !== String(start.id) && (w.geometry?.length ?? 0) >= 2
    && String(w.tags?.highway ?? w.tags?.railway ?? '') === kind)
    .map(line);
  const heading = (a: LatLng, b: LatLng) => Math.atan2(b.lat - a.lat, (b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180));
  const turn = (x: number, y: number) => Math.abs(Math.atan2(Math.sin(x - y), Math.cos(x - y)));
  const extend = (chain: LatLng[]): LatLng[] => {
    for (;;) {
      const end = chain[chain.length - 1];
      const dir = heading(chain[chain.length - 2], end);
      const next = pool
        .map((w, i) => ({ i, w: samePoint(w[0], end) ? w : samePoint(w[w.length - 1], end) ? [...w].reverse() : null }))
        .filter((c): c is { i: number; w: LatLng[] } => c.w !== null)
        .sort((x, y) => turn(heading(x.w[0], x.w[1]), dir) - turn(heading(y.w[0], y.w[1]), dir))[0];
      if (!next) return chain;
      pool.splice(next.i, 1);
      chain = chain.concat(next.w.slice(1));
    }
  };
  return extend([...extend(line(start))].reverse());
}

/**
 * Overpass query for the ways within `aroundM` of `wayId` tied to it by id: carrying its
 * `wikidata`, or members of the waterway or bridge relation it belongs to (a river's segments
 * rarely carry their own wikidata; the river relation does). A route relation is not identity: a
 * bus line crosses the bridge and leaves it.
 */
export function sameIdentityWaysQuery(wayId: string | number, wikidata: string | null | undefined, aroundM: number): string {
  const qid = /^Q\d+$/.test(String(wikidata ?? '').trim()) ? String(wikidata).trim() : '';
  const byWikidata = qid ? `way(around.a:${aroundM})["wikidata"="${qid}"];` : '';
  return `
[out:json][timeout:60];
way(${wayId})->.a;
rel(bw.a)["type"~"^(waterway|bridge)$"]->.r;
(${byWikidata}way(r.r)(around.a:${aroundM}););
out geom;
`;
}

/**
 * Whether the relation half of `sameIdentityWaysQuery` can tie anything to this way: a waterway
 * relation's ways carry `waterway=*` (wiki Relation:waterway), and a bridge relation ties the ways
 * on the bridge (`bridge=*`; wiki Relation:bridge). Any other line — a city wall, a path — has no
 * such relation to be in, and Overpass is not asked for it.
 */
export function mayHaveIdentityRelation(tags: Record<string, unknown> | undefined): boolean {
  return Boolean(tags?.waterway || (tags?.bridge && tags.bridge !== 'no') || tags?.man_made === 'bridge');
}

/** Closed ring of a corridor `halfWidthM` each side of a polyline (offset along vertex normals). */
export function corridorRing(line: LatLng[], halfWidthM: number): LatLng[] {
  if (line.length < 2) return [];
  const lat0 = line[0].lat;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_540;
  const xy = line.map(p => ({ x: p.lng * kx, y: p.lat * ky }));
  const normal = (i: number) => {
    const a = xy[Math.max(0, i - 1)], b = xy[Math.min(xy.length - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    return { x: -dy / len, y: dx / len };
  };
  const side = (sign: number) => xy.map((p, i) => {
    const n = normal(i);
    return { lat: (p.y + sign * n.y * halfWidthM) / ky, lng: (p.x + sign * n.x * halfWidthM) / kx };
  });
  const left = side(1), right = side(-1).reverse();
  return [...left, ...right, left[0]];
}

/** Area ratio under which two rings that agree on the pin are the same footprint (#779). */
export const SAME_FOOTPRINT_AREA_RATIO = 1.25;

/**
 * Two borders are the same footprint when they agree on holding the pin and their areas are
 * within `SAME_FOOTPRINT_AREA_RATIO`. Used to keep a detection that matches the stored reference
 * border, and to drop one that picked another element (Parque Chácara do Jockey: 0.54 ha football
 * pitch against the 16.8 ha park, #779).
 */
export function sameFootprint(a: LatLng[], b: LatLng[], pin: LatLng): boolean {
  if (isPointInPolygon(pin, a) !== isPointInPolygon(pin, b)) return false;
  const [x, y] = [calculatePolygonAreaInM2(a), calculatePolygonAreaInM2(b)];
  return Math.max(x, y) <= SAME_FOOTPRINT_AREA_RATIO * Math.min(x, y);
}

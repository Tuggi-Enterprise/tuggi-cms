/**
 * E1 — which OSM element may be the POI border (docs/arquitetura/cms/motor-de-tp.md,
 * INV-E1a/b/c, BR-AUDIO-010). Pure: no network, no DB. The detector fetches, this decides.
 *
 * Identity and geometry only (operator, 2026-09-27): the name says WHICH element is the POI; no
 * category, geocoder class or type tag (`leisure`, `natural`, `place`, `building`, …) decides
 * whether an element may be its border. Every element that contains the pin and is refused
 * leaves a reason for the trace (E0).
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
}

export interface ChosenBoundary {
  element: OsmAreaElement;
  ring: LatLng[];
  areaM2: number;
}

const normName = (s: unknown): string =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase();

/**
 * The element's own names, normalised (`name`, `name:pt`, `official_name`, `alt_name`,
 * `short_name`; a `;` list is several names). The Maracanã stadium is `name=Estádio Jornalista
 * Mário Filho`, `short_name=Maracanã`: without it the neighbourhood of the same name took the
 * border (#786).
 */
export function elementNames(tags: Tags): string[] {
  return ['name', 'name:pt', 'official_name', 'alt_name', 'short_name']
    .flatMap(k => String(tags?.[k] ?? '').split(';'))
    .map(normName).filter(n => n !== '');
}

/** Identity: the element carries the POI's own name. Compared for identity, never read for kind. */
export function carriesPoiName(tags: Tags, poiName: string | null | undefined): boolean {
  const name = normName(poiName);
  return name !== '' && elementNames(tags).includes(name);
}

/** Joining words that never tell two names apart. */
const NAME_JOINERS = new Set(['a', 'as', 'o', 'os', 'da', 'das', 'de', 'do', 'dos', 'e']);

const nameTokens = (s: unknown): string[] => normName(s).split(' ').filter(t => t !== '' && !NAME_JOINERS.has(t));

/** One edit or one swap of neighbours apart (`matriz`/`martiz`), for words of 5+ letters. */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length] <= 1;
}

/**
 * Akin identity: one of the element's names is the POI's name with at most ONE word swapped on
 * each side and 2+ words shared, typos of one letter forgiven. "Igreja Matriz da Nossa Senhora da
 * Assunção" ~ "Paróquia Nossa Senhora da Assunção Martiz" (Cabo Frio); "Estádio do Maracanã" is
 * not "Maracanã" (one shared word). Weaker than `carriesPoiName`: "Igreja X" ~ "Praça X" too, so
 * the caller also asks the element to be built (`chooseContainingBoundary`, `isBuilt`).
 */
export function akinPoiName(tags: Tags, poiName: string | null | undefined): boolean {
  const poi = nameTokens(poiName);
  if (poi.length < 2) return false;
  return ['name', 'name:pt', 'official_name', 'alt_name', 'short_name']
    .flatMap(k => String(tags?.[k] ?? '').split(';'))
    .some(n => {
      const el = nameTokens(n);
      const shared = poi.filter(t => el.some(u => sameWord(t, u))).length;
      const elShared = el.filter(u => poi.some(t => sameWord(t, u))).length;
      return shared >= 2 && poi.length - shared <= 1 && el.length - elShared <= 1;
    });
}

/**
 * The pin stands on a named element of another name: it is the ground the POI is on (a square,
 * a park, a neighbourhood), not the POI. The Monumento Árvore de Natal took the Praça do Radio
 * Amador (6,008 m²) with the avenue sidewalk in it (#772).
 */
export const NAMED_GROUND_REASON = 'named element of another name: the ground the POI stands on';

/**
 * How far from the pin a border of the POI's identity is looked for when the typed id already
 * gave one (INV-E1c): the Maracanã pin is 17 m off the stadium, on the street (#786). Same
 * widening as the identity match of the name search. Provisional (#775).
 */
export const IDENTITY_NEAR_PIN_M = 50;

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
 * INV-E1a step "OSM that contains the pin", with INV-E1c by identity and geometry:
 * 1. an element carrying the POI's name wins (the smallest, when several do). It need not hold the
 *    pin, only be as plausible as a curated id (`isCuratedBoundaryImplausible`): the Praia da
 *    Reserva pin is on the promenade, off the sand, and a 248 m² kiosk under it took the border;
 * 2. otherwise an UNNAMED element, and only one smaller than the smallest named element of another
 *    name at the pin — whatever holds the ground the POI stands on is not the POI either — and
 *    holding no named place of another name (`namedInside`, BR-POI-009): the unnamed 100 km²
 *    forest of the Maciço da Pedra Branca holds 112 named peaks and was the border of each (#779);
 * 2a. without a node id, an element holding the pin whose name is akin (`akinPoiName`) and that
 *    the buildings layer says is built (`isBuilt`) — the church polygon named "Paróquia …" under the
 *    pin of "Igreja Matriz …" (Cabo Frio); a square of the same name is not built;
 * 3. `namedOnly`: only step 1 applies. A POI with a curated node id has its own identity, because
 *    an unnamed polygon under a bust is the square, not the bust; and a POI whose typed id already
 *    gave a border only gives way to a smaller element of its name (Maracanã, #786).
 * Otherwise only elements holding the pin are judged; without an id the pin is the only evidence.
 */
export function chooseContainingBoundary(
  pin: LatLng,
  poi: {
    name?: string | null;
    namedOnly?: boolean;
    isBuilt?: (ring: LatLng[]) => boolean;
    /** Tags of the named places standing inside the ring (the local DB's nodes). */
    namedInside?: (ring: LatLng[]) => Tags[];
  },
  elements: OsmAreaElement[],
): { chosen?: ChosenBoundary; rejected: BoundaryRejection[] } {
  const rejected: BoundaryRejection[] = [];
  const named: ChosenBoundary[] = [];
  const other: ChosenBoundary[] = [];
  const unnamed: ChosenBoundary[] = [];
  const akin: ChosenBoundary[] = [];
  const seen = new Set<string>();

  for (const el of elements) {
    const key = `${el.type}/${el.id}`;
    if (seen.has(key) || !Array.isArray(el.geometry) || el.geometry.length < 4) continue;
    seen.add(key);
    const points = el.geometry.map(toLatLng);
    const ring = el.type === 'relation' ? outerRing(points, pin) : points;
    if (!isClosed(ring) || isVia(el.tags)) continue;
    const candidate = { element: el, ring, areaM2: calculatePolygonAreaInM2(ring) };
    if (carriesPoiName(el.tags, poi.name)) {
      if (!isCuratedBoundaryImplausible(pin, ring)) named.push(candidate);
      continue;
    }
    if (!isPointInPolygon(pin, ring)) continue;
    if (!poi.namedOnly && poi.isBuilt && akinPoiName(el.tags, poi.name) && poi.isBuilt(ring)) akin.push(candidate);
    else if (elementNames(el.tags).length > 0) other.push(candidate);
    else unnamed.push(candidate);
  }
  const byArea = (a: ChosenBoundary, b: ChosenBoundary) => a.areaM2 - b.areaM2;
  named.sort(byArea);
  if (named[0]) return { chosen: named[0], rejected };
  if (akin.length) return { chosen: akin.sort(byArea)[0], rejected };

  const key = (c: ChosenBoundary) => `${c.element.type}/${c.element.id}`;
  for (const c of other) rejected.push({ element: key(c), reason: NAMED_GROUND_REASON });
  const groundM2 = Math.min(...other.map(c => c.areaM2));
  const fitting: ChosenBoundary[] = [];
  for (const c of unnamed.sort(byArea)) {
    if (poi.namedOnly) rejected.push({ element: key(c), reason: 'unnamed area under a POI with its own node id' });
    else if (c.areaM2 >= groundM2) rejected.push({ element: key(c), reason: `unnamed area ${Math.round(c.areaM2)} m² holds the named ground at the pin` });
    else {
      // Only until one fits: the smallest wins, and a forest's ring is costly to search.
      const held = fitting.length ? undefined
        : poi.namedInside?.(c.ring).find(t => !carriesPoiName(t, poi.name) && !akinPoiName(t, poi.name));
      if (held) rejected.push({ element: key(c), reason: `unnamed area holds "${elementNames(held)[0]}": ${NAMED_GROUND_REASON}` });
      else fitting.push(c);
    }
  }
  return { chosen: fitting[0], rejected };
}

// ── A POI mapped as a line (bridge, promenade) — INV-E1a ───────────────────────

/**
 * Half width of the corridor drawn around a POI mapped as open ways, when the way has no
 * `width` of its own. Two carriageways of a motorway sit within it. Provisional (#775).
 */
export const LINE_CORRIDOR_HALF_WIDTH_M = 15;

type Way = { id: string | number; tags?: Record<string, unknown>; geometry?: Array<{ lat: number; lon?: number; lng?: number }> };

/**
 * The POI's curated way is open: the element is a line, and the POI is the whole run of ways of
 * the same identity (name) and the same via kind that continue it end to end. The Ponte
 * Rio-Niterói id is one 45-point motorway segment; read as a ring it was a 1,040 m² sliver.
 * Walks both ends, taking at each end the continuation that turns the least.
 */
export function chainSameIdentity(start: Way, ways: Way[]): LatLng[] {
  const line = (w: Way) => (w.geometry ?? []).map(toLatLng);
  const names = elementNames(start.tags);
  const kind = String(start.tags?.highway ?? start.tags?.railway ?? '');
  const pool = ways.filter(w => String(w.id) !== String(start.id) && (w.geometry?.length ?? 0) >= 2
    && elementNames(w.tags).some(n => names.includes(n)) && String(w.tags?.highway ?? w.tags?.railway ?? '') === kind)
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
 * Overpass query for the ways around `wayId` carrying one of `names` as `name`/`official_name`,
 * matched regardless of letter case: the same river is "Rio Pavuna" on some ways and "Rio pavuna"
 * on others, and an exact match cut its corridor where the case changes (#779). `chainSameIdentity`
 * compares the names the same way (`elementNames`).
 */
export function sameIdentityWaysQuery(wayId: string | number, names: string[], aroundM: number): string {
  const re = (n: string) => `^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
  const ql = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const sel = names.flatMap(n => ['name', 'official_name'].map(k => `way(around.a:${aroundM})["${k}"~"${ql(re(n))}",i];`));
  return `
[out:json][timeout:60];
way(${wayId})->.a;
(${sel.join('')});
out geom;
`;
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

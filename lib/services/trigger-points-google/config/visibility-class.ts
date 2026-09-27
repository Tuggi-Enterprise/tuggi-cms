/**
 * POI visibility class — BR-AUDIO-010 (the TP fires where the POI is).
 *
 * Engine-agnostic (epic #772): the class comes from PHYSICAL attributes — height,
 * prominence over the terrain, boundary area and shape. No POI name becomes a branch.
 * OSM tags enter only as DATA TABLES (default height when the real one is missing;
 * viewpoint tag), never as an `if`.
 *
 * PROVISIONAL: every number in this file comes from the engine audit (2026-09-27) and has
 * no `BR-*` of its own yet — `produto` registers it (#775). Until then this is their only home.
 */
import { GeoPoint } from '../types/interfaces';

export enum VisibilityClass {
  /** point-like and low (<5 m): bust, plaque, fountain */
  POINT_LOW = 'point_low',
  /** 5–30 m structure */
  STRUCTURE = 'structure',
  /** large, low area: park, square, beach */
  AREA = 'area',
  /** elongated boundary: waterfront, promenade, bridge */
  LINEAR = 'linear',
  /** tall (≥30 m) or prominent over the terrain: visible from afar */
  LANDMARK_HIGH = 'landmark_high',
  /** viewpoint — the tourist goes to it, does not see it from afar */
  VIEWPOINT = 'viewpoint',
}

// ── Classification thresholds (provisional, #775) ──────────────────────────────
export const STRUCTURE_MIN_HEIGHT_M = 5;
export const LANDMARK_MIN_HEIGHT_M = 30;
/** Prominence over the regional base. Below this it is urban SRTM noise. */
export const LANDMARK_MIN_PROMINENCE_M = 100;
export const AREA_MIN_M2 = 10_000;
/** Boundary major axis / minor axis ratio. */
export const LINEAR_MIN_ELONGATION = 4;
/** Minimum major-axis length to count as linear (keeps narrow buildings out). */
export const LINEAR_MIN_LENGTH_M = 150;

// ── Caps ──────────────────────────────────────────────────────────────────────
/** Absolute TP↔POI sanity cap: stops garbage, does not decide product. */
export const SANITY_MAX_TP_DISTANCE_M = 15_000;
/** Tall landmark horizon on flat terrain: visitors approach from ≤2 km. */
export const URBAN_LANDMARK_HORIZON_M = 2_000;
/** Edge band: a TP within this counts as next to the POI (not in the far-TP cap). */
export const EDGE_BAND_M = 100;

export interface ClassLimits {
  /** max distance from the TP to the POI EDGE */
  maxEdgeDistanceM: number;
  /** cap on the TP radius_meters */
  maxRadiusM: number;
  /** max TPs inside the edge band (≤ EDGE_BAND_M) */
  maxTPs: number;
  /** max TPs beyond the edge band */
  maxFarTPs: number;
}

export const CLASS_LIMITS: Record<VisibilityClass, ClassLimits> = {
  [VisibilityClass.POINT_LOW]: { maxEdgeDistanceM: 60, maxRadiusM: 30, maxTPs: 4, maxFarTPs: 0 },
  [VisibilityClass.STRUCTURE]: { maxEdgeDistanceM: 100, maxRadiusM: 40, maxTPs: 6, maxFarTPs: 0 },
  [VisibilityClass.AREA]: { maxEdgeDistanceM: 60, maxRadiusM: 50, maxTPs: 16, maxFarTPs: 0 },
  [VisibilityClass.LINEAR]: { maxEdgeDistanceM: 60, maxRadiusM: 50, maxTPs: 16, maxFarTPs: 0 },
  [VisibilityClass.LANDMARK_HIGH]: { maxEdgeDistanceM: URBAN_LANDMARK_HORIZON_M, maxRadiusM: 100, maxTPs: 8, maxFarTPs: 8 },
  [VisibilityClass.VIEWPOINT]: { maxEdgeDistanceM: 60, maxRadiusM: 30, maxTPs: 4, maxFarTPs: 0 },
};

/**
 * Max edge distance for the class. A landmark on elevated terrain (real prominence)
 * reaches the sanity cap; everything else uses the table.
 */
export function maxEdgeDistanceFor(cls: VisibilityClass, prominenceM = 0): number {
  if (cls === VisibilityClass.LANDMARK_HIGH && prominenceM >= LANDMARK_MIN_PROMINENCE_M) {
    return SANITY_MAX_TP_DISTANCE_M;
  }
  return CLASS_LIMITS[cls].maxEdgeDistanceM;
}

/** Horizon of an unclassified POI (legacy): approach floor. */
export const UNCLASSIFIED_MIN_HORIZON_M = 300;
/** Fan heuristic: a POI of effective height h is visible at ~15·h. */
export const HORIZON_PER_HEIGHT = 15;

/**
 * Visibility fan horizon, measured from the edge.
 * Low/local class: the class cap (no 300 m floor). Tall landmark: 15·h, up to 2 km on
 * flat terrain or up to the sanity cap on prominent terrain.
 */
export function fanHorizonM(a: { cls?: VisibilityClass; effectiveHeightM: number; prominenceM: number }): number {
  const elevated = a.prominenceM >= LANDMARK_MIN_PROMINENCE_M;
  const cap = elevated ? SANITY_MAX_TP_DISTANCE_M : URBAN_LANDMARK_HORIZON_M;
  const byHeight = Math.round(a.effectiveHeightM * HORIZON_PER_HEIGHT);
  if (!a.cls) return Math.max(UNCLASSIFIED_MIN_HORIZON_M, Math.min(cap, byHeight));
  if (a.cls === VisibilityClass.LANDMARK_HIGH) return Math.max(EDGE_BAND_M, Math.min(cap, byHeight));
  return CLASS_LIMITS[a.cls].maxEdgeDistanceM;
}

// ── Ranking ────────────────────────────────────────────────────────────────────
/**
 * Proximity bands (distance to the edge, m). Ranking orders by band first; road type
 * only breaks ties inside a band (BR-AUDIO-010: close beats big road).
 */
export const PROXIMITY_BANDS_M = [30, 60, 100, 200, 500];

/** Band index of an edge distance: 0 = closest; PROXIMITY_BANDS_M.length = beyond all. */
export function proximityBand(edgeDistanceM: number): number {
  const i = PROXIMITY_BANDS_M.findIndex(limit => edgeDistanceM <= limit);
  return i === -1 ? PROXIMITY_BANDS_M.length : i;
}

/** Road-type tie-break inside a proximity band. Values stay below one band step. */
export const ROAD_TYPE_TIEBREAK: Record<string, number> = {
  motorway: 1, trunk: 0.9, primary: 0.8, secondary: 0.7, tertiary: 0.55, residential: 0.4,
  unclassified: 0.3, living_street: 0.25, pedestrian: 0.2, service: 0.15, footway: 0.1, cycleway: 0.1,
};

/**
 * Rank score in [0, 1]: proximity band dominates, road type breaks ties.
 * Any candidate in a closer band scores above every candidate in a farther band.
 */
export function proximityRankScore(edgeDistanceM: number, roadType?: string): number {
  const bands = PROXIMITY_BANDS_M.length + 1;
  const step = 1 / bands;
  const bandScore = (bands - 1 - proximityBand(edgeDistanceM)) * step;
  return bandScore + (ROAD_TYPE_TIEBREAK[roadType ?? ''] ?? 0.05) * step * 0.9;
}

// ── Data tables (OSM tags) ────────────────────────────────────────────────
type TagRow = { key: string; value: string; heightM: number };

/** Default height when OSM has neither `height` nor `building:levels`. */
export const DEFAULT_HEIGHT_BY_TAG: TagRow[] = [
  { key: 'memorial', value: 'bust', heightM: 2.5 },
  { key: 'historic', value: 'memorial', heightM: 2.5 },
  { key: 'memorial', value: 'statue', heightM: 6 },
  { key: 'artwork_type', value: 'statue', heightM: 6 },
  { key: 'historic', value: 'monument', heightM: 12 },
  { key: 'man_made', value: 'obelisk', heightM: 12 },
  { key: 'memorial', value: 'obelisk', heightM: 12 },
  { key: 'building', value: 'chapel', heightM: 10 },
  { key: 'building', value: 'church', heightM: 25 },
  { key: 'building', value: 'cathedral', heightM: 25 },
  { key: 'building', value: 'basilica', heightM: 25 },
  { key: 'man_made', value: 'lighthouse', heightM: 20 },
  { key: 'man_made', value: 'tower', heightM: 30 },
  { key: 'tourism', value: 'viewpoint', heightM: 0 },
  { key: 'historic', value: 'castle', heightM: 20 },
  { key: 'building', value: 'mosque', heightM: 20 },
  { key: 'building', value: 'temple', heightM: 20 },
  { key: 'building', value: 'synagogue', heightM: 20 },
  { key: 'amenity', value: 'cinema', heightM: 12 },
  { key: 'amenity', value: 'theatre', heightM: 12 },
  { key: 'tourism', value: 'museum', heightM: 15 },
  // any other tagged building (`*` matches any value)
  { key: 'building', value: '*', heightM: 10 },
];

/** Height per floor, for `building:levels`. */
export const BUILDING_LEVEL_HEIGHT_M = 4;

/**
 * Natural relief: seen from afar by what it is, even when SRTM smooths its prominence away.
 * Precedes the viewpoint tag — a summit with `tourism=viewpoint` is still a summit seen
 * from the whole neighbourhood (Pico Irmão Menor, #779).
 */
export const NATURAL_RELIEF_TAGS: Array<{ key: string; value: string }> = [
  { key: 'natural', value: 'peak' },
  { key: 'natural', value: 'hill' },
  { key: 'natural', value: 'volcano' },
];

/** Tags that mark a viewpoint. */
export const VIEWPOINT_TAGS: Array<{ key: string; value: string }> = [
  { key: 'tourism', value: 'viewpoint' },
];

/**
 * Tags where the POI is a place the tourist is INSIDE (neighbourhood, island): an area even
 * when OSM only has the node. Read before area/shape because a node has neither.
 */
export const AREA_TAGS: Array<{ key: string; value: string }> = [
  { key: 'place', value: 'suburb' },
  { key: 'place', value: 'neighbourhood' },
  { key: 'place', value: 'quarter' },
  { key: 'place', value: 'city_block' },
  { key: 'place', value: 'locality' },
  { key: 'place', value: 'village' },
  { key: 'place', value: 'hamlet' },
  { key: 'place', value: 'island' },
  { key: 'place', value: 'islet' },
];

/**
 * Tag value. Accepts both OSM (`natural=peak`) and the Nominatim shape stored in
 * `osm_tags` (`class=natural`, `type=peak`).
 */
function tagValue(tags: Record<string, unknown> | undefined, key: string): string {
  const direct = tags?.[key];
  if (direct != null && direct !== '') return String(direct).toLowerCase();
  if (String(tags?.class ?? '').toLowerCase() === key) return String(tags?.type ?? '').toLowerCase();
  return '';
}

function hasTag(tags: Record<string, unknown> | undefined, key: string, value: string): boolean {
  const v = tagValue(tags, key);
  return value === '*' ? v !== '' && v !== 'no' : v === value;
}

/**
 * Default height from DEFAULT_HEIGHT_BY_TAG: the most specific matching row wins
 * (exact value over `*`), then the tallest. null when no row matches.
 */
export function defaultHeightByTag(tags: Record<string, unknown> | undefined): number | null {
  const rows = DEFAULT_HEIGHT_BY_TAG.filter(r => hasTag(tags, r.key, r.value));
  const exact = rows.filter(r => r.value !== '*');
  const pick = exact.length ? exact : rows;
  return pick.length ? Math.max(...pick.map(r => r.heightM)) : null;
}

function parseMeters(raw: unknown): number | null {
  const m = String(raw ?? '').match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Physical POI height: real `height` > `building:levels` × BUILDING_LEVEL_HEIGHT_M >
 * height already known > DEFAULT_HEIGHT_BY_TAG (largest among matching tags).
 */
export function resolveHeightM(
  tags: Record<string, unknown> | undefined,
  knownHeightM?: number
): { heightM: number; source: 'height' | 'levels' | 'known' | 'tag_default' | 'none' } {
  const real = parseMeters(tags?.height);
  if (real) return { heightM: real, source: 'height' };
  const levels = parseMeters(tags?.['building:levels']);
  if (levels) return { heightM: levels * BUILDING_LEVEL_HEIGHT_M, source: 'levels' };
  if (knownHeightM && knownHeightM > 0) return { heightM: knownHeightM, source: 'known' };
  const byTag = defaultHeightByTag(tags);
  if (byTag !== null) return { heightM: byTag, source: 'tag_default' };
  return { heightM: 0, source: 'none' };
}

/**
 * Boundary elongation: ratio of the principal-axis deviations (PCA) and the major-axis
 * length in meters, on a local projection.
 */
export function boundaryShape(coords: GeoPoint[] | undefined): { elongation: number; lengthM: number } {
  if (!coords || coords.length < 3) return { elongation: 1, lengthM: 0 };
  const lat0 = coords.reduce((s, p) => s + p.lat, 0) / coords.length;
  const lng0 = coords.reduce((s, p) => s + p.lng, 0) / coords.length;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_540;
  const pts = coords.map(p => ({ x: (p.lng - lng0) * kx, y: (p.lat - lat0) * ky }));
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { sxx += p.x * p.x; syy += p.y * p.y; sxy += p.x * p.y; }
  sxx /= pts.length; syy /= pts.length; sxy /= pts.length;
  const tr = sxx + syy;
  const disc = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy));
  const l1 = tr / 2 + disc;
  const l2 = Math.max(tr / 2 - disc, 1e-9);
  // major axis: spread of the projections on the principal eigenvector
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const proj = pts.map(p => p.x * ux + p.y * uy);
  return { elongation: Math.sqrt(l1 / l2), lengthM: Math.max(...proj) - Math.min(...proj) };
}

export interface PhysicalAttributes {
  heightM: number;
  /** prominence over the regional base (m); 0 when unknown */
  prominenceM: number;
  /** footprint area; 0 when the boundary is synthetic (BoundaryData.synthetic) */
  areaM2: number;
  /** footprint; omitted when synthetic — a drawn circle has no shape */
  boundary?: GeoPoint[];
  tags?: Record<string, unknown>;
}

export function isNaturalRelief(tags: Record<string, unknown> | undefined): boolean {
  return NATURAL_RELIEF_TAGS.some(t => hasTag(tags, t.key, t.value));
}

/** The single, pure classifier. Order is precedence. */
export function classifyVisibility(a: PhysicalAttributes): VisibilityClass {
  if (isNaturalRelief(a.tags)) return VisibilityClass.LANDMARK_HIGH;
  if (VIEWPOINT_TAGS.some(t => hasTag(a.tags, t.key, t.value))) return VisibilityClass.VIEWPOINT;
  if (a.heightM >= LANDMARK_MIN_HEIGHT_M || a.prominenceM >= LANDMARK_MIN_PROMINENCE_M) {
    return VisibilityClass.LANDMARK_HIGH;
  }
  if (AREA_TAGS.some(t => hasTag(a.tags, t.key, t.value))) return VisibilityClass.AREA;
  const shape = boundaryShape(a.boundary);
  if (shape.elongation >= LINEAR_MIN_ELONGATION && shape.lengthM >= LINEAR_MIN_LENGTH_M) {
    return VisibilityClass.LINEAR;
  }
  if (a.areaM2 >= AREA_MIN_M2) return VisibilityClass.AREA;
  if (a.heightM >= STRUCTURE_MIN_HEIGHT_M) return VisibilityClass.STRUCTURE;
  return VisibilityClass.POINT_LOW;
}

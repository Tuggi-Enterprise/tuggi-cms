/**
 * POI visibility class — BR-AUDIO-010 (the TP fires where the POI is).
 *
 * Engine-agnostic (epic #772): the class comes from what is MEASURED on the POI — height,
 * prominence over the terrain, boundary area and shape. No name, category or type tag
 * (`natural`, `tourism`, `place`, `building`, …) decides class or reach (operator, 2026-09-27):
 * a summit that is not measured prominent, a viewpoint and a church of unknown height are
 * classed by what the terrain and their footprint say.
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
}

// ── Classification thresholds (provisional, #775) ──────────────────────────────
export const STRUCTURE_MIN_HEIGHT_M = 5;
export const LANDMARK_MIN_HEIGHT_M = 30;
/**
 * Share of a footprint that building footprints must cover for the buildings layer to lend the
 * POI its height (INV-E3, #783): the footprint IS a building. Measured on the obstacle lattice
 * (`DemStore#footprintBuildings`): Nilton Santos, Museu do Amanhã 100 %, Igreja de Fátima 83 %;
 * the Maracanã neighbourhood polygon 51 %, Ilha das Cobras 51 %, Manguinhos 39 %, a park 1 %.
 * Provisional (#775).
 */
export const STRUCTURE_BUILT_SHARE_MIN = 0.8;
/**
 * Smallest angle the visible part of the POI must span in the observer's view for the candidate
 * to pass the sight line (INV-E8b, #784). Calibrated on the 36 POIs (#784): the visible candidates
 * leave a gap between ~0.1° and ~0.3° (below it, one aim or a sliver; above it, the POI), and
 * 0.2° is a 35 m object at 10 km. Provisional (#775).
 */
export const MIN_APPARENT_ANGLE_DEG = 0.2;
/**
 * Prominence threshold of a landmark, over the city base AND over the local ring
 * (`LOCAL_BASE_RING_M`). Below this it is urban SRTM noise.
 */
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
/**
 * Edge length of one perimeter sector of an `area`/`linear` POI (INV-E10d): each sector with a
 * street in reach gets a TP. Provisional (#775).
 */
export const PERIMETER_SECTOR_M = 250;

// ── Far candidates of a landmark (E7, INV-E7c) ────────────────────────────────
/** Direction sector seen from the POI; the golden counts coverage in the same 45°. */
export const FAR_SECTOR_DEG = 45;
/**
 * Beyond FINE_SECTOR_FROM_M from the edge the sector narrows to FAR_FINE_SECTOR_DEG: at 2–4 km a
 * 45° sector east of the Irmão Menor holds both the Lagoa and the orla of Ipanema, and one TP per
 * cell went to the Lagoa. Provisional (#775).
 */
export const FAR_FINE_SECTOR_DEG = 22.5;
/** Outer limits of the distance rings beyond EDGE_BAND_M, from the edge. */
export const FAR_RINGS_M = [500, 1_000, 2_000, 4_000, 8_000, SANITY_MAX_TP_DISTANCE_M];
/**
 * Inner rings (up to the last LANDMARK_CELL_RINGS_M): every tourist-street candidate at least
 * FAR_CELL_SPACING_M from the others, so a cell's candidates follow the length of its avenues
 * and promenades (Copacabana, Ipanema, the south shore of the Lagoa); other streets fill up to
 * FAR_CANDIDATES_PER_CELL. Horizon: tourist streets only, FAR_CANDIDATES_PER_CELL per cell —
 * E10 takes nothing else there, and the horizon is the bulk of the sight-line cost.
 */
export const FAR_CANDIDATES_PER_CELL = 6;
/** Min distance between two candidates of the same cell. */
export const FAR_CELL_SPACING_M = 300;

// ── Landmark selection by cell coverage (E10, INV-E10a/c) ─────────────────────
/**
 * Outer limits of the E10 coverage rings of a landmark, from the edge: near, 1–2 km, 2–4 km,
 * and the open-ended horizon beyond. A cell is (`landmarkSectorOf` sector seen from the POI × ring).
 * 2 km splits the two sides of the Lagoa seen from the Cristo; 4 km holds Copacabana and
 * Ipanema. Coarser than FAR_RINGS_M on purpose: E7 rings bound the sight-line work, these decide
 * coverage. Provisional (#775).
 */
export const LANDMARK_CELL_RINGS_M = [1_000, 2_000, 4_000];
export const FINE_SECTOR_FROM_M = LANDMARK_CELL_RINGS_M[1];

/** Sector of a landmark candidate/TP seen from the POI (E7 sampling and E10 cells, one rule). */
export function landmarkSectorOf(bearingFromPoiDeg: number, edgeDistanceM: number): number {
  const width = edgeDistanceM > FINE_SECTOR_FROM_M ? FAR_FINE_SECTOR_DEG : FAR_SECTOR_DEG;
  return Math.floor((((bearingFromPoiDeg % 360) + 360) % 360) / width);
}
/**
 * Where the tourist circulates, by the street's own OSM `highway` (INV-E10a): 0 wins, 2 loses.
 * Tier 0 is where the tourist is, on foot or DRIVING: avenue, promenade, expressway and bridge
 * (the app is used driving, BR-POI-008; whoever crosses the Rio–Niterói bridge sees the Pão de
 * Açúcar). Tier 2 is what nobody travels: the forest track, the path and the service lane.
 * Unknown types sit in the middle. Provisional (#775).
 */
export const LANDMARK_TOURIST_STREET_TYPES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'pedestrian', 'living_street'];
export const LANDMARK_AVOID_STREET_TYPES = ['track', 'path', 'service'];

/**
 * Streets a car does not drive on. A `point_low` next to a car street keeps at least one TP on
 * it: the app is used driving (BR-POI-008), and a TP on the sidewalk only fires on foot (#772).
 */
export const NON_CAR_STREET_TYPES = ['footway', 'path', 'pedestrian', 'steps', 'track', 'service', 'cycleway'];

export function isCarStreet(streetType?: string): boolean {
  return !!streetType && !NON_CAR_STREET_TYPES.includes(streetType);
}

/** `access` values that close a way to the public (#772: Ilha Fiscal's TP sat on the Navy's private dock). */
export const CLOSED_ACCESS_VALUES = ['private', 'no', 'military'];
/** Mode tags that reopen a closed way to someone the app serves (on foot or driving). */
const PUBLIC_MODE_TAGS = ['foot', 'motor_vehicle', 'motorcar', 'vehicle'];
const OPEN_MODE_VALUES = ['yes', 'designated', 'permissive', 'destination'];

/**
 * A way the public may use: no TP on a way closed by `access` (unless a mode tag reopens it) or
 * tagged `military=*` (BR-AUDIO-010: the TP is where the tourist passes). A tag of the WAY, not
 * of the POI: it says where the TP may stand, not what the POI is.
 */
export function isPublicWay(tags?: Record<string, unknown> | null): boolean {
  if (!tags) return true;
  if (String(tags.military ?? '') !== '') return false;
  if (!CLOSED_ACCESS_VALUES.includes(String(tags.access ?? ''))) return true;
  return PUBLIC_MODE_TAGS.some(k => OPEN_MODE_VALUES.includes(String(tags[k] ?? '')));
}

export function landmarkStreetTier(streetType?: string): 0 | 1 | 2 {
  if (LANDMARK_TOURIST_STREET_TYPES.includes(streetType ?? '')) return 0;
  if (LANDMARK_AVOID_STREET_TYPES.includes(streetType ?? '')) return 2;
  return 1;
}

/**
 * Streets of a landmark (E6/E7): every type along the edge up to the last E10 inner ring;
 * beyond it, where E10 takes a tourist street only, those types only, tile by tile
 * (FAR_STREET_TILE_M): every street within 15 km is ~100k rows.
 */
export const FAR_STREETS_FROM_M = LANDMARK_CELL_RINGS_M[LANDMARK_CELL_RINGS_M.length - 1];
export const FAR_STREET_TYPES = LANDMARK_TOURIST_STREET_TYPES;
export const FAR_STREET_TILE_M = 3_000;

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
  // Inner cells (INV-E10a): 8 sectors of 45° in 0–1 and 1–2 km + 16 of 22.5° in 2–4 km = 32;
  // 4 at the edge + 28 beyond. The horizon ring only after every inner cell is spent. The edge
  // band of a landmark is a handful of footways at its base. Provisional (#775).
  [VisibilityClass.LANDMARK_HIGH]: { maxEdgeDistanceM: URBAN_LANDMARK_HORIZON_M, maxRadiusM: 100, maxTPs: 4, maxFarTPs: 28 },
};

/**
 * Max edge distance for the class. A landmark on elevated terrain (real prominence)
 * reaches the sanity cap; everything else uses the table.
 */
export function maxEdgeDistanceFor(cls: VisibilityClass, prominenceM: number | null = 0): number {
  if (cls === VisibilityClass.LANDMARK_HIGH && (prominenceM ?? 0) >= LANDMARK_MIN_PROMINENCE_M) {
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

// ── Height measured on the element ─────────────────────────────────────────

/**
 * Height per floor, for `building:levels` — the ONE floor ruler of the engine (INV-E3). The POI
 * height, the buildings of the fan, the sight-line check and the elevation service all read it
 * through `heightFromTags`. 3 m is the OSM "Simple 3D Buildings" convention for a level.
 * It was ×3, ×3.5 and ×4 in three places.
 */
export const BUILDING_LEVEL_HEIGHT_M = 3;

/**
 * Tag value. Accepts both OSM (`natural=peak`) and the Nominatim shape stored in
 * `osm_tags` (`class=natural`, `type=peak`).
 */
export function tagValue(tags: Record<string, unknown> | undefined, key: string): string {
  const direct = tags?.[key];
  if (direct != null && direct !== '') return String(direct).toLowerCase();
  if (String(tags?.class ?? '').toLowerCase() === key) return String(tags?.type ?? '').toLowerCase();
  return '';
}

function parseMeters(raw: unknown): number | null {
  const m = String(raw ?? '').match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type TagHeightSource = 'height' | 'building:height' | 'levels';

/**
 * Measured height written on the element itself: `height` → `building:height` →
 * `building:levels` × BUILDING_LEVEL_HEIGHT_M. null when none is there. Every building-height
 * reader of the engine goes through here (INV-E3).
 */
export function heightFromTags(
  tags: Record<string, unknown> | undefined | null
): { heightM: number; source: TagHeightSource } | null {
  if (!tags) return null;
  const real = parseMeters(tags.height);
  if (real) return { heightM: real, source: 'height' };
  const building = parseMeters(tags['building:height']);
  if (building) return { heightM: building, source: 'building:height' };
  const levels = parseMeters(tags['building:levels']);
  if (levels) return { heightM: levels * BUILDING_LEVEL_HEIGHT_M, source: 'levels' };
  return null;
}

/** Where a height measured by the buildings layer came from (#783; `dem-store#BuildingHeightSource`). */
export type FootprintHeightSource = 'overture' | '3d-globfp' | 'dem_surface';
export type HeightSource = TagHeightSource | 'known' | FootprintHeightSource | 'none';

/**
 * Physical POI height (INV-E3): measured on the element (`heightFromTags`) → height measured on
 * another OSM element (`knownHeightM`: building aggregation, host) → the buildings layer on the
 * footprint (`footprint`: Overture → 3D-GloBFP → surface − ground; #783) → 0. There is no
 * height by type: a church or a statue with no measured height is 0, and its class comes from
 * the terrain and its footprint (operator, 2026-09-27; BR-AUDIO-010). Pure.
 */
export function resolveHeightM(
  tags: Record<string, unknown> | undefined,
  knownHeightM?: number,
  footprint?: { heightM: number; source: FootprintHeightSource } | null
): { heightM: number; source: HeightSource } {
  const measured = heightFromTags(tags);
  if (measured) return measured;
  if (knownHeightM && knownHeightM > 0) return { heightM: knownHeightM, source: 'known' };
  if (footprint && footprint.heightM > 0) return { heightM: footprint.heightM, source: footprint.source };
  return { heightM: 0, source: 'none' };
}

/**
 * The buildings-layer height a footprint lends the POI (INV-E3, #783): only when the measured
 * buildings cover at least `STRUCTURE_BUILT_SHARE_MIN` of it. Pure.
 */
export function footprintStructureHeight(fp: {
  cells: number;
  builtCells: number;
  heightM: number | null;
  source: FootprintHeightSource | null;
}): { heightM: number; source: FootprintHeightSource } | null {
  if (!fp.cells || fp.heightM === null || !fp.source) return null;
  return fp.builtCells / fp.cells >= STRUCTURE_BUILT_SHARE_MIN ? { heightM: fp.heightM, source: fp.source } : null;
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
  /**
   * Ground at the top of the POI + height − city base (INV-E4b, `prominenceOverCityM`).
   * null when the DEM failed: the class is still decided, never on a silent 0 (INV-E4c/E5c).
   */
  prominenceM: number | null;
  /**
   * Ground at the top of the POI + height − local base (`localBaseElevation`, a ring of
   * LOCAL_BASE_RING_M). A church on a plateau is prominent over the city and not over its
   * neighbourhood (Igreja de Fátima, #772). null/absent = unknown, and then prominence alone
   * does not make a landmark (INV-E5c).
   */
  localProminenceM?: number | null;
  /** footprint area; 0 when the boundary is synthetic (BoundaryData.synthetic) */
  areaM2: number;
  /** footprint; omitted when synthetic — a drawn circle has no shape */
  boundary?: GeoPoint[];
}

/**
 * The rule that decided the class, for the trace (E0). Same precedence as `classifyVisibility`,
 * which is the only caller that turns it into a class.
 */
export type ClassRule =
  | 'landmark_height' | 'landmark_prominence' | 'linear_shape' | 'area_size' | 'structure_height' | 'point_low';

export function visibilityClassRule(a: PhysicalAttributes): { cls: VisibilityClass; rule: ClassRule } {
  if (a.heightM >= LANDMARK_MIN_HEIGHT_M) return { cls: VisibilityClass.LANDMARK_HIGH, rule: 'landmark_height' };
  // Relief is a landmark only when prominent over the city AND its ring, whatever its tags: the
  // Morro do Patronato (91 m over the city, 77 m local) got 32 TPs up to 2.6 km (#772).
  if (isProminentLandmark(a)) return { cls: VisibilityClass.LANDMARK_HIGH, rule: 'landmark_prominence' };
  // A structure of known height is a structure whatever its footprint: the Museu do Amanhã is
  // long and narrow, and it is still a 15 m building seen from the street (#772).
  if (a.heightM >= STRUCTURE_MIN_HEIGHT_M) return { cls: VisibilityClass.STRUCTURE, rule: 'structure_height' };
  const shape = boundaryShape(a.boundary);
  if (shape.elongation >= LINEAR_MIN_ELONGATION && shape.lengthM >= LINEAR_MIN_LENGTH_M) {
    return { cls: VisibilityClass.LINEAR, rule: 'linear_shape' };
  }
  if (a.areaM2 >= AREA_MIN_M2) return { cls: VisibilityClass.AREA, rule: 'area_size' };
  return { cls: VisibilityClass.POINT_LOW, rule: 'point_low' };
}

/** Landmark by relief (INV-E5b): prominent over the city base AND over the local ring. */
export function isProminentLandmark(a: Pick<PhysicalAttributes, 'prominenceM' | 'localProminenceM'>): boolean {
  return a.prominenceM != null && a.prominenceM >= LANDMARK_MIN_PROMINENCE_M
    && a.localProminenceM != null && a.localProminenceM >= LANDMARK_MIN_PROMINENCE_M;
}

/** The single, pure classifier (INV-E5a). Order is precedence. */
export function classifyVisibility(a: PhysicalAttributes): VisibilityClass {
  return visibilityClassRule(a).cls;
}

// ── Elevation and city base (E4, P8) ───────────────────────────────────────────
/** Radius around the city centre sampled for the city base. */
export const CITY_BASE_RADIUS_M = 10_000;
/** Grid step of that sampling (~300 SRTM reads per city, once). */
export const CITY_BASE_GRID_STEP_M = 1_000;
/** Lower quartile of the land samples: the ground the city is built on, not its hills. */
export const CITY_BASE_PERCENTILE = 0.25;
/** Radius of the local ring, from the pin: the neighbourhood the POI must stand out of. */
export const LOCAL_BASE_RING_M = 2_000;
/** Directions sampled on that ring. */
export const LOCAL_BASE_DIRECTIONS = 24;
/** Median of the land samples: the typical ground around, so a plateau counts as ground. */
export const LOCAL_BASE_PERCENTILE = 0.5;
/** A surveyed summit (`natural=peak` with `ele`) this close to the boundary is its top. */
export const SUMMIT_MATCH_M = 60;

// ── Relief footprint (E1, #772) — provisional (#775) ──────────────────────────────
/**
 * A POI with no footprint of its own whose SRTM ground stands this much above the local base
 * (`LOCAL_BASE_RING_M` median) is a hill: its border is the slope, measured on the DEM
 * (`elevation-service#reliefFootprint`). Below it, urban SRTM noise.
 */
export const RELIEF_MIN_M = 30;
/** The slope ends where the terrain has come down this fraction of the relief above the base. */
export const RELIEF_FOOT_FRACTION = 1 / 3;
/** Rays from the pin, step along each, and the cap of a ray (a ridge that never comes down). */
export const RELIEF_RAYS = 24;
export const RELIEF_STEP_M = 30;
export const RELIEF_MAX_RADIUS_M = 1_000;
/** A ray stops at a saddle: the terrain climbs this much above the lowest point it passed. */
export const RELIEF_SADDLE_RISE_M = 5;

/** Lower percentile of the samples above sea level (sea reads 0 in SRTM); null when none. */
export function landPercentile(samples: Array<number | null>, p = CITY_BASE_PERCENTILE): number | null {
  const land = samples.filter((v): v is number => v !== null && Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!land.length) return null;
  return land[Math.floor((land.length - 1) * p)];
}

/**
 * INV-E4b (P8): prominence = ground at the top of the POI + POI height − city base.
 * null when either terrain number is unknown (INV-E4c).
 */
export function prominenceOverCityM(groundTopM: number | null, heightM: number, cityBaseM: number | null): number | null {
  if (groundTopM === null || cityBaseM === null) return null;
  return Math.max(0, groundTopM + heightM - cityBaseM);
}

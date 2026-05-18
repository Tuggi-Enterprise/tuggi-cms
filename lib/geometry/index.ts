/**
 * SSOT geometric/spatial utilities for trigger-point generation.
 *
 * Canonical implementations live in `services/trigger-points-google/utils/calculations.ts`
 * and are re-exported here so new code can import from a single, stable location.
 *
 * New functions added here (not present in calculations.ts) mirror app-side logic
 * (direction zones) and add helpers required by the boundary-segmentation, one-way
 * validation and 2.5D visibility features.
 */

export type GeoPoint = { lat: number; lng: number };
export type Direction = 'front' | 'right' | 'left' | 'back';

export {
  calculateDistance,
  calculateBearing,
  normalizeAngleDifference,
  isInBearingRange,
  isPointInPolygon,
  calculatePolygonArea,
  calculatePolygonAreaInM2,
  calculatePolygonPerimeter,
  calculatePolygonCenter,
  calculateDistanceToPolygon,
  calculateDistanceToLineSegment,
  calculateDistanceToBoundary,
  findNearestBoundaryPoint,
  findClosestPointOnBoundary,
  adjustPointDistance,
  lineIntersectsPolygon,
  extractBuildingHeight,
} from '../services/trigger-points-google/utils/calculations';

import {
  calculateDistance,
  calculateBearing,
  normalizeAngleDifference,
  isPointInPolygon,
} from '../services/trigger-points-google/utils/calculations';

// =====================================================================
// DIRECTION ZONES — MUST mirror tuggi-drive-v2 native logic.
// Android: TriggerDetectionService.kt — direction is computed by comparing
// expectedBearing to userHeading. If the result is "back", the trigger
// is BLOCKED. Keep these ranges in sync with the app.
// =====================================================================

export const DIRECTION_ZONES = {
  front: { min: 325, max: 35 },   // wraps around 0°
  right: { min: 35, max: 135 },
  back:  { min: 135, max: 225 },
  left:  { min: 225, max: 325 },
} as const;

/**
 * Classifies the relative direction of a POI given the user's heading,
 * using the same 4-zone model the mobile app applies.
 *
 * @param expectedBearing  bearing from user/TP toward the POI (0-360)
 * @param userHeading      user's travel direction (0-360)
 * @returns 'front' | 'right' | 'left' | 'back'
 */
export function getDirectionZone(expectedBearing: number, userHeading: number): Direction {
  // delta = how much "off" the POI is relative to user's heading
  const delta = ((expectedBearing - userHeading) % 360 + 360) % 360;

  if (delta >= 325 || delta < 35) return 'front';
  if (delta >= 35 && delta < 135) return 'right';
  if (delta >= 135 && delta < 225) return 'back';
  return 'left';
}

/**
 * Predicts whether the app would FIRE this TP given a user heading.
 * The app blocks `direction === 'back'`, so anything else fires.
 */
export function wouldAppFireTrigger(expectedBearing: number, userHeading: number): boolean {
  return getDirectionZone(expectedBearing, userHeading) !== 'back';
}

// =====================================================================
// STREET-VS-BOUNDARY CLASSIFICATION (for issue 1.8)
// =====================================================================

export type StreetBoundaryRelation = 'internal' | 'border' | 'partial' | 'external';

export interface StreetSegment {
  coordinates: GeoPoint[];
  lengthMeters: number;
}

/**
 * Computes the length in meters of a polyline.
 */
export function polylineLength(coords: GeoPoint[]): number {
  if (coords.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    total += calculateDistance(coords[i], coords[i + 1]);
  }
  return total;
}

/**
 * Splits a street polyline into contiguous segments based on whether each
 * point is inside or outside the boundary polygon.
 *
 * Note: we sample the *vertices* of the street polyline. For sharp boundary
 * crossings between vertices, a single coordinate may straddle in/out — we
 * accept that approximation (street vertices are typically dense enough).
 */
export function splitStreetByBoundary(
  streetCoords: GeoPoint[],
  boundary: GeoPoint[]
): { inside: StreetSegment[]; outside: StreetSegment[] } {
  const inside: StreetSegment[] = [];
  const outside: StreetSegment[] = [];

  if (streetCoords.length === 0) return { inside, outside };

  let currentBucket: 'in' | 'out' = isPointInPolygon(streetCoords[0], boundary) ? 'in' : 'out';
  let currentCoords: GeoPoint[] = [streetCoords[0]];

  for (let i = 1; i < streetCoords.length; i++) {
    const point = streetCoords[i];
    const isInside = isPointInPolygon(point, boundary);
    const bucket: 'in' | 'out' = isInside ? 'in' : 'out';

    if (bucket === currentBucket) {
      currentCoords.push(point);
    } else {
      // flush current segment
      if (currentCoords.length >= 1) {
        const seg: StreetSegment = {
          coordinates: [...currentCoords],
          lengthMeters: polylineLength(currentCoords),
        };
        (currentBucket === 'in' ? inside : outside).push(seg);
      }
      currentBucket = bucket;
      currentCoords = [point];
    }
  }

  // flush last segment
  if (currentCoords.length >= 1) {
    const seg: StreetSegment = {
      coordinates: [...currentCoords],
      lengthMeters: polylineLength(currentCoords),
    };
    (currentBucket === 'in' ? inside : outside).push(seg);
  }

  return { inside, outside };
}

/**
 * Classifies a street's relationship to a POI boundary.
 *
 * - `internal`: street runs mostly INSIDE the boundary (e.g. trails inside a park) → discard TPs
 * - `external`: street has no overlap with the boundary → use normally
 * - `border`: street has only a tiny overlap (boundary "invades" the street) → use externalsegments
 * - `partial`: street straddles in/out significantly → use only external segments
 *
 * The user's case: Ibirapuera boundary expanded slightly into perimeter avenues.
 * The avenue is `border` (or `partial`) — we want TPs on the external portion.
 */
export function classifyStreetVsBoundary(
  streetCoords: GeoPoint[],
  boundary: GeoPoint[],
  thresholds: { internalRatio?: number; borderRatio?: number } = {}
): { relation: StreetBoundaryRelation; insideRatio: number; outsideSegments: StreetSegment[] } {
  const internalRatio = thresholds.internalRatio ?? 0.8;
  const borderRatio = thresholds.borderRatio ?? 0.2;

  const totalLength = polylineLength(streetCoords);
  if (totalLength === 0) {
    return { relation: 'external', insideRatio: 0, outsideSegments: [] };
  }

  const { inside, outside } = splitStreetByBoundary(streetCoords, boundary);
  const insideLength = inside.reduce((sum, s) => sum + s.lengthMeters, 0);
  const ratio = insideLength / totalLength;

  let relation: StreetBoundaryRelation;
  if (ratio === 0) relation = 'external';
  else if (ratio >= internalRatio) relation = 'internal';
  else if (ratio <= borderRatio) relation = 'border';
  else relation = 'partial';

  return { relation, insideRatio: ratio, outsideSegments: outside };
}

// =====================================================================
// STREET TRAVEL DIRECTION (for issue 1.2 — one-way validation)
// =====================================================================

/**
 * Returns the typical user travel direction(s) along a street, in degrees.
 *
 * OSM convention for `oneway`:
 *   - `"yes"` / `"true"` / `"1"`: traffic flows from coords[0] to coords[last]
 *   - `"-1"` / `"reverse"`:        traffic flows from coords[last] to coords[0]
 *   - anything else / undefined:   bidirectional → returns BOTH directions
 *
 * @param coords  street polyline (in OSM order)
 * @param oneway  raw OSM tag value
 * @returns array of bearings (1 entry for one-way, 2 for two-way)
 */
export function getStreetTravelDirections(
  coords: GeoPoint[],
  oneway?: string | null
): number[] {
  if (coords.length < 2) return [];

  const forward = calculateBearing(coords[0], coords[coords.length - 1]);
  const reverse = (forward + 180) % 360;

  const tag = (oneway || '').toLowerCase();

  if (tag === 'yes' || tag === 'true' || tag === '1') return [forward];
  if (tag === '-1' || tag === 'reverse') return [reverse];

  // bidirectional (default) — both directions valid
  return [forward, reverse];
}

/**
 * Given an `expectedBearing` (TP→POI direction) and a street, returns true
 * if at least one travel direction along the street keeps the POI in the
 * user's "front zone" (i.e. the app does NOT classify as "back").
 *
 * Importante: receba o `expectedBearing` já calculado (idealmente com o
 * mesmo target que o `point-calculator` usou — entrada OSM ou centroid).
 * Recalcular aqui via centroid descartaria a precisão do entrance-aware.
 */
export function isApproachableForBearing(
  streetCoords: GeoPoint[],
  oneway: string | null | undefined,
  expectedBearing: number
): boolean {
  const travelDirs = getStreetTravelDirections(streetCoords, oneway);
  if (travelDirs.length === 0) return true; // no info → don't filter
  return travelDirs.some(dir => getDirectionZone(expectedBearing, dir) !== 'back');
}

/**
 * @deprecated Prefer `isApproachableForBearing` to respect entrance-aware bearing.
 * Mantida apenas para callers que não têm o bearing pré-calculado.
 */
export function isApproachableForPOI(
  streetCoords: GeoPoint[],
  oneway: string | null | undefined,
  tpLocation: GeoPoint,
  poiLocation: GeoPoint
): boolean {
  const expectedBearing = calculateBearing(tpLocation, poiLocation);
  return isApproachableForBearing(streetCoords, oneway, expectedBearing);
}

// =====================================================================
// RADIUS CALCULATION
// =====================================================================
//
// IMPORTANTE: o radius do TP NÃO está relacionado à duração do áudio.
// O app `tuggi-drive-v2` toca a narração até o fim mesmo que o usuário
// saia do radius. O radius serve só como **gatilho** — garantir que o
// GPS faz pelo menos uma leitura dentro da zona enquanto o usuário
// passa por ali.
//
// Por isso a fórmula é baseada na janela de amostragem GPS, não em áudio.
// Histórico do produto: radius de 10-50m funciona bem na prática.

/**
 * Computes a radius large enough to catch a GPS sample while the user
 * passes through the trigger zone.
 *
 * Formula: `radius = speed_m_per_s × gpsPingWindowSec × safetyFactor`
 *
 * Examples (with default 3s window, safety 2):
 *   - walking 5 km/h  →  ~8m  (clamped to min ≈ 15-20m)
 *   - city 40 km/h    →  ~67m (clamped to group cap ≈ 50m)
 *   - highway 100 km/h →  ~167m (clamped to HIGH cap 100m)
 *
 * @param streetSpeedKmh    typical speed on the street (OSM maxspeed / inferred)
 * @param gpsPingWindowSec  GPS sampling interval in seconds (default 3)
 * @param safetyFactor      multiplier to cover ping variance (default 2)
 * @param limits            min/max clamping (from per-group caps)
 */
export function calculateGpsAwareRadius(
  streetSpeedKmh: number,
  gpsPingWindowSec: number = 3,
  safetyFactor: number = 2,
  limits: { min?: number; max?: number } = {}
): number {
  const min = limits.min ?? 15;
  const max = limits.max ?? 100;

  const speedMps = streetSpeedKmh / 3.6;
  const radius = speedMps * gpsPingWindowSec * safetyFactor;

  return Math.max(min, Math.min(max, Math.round(radius)));
}

/**
 * @deprecated Use `calculateGpsAwareRadius`. Mantida só para retro-compat —
 * o nome "audio-aware" estava errado: o áudio do app toca até o fim mesmo
 * fora do radius. Veja o comentário acima.
 */
export const calculateAudioAwareRadius = calculateGpsAwareRadius;

/**
 * Infers a typical travel speed (km/h) from an OSM `highway` tag when the
 * explicit `maxspeed` tag is missing.
 *
 * Values are conservative typical speeds for the road class, not legal limits.
 */
export function inferSpeedFromHighwayType(highway?: string | null): number {
  switch ((highway || '').toLowerCase()) {
    case 'motorway':
    case 'motorway_link':
      return 100;
    case 'trunk':
    case 'trunk_link':
      return 80;
    case 'primary':
    case 'primary_link':
      return 60;
    case 'secondary':
    case 'secondary_link':
      return 50;
    case 'tertiary':
    case 'tertiary_link':
      return 40;
    case 'residential':
    case 'unclassified':
    case 'living_street':
      return 30;
    case 'service':
    case 'track':
      return 20;
    case 'pedestrian':
    case 'footway':
    case 'path':
    case 'steps':
      return 5;
    default:
      return 40; // urban-street default
  }
}

/**
 * Parses an OSM `maxspeed` tag string (e.g. "50", "50 km/h", "30 mph") to km/h.
 * Returns null if it can't be parsed.
 */
export function parseMaxspeedKmh(maxspeed?: string | number | null): number | null {
  if (maxspeed == null) return null;
  if (typeof maxspeed === 'number') return maxspeed;

  const str = String(maxspeed).trim().toLowerCase();
  const match = str.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;

  const value = parseFloat(match[1]);
  if (str.includes('mph')) return value * 1.609344;
  return value;
}

/**
 * Resolves the effective speed (km/h) for a street: prefers `maxspeed` tag,
 * falls back to inference from `highway` type.
 */
export function resolveStreetSpeedKmh(
  maxspeed?: string | number | null,
  highway?: string | null
): number {
  const parsed = parseMaxspeedKmh(maxspeed);
  if (parsed != null && parsed > 0) return parsed;
  return inferSpeedFromHighwayType(highway);
}

// =====================================================================
// 2.5D VISIBILITY (for issue 2.2 — building heights from local OSM)
// =====================================================================

/**
 * 2.5D line-of-sight test: returns true if a building of the given height
 * blocks the sight line from TP (with eye height) to POI (with structure top).
 *
 * Geometry:
 *  - We already know the 2D line tp→poi intersects the building polygon
 *    (that check is done by the caller).
 *  - The intersection happens somewhere along the ray; we compute the ray's
 *    altitude at that point via linear interpolation between TP eye height
 *    and POI top height.
 *  - If the building is taller than the ray at that point: BLOCKS.
 *  - Otherwise the line of sight passes ABOVE the building → not blocked.
 *
 * @param tp                  trigger-point location
 * @param tpEyeHeightM        observer eye height (1.5 car, 1.7 pedestrian)
 * @param poi                 POI location
 * @param poiTopHeightM       POI top height ASL (elevation + structure height)
 * @param buildingCentroid    approximate building location (for ray-fraction calc)
 * @param buildingHeightM     building height in meters
 */
export function isSightLineBlockedBy(
  tp: GeoPoint,
  tpEyeHeightM: number,
  poi: GeoPoint,
  poiTopHeightM: number,
  buildingCentroid: GeoPoint,
  buildingHeightM: number
): boolean {
  const totalDist = calculateDistance(tp, poi);
  if (totalDist === 0) return false;

  const distAtBuilding = calculateDistance(tp, buildingCentroid);
  const t = Math.max(0, Math.min(1, distAtBuilding / totalDist));

  const rayAltitudeAtBuilding = tpEyeHeightM + (poiTopHeightM - tpEyeHeightM) * t;

  return buildingHeightM > rayAltitudeAtBuilding;
}

/**
 * Quick helper: building centroid from polygon coords.
 */
export function buildingCentroid(coords: GeoPoint[]): GeoPoint {
  if (coords.length === 0) return { lat: 0, lng: 0 };
  let lat = 0, lng = 0;
  for (const c of coords) { lat += c.lat; lng += c.lng; }
  return { lat: lat / coords.length, lng: lng / coords.length };
}

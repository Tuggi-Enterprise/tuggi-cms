/**
 * Final TP selection for one POI — BR-AUDIO-010 (the TP fires where the POI is).
 *
 * The single place that decides spacing and per-class caps over ALL TPs of a POI,
 * frontal TPs included. Numbers live in config/visibility-class.ts.
 */
import { TriggerPoint } from '../types/interfaces';
import { calculateDistance, isPointInPolygon } from './calculations';
import { EDGE_BAND_M, VisibilityClass, proximityBand, touristCanBeInside } from '../config/visibility-class';
import { isApproachableForBearing } from '../../../geometry';
import { partitionByPoiReach, tpReachCapM } from './validation';

type SelectionClassification = {
  group?: VisibilityClass;
  maxTriggerPoints?: number;
  maxFarTriggerPoints?: number;
  /** class spacing floor (2 × class max radius) */
  minDistanceBetweenTPs?: number;
};

/** Classes whose perimeter is long enough to want one TP per approach direction. */
const DIRECTION_COVERAGE_CLASSES = new Set<VisibilityClass | undefined>([
  VisibilityClass.AREA,
  VisibilityClass.LINEAR,
  VisibilityClass.LANDMARK_HIGH,
  undefined,
]);
const COVERAGE_SLICES = 16;

/**
 * Min distance between two TPs: their GPS circles never overlap, it grows with range, and
 * it never goes below the class floor. With 15 m radii the floor was 30 m and the Museu do
 * Amanhã got 16 TPs in 200 m of waterfront (#779).
 */
export function minSpacingM(
  a: Pick<TriggerPoint, 'radius' | 'distance'>,
  b: Pick<TriggerPoint, 'radius' | 'distance'>,
  classFloorM = 0
): number {
  return Math.max(2 * a.radius, 2 * b.radius, 0.1 * Math.max(a.distance, b.distance), classFloorM);
}

/**
 * Picks TPs ranked by proximity band to the edge (then quality), keeping ≥2r between
 * every pair and the class caps (near band / far). Long-perimeter classes first take the
 * best TP of each approach direction.
 */
export function selectSpacedTriggerPoints(
  tps: TriggerPoint[],
  classification?: SelectionClassification | null
): TriggerPoint[] {
  const ranked = [...tps].sort((a, b) =>
    proximityBand(a.distance) - proximityBand(b.distance) || b.quality - a.quality
  );
  const maxNear = classification?.maxTriggerPoints ?? Infinity;
  const maxFar = classification?.maxFarTriggerPoints ?? (classification ? 0 : Infinity);
  const classFloorM = classification?.minDistanceBetweenTPs ?? 0;
  const accepted: TriggerPoint[] = [];
  let near = 0;
  let far = 0;

  const tryAccept = (tp: TriggerPoint): boolean => {
    if (accepted.includes(tp)) return false;
    const isFar = tp.distance > EDGE_BAND_M;
    if (isFar ? far >= maxFar : near >= maxNear) return false;
    if (accepted.some(a => calculateDistance(a.location, tp.location) < minSpacingM(a, tp, classFloorM))) return false;
    accepted.push(tp);
    if (isFar) far++; else near++;
    return true;
  };

  // Far TPs (the landmark seen from afar) go to DIFFERENT sides of the POI: the best one
  // first, then always the candidate whose bearing is farthest from the far TPs already
  // taken. By rank alone all of them landed in the closest neighbourhood (Cristo: 4 far TPs
  // around the Lagoa, none in Botafogo or Copacabana — #779).
  if (Number.isFinite(maxFar) && maxFar > 0) {
    const pool = ranked.filter(tp => tp.distance > EDGE_BAND_M);
    const farBearings: number[] = [];
    const gap = (b: number) => farBearings.length === 0
      ? 0
      : Math.min(...farBearings.map(f => { const d = Math.abs(((b - f) % 360 + 360) % 360); return Math.min(d, 360 - d); }));
    while (far < maxFar && pool.length) {
      const order = pool
        .map((tp, rank) => ({ tp, rank, gap: gap(tp.expectedBearing) }))
        .sort((a, b) => b.gap - a.gap || a.rank - b.rank);
      const hit = order.find(o => tryAccept(o.tp));
      if (!hit) break;
      farBearings.push(hit.tp.expectedBearing);
      pool.splice(pool.indexOf(hit.tp), 1);
    }
  }

  if (DIRECTION_COVERAGE_CLASSES.has(classification?.group)) {
    const sliceDeg = 360 / COVERAGE_SLICES;
    const sliceOf = (bearing: number) => Math.floor((((bearing % 360) + 360) % 360) / sliceDeg);
    for (let s = 0; s < COVERAGE_SLICES; s++) {
      const best = ranked.find(tp => sliceOf(tp.expectedBearing) === s);
      if (best) tryAccept(best);
    }
  }
  for (const tp of ranked) tryAccept(tp);

  return accepted.sort((a, b) =>
    proximityBand(a.distance) - proximityBand(b.distance) || b.quality - a.quality
  );
}

/**
 * Post-condition: drops TPs that fire for no legal traffic direction — a one-way
 * stretch whose only direction puts the POI behind the driver. Read by the local
 * tangent at the TP. Bidirectional streets and TPs without street data pass.
 */
export function dropUnfireable(tps: TriggerPoint[]): TriggerPoint[] {
  return tps.filter(tp => {
    const coords = tp.street?.fullCoordinates?.length ? tp.street.fullCoordinates : tp.street?.coordinates;
    const oneway = (tp.street as any)?.tags?.oneway as string | undefined;
    if (!coords || coords.length < 2 || !oneway) return true;
    return isApproachableForBearing(coords, oneway, tp.expectedBearing, tp.location);
  });
}

type LatLng = { lat: number; lng: number };

/**
 * Post-condition: no TP inside the POI boundary, nor inside the building that hosts the POI
 * (a room or a shop inside a larger building) — it would fire inside the building or on the
 * statue. Exception: AREA and open spaces (beach, park), where the tourist is inside
 * (BR-AUDIO-010, #779: Cidade das Artes and a bust had TPs inside their boundary).
 */
export function dropInsidePoi<T extends { location: LatLng }>(
  tps: T[],
  boundary?: {
    coordinates?: LatLng[];
    synthetic?: boolean;
    center?: LatLng;
    classification?: { group?: VisibilityClass };
    osmTags?: Record<string, unknown>;
    buildings?: Array<{ geometry?: Array<{ lat: number; lng?: number; lon?: number }> }>;
  } | null
): T[] {
  if (!boundary || touristCanBeInside(boundary.classification?.group, boundary.osmTags)) return tps;
  const rings: LatLng[][] = [];
  // A synthetic circle is not the footprint: a TP 30 m from a memorial inside a drawn 50 m
  // circle is in front of it, not inside it.
  if (!boundary.synthetic && boundary.coordinates && boundary.coordinates.length >= 3) rings.push(boundary.coordinates);
  if (boundary.center) {
    for (const b of boundary.buildings ?? []) {
      const ring = (b.geometry ?? []).map(c => ({ lat: c.lat, lng: (c.lng ?? c.lon) as number }));
      if (ring.length >= 3 && isPointInPolygon(boundary.center, ring)) { rings.push(ring); break; }
    }
  }
  return tps.filter(tp => !rings.some(r => isPointInPolygon(tp.location, r)));
}

export type TpDropReason = 'beyond_reach' | 'unfireable' | 'inside_poi';

type PostConditionBoundary = NonNullable<Parameters<typeof dropInsidePoi>[1]> & {
  classification?: { group?: VisibilityClass; maxEdgeDistanceM?: number };
};

/**
 * E11 post-conditions (INV-E11, BR-AUDIO-010): the ONE step that decides which TPs are
 * written. The save (`poi-migration-pipeline`), the API routes that save, the dry-run
 * (`tp-dry-run`) and the engine itself call it, so a dry-run number predicts the save.
 * Order: reach cap (`tpReachCapM`, measured to the edge) → fires in a legal direction →
 * not inside the POI.
 */
export function applyTpPostConditions<T extends TriggerPoint>(
  tps: T[],
  poiPin: LatLng,
  boundary?: PostConditionBoundary | null
): { kept: T[]; dropped: Array<{ tp: T; reason: TpDropReason }>; reachCapM: number } {
  const reachCapM = tpReachCapM(boundary?.classification);
  const reach = partitionByPoiReach(tps, tp => tp.location, poiPin, boundary?.coordinates, reachCapM);
  const dropped: Array<{ tp: T; reason: TpDropReason }> = reach.dropped.map(d => ({ tp: d.item, reason: 'beyond_reach' }));
  const fireable = dropUnfireable(reach.kept) as T[];
  for (const tp of reach.kept) if (!fireable.includes(tp)) dropped.push({ tp, reason: 'unfireable' });
  const kept = dropInsidePoi(fireable, boundary);
  for (const tp of fireable) if (!kept.includes(tp)) dropped.push({ tp, reason: 'inside_poi' });
  return { kept, dropped, reachCapM };
}

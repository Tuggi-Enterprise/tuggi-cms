/**
 * Final TP selection for one POI — BR-AUDIO-010 (the TP fires where the POI is).
 *
 * The single place that decides spacing and per-class caps over ALL TPs of a POI,
 * frontal TPs included. Numbers live in config/visibility-class.ts.
 */
import { TriggerPoint } from '../types/interfaces';
import { calculateDistance } from './calculations';
import { EDGE_BAND_M, VisibilityClass, proximityBand } from '../config/visibility-class';
import { isApproachableForBearing } from '../../../geometry';

type SelectionClassification = {
  group?: VisibilityClass;
  maxTriggerPoints?: number;
  maxFarTriggerPoints?: number;
};

/** Classes whose perimeter is long enough to want one TP per approach direction. */
const DIRECTION_COVERAGE_CLASSES = new Set<VisibilityClass | undefined>([
  VisibilityClass.AREA,
  VisibilityClass.LINEAR,
  VisibilityClass.LANDMARK_HIGH,
  undefined,
]);
const COVERAGE_SLICES = 16;

/** Min distance between two TPs: their GPS circles never overlap, and it grows with range. */
export function minSpacingM(a: Pick<TriggerPoint, 'radius' | 'distance'>, b: Pick<TriggerPoint, 'radius' | 'distance'>): number {
  return Math.max(2 * a.radius, 2 * b.radius, 0.1 * Math.max(a.distance, b.distance));
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
  const accepted: TriggerPoint[] = [];
  let near = 0;
  let far = 0;

  const tryAccept = (tp: TriggerPoint): void => {
    if (accepted.includes(tp)) return;
    const isFar = tp.distance > EDGE_BAND_M;
    if (isFar ? far >= maxFar : near >= maxNear) return;
    if (accepted.some(a => calculateDistance(a.location, tp.location) < minSpacingM(a, tp))) return;
    accepted.push(tp);
    if (isFar) far++; else near++;
  };

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

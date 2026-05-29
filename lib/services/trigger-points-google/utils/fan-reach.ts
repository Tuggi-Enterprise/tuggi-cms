/**
 * Phase 2.A — Cap-by-visibility helper.
 *
 * Returns the maximum visibility distance from the POI in a given bearing,
 * derived from the union of per-sample-point fan polygons. Used by the
 * validator to reject candidates that lie beyond what the fan considers
 * physically visible in their direction.
 *
 * Fan construction (see visibility-map-builder.ts buildFan): for each sample
 * point along the boundary, N rays are cast in evenly-spaced bearings; each
 * ray's terminus is a polygon vertex. So the distance from sample-point[i]
 * to polygon[i][b] is how far the POI is visible from sample-point[i] in the
 * direction matching bearing index b. We take the MAX across all sample
 * points: the fan is the UNION of those polygons, so if ANY sample point can
 * see at distance D in bearing B, the POI is visible at (B, D).
 *
 * Resolution: directionCount equals (polygon.length - 1) because buildPolygon
 * closes the ring by repeating the first vertex. At 72 bearings the angular
 * resolution is 5°; we round to the nearest bucket (no interpolation) since
 * the fan itself is already discretized at that resolution.
 *
 * Returns Infinity when no fan is available — caller should treat this as
 * "no constraint" so existing code paths keep working.
 */
import { GeoPoint } from '../types/interfaces';
import { calculateDistance } from './calculations';

type FanLike = {
  polygons?: GeoPoint[][];
  samplePoints?: GeoPoint[];
};

export function getFanReachAtBearing(fan: FanLike | undefined, bearingDeg: number): number {
  if (!fan?.polygons?.length || !fan.samplePoints?.length) return Infinity;
  const normalized = ((bearingDeg % 360) + 360) % 360;

  let maxReach = 0;
  for (let s = 0; s < fan.samplePoints.length; s++) {
    const polygon = fan.polygons[s];
    const samplePoint = fan.samplePoints[s];
    if (!polygon || polygon.length < 2 || !samplePoint) continue;

    const directionCount = polygon.length - 1; // closing vertex
    if (directionCount <= 0) continue;

    const idx = Math.round((normalized / 360) * directionCount) % directionCount;
    const vertex = polygon[idx];
    if (!vertex) continue;

    const reach = calculateDistance(samplePoint, vertex);
    if (reach > maxReach) maxReach = reach;
  }

  return maxReach;
}

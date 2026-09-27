/**
 * Final TP selection for one POI — BR-AUDIO-010 (the TP fires where the POI is).
 *
 * The single place that decides spacing and per-class caps over ALL TPs of a POI,
 * frontal TPs included. Numbers live in config/visibility-class.ts.
 */
import { TriggerPoint } from '../types/interfaces';
import { calculateBearing, calculateDistance, calculateDistanceToPolygon } from './calculations';
import { EDGE_BAND_M, LANDMARK_CELL_RINGS_M, VisibilityClass, landmarkSectorOf, landmarkStreetTier, proximityBand } from '../config/visibility-class';
import { isApproachableForBearing } from '../../../geometry';
import { partitionByPoiReach, poiEdgeRing, tpReachCapM } from './validation';

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

type LatLng = { lat: number; lng: number };

/** E10 cell of a landmark TP: sector seen from the POI × ring of edge distance (INV-E10a). */
export function landmarkCellOf(tp: Pick<TriggerPoint, 'location' | 'distance' | 'expectedBearing'>, centre?: LatLng | null) {
  const fromPoi = centre ? calculateBearing(centre, tp.location) : tp.expectedBearing + 180;
  const sector = landmarkSectorOf(fromPoi, tp.distance);
  const ring = LANDMARK_CELL_RINGS_M.findIndex(r => tp.distance <= r);
  return { sector, ring: ring === -1 ? LANDMARK_CELL_RINGS_M.length : ring };
}

/**
 * Picks the TPs of one POI, keeping the spacing and the class caps (near band / far) in one
 * pass over ALL its TPs (INV-E10b). `why`, when given, gets the E10 reason of every TP.
 *
 * - `landmark_high` (INV-E10a/c): coverage first. One TP per cell (sector × ring) before any
 *   second TP in the same cell; inside the cell the street where the tourist circulates wins
 *   (`landmarkStreetTier`), then quality. Cells are walked by the tier of their best street,
 *   then ring by ring, so the cap cuts the cells without a tourist street first. The open-ended
 *   horizon ring comes only after every inner cell, and only on a tourist street. By proximity first, the Cristo had its TPs in the forest and none in
 *   Botafogo or Copacabana (#772).
 * - Other classes: proximity band to the edge first, then quality; long-perimeter classes first
 *   take the best TP of each approach direction.
 */
export function selectSpacedTriggerPoints(
  tps: TriggerPoint[],
  classification?: SelectionClassification | null,
  centre?: LatLng | null,
  why?: Map<TriggerPoint, string>
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

  const tryAccept = (tp: TriggerPoint): 'won' | 'cap' | 'spacing' | 'taken' => {
    if (accepted.includes(tp)) return 'taken';
    const isFar = tp.distance > EDGE_BAND_M;
    if (isFar ? far >= maxFar : near >= maxNear) return 'cap';
    if (accepted.some(a => calculateDistance(a.location, tp.location) < minSpacingM(a, tp, classFloorM))) return 'spacing';
    accepted.push(tp);
    if (isFar) far++; else near++;
    return 'won';
  };

  if (classification?.group === VisibilityClass.LANDMARK_HIGH) {
    const cells = new Map<string, TriggerPoint[]>();
    const label = new Map<TriggerPoint, string>();
    for (const tp of tps) {
      const { sector, ring } = landmarkCellOf(tp, centre);
      const key = `${ring}:${sector}`;
      label.set(tp, `cell s${sector}/r${ring}; tier ${landmarkStreetTier(tp.street?.type)} ${tp.street?.type || '?'}`);
      (cells.get(key) ?? cells.set(key, []).get(key)!).push(tp);
    }
    const tierOf = (t: TriggerPoint) => landmarkStreetTier(t.street?.type);
    for (const cell of cells.values()) cell.sort((a, b) => tierOf(a) - tierOf(b) || b.quality - a.quality);
    // Cells whose best street is a tourist street first, then ring, then sector: when the cap
    // cuts, it cuts the track- and service-only cells, not Copacabana (#772).
    const byTierRingSector = (a: string, b: string) => {
      const [ra, sa] = a.split(':').map(Number);
      const [rb, sb] = b.split(':').map(Number);
      return tierOf(cells.get(a)![0]) - tierOf(cells.get(b)![0]) || ra - rb || sa - sb;
    };
    // The open-ended outer ring (the horizon, up to the sanity cap) only after every inner cell
    // is spent, and only on a tourist street: measured on the Rio sample it held the bridge,
    // a footway on an island and the far side of the bay, while Ipanema waited for a 2nd TP.
    const outer = String(LANDMARK_CELL_RINGS_M.length);
    const tierRank = new Map([...cells].map(([k, c]) => [k, tierOf(c[0])]));
    const ringOf = (k: string) => Number(k.split(':')[0]);
    const sectorOf = (k: string) => Number(k.split(':')[1]);
    const keys = [...cells.keys()].sort(byTierRingSector);
    const lost = new Map<TriggerPoint, string>();
    for (const phase of [keys.filter(k => !k.startsWith(`${outer}:`)), keys.filter(k => k.startsWith(`${outer}:`))]) {
      const isOuter = phase[0]?.startsWith(`${outer}:`);
      // Pass k gives each cell its k-th TP: every covered cell before any cell gets a second one.
      // From pass 2 on, the outer rings first: a second TP 3 km out (Ipanema seen from the Irmão
      // Menor, Copacabana from the Cristo) is where the tourist is; a second one on the slope is not.
      const secondPass = [...phase].sort((a, b) => tierRank.get(a)! - tierRank.get(b)! || ringOf(b) - ringOf(a) || sectorOf(a) - sectorOf(b));
      for (let pass = 1; phase.some(k => cells.get(k)!.length); pass++) {
        for (const key of pass === 1 ? phase : secondPass) {
          const cell = cells.get(key)!;
          while (cell.length) {
            const tp = cell.shift()!;
            const r = isOuter && tierOf(tp) > 0 ? 'horizon needs a tourist street' : tryAccept(tp);
            if (r === 'won') { why?.set(tp, `${label.get(tp)}; won pass ${pass}${isOuter ? ' (horizon)' : ''}`); break; }
            lost.set(tp, `lost: ${r}`);
          }
        }
      }
    }
    for (const tp of tps) if (!why?.has(tp)) why?.set(tp, `${label.get(tp)}; ${lost.get(tp) ?? 'lost'}`);
  } else {
    if (DIRECTION_COVERAGE_CLASSES.has(classification?.group)) {
      const sliceDeg = 360 / COVERAGE_SLICES;
      const sliceOf = (bearing: number) => Math.floor((((bearing % 360) + 360) % 360) / sliceDeg);
      for (let s = 0; s < COVERAGE_SLICES; s++) {
        const best = ranked.find(tp => sliceOf(tp.expectedBearing) === s);
        if (best) tryAccept(best);
      }
    }
    for (const tp of ranked) tryAccept(tp);
  }

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

/**
 * Post-condition (INV-E11): no TP inside the POI boundary, nor inside the building that hosts
 * the POI (a room or a shop inside a larger building), in ANY class. Whoever is inside hears the
 * POI through the boundary (BR-AUDIO-009, BR-AUDIO-013); the TP serves whoever is outside
 * (operator, 2026-09-27). A TP ON the edge counts as inside.
 */
export function dropInsidePoi<T extends { location: LatLng }>(
  tps: T[],
  boundary?: {
    coordinates?: LatLng[];
    synthetic?: boolean;
    center?: LatLng;
    classification?: { group?: VisibilityClass };
    buildings?: Array<{ geometry?: Array<{ lat: number; lng?: number; lon?: number }> }>;
  } | null
): T[] {
  if (!boundary) return tps;
  const rings: LatLng[][] = [];
  // A synthetic circle is not the footprint (INV-E1b): a TP 30 m from a memorial inside a drawn
  // 50 m circle is in front of it, not inside it.
  const edge = poiEdgeRing(boundary);
  if (edge) rings.push(edge);
  if (boundary.center) {
    for (const b of boundary.buildings ?? []) {
      const ring = (b.geometry ?? []).map(c => ({ lat: c.lat, lng: (c.lng ?? c.lon) as number }));
      if (ring.length >= 3 && calculateDistanceToPolygon(boundary.center, ring) === 0) { rings.push(ring); break; }
    }
  }
  return tps.filter(tp => !rings.some(r => calculateDistanceToPolygon(tp.location, r) < ON_EDGE_M));
}

/** A TP closer than this to the edge is ON it, and counts as inside (INV-E11). Provisional (#775). */
export const ON_EDGE_M = 1;

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
  const reach = partitionByPoiReach(tps, tp => tp.location, poiPin, poiEdgeRing(boundary), reachCapM);
  const dropped: Array<{ tp: T; reason: TpDropReason }> = reach.dropped.map(d => ({ tp: d.item, reason: 'beyond_reach' }));
  const fireable = dropUnfireable(reach.kept) as T[];
  for (const tp of reach.kept) if (!fireable.includes(tp)) dropped.push({ tp, reason: 'unfireable' });
  const kept = dropInsidePoi(fireable, boundary);
  for (const tp of fireable) if (!kept.includes(tp)) dropped.push({ tp, reason: 'inside_poi' });
  return { kept, dropped, reachCapM };
}

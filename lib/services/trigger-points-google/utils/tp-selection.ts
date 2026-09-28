/**
 * Final TP selection for one POI — BR-AUDIO-010 (the TP fires where the POI is).
 *
 * The single place that decides spacing and per-class caps over ALL TPs of a POI,
 * frontal TPs included. Numbers live in config/visibility-class.ts.
 */
import { StreetData, TriggerPoint } from '../types/interfaces';
import { calculateBearing, calculateDistance, calculateDistanceToPolygon, closestPointOnSegment } from './calculations';
import { EDGE_BAND_M, LANDMARK_CELL_RINGS_M, PERIMETER_SECTOR_M, SANITY_MAX_TP_DISTANCE_M, VisibilityClass, isCarStreet, landmarkSectorOf, landmarkStreetTier, proximityBand, proximityRankScore } from '../config/visibility-class';
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
/** Classes covered by perimeter sector when they have a real edge (INV-E10d). */
const PERIMETER_COVERAGE_CLASSES = new Set<VisibilityClass | undefined>([VisibilityClass.AREA, VisibilityClass.LINEAR]);

/** Arc length (m) from the first vertex of `ring` to the edge point closest to `p`. */
export function perimeterPositionM(p: LatLng, ring: LatLng[]): number {
  let best = Infinity;
  let at = 0;
  let walked = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const seg = calculateDistance(ring[i], ring[i + 1]);
    const foot = closestPointOnSegment(p, ring[i], ring[i + 1]);
    const d = calculateDistance(p, foot.point);
    if (d < best) { best = d; at = walked + foot.t * seg; }
    walked += seg;
  }
  return at;
}

/**
 * Perimeter sectors of an `area`/`linear` edge (INV-E10d): `PERIMETER_SECTOR_M` of edge each,
 * equal length, at least one. Returns the sector count and the sector of a point.
 */
export function perimeterSectors(ring: LatLng[]): { count: number; sectorOf: (p: LatLng) => number; offMidM: (p: LatLng) => number } {
  let perimeter = 0;
  for (let i = 0; i < ring.length - 1; i++) perimeter += calculateDistance(ring[i], ring[i + 1]);
  const count = Math.max(1, Math.round(perimeter / PERIMETER_SECTOR_M));
  const len = perimeter / count;
  const sectorOf = (p: LatLng) => (perimeter > 0 ? Math.min(count - 1, Math.floor(perimeterPositionM(p, ring) / len)) : 0);
  return {
    count,
    sectorOf,
    /** arc distance from the point's edge position to the middle of its sector */
    offMidM: p => Math.abs(perimeterPositionM(p, ring) - (sectorOf(p) + 0.5) * len),
  };
}

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
 *   horizon ring comes only after every inner cell with more than a trail, and only on a tourist
 *   street; the cells with only a trail come last (#784). By proximity first, the Cristo had its
 *   TPs in the forest and none in Botafogo or Copacabana (#772).
 * - Other classes: proximity band to the edge first, then quality; long-perimeter classes first
 *   take the best TP of each approach direction.
 */
export function selectSpacedTriggerPoints(
  tps: TriggerPoint[],
  classification?: SelectionClassification | null,
  centre?: LatLng | null,
  why?: Map<TriggerPoint, string>,
  edgeRing?: LatLng[] | null
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

  const tryAccept = (tp: TriggerPoint, overCap = false): 'won' | 'cap' | 'spacing' | 'taken' => {
    if (accepted.includes(tp)) return 'taken';
    const isFar = tp.distance > EDGE_BAND_M;
    if (!overCap && (isFar ? far >= maxFar : near >= maxNear)) return 'cap';
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
    // The cells with only a trail (tier 2) after the horizon (#784): with the upper half of the
    // relief as an aim, the trails on the slope under the Mirante took the cap from the
    // motorways at 5–8 km that the operator had approved.
    const isOuterKey = (k: string) => k.startsWith(`${outer}:`);
    const phases = [
      keys.filter(k => !isOuterKey(k) && tierRank.get(k)! < 2),
      keys.filter(isOuterKey),
      keys.filter(k => !isOuterKey(k) && tierRank.get(k)! === 2),
    ];
    for (const phase of phases) {
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
    const perimeterRing = PERIMETER_COVERAGE_CLASSES.has(classification?.group) && edgeRing && edgeRing.length >= 4 ? edgeRing : undefined;
    if (perimeterRing) {
      // INV-E10d: every perimeter sector with a candidate in reach gets one TP, above the class
      // cap — a cap by count left the Lagoa with 1 km of Av. Borges de Medeiros bare. Inside the
      // spacing is a physical floor, never waived.
      const { count, sectorOf, offMidM } = perimeterSectors(perimeterRing);
      const bySector = new Map<number, TriggerPoint[]>();
      for (const tp of ranked) {
        const k = sectorOf(tp.location);
        (bySector.get(k) ?? bySector.set(k, []).get(k)!).push(tp);
      }
      // Inside a sector, a car street first (BR-POI-008: the app is used driving), then the
      // candidate nearest the middle of the sector's arc: picked at the sector's end, it took the
      // spacing of the next sector's only candidates (Estádio Nilton Santos, #772). The sectors
      // with the fewest candidates choose first: they cannot give way.
      const mid = new Map(ranked.map(tp => [tp, offMidM(tp.location)]));
      const car = (tp: TriggerPoint) => (isCarStreet(tp.street?.type) ? 0 : 1);
      for (const cands of bySector.values()) cands.sort((a, b) => car(a) - car(b) || mid.get(a)! - mid.get(b)!);
      for (const [k, cands] of [...bySector].sort((a, b) => a[1].length - b[1].length || a[0] - b[0])) {
        for (const tp of cands) {
          const r = tryAccept(tp, true);
          if (r === 'won') { why?.set(tp, `${tp.street?.type || '?'}; perimeter sector ${k + 1}/${count}; won`); break; }
        }
      }
    } else if (DIRECTION_COVERAGE_CLASSES.has(classification?.group)) {
      const sliceDeg = 360 / COVERAGE_SLICES;
      const sliceOf = (bearing: number) => Math.floor((((bearing % 360) + 360) % 360) / sliceDeg);
      for (let s = 0; s < COVERAGE_SLICES; s++) {
        const best = ranked.find(tp => sliceOf(tp.expectedBearing) === s);
        if (best) tryAccept(best);
      }
    }
    // `point_low`: the closest car-street candidate goes first, so it wins spacing against a
    // sidewalk one (BR-POI-008, #772 — Árvore de Natal kept only the sidewalk at 12 m).
    const carFirst = classification?.group === VisibilityClass.POINT_LOW ? ranked.find(tp => isCarStreet(tp.street?.type)) : undefined;
    if (carFirst) why?.set(carFirst, `${carFirst.street?.type}; car street first: ${tryAccept(carFirst)}`);
    for (const tp of ranked) {
      const r = tryAccept(tp);
      if (!why?.has(tp)) why?.set(tp, `${tp.street?.type || '?'}; ${r === 'won' || r === 'taken' ? 'won' : `lost: ${r}`}`);
    }
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

/** generationMethod of the one TP emitted when nothing survived the class reach (INV-E11b). */
export const REACH_RESCUE_METHOD = 'reach_rescue' as const;

/** Spacing of the points sampled along a street when looking for its closest point outside the POI. */
const RESCUE_SAMPLE_STEP_M = 5;

/**
 * INV-E11b (#772, BR-AUDIO-010): a POI with a real border never ends with 0 TPs. When nothing
 * survived the class reach, the rescue takes the best street point OUTSIDE the border —
 * `proximityRankScore` (closer band first, road type breaks ties), then the smaller distance.
 * Pure: the caller passes streets already filtered for access. Ilha das Cobras: water all
 * around, the only bridge a military `service` way, the nearest public street 120 m from the
 * edge against an `area` reach of 60 m — every candidate died and the POI had no TP.
 */
export function bestStreetPointOutside(
  streets: StreetData[],
  ring: LatLng[]
): { street: StreetData; point: LatLng; edgeDistanceM: number } | null {
  let best: { street: StreetData; point: LatLng; edgeDistanceM: number; score: number } | null = null;
  for (const street of streets) {
    const line = street.fullCoordinates?.length ? street.fullCoordinates : street.coordinates;
    if (!line?.length) continue;
    let own: { point: LatLng; edgeDistanceM: number } | null = null;
    for (let i = 0; i < line.length; i++) {
      const a = line[i], b = line[i + 1] ?? a;
      const steps = Math.max(1, Math.ceil(calculateDistance(a, b) / RESCUE_SAMPLE_STEP_M));
      for (let k = 0; k <= steps; k++) {
        const point = { lat: a.lat + (b.lat - a.lat) * (k / steps), lng: a.lng + (b.lng - a.lng) * (k / steps) };
        const d = calculateDistanceToPolygon(point, ring);
        if (d >= ON_EDGE_M && (!own || d < own.edgeDistanceM)) own = { point, edgeDistanceM: d };
      }
    }
    if (!own) continue;
    const score = proximityRankScore(own.edgeDistanceM, street.type);
    if (!best || score > best.score || (score === best.score && own.edgeDistanceM < best.edgeDistanceM)) {
      best = { street, ...own, score };
    }
  }
  return best && { street: best.street, point: best.point, edgeDistanceM: best.edgeDistanceM };
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
  const ring = poiEdgeRing(boundary);
  // The rescue TP (INV-E11b) answers to the sanity cap, not to the class reach: it exists
  // precisely because nothing was within the class reach.
  const rescue = tps.filter(tp => tp.generationMethod === REACH_RESCUE_METHOD);
  const reach = partitionByPoiReach(tps.filter(tp => !rescue.includes(tp)), tp => tp.location, poiPin, ring, reachCapM);
  const sane = partitionByPoiReach(rescue, tp => tp.location, poiPin, ring, SANITY_MAX_TP_DISTANCE_M);
  const dropped: Array<{ tp: T; reason: TpDropReason }> = [...reach.dropped, ...sane.dropped].map(d => ({ tp: d.item, reason: 'beyond_reach' }));
  const fireable = dropUnfireable([...reach.kept, ...sane.kept]) as T[];
  for (const tp of reach.kept) if (!fireable.includes(tp)) dropped.push({ tp, reason: 'unfireable' });
  const kept = dropInsidePoi(fireable, boundary);
  for (const tp of fireable) if (!kept.includes(tp)) dropped.push({ tp, reason: 'inside_poi' });
  return { kept, dropped, reachCapM };
}

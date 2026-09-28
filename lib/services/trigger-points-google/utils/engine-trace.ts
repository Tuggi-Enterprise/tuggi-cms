/**
 * E0 — engine trace (docs/arquitetura/cms/motor-de-tp.md, BR-AUDIO-010).
 *
 * One row per POI for E1–E6 and one row per candidate for E7–E11:
 * `poi_id · stage · rule (file#symbol) · measured value · limit · kept|dropped`.
 * Pure information: nothing here decides; it records what the deciding step did, so
 * "why did this POI end with no TP" is answered from the dry-run CSV without reading code.
 */
import type { BoundaryData, TriggerPointPredictionResult } from '../types/interfaces';
import { edgeDistanceM, tpReachCapM } from './validation';
import {
  CLASS_LIMITS,
  MIN_APPARENT_ANGLE_DEG,
  LANDMARK_MIN_HEIGHT_M,
  LANDMARK_MIN_PROMINENCE_M,
  APPARENT_REACH_CEILING_M,
  RECOGNITION_ANGLE_DEG,
  STRUCTURE_BUILT_SHARE_MIN,
  STRUCTURE_MIN_HEIGHT_M,
  VisibilityClass,
} from '../config/visibility-class';

export type TraceStage = 'EP' | 'E1' | 'E3' | 'E4' | 'E5' | 'E6' | 'E7' | 'E8' | 'E9-E10' | 'E10' | 'E11';

export interface EngineTraceRow {
  poi_id: string;
  stage: TraceStage;
  /** `file#symbol` of the step that decided */
  rule: string;
  /** `lat,lng` (6 decimals) for E7–E11; empty for the per-POI stages */
  candidate: string;
  value: string;
  limit: string;
  decision: 'kept' | 'dropped';
}

type LatLng = { lat: number; lng: number };
type Located = { location: LatLng };

export const candidateKey = (p: LatLng): string => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

const m = (n: number | null | undefined): string => (n === null || n === undefined ? 'null' : `${Math.round(n)} m`);

export { edgeDistanceM };

/** E1–E6: one row per POI, from what the detector measured (`boundary.physical`). */
export function poiTraceRows(poiId: string, boundary: BoundaryData | undefined): EngineTraceRow[] {
  const row = (stage: TraceStage, rule: string, value: string, limit = '', decision: 'kept' | 'dropped' = 'kept'): EngineTraceRow =>
    ({ poi_id: poiId, stage, rule, candidate: '', value, limit, decision });
  if (!boundary) return [row('E1', 'boundary-detector#detectBoundary', 'no boundary', '', 'dropped')];
  const ph = boundary.physical;
  const cls = boundary.classification?.group as VisibilityClass | undefined;
  const rows: EngineTraceRow[] = [
    row('E1', 'boundary-detector#detectBoundary',
      `source=${boundary.source}; synthetic=${!!boundary.synthetic}; vertices=${boundary.coordinates?.length ?? 0}; area=${Math.round(boundary.area_m2 ?? 0)} m²`),
    // INV-E1c: every candidate refused on the way, with the reason.
    ...(boundary.rejected ?? []).map(r => row('E1', 'boundary-choice#chooseContainingBoundary', `${r.element}: ${r.reason}`, '', 'dropped')),
    // #783: what the buildings layer measured on the footprint, and the share it had to cover.
    row('E3', 'visibility-class#resolveHeightM', `${m(ph?.heightM ?? boundary.height)} (${ph?.heightSource ?? 'unmeasured'})${
      ph?.footprintBuilt?.share == null ? '' : `; layer: built ${Math.round(ph.footprintBuilt.share * 100)}%, ${m(ph.footprintBuilt.heightM)} (${ph.footprintBuilt.source ?? 'no building'})`
    }`, `built ≥ ${Math.round(STRUCTURE_BUILT_SHARE_MIN * 100)}%`),
    row('E4', 'elevation-service#groundTop', `${m(ph?.groundTopM)} (${ph?.groundSource ?? 'unmeasured'})`, '',
      ph?.groundTopM === null ? 'dropped' : 'kept'),
    row('E4', 'elevation-service#cityBaseElevation', `${m(ph?.cityBaseM)} (${ph?.cityBaseSource ?? 'unmeasured'})`, '',
      ph?.cityBaseM === null ? 'dropped' : 'kept'),
    row('E4', 'visibility-class#prominenceOverCityM', m(ph?.prominenceM), `landmark ≥ ${LANDMARK_MIN_PROMINENCE_M} m`),
    row('E4', 'elevation-service#localBaseElevation', `local base ${m(ph?.localBaseM)}; local prominence ${m(ph?.localProminenceM)}; on top of its relief ${m(ph?.reliefProminenceM)}`,
      `landmark ≥ ${LANDMARK_MIN_PROMINENCE_M} m`, ph?.localProminenceM === null ? 'dropped' : 'kept'),
    row('E5', 'visibility-class#visibilityClassRule', `${cls ?? 'none'} (${ph?.classRule ?? 'unmeasured'})`,
      `height landmark ≥ ${LANDMARK_MIN_HEIGHT_M} m; structure ≥ ${STRUCTURE_MIN_HEIGHT_M} m`),
    row('E6', 'validation#tpReachCapM', `${tpReachCapM(boundary.classification)} m`,
      !cls ? 'unclassified'
        : cls === VisibilityClass.LANDMARK_HIGH
          ? `class ${cls}: edge ≤ ${CLASS_LIMITS[cls].maxEdgeDistanceM} m, near ≤ ${CLASS_LIMITS[cls].maxTPs}, far ≤ ${CLASS_LIMITS[cls].maxFarTPs}`
          : `class ${cls}: size / tan ${RECOGNITION_ANGLE_DEG}°, ${CLASS_LIMITS[cls].maxEdgeDistanceM}–${APPARENT_REACH_CEILING_M} m; near ≤ ${CLASS_LIMITS[cls].maxEdgeDistanceM} m ≤ ${CLASS_LIMITS[cls].maxTPs}, far on a tourist way ≤ ${CLASS_LIMITS[cls].maxFarTPs}`),
    row('E6', 'trigger-point-predictor#attachVisibilityFan', `fan max ${m(boundary.visibilityFan?.maxDistanceM)}`),
  ];
  return rows;
}

/** INV-E8b: what the E8 row of a candidate says about its sight — aims seen and apparent angle. */
export function sightTraceValue(sight: { visible: number; total: number; fraction: number; angleDeg: number; ownSlope?: boolean } | undefined): string {
  if (!sight) return 'sight not measured';
  return `sight ${sight.visible}/${sight.total} aims (${Math.round(sight.fraction * 100)}%), ${sight.angleDeg.toFixed(2)}°${sight.ownSlope ? '; own slope' : ''}`;
}

/** INV-E8b: the limit column of the E8 rows. */
export const SIGHT_TRACE_LIMIT = `apparent angle ≥ ${MIN_APPARENT_ANGLE_DEG}° (provisional, #775)`;

/**
 * Candidate rows for one step: every item of `before` is kept when it is still in `after`
 * (same location), dropped otherwise; items that only exist in `after` (merged or moved by the
 * step) are kept with `new` in the value.
 */
export function stepTraceRows<T extends Located>(a: {
  poiId: string;
  stage: TraceStage;
  rule: string;
  before: T[];
  after: T[];
  value: (c: T) => string;
  limit: string;
}): EngineTraceRow[] {
  const afterKeys = new Set(a.after.map(c => candidateKey(c.location)));
  const beforeKeys = new Set(a.before.map(c => candidateKey(c.location)));
  const rows: EngineTraceRow[] = a.before.map(c => ({
    poi_id: a.poiId, stage: a.stage, rule: a.rule, candidate: candidateKey(c.location),
    value: a.value(c), limit: a.limit, decision: afterKeys.has(candidateKey(c.location)) ? 'kept' : 'dropped',
  }));
  for (const c of a.after) {
    if (beforeKeys.has(candidateKey(c.location))) continue;
    rows.push({ poi_id: a.poiId, stage: a.stage, rule: a.rule, candidate: candidateKey(c.location),
      value: `new; ${a.value(c)}`, limit: a.limit, decision: 'kept' });
  }
  return rows;
}

/** Engine result with its trace (per-POI rows first). */
export type TracedPrediction = TriggerPointPredictionResult & { trace: EngineTraceRow[] };

export const TRACE_CSV_COLUMNS: Array<keyof EngineTraceRow> = ['poi_id', 'stage', 'rule', 'candidate', 'value', 'limit', 'decision'];

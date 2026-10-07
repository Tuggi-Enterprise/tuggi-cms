/**
 * Same-POI duplicate TPs — BR-POI-009 (operator, 2026-10-07: "a ideia é não ter duplicação").
 *
 * ONE rule, used by the save (`TriggerPointSavingService.saveTriggerPoints`, replace_all), by the
 * dry-run (`tp-dry-run`) and by the stored-TP cleanup (`output/_dedupe-tps.ts`):
 *
 * - Duplicate: two TPs of the SAME POI whose centres are closer than the larger of the two radii
 *   (one centre falls inside the other's circle). Geometry only; the origin does not enter.
 * - Which one stays, per cluster, greedy in priority order: a TP is dropped when it falls inside
 *   the radius of one already kept, or one already kept falls inside its radius.
 *   Priority: 1. approved by a human (`manual_status = 'approved'`) · 2. larger radius ·
 *   3. more recent · 4. `id` (deterministic).
 * - TPs of different POIs never compare.
 */
import { calculateDistance } from './calculations';

export interface SamePoiTp {
  id: string;
  poiId: string;
  location: { lat: number; lng: number };
  radius: number;
  /** `manual_status = 'approved'`, whatever the generation method */
  humanApproved: boolean;
  /** epoch ms of `updated_at` (else `created_at`); a TP generated now is `Date.now()` */
  recency: number;
}

/** The trace/drop reason the save and the dry-run write (`drop_reason`). */
export type DuplicateDropReason = `duplicate_of:${string}`;
export const duplicateReason = (keptId: string): DuplicateDropReason => `duplicate_of:${keptId}`;

function outranks(a: SamePoiTp, b: SamePoiTp): number {
  if (a.humanApproved !== b.humanApproved) return a.humanApproved ? -1 : 1;
  if (a.radius !== b.radius) return b.radius - a.radius;
  if (a.recency !== b.recency) return b.recency - a.recency;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function isSamePoiDuplicate(a: SamePoiTp, b: SamePoiTp): boolean {
  return a.poiId === b.poiId && calculateDistance(a.location, b.location) < Math.max(a.radius, b.radius);
}

export function dedupeSamePoiTriggerPoints<T extends SamePoiTp>(tps: T[]): { kept: T[]; dropped: Array<{ tp: T; duplicateOf: T }> } {
  const byPoi = new Map<string, T[]>();
  for (const tp of tps) (byPoi.get(tp.poiId) ?? byPoi.set(tp.poiId, []).get(tp.poiId)!).push(tp);
  const kept: T[] = [];
  const dropped: Array<{ tp: T; duplicateOf: T }> = [];
  for (const group of byPoi.values()) {
    const keptHere: T[] = [];
    for (const tp of [...group].sort(outranks)) {
      const winner = keptHere.find(k => isSamePoiDuplicate(k, tp));
      if (winner) dropped.push({ tp, duplicateOf: winner });
      else keptHere.push(tp);
    }
    kept.push(...keptHere);
  }
  return { kept, dropped };
}

/**
 * The save's side of the rule. `survivors` are the stored TPs the replace does not remove
 * (`isReplaceSurvivor`); they are not ours to delete, so only a GENERATED TP is dropped — when
 * the rule keeps something else over it. A survivor the rule would drop stays in the database
 * and is reported in `outrankedSurvivors`: the cleanup removes it.
 */
export function dropGeneratedDuplicates<G extends SamePoiTp>(
  generated: G[],
  survivors: SamePoiTp[]
): { kept: G[]; dropped: Array<{ tp: G; reason: DuplicateDropReason }>; outrankedSurvivors: SamePoiTp[] } {
  const isGenerated = new Set<SamePoiTp>(generated);
  const result = dedupeSamePoiTriggerPoints<SamePoiTp>([...survivors, ...generated]);
  return {
    kept: generated.filter(g => result.kept.includes(g)),
    dropped: result.dropped.filter(d => isGenerated.has(d.tp)).map(d => ({ tp: d.tp as G, reason: duplicateReason(d.duplicateOf.id) })),
    outrankedSurvivors: result.dropped.filter(d => !isGenerated.has(d.tp)).map(d => d.tp),
  };
}

/**
 * Which stored TP survives `core.replace_trigger_points_atomic` — the production predicate
 * (#776; read from the remote-schema baseline `20261006120000` in db-tuggiApp, and confirmed on
 * 2026-10-07: `google_apis` rows survive because they carry `updated_by`). The RPC replaces
 * `generation_method IS DISTINCT FROM 'manual' AND updated_by IS NULL`; this is its negation.
 * Keep the two in step: a change to the RPC predicate changes this line.
 */
export function isReplaceSurvivor(row: { generation_method?: string | null; updated_by?: string | null }): boolean {
  return row.generation_method === 'manual' || row.updated_by != null;
}

/** Stored row → `SamePoiTp`. Shared by the save's survivor load and the cleanup script. */
export function storedTpToSamePoi(row: {
  id: string; attraction_id: string; latitude: number; longitude: number; radius_meters: number | null;
  manual_status?: string | null; updated_at?: string | null; created_at?: string | null;
}): SamePoiTp {
  return {
    id: row.id,
    poiId: row.attraction_id,
    location: { lat: row.latitude, lng: row.longitude },
    // the column default (`replace_trigger_points_atomic`: COALESCE(radius_meters, 20))
    radius: row.radius_meters ?? 20,
    humanApproved: row.manual_status === 'approved',
    recency: Date.parse(row.updated_at ?? row.created_at ?? '') || 0,
  };
}

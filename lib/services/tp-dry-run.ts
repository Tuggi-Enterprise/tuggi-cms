/**
 * Dry-run do motor de TP: gera como a gravação geraria e mede, sem escrever nada.
 *
 * Passa pela mesma pós-condição da gravação (`applyTpPostConditions`, INV-E11): o TP que a
 * gravação cortaria sai cortado aqui também, com o motivo em `drop_reason`.
 *
 * Só leitura no banco (SELECT e RPC de leitura). Não chama saveTriggerPoints, não aprova
 * POI, não toca tp_regen_queue. Para cada POI devolve uma linha por TP — os gerados agora
 * e os gravados hoje — com a distância à borda e ao pino, para comparar antes × depois
 * (auditoria de TP, 2026-09-27; BR-AUDIO-010).
 */

import { getSupabase } from '@/lib/core/supabase-client'
import { MigrationService } from './migration-service'
import { PoiMigrationPipeline, TP_ENGINE_OPTIONS } from './poi-migration-pipeline'
import { CoreTriggerPointPredictor } from './trigger-points-google/core/trigger-point-predictor'
import { BoundaryDetector } from './trigger-points-google/core/boundary-detector'
import { calculateDistance, calculateDistanceToPolygon } from './trigger-points-google/utils/calculations'
import { UNCLASSIFIED_MAX_TP_DISTANCE_M, distanceFromPoiM, poiEdgeRing } from './trigger-points-google/utils/validation'
import { applyTpPostConditions, type TpDropReason } from './trigger-points-google/utils/tp-selection'
import { dropGeneratedDuplicates, type DuplicateDropReason } from './trigger-points-google/utils/same-poi-dedupe'
import { TriggerPointSavingService } from './trigger-point-saving'
import { DemNotPreparedError } from './dem/dem-store'
import {
  TRACE_CSV_COLUMNS,
  candidateKey,
  edgeDistanceM,
  type EngineTraceRow,
} from './trigger-points-google/utils/engine-trace'

type LatLng = { lat: number; lng: number }

export interface TpMetricInput {
  lat: number
  lng: number
  type: string | null
  generation_method: string | null
  radius_m: number | null
  bearing: number | null
  /** generated only: why the post-conditions or the same-POI dedupe dropped it; empty when kept */
  drop_reason?: TpDropReason | DuplicateDropReason | ''
}

export interface TpMetricRow extends TpMetricInput {
  attraction_id: string
  poi_name: string
  source: 'current' | 'generated'
  boundary_source: string | null
  dist_to_pin_m: number
  /** null quando não há polígono de borda */
  dist_to_boundary_m: number | null
  /** the POI class save cap (tpReachCapM) would drop this TP */
  beyond_cap: boolean
  drop_reason: TpDropReason | DuplicateDropReason | ''
}

export interface PoiDryRunResult {
  attraction_id: string
  poi_name: string
  error: string | null
  rows: TpMetricRow[]
  /** E0 trace: E1–E6 one row per POI, E7–E11 one row per candidate (motor-de-tp.md) */
  trace: EngineTraceRow[]
  /** the generated edge ring (`poiEdgeRing`); absent when the border is synthetic */
  edge?: LatLng[]
  /** the POI pin the engine ran from; `dist_to_pin_m` is measured from it */
  pin?: LatLng
}

export function measureTriggerPoints(args: {
  attractionId: string
  poiName: string
  pin: LatLng
  boundaryCoords?: LatLng[]
  boundarySource: string | null
  source: 'current' | 'generated'
  tps: TpMetricInput[]
  /** POI class cap; without it, the unclassified one */
  capM?: number
}): TpMetricRow[] {
  const hasBoundary = !!args.boundaryCoords && args.boundaryCoords.length >= 3
  const round = (n: number) => Math.round(n * 10) / 10
  return args.tps.map(tp => {
    const at = { lat: tp.lat, lng: tp.lng }
    return {
      ...tp,
      attraction_id: args.attractionId,
      poi_name: args.poiName,
      source: args.source,
      boundary_source: args.boundarySource,
      dist_to_pin_m: round(calculateDistance(at, args.pin)),
      dist_to_boundary_m: hasBoundary ? round(calculateDistanceToPolygon(at, args.boundaryCoords!)) : null,
      beyond_cap: distanceFromPoiM(at, args.pin, args.boundaryCoords) > (args.capM ?? UNCLASSIFIED_MAX_TP_DISTANCE_M),
      drop_reason: tp.drop_reason ?? '',
    }
  })
}

/** IDs de atração cujo pino cai no bbox [minLng, minLat, maxLng, maxLat]. */
export async function listAttractionIdsInBbox(bbox: [number, number, number, number], limit?: number): Promise<string[]> {
  const [minLng, minLat, maxLng, maxLat] = bbox
  const supabase = getSupabase('service')
  if (limit) {
    // ~2.7M coordinates: ordering a country-sized bbox times out (8 s, Portugal 2026-10-05);
    // a sample of N needs no order, and the same query returns in ~0.3 s.
    const { data, error } = await supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('attraction_id')
      .gte('latitude', minLat).lte('latitude', maxLat)
      .gte('longitude', minLng).lte('longitude', maxLng)
      .limit(limit)
    if (error) throw new Error(`bbox query failed: ${error.message}`)
    return (data ?? []).map((r: { attraction_id: string }) => r.attraction_id)
  }
  const PAGE = 1000
  const ids: string[] = []
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('attraction_id')
      .gte('latitude', minLat).lte('latitude', maxLat)
      .gte('longitude', minLng).lte('longitude', maxLng)
      .order('attraction_id')
      .range(page * PAGE, (page + 1) * PAGE - 1)
    if (error) throw new Error(`bbox query failed: ${error.message}`)
    if (!data?.length) break
    ids.push(...data.map((r: { attraction_id: string }) => r.attraction_id))
    if (data.length < PAGE) break
  }
  return ids
}

async function fetchCurrentTriggerPoints(attractionId: string): Promise<TpMetricInput[]> {
  const { data, error } = await getSupabase('service')
    .schema('core')
    .from('trigger_points_with_coords')
    .select('*')
    .eq('attraction_id', attractionId)
  if (error) throw new Error(`current TPs query failed: ${error.message}`)
  return (data ?? []).map((r: any) => ({
    lat: r.latitude,
    lng: r.longitude,
    type: r.type ?? null,
    generation_method: r.generation_method ?? null,
    radius_m: r.radius_meters ?? null,
    bearing: r.expected_bearing ?? null,
  }))
}

export async function dryRunPoi(attractionId: string, opts: { storedBoundaryReference?: boolean } = {}): Promise<PoiDryRunResult> {
  const loaded = await MigrationService.loadPOIWithCoordinates(attractionId)
  if (!loaded.success || !loaded.data) {
    return { attraction_id: attractionId, poi_name: '', error: loaded.error ?? 'POI not found', rows: [], trace: [] }
  }
  const poiData = PoiMigrationPipeline.buildEngineInput(loaded.data.poi, loaded.data.coordinate)
  const base = { attractionId, poiName: poiData.name, pin: poiData.location }

  const [current, stored] = await Promise.all([
    fetchCurrentTriggerPoints(attractionId),
    new BoundaryDetector().fetchBoundaryFromDatabase(attractionId),
  ])
  const rows = measureTriggerPoints({
    ...base,
    source: 'current',
    tps: current,
    boundaryCoords: stored.success ? stored.data?.coordinates : undefined,
    boundarySource: stored.success ? stored.data?.source ?? null : null,
  })

  try {
    const prediction = await new CoreTriggerPointPredictor().predictTriggerPointsComplete(poiData, { ...TP_ENGINE_OPTIONS, ...opts })
    const post = applyTpPostConditions(prediction.triggerPoints ?? [], poiData.location, prediction.boundary)
    const capM = post.reachCapM
    // The save's same-POI dedupe (BR-POI-009), so this number still predicts the save.
    const now = Date.now()
    const dedupe = dropGeneratedDuplicates(
      post.kept.map(tp => ({ ...tp, poiId: attractionId, humanApproved: false, recency: now })),
      await TriggerPointSavingService.loadReplaceSurvivors(attractionId),
    )
    // The engine already traced its own E11; the fallback exits and anything cut here are added.
    const e11 = (tp: { location: { lat: number; lng: number } }, reason: string): EngineTraceRow => ({
      poi_id: attractionId, stage: 'E11', rule: 'tp-selection#applyTpPostConditions', candidate: candidateKey(tp.location),
      value: `${reason ? `${reason}; ` : ''}edge ${Math.round(edgeDistanceM(tp.location, prediction.boundary))} m`,
      limit: `reach ${capM} m`, decision: reason ? 'dropped' : 'kept',
    })
    const trace = [
      // tolerant on purpose: the trace is information and never fails the dry-run
      ...(prediction.trace ?? []),
      ...(prediction.metadata?.fallbackUsed ? post.kept.map(tp => e11(tp, '')) : []),
      ...post.dropped.map(d => e11(d.tp, d.reason)),
      ...dedupe.dropped.map(d => e11(d.tp, d.reason)),
    ]
    // Before × after under the same cap: the class the engine assigns now.
    for (const r of rows) r.beyond_cap = (r.dist_to_boundary_m ?? r.dist_to_pin_m) > capM
    rows.push(...measureTriggerPoints({
      ...base,
      capM,
      source: 'generated',
      boundaryCoords: poiEdgeRing(prediction.boundary),
      boundarySource: prediction.boundary?.source ?? null,
      tps: [
        ...dedupe.kept.map(tp => ({ tp, reason: '' as const })),
        ...dedupe.dropped,
        ...post.dropped,
      ].map(({ tp, reason }) => ({
        lat: tp.location.lat,
        lng: tp.location.lng,
        type: tp.type ?? null,
        generation_method: tp.generationMethod ?? null,
        radius_m: tp.radius ?? null,
        bearing: tp.expectedBearing ?? null,
        drop_reason: reason,
      })),
    }))
    return { attraction_id: attractionId, poi_name: poiData.name, error: null, rows, trace, edge: poiEdgeRing(prediction.boundary), pin: poiData.location }
  } catch (e) {
    // EP (INV-EPb): a city whose relief was not prepared does not generate, and says why.
    const trace = e instanceof DemNotPreparedError
      ? [{ poi_id: attractionId, stage: 'EP' as const, rule: 'dem-store#coverage', candidate: '', value: e.message, limit: 'city relief prepared (INV-EPb)', decision: 'dropped' as const }]
      : []
    return { attraction_id: attractionId, poi_name: poiData.name, error: e instanceof Error ? e.message : String(e), rows, trace }
  }
}

export const DRY_RUN_CSV_COLUMNS: Array<keyof TpMetricRow> = [
  'attraction_id', 'poi_name', 'source', 'boundary_source', 'type', 'generation_method',
  'radius_m', 'bearing', 'lat', 'lng', 'dist_to_pin_m', 'dist_to_boundary_m', 'beyond_cap', 'drop_reason',
]

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsvLines(rows: TpMetricRow[]): string[] {
  return rows.map(r => DRY_RUN_CSV_COLUMNS.map(c => csvCell(r[c])).join(','))
}

/** E0 trace CSV, written next to the dry-run CSV (`*.trace.csv`). */
export { TRACE_CSV_COLUMNS }
export function toTraceCsvLines(rows: EngineTraceRow[]): string[] {
  return rows.map(r => TRACE_CSV_COLUMNS.map(c => csvCell(r[c])).join(','))
}

/**
 * Resumo por POI, antes × depois. `generated.count` é o que a gravação gravaria (os mantidos);
 * `generated.dropped` conta os cortados pela pós-condição, por motivo.
 */
export function summarizePoi(result: PoiDryRunResult) {
  const side = (source: 'current' | 'generated') => {
    const rows = result.rows.filter(r => r.source === source && !r.drop_reason)
    return {
      count: rows.length,
      beyond_cap: rows.filter(r => r.beyond_cap).length,
      max_dist_to_pin_m: rows.length ? Math.max(...rows.map(r => r.dist_to_pin_m)) : null,
    }
  }
  const dropped: Record<TpDropReason | 'duplicate', number> = { beyond_reach: 0, inside_poi: 0, duplicate: 0 }
  for (const r of result.rows) {
    if (r.source !== 'generated' || !r.drop_reason) continue
    dropped[r.drop_reason.startsWith('duplicate_of:') ? 'duplicate' : r.drop_reason as TpDropReason]++
  }
  return {
    attraction_id: result.attraction_id, poi_name: result.poi_name, error: result.error,
    current: side('current'), generated: { ...side('generated'), dropped },
  }
}

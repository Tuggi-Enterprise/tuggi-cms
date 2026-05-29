/**
 * Phase 0 — Debug-quality logger for Trigger Point generation.
 *
 * Emits one JSON line per POI capturing the inputs the predictor used to make
 * its decisions: boundary source/size, fan reach, candidate counts at each
 * pipeline stage, final TP distances. Lines are grep-friendly via the
 * `[TP_DEBUG_QUALITY]` prefix and ride the existing console.log → file pipe in
 * `scripts/migrate-pois-batch.ts` (attachFileLogger).
 *
 * Goal: feed evidence-based decisions about which Phase 1+ items to apply
 * first. No behavior change; pure observation.
 */
export interface DebugQualitySnapshot {
  __type: 'tp_debug_quality';
  ts: string;

  poi_id?: string;
  poi_name?: string;
  poi_category?: string | null;
  poi_height_m?: number | null;
  poi_height_source?: 'osm' | 'null_fallback';

  boundary_source?: string;
  boundary_perimeter_m?: number;
  boundary_area_m2?: number;
  urban_density?: string | null;
  elevation_diff_m?: number | null;

  search_radius_m?: number;
  search_radius_source?: 'category_default' | 'elevation_scaled' | 'height_scaled' | 'fixed' | 'fallback';

  fan_max_horizon_m?: number;
  fan_direction_count?: number;
  fan_step_m?: number;
  fan_sample_points?: number;
  fan_mean_visible_m?: number;
  fan_max_visible_m?: number;
  fan_min_visible_m?: number;
  fan_coverage_km2?: number;

  candidate_count_pre_filter?: number;
  candidate_count_post_los?: number;
  candidate_count_post_street_validation?: number;
  candidate_count_validated?: number;
  tp_count_final?: number;
  tp_distances_m?: number[];

  exit_path: 'main' | 'manual_boundary' | 'estimated_boundary' | 'no_streets' | 'no_optimal_points' | 'no_street_candidates' | 'error';
  processing_time_ms?: number;
}

/**
 * Serialize the snapshot to a single JSON line prefixed with a tag for grep.
 * The wrapping console.log is teed into the migration-log file by the existing
 * attachFileLogger in scripts/migrate-pois-batch.ts.
 */
export function emitDebugQuality(snapshot: DebugQualitySnapshot): void {
  try {
    console.log(`[TP_DEBUG_QUALITY] ${JSON.stringify(snapshot)}`);
  } catch {
    // Silent — instrumentation must never break the pipeline.
  }
}

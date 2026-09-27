/**
 * POI CLASSIFIER SERVICE — BR-AUDIO-010.
 *
 * Measures the POI physical attributes (height, prominence, area, shape) and delegates
 * to the pure `classifyVisibility` (config/visibility-class.ts). No POI name decides
 * anything here (engine-agnostic, epic #772).
 */

import { GeographicContext, GeoPoint, POIData } from '../types/interfaces';
import {
  VisibilityClass,
  CLASS_LIMITS,
  ClassRule,
  HeightSource,
  maxEdgeDistanceFor,
  SUMMIT_MATCH_M,
  prominenceOverCityM,
  resolveHeightM,
  visibilityClassRule,
} from '../config/visibility-class';
import { ElevationAnalysisService, GroundTop } from './elevation-service';
import { LocalOSMFetcher } from './local-osm-fetcher';

/** Summits from the local OSM DB around the boundary (E4): not every detector path collects them. */
function summitsAround(pin: GeoPoint, boundary?: GeoPoint[]) {
  const pts = [pin, ...(boundary ?? [])];
  const pad = SUMMIT_MATCH_M / 110_000;
  const lats = pts.map(p => p.lat), lngs = pts.map(p => p.lng);
  return LocalOSMFetcher.getInstance().fetchSummits({
    minLat: Math.min(...lats) - pad, maxLat: Math.max(...lats) + pad,
    minLng: Math.min(...lngs) - pad, maxLng: Math.max(...lngs) + pad,
  }) ?? [];
}

/**
 * E3 + E4 + E5 measured once per POI (P8). Everything downstream — fan, sight line, reach,
 * trace — reads these numbers instead of measuring again.
 */
export interface PoiPhysical {
  heightM: number;
  heightSource: HeightSource;
  /** terrain at the highest point of the boundary (INV-E4a); null when the DEM failed */
  groundTopM: number | null;
  groundSource: GroundTop['source'];
  /** where that highest point is */
  topPoint: GeoPoint | null;
  cityBaseM: number | null;
  cityBaseSource: string;
  /** ground top + height − city base (INV-E4b); null when a terrain number is missing (INV-E4c) */
  prominenceM: number | null;
  areaM2: number;
  classRule: ClassRule;
}

export interface POIClassification {
  group: VisibilityClass;
  /** street search radius, from the EDGE */
  searchRadius: number;
  /** max distance from the TP to the edge */
  maxEdgeDistanceM: number;
  maxTriggerPoints: number;
  maxFarTriggerPoints: number;
  /** cap on the TP radius */
  maxTPRadiusM: number;
  /** min spacing between TPs = 2 × maxTPRadiusM */
  minDistanceBetweenTPs: number;
  metadata: {
    height: number;
    heightSource: string;
    elevation: number | null;
    /** prominence over the city base; null = unknown (DEM failed), never a silent 0 */
    elevationDiff: number | null;
    area: number;
    urbanDensity: string;
    reasoning: string;
  };
}

/** Builds the classification from the class — numbers live in CLASS_LIMITS. */
export function buildClassification(
  cls: VisibilityClass,
  m: { heightM: number; heightSource?: string; elevationM?: number | null; prominenceM: number | null; areaM2: number; urbanDensity?: string }
): POIClassification {
  const limits = CLASS_LIMITS[cls];
  const maxEdge = maxEdgeDistanceFor(cls, m.prominenceM);
  return {
    group: cls,
    searchRadius: maxEdge,
    maxEdgeDistanceM: maxEdge,
    maxTriggerPoints: limits.maxTPs,
    maxFarTriggerPoints: limits.maxFarTPs,
    maxTPRadiusM: limits.maxRadiusM,
    minDistanceBetweenTPs: 2 * limits.maxRadiusM,
    metadata: {
      height: m.heightM,
      heightSource: m.heightSource ?? 'none',
      elevation: m.elevationM ?? null,
      elevationDiff: m.prominenceM,
      area: m.areaM2,
      urbanDensity: m.urbanDensity ?? 'unknown',
      reasoning: `${cls}: height ${m.heightM.toFixed(1)}m, prominence ${m.prominenceM === null ? 'unknown' : `${m.prominenceM.toFixed(0)}m`}, area ${m.areaM2.toFixed(0)}m²`,
    },
  };
}

export interface MeasureInput {
  poiData: POIData;
  /** boundary ring; for a synthetic one it still locates the ground, but has no area or shape */
  boundary?: GeoPoint[];
  synthetic?: boolean;
  areaM2: number;
  tags?: Record<string, unknown>;
  /** height measured on another element (building aggregation, host) */
  knownHeightM?: number;
  /** surveyed summits nearby (`natural=peak` with `ele`) */
  peaks?: Array<{ lat: number; lng: number; tags?: Record<string, unknown> }>;
  context?: GeographicContext;
}

/** E3 → E4 → E5 for one POI. The only caller of `visibilityClassRule` with measured data. */
export async function measureAndClassify(a: MeasureInput): Promise<{ classification: POIClassification; physical: PoiPhysical }> {
  const { heightM, source: heightSource } = resolveHeightM(a.tags, a.knownHeightM);
  const top = await ElevationAnalysisService.groundTop({
    pin: a.poiData.location,
    boundary: a.boundary,
    tags: a.tags,
    peaks: [...(a.peaks ?? []), ...summitsAround(a.poiData.location, a.boundary)],
  });
  const base = await ElevationAnalysisService.cityBaseElevation(a.poiData.location, a.poiData.city);
  const prominenceM = prominenceOverCityM(top.groundM, heightM, base.baseM);
  const areaM2 = a.synthetic ? 0 : a.areaM2 || 0;
  const { cls, rule } = visibilityClassRule({
    heightM,
    prominenceM,
    areaM2,
    boundary: a.synthetic ? undefined : a.boundary,
    tags: a.tags,
  });
  return {
    classification: buildClassification(cls, {
      heightM,
      heightSource,
      elevationM: top.groundM,
      prominenceM,
      areaM2,
      urbanDensity: a.context?.urbanDensity?.level,
    }),
    physical: {
      heightM,
      heightSource,
      groundTopM: top.groundM,
      groundSource: top.source,
      topPoint: top.at,
      cityBaseM: base.baseM,
      cityBaseSource: base.source,
      prominenceM,
      areaM2,
      classRule: rule,
    },
  };
}

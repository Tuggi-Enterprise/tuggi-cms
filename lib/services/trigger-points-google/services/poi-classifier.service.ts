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
  boundaryShape,
  SUMMIT_MATCH_M,
  prominenceOverCityM,
  resolveHeightM,
  footprintStructureHeight,
  visibilityClassRule,
  isWaterBody,
  BUILT_BASE_MIN_RELIEF_CELLS,
} from '../config/visibility-class';
import { ElevationAnalysisService, GroundTop } from './elevation-service';
import { DemStore } from '../../dem/dem-store';
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
  /** share of the footprint the buildings layer covers, and the height it measured (#783) */
  footprintBuilt: { share: number | null; heightM: number | null; source: string | null };
  /** terrain at the highest point of the boundary (INV-E4a); null when the DEM failed */
  groundTopM: number | null;
  groundSource: GroundTop['source'];
  /** where that highest point is */
  topPoint: GeoPoint | null;
  cityBaseM: number | null;
  cityBaseSource: string;
  /** ground top + height − city base (INV-E4b); null when a terrain number is missing (INV-E4c) */
  prominenceM: number | null;
  /** ground top + height − local base (ring of LOCAL_BASE_RING_M); null when unknown */
  localBaseM: number | null;
  localProminenceM: number | null;
  /**
   * The local prominence of the relief the POI stands on top of (BR-POI-009 item 1): localProminenceM
   * when the ground comes down all around its top (`elevation-service#isReliefTop`), 0 on a slope
   * or on the flat, null when unknown. The size S and the far ways read this, never the raw one.
   */
  reliefProminenceM: number | null;
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
  m: {
    heightM: number; heightSource?: string; elevationM?: number | null; prominenceM: number | null; areaM2: number; urbanDensity?: string;
    /** longest extent of the real footprint (`boundaryShape`); 0 for a synthetic circle (INV-E1b) */
    extentM?: number;
    /**
     * Local prominence of the relief the POI tops (`PoiPhysical#reliefProminenceM`): what the
     * passer-by sees standing up is the POI plus the hill under it. A 0 m chapel on a 31 m hill
     * (Capela da Guia, Cabo Frio) reached 60 m; its hilltop is seen from the canal bridge. A bust
     * at the foot of a slope tops nothing (0). null = unknown, not counted.
     */
    reliefProminenceM?: number | null;
  }
): POIClassification {
  const limits = CLASS_LIMITS[cls];
  // INV-E6: the reach is decided here, once, and read by `tpReachCapM` everywhere.
  // The size S of BR-POI-009 item 1: the largest of height (with the terrain under it) and extent.
  const maxEdge = maxEdgeDistanceFor(cls, m.prominenceM, Math.max(m.heightM, m.reliefProminenceM ?? 0, m.extentM ?? 0));
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
  // E3 (#783): the buildings layer on the footprint, after the OSM tags and the OSM host. A
  // synthetic circle is not a footprint (INV-E1b): the building under a park's pin is not the park.
  const footprint = a.synthetic ? null : DemStore.getInstance().footprintBuildings(a.boundary ?? []);
  const { heightM, source: heightSource } = resolveHeightM(a.tags, a.knownHeightM, footprint && footprintStructureHeight(footprint));
  const measuredTop = await ElevationAnalysisService.groundTop({
    pin: a.poiData.location,
    boundary: a.boundary,
    tags: a.tags,
    peaks: [...(a.peaks ?? []), ...summitsAround(a.poiData.location, a.boundary)],
  });
  // INV-E4a (#772): a built POI wide enough for GEDTM30 to read it as terrain stands on the
  // ground around it; the maximum inside would count its height twice.
  const stepM = DemStore.getInstance().stepM;
  const wideBuilt = !a.synthetic && heightM > 0 && measuredTop.source === 'dem_boundary_max' && measuredTop.groundM !== null
    && (a.areaM2 || 0) >= BUILT_BASE_MIN_RELIEF_CELLS * stepM * stepM;
  const builtBase = wideBuilt ? await ElevationAnalysisService.builtBaseM(a.boundary) : null;
  const top = builtBase !== null && builtBase < measuredTop.groundM!
    ? { ...measuredTop, groundM: builtBase, source: 'built_base' as const }
    : measuredTop;
  const [base, localBaseM] = await Promise.all([
    ElevationAnalysisService.cityBaseElevation(a.poiData.location, a.poiData.city),
    ElevationAnalysisService.localBaseElevation(a.poiData.location),
  ]);
  const prominenceM = prominenceOverCityM(top.groundM, heightM, base.baseM);
  const localProminenceM = prominenceOverCityM(top.groundM, heightM, localBaseM);
  const onTop = localProminenceM === null ? null : await ElevationAnalysisService.isReliefTop(top.at, top.groundM);
  const reliefProminenceM = onTop === null ? null : onTop ? localProminenceM : 0;
  const areaM2 = a.synthetic ? 0 : a.areaM2 || 0;
  const { cls, rule } = visibilityClassRule({
    heightM,
    prominenceM,
    // Measured, not tagged: a POI that is not the top of its relief stands on the hill, it is not
    // the hill — a 2 m fountain on a slope read 993 m and got TPs 12 km away (Portugal, 2026-10-05).
    localProminenceM: onTop === false ? 0 : localProminenceM,
    areaM2,
    boundary: a.synthetic ? undefined : a.boundary,
    waterBody: isWaterBody(a.tags),
  });
  return {
    classification: buildClassification(cls, {
      heightM,
      heightSource,
      elevationM: top.groundM,
      prominenceM,
      areaM2,
      // A synthetic circle is drawn, not measured: it is no size (INV-E1b), like its area.
      extentM: a.synthetic ? 0 : boundaryShape(a.boundary).lengthM,
      reliefProminenceM,
      urbanDensity: a.context?.urbanDensity?.level,
    }),
    physical: {
      heightM,
      heightSource,
      footprintBuilt: {
        share: footprint?.cells ? footprint.builtCells / footprint.cells : null,
        heightM: footprint?.heightM ?? null,
        source: footprint?.source ?? null,
      },
      groundTopM: top.groundM,
      groundSource: top.source,
      topPoint: top.at,
      cityBaseM: base.baseM,
      cityBaseSource: base.source,
      prominenceM,
      localBaseM,
      localProminenceM,
      reliefProminenceM,
      areaM2,
      classRule: rule,
    },
  };
}

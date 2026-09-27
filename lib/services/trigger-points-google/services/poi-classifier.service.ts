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
  classifyVisibility,
  maxEdgeDistanceFor,
  resolveHeightM,
} from '../config/visibility-class';
import { ElevationAnalysisService } from './elevation-service';

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
    elevation: number;
    elevationDiff: number;
    area: number;
    urbanDensity: string;
    reasoning: string;
  };
}

/** Builds the classification from the class — numbers live in CLASS_LIMITS. */
export function buildClassification(
  cls: VisibilityClass,
  m: { heightM: number; heightSource?: string; elevationM?: number; prominenceM: number; areaM2: number; urbanDensity?: string }
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
      elevation: m.elevationM ?? 0,
      elevationDiff: m.prominenceM,
      area: m.areaM2,
      urbanDensity: m.urbanDensity ?? 'unknown',
      reasoning: `${cls}: height ${m.heightM.toFixed(1)}m, prominence ${m.prominenceM.toFixed(0)}m, area ${m.areaM2.toFixed(0)}m²`,
    },
  };
}

export class POIClassifierService {
  async classifyPOI(
    poiData: POIData,
    poiHeight: number | undefined,
    poiElevation: { center: number } | undefined,
    area: number,
    context: GeographicContext | undefined,
    osmTags?: Record<string, unknown>,
    boundaryCoords?: GeoPoint[]
  ): Promise<POIClassification> {
    let prominenceM = 0;
    if (poiElevation && poiElevation.center > 0) {
      const base = await ElevationAnalysisService.estimateRegionalBaseElevation(
        { lat: poiData.location.lat, lng: poiData.location.lng },
        context,
        poiData
      );
      prominenceM = Math.max(0, poiElevation.center - base);
    }
    const { heightM, source } = resolveHeightM(osmTags, poiHeight);
    const cls = classifyVisibility({ heightM, prominenceM, areaM2: area || 0, boundary: boundaryCoords, tags: osmTags });
    return buildClassification(cls, {
      heightM,
      heightSource: source,
      elevationM: poiElevation?.center,
      prominenceM,
      areaM2: area || 0,
      urbanDensity: context?.urbanDensity?.level,
    });
  }
}

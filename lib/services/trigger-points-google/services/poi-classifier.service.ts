/**
 * POI CLASSIFIER SERVICE — BR-AUDIO-010.
 *
 * Mede os atributos físicos do POI (altura, proeminência, área, forma) e delega a
 * classificação ao classificador puro `classifyVisibility` (config/visibility-class.ts).
 * Nenhum nome de POI decide nada aqui (motor agnóstico, épico #772).
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
  /** raio de busca de ruas, a partir da BORDA */
  searchRadius: number;
  /** distância máxima do TP à borda */
  maxEdgeDistanceM: number;
  maxTriggerPoints: number;
  maxFarTriggerPoints: number;
  /** teto do radius do TP */
  maxTPRadiusM: number;
  /** espaçamento mínimo entre TPs = 2 × maxTPRadiusM */
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

/** Monta a classificação a partir da classe — SSOT dos números em CLASS_LIMITS. */
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
    context: GeographicContext,
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

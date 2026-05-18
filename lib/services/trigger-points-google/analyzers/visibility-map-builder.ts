/**
 * VisibilityMapBuilder — produces a physics-driven "visibility fan" for a POI.
 *
 * IDEA (this is the heart of the new motor):
 *  Instead of picking a search radius by category (HIGH=5km, FLAT=120m, etc.),
 *  we cast rays in every direction from the POI and use building heights + SRTM
 *  terrain to find HOW FAR the POI is actually visible in each direction.
 *
 *  Output: a 72-vertex polygon ("fan") around the POI representing where the POI
 *  is physically visible. Downstream pipeline filters streets by this polygon
 *  instead of by an arbitrary numeric radius.
 *
 *  Trade-off vs. categorical model:
 *   ✅ Zero magic numbers (only a maxHorizon to cap compute, justified by product)
 *   ✅ Asymmetric, real-world shapes (Williamsburg Bridge: long fan on Brooklyn,
 *      short fan blocked by Lower East Side on Manhattan)
 *   ✅ Same code for Cristo Redentor, Pier 97, Roman bridge — physics decides
 *   ⚠️ ~1-3s of extra compute per POI (acceptable, all local data)
 *
 * Earth curvature: included as an additional drop on the line of sight at long
 * distances (matters at 3km+). Earth radius = 6371000m.
 */

import type { BuildingData } from '../services/osm-data-fetcher';
import { calculateDistance, isPointInPolygon } from '../utils/calculations';
import { SRTMLocalService } from '../../srtm-local-service';
import { TRIGGER_POINTS_CONSTANTS } from '../config/trigger-points-config';

export type GeoPoint = { lat: number; lng: number };

export interface VisibilityFan {
  /** Sample points used as origins for the ray-cast (boundary vertices). */
  samplePoints: GeoPoint[];
  poiTopAltitudeM: number;
  poiGroundAltitudeM: number;
  observerEyeHeightM: number;
  /** One polygon per sample point. Acceptance = point inside ANY of these. */
  polygons: GeoPoint[][];
  stats: {
    maxDistanceM: number;
    minDistanceM: number;
    meanDistanceM: number;
    coverageAreaM2: number;
  };
  /** Diagnostic metadata, useful for debugging */
  diagnostics: {
    samplePointCount: number;
    buildingsConsidered: number;
    maxHorizonM: number;
    directionCount: number;
    stepM: number;
    elapsedMs: number;
  };
}

export interface BuildVisibilityFanOptions {
  /** Hard cap on search distance per direction. Default 10km. Product decision. */
  maxHorizonM?: number;
  /** Number of directions to test (sample density of the fan). Default 72 (5° each). */
  directionCount?: number;
  /** Step size when walking outward along a ray. Default 100m. */
  stepM?: number;
  /** Observer eye height (1.7m pedestrian, 1.5m car driver). Default 1.7m. */
  observerEyeHeightM?: number;
  /** Minimum visible distance per direction (avoids degenerate polygons). Default 30m. */
  minVisibleDistanceM?: number;
}

const EARTH_RADIUS_M = 6_371_000;
const SRTM_FAIL_VALUE = 0;

export class VisibilityMapBuilder {
  /**
   * Builds a visibility fan for a POI, sampling MULTIPLE points along the
   * boundary (not just the centroid).
   *
   * Por que múltiplos pontos: POIs longos como pontes têm o centroide em
   * lugar arbitrário (no meio do rio, no caso da Queensboro Bridge). O fan
   * desde o centroide perderia ruas que estão no DECK da ponte longe do
   * centroide. Amostrando ao longo da boundary, o fan resultante (união)
   * cobre toda a região onde o POI é fisicamente visível.
   */
  static async buildFan(
    boundaryCoords: GeoPoint[],
    poiTopAltitudeM: number,
    poiGroundAltitudeM: number,
    buildings: BuildingData[],
    options: BuildVisibilityFanOptions = {}
  ): Promise<VisibilityFan> {
    const maxHorizonM = options.maxHorizonM ?? 10_000;
    const directionCount = options.directionCount ?? 72;
    const stepM = options.stepM ?? 100;
    const observerEyeHeightM = options.observerEyeHeightM ?? 1.7;
    const minVisibleDistanceM = options.minVisibleDistanceM ?? 30;

    const start = Date.now();
    const srtm = SRTMLocalService.getInstance();

    // Pre-compute building tops (terrain elevation + building height) using SRTM
    const buildingTops = await this.computeBuildingTops(buildings, srtm);

    // Sample points along the boundary — quantos depende do tamanho do POI.
    // POI pequeno (boundary curto): 1 ponto (centroide).
    // POI grande/longo: até 12 pontos espaçados.
    const samplePoints = this.sampleBoundary(boundaryCoords);

    // Para cada sample point, computa um fan independente
    const polygons: GeoPoint[][] = [];
    const allDistances: number[] = [];

    for (const sp of samplePoints) {
      const promises = Array.from({ length: directionCount }, (_, i) => {
        const bearing = (i * 360) / directionCount;
        return this.computeMaxVisibleDistance(
          sp,
          poiTopAltitudeM,
          bearing,
          buildingTops,
          srtm,
          maxHorizonM,
          stepM,
          observerEyeHeightM,
          minVisibleDistanceM
        );
      });
      const distances = await Promise.all(promises);
      const bearings = Array.from({ length: directionCount }, (_, i) => (i * 360) / directionCount);
      polygons.push(this.buildPolygon(sp, bearings, distances));
      allDistances.push(...distances);
    }

    const stats = this.computeMultiStats(allDistances, polygons, samplePoints);

    return {
      samplePoints,
      poiTopAltitudeM,
      poiGroundAltitudeM,
      observerEyeHeightM,
      polygons,
      stats,
      diagnostics: {
        samplePointCount: samplePoints.length,
        buildingsConsidered: buildings.length,
        maxHorizonM,
        directionCount,
        stepM,
        elapsedMs: Date.now() - start,
      },
    };
  }

  /**
   * Sampleia pontos ao longo do boundary do POI proporcional ao perímetro.
   * - Boundary com perímetro < 400m: 1 ponto (centroide)
   * - Boundary 400-2000m: 4 pontos
   * - Boundary 2000-5000m: 8 pontos
   * - Boundary > 5000m: 12 pontos (cap)
   *
   * Pra POIs gigantes (área > 1 km²), adiciona grade INTERIOR de até 16 pontos
   * extras. Motivação: pra JFK/parques/campus, sample points só no perímetro
   * fazem ray-cast "ver fora" sem encontrar os próprios prédios do POI como
   * obstáculos. Pontos interiores corrigem isso — o ray sai do centro dum
   * terminal/edifício do aeroporto e BATE em outros terminais antes de escapar,
   * resultando em fan mais conservador e fisicamente correto.
   */
  private static sampleBoundary(coords: GeoPoint[]): GeoPoint[] {
    if (!coords || coords.length === 0) return [];

    // Compute perimeter
    let perimeter = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      perimeter += calculateDistance(coords[i], coords[i + 1]);
    }

    const centroid = this.polygonCentroid(coords);

    // Decide sample count
    let n: number;
    if (perimeter < 400) n = 1;
    else if (perimeter < 2000) n = 4;
    else if (perimeter < 5000) n = 8;
    else n = 12;

    if (n === 1) return [centroid];

    // Distribute n points evenly along the perimeter
    const samples: GeoPoint[] = [centroid]; // always include centroid
    const targetSpacing = perimeter / n;
    let walked = 0;
    let nextTarget = targetSpacing;
    for (let i = 0; i < coords.length - 1 && samples.length < n; i++) {
      const segLen = calculateDistance(coords[i], coords[i + 1]);
      while (walked + segLen >= nextTarget && samples.length < n) {
        const t = (nextTarget - walked) / segLen;
        samples.push({
          lat: coords[i].lat + (coords[i + 1].lat - coords[i].lat) * t,
          lng: coords[i].lng + (coords[i + 1].lng - coords[i].lng) * t,
        });
        nextTarget += targetSpacing;
      }
      walked += segLen;
    }

    // Interior grid pra boundaries grandes (área > 1 km²).
    const area = this.polygonAreaM2(coords);
    const LARGE_AREA_THRESHOLD_M2 = 1_000_000;
    const MAX_INTERIOR_POINTS = 16;
    if (area > LARGE_AREA_THRESHOLD_M2) {
      const before = samples.length;
      // Grid 4×4 dentro do bbox; filtra pelos que caem dentro do polígono.
      let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
      for (const p of coords) {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lng < minLng) minLng = p.lng;
        if (p.lng > maxLng) maxLng = p.lng;
      }
      const cols = 4;
      const rows = 4;
      const interior: GeoPoint[] = [];
      for (let r = 1; r <= rows; r++) {
        for (let c = 1; c <= cols; c++) {
          const lat = minLat + (maxLat - minLat) * (r / (rows + 1));
          const lng = minLng + (maxLng - minLng) * (c / (cols + 1));
          const pt = { lat, lng };
          if (this.isPointInPolygon(pt, coords)) interior.push(pt);
        }
      }
      const toAdd = interior.slice(0, MAX_INTERIOR_POINTS);
      samples.push(...toAdd);
      if (toAdd.length > 0) {
        console.log(`👁️ Large boundary (${(area / 1_000_000).toFixed(2)}km²): added ${toAdd.length} interior sample points (was ${before} on perimeter+centroid)`);
      }
    }

    return samples;
  }

  /**
   * Point-in-polygon ray-cast simples (mesma fórmula que utils/calculations).
   * Inline aqui pra evitar import circular.
   */
  private static isPointInPolygon(point: GeoPoint, polygon: GeoPoint[]): boolean {
    let inside = false;
    const x = point.lng, y = point.lat;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].lng, yi = polygon[i].lat;
      const xj = polygon[j].lng, yj = polygon[j].lat;
      const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /**
   * Área aproximada de polígono em m² via fórmula de shoelace + conversão.
   */
  private static polygonAreaM2(coords: GeoPoint[]): number {
    if (coords.length < 3) return 0;
    let areaDeg = 0;
    for (let i = 0; i < coords.length; i++) {
      const j = (i + 1) % coords.length;
      areaDeg += coords[i].lng * coords[j].lat;
      areaDeg -= coords[j].lng * coords[i].lat;
    }
    areaDeg = Math.abs(areaDeg) / 2;
    // 1° lat ≈ 111_320m; 1° lng ≈ 111_320 × cos(lat). Aproximação no centroide.
    const meanLat = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
    const mPerDegLng = 111_320 * Math.cos((meanLat * Math.PI) / 180);
    const mPerDegLat = 111_320;
    return areaDeg * mPerDegLat * mPerDegLng;
  }

  private static computeMultiStats(
    allDistances: number[],
    polygons: GeoPoint[][],
    samplePoints: GeoPoint[]
  ): VisibilityFan['stats'] {
    const max = Math.max(...allDistances);
    const min = Math.min(...allDistances);
    const mean = allDistances.reduce((s, d) => s + d, 0) / allDistances.length;

    // Approximate coverage area: sum of all individual polygon areas (overestimates
    // overlapping regions, but good enough for rough stats)
    let areaM2 = 0;
    for (let pi = 0; pi < polygons.length; pi++) {
      const polygon = polygons[pi];
      const origin = samplePoints[pi];
      for (let i = 0; i < polygon.length - 1; i++) {
        const a = polygon[i];
        const b = polygon[i + 1];
        const dA = calculateDistance(origin, a);
        const dB = calculateDistance(origin, b);
        const angleRad = (2 * Math.PI) / (polygon.length - 1);
        areaM2 += 0.5 * dA * dB * Math.sin(angleRad);
      }
    }

    return {
      maxDistanceM: Math.round(max),
      minDistanceM: Math.round(min),
      meanDistanceM: Math.round(mean),
      coverageAreaM2: Math.round(areaM2),
    };
  }

  // ───────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────

  /**
   * Builds an enriched list of buildings with their TOP absolute altitude
   * (terrain elevation at building centroid + building height).
   */
  private static async computeBuildingTops(
    buildings: BuildingData[],
    srtm: SRTMLocalService
  ): Promise<Array<{ centroid: GeoPoint; topAltitudeM: number; polygon: GeoPoint[] }>> {
    const result: Array<{ centroid: GeoPoint; topAltitudeM: number; polygon: GeoPoint[] }> = [];
    for (const b of buildings) {
      if (!b.geometry || b.geometry.length < 3) continue;
      const centroid = this.polygonCentroid(b.geometry);
      const groundAlt = (await srtm.getElevation(centroid.lat, centroid.lng)) ?? SRTM_FAIL_VALUE;
      const heightM = this.resolveBuildingHeight(b);
      result.push({
        centroid,
        topAltitudeM: groundAlt + heightM,
        polygon: b.geometry,
      });
    }
    return result;
  }

  /**
   * Extracts a usable building height, with fallbacks.
   */
  private static resolveBuildingHeight(b: BuildingData): number {
    if (b.height && b.height > 0) return b.height;
    const tags = b.tags || {};
    const levels = parseFloat(tags['building:levels'] as any);
    if (!isNaN(levels) && levels > 0) return levels * 3.5;
    // Fallback conservador (SSOT em TRIGGER_POINTS_CONSTANTS.obstructions.defaultHouseHeight)
    return TRIGGER_POINTS_CONSTANTS.obstructions.defaultHouseHeight;
  }

  /**
   * For a single direction, walks outward from POI and returns the maximum
   * distance at which the POI top is still visible (no building/terrain blocks
   * the line from POI top to an observer eye at that point).
   */
  private static async computeMaxVisibleDistance(
    poi: GeoPoint,
    poiTopAltitudeM: number,
    bearing: number,
    buildings: Array<{ centroid: GeoPoint; topAltitudeM: number; polygon: GeoPoint[] }>,
    srtm: SRTMLocalService,
    maxHorizonM: number,
    stepM: number,
    observerEyeHeightM: number,
    minVisibleDistanceM: number
  ): Promise<number> {
    // Pre-filter: keep only buildings whose footprint touches the ray corridor
    // (within ~50m perpendicular distance to the ray). This avoids O(N) per step.
    const relevantBuildings = this.filterBuildingsAlongRay(poi, bearing, maxHorizonM, buildings);

    // Sort by distance from POI — we'll iterate them in order
    const buildingsSorted = relevantBuildings
      .map(b => ({ ...b, distanceFromPoi: calculateDistance(poi, b.centroid) }))
      .sort((a, b) => a.distanceFromPoi - b.distanceFromPoi);

    let lastVisibleD = minVisibleDistanceM;

    for (let d = stepM; d <= maxHorizonM; d += stepM) {
      const observerPoint = this.offsetByBearing(poi, bearing, d);
      const terrainAlt = (await srtm.getElevation(observerPoint.lat, observerPoint.lng)) ?? SRTM_FAIL_VALUE;
      // Apply Earth-curvature drop: distant observer appears LOWER relative to POI
      const earthDropM = (d * d) / (2 * EARTH_RADIUS_M);
      const observerEyeAlt = terrainAlt + observerEyeHeightM - earthDropM;

      const blocked = this.isLineOfSightBlocked(
        poi,
        poiTopAltitudeM,
        observerPoint,
        observerEyeAlt,
        d,
        buildingsSorted,
        srtm
      );

      // Check terrain along the way (intermediate samples) — async-light by reusing SRTM cache
      const blockedByTerrain = await this.isBlockedByTerrainAlongRay(
        poi,
        poiTopAltitudeM,
        observerPoint,
        observerEyeAlt,
        d,
        bearing,
        stepM,
        srtm
      );

      if (blocked || blockedByTerrain) {
        return Math.max(lastVisibleD, minVisibleDistanceM);
      }
      lastVisibleD = d;
    }

    return Math.max(lastVisibleD, minVisibleDistanceM);
  }

  /**
   * Returns true if any pre-sorted building's TOP altitude is above the line
   * from POI top to observer eye at the building's distance along the ray.
   */
  private static isLineOfSightBlocked(
    _poi: GeoPoint,
    poiTopAltitudeM: number,
    _observer: GeoPoint,
    observerEyeAlt: number,
    observerDistanceM: number,
    buildings: Array<{ distanceFromPoi: number; topAltitudeM: number }>,
    _srtm: SRTMLocalService
  ): boolean {
    for (const b of buildings) {
      // Only buildings between POI and observer can block
      if (b.distanceFromPoi >= observerDistanceM) break;
      // Linear interpolation of sight-line altitude at the building distance
      const t = b.distanceFromPoi / observerDistanceM;
      const lineAltAtBuilding = poiTopAltitudeM * (1 - t) + observerEyeAlt * t;
      if (b.topAltitudeM > lineAltAtBuilding) {
        return true;
      }
    }
    return false;
  }

  /**
   * Samples SRTM terrain at a few intermediate points along the ray and
   * checks if the terrain itself blocks the sight line. Critical for non-urban
   * areas (mountains, hills) and for HIGH POIs visible from afar.
   */
  private static async isBlockedByTerrainAlongRay(
    poi: GeoPoint,
    poiTopAltitudeM: number,
    observer: GeoPoint,
    observerEyeAlt: number,
    observerDistanceM: number,
    bearing: number,
    stepM: number,
    srtm: SRTMLocalService
  ): Promise<boolean> {
    // Sample 5-10 intermediate terrain points (cheap with local SRTM)
    const sampleCount = Math.max(3, Math.min(10, Math.floor(observerDistanceM / 500)));
    if (sampleCount < 3) return false;

    for (let i = 1; i < sampleCount; i++) {
      const sampleDistance = (observerDistanceM * i) / sampleCount;
      const samplePoint = this.offsetByBearing(poi, bearing, sampleDistance);
      const terrainAlt = (await srtm.getElevation(samplePoint.lat, samplePoint.lng)) ?? SRTM_FAIL_VALUE;
      const t = sampleDistance / observerDistanceM;
      const lineAlt = poiTopAltitudeM * (1 - t) + observerEyeAlt * t;
      // Small margin (5m) to forgive SRTM resolution noise
      if (terrainAlt > lineAlt + 5) {
        return true;
      }
    }
    return false;
  }

  /**
   * Filters buildings whose footprint is "near" the ray (within ~50m perpendicular).
   * Used as a cheap O(N) pre-filter before per-step blocking checks.
   */
  private static filterBuildingsAlongRay(
    poi: GeoPoint,
    bearing: number,
    maxHorizonM: number,
    buildings: Array<{ centroid: GeoPoint; topAltitudeM: number; polygon: GeoPoint[] }>
  ): Array<{ centroid: GeoPoint; topAltitudeM: number; polygon: GeoPoint[] }> {
    const corridorWidthM = 50;
    const rayEnd = this.offsetByBearing(poi, bearing, maxHorizonM);
    return buildings.filter(b => {
      const distToRay = this.perpendicularDistanceToSegment(b.centroid, poi, rayEnd);
      if (distToRay > corridorWidthM) return false;
      // Also: building must be in front of POI along the ray (not behind it)
      const distAlongRay = this.distanceAlongSegment(b.centroid, poi, rayEnd);
      return distAlongRay > 0 && distAlongRay < maxHorizonM;
    });
  }

  /**
   * Builds a closed GeoJSON-style polygon from the visibility distances.
   */
  private static buildPolygon(poi: GeoPoint, bearings: number[], distancesM: number[]): GeoPoint[] {
    const poly: GeoPoint[] = [];
    for (let i = 0; i < bearings.length; i++) {
      poly.push(this.offsetByBearing(poi, bearings[i], distancesM[i]));
    }
    // Close the polygon
    if (poly.length > 0) poly.push({ ...poly[0] });
    return poly;
  }

  // ───────────────────────────────────────────────────────────────────
  // Geometry helpers (local; could be moved to lib/geometry later)
  // ───────────────────────────────────────────────────────────────────

  private static offsetByBearing(origin: GeoPoint, bearingDeg: number, distanceM: number): GeoPoint {
    const θ = (bearingDeg * Math.PI) / 180;
    const δ = distanceM / EARTH_RADIUS_M;
    const φ1 = (origin.lat * Math.PI) / 180;
    const λ1 = (origin.lng * Math.PI) / 180;

    const φ2 = Math.asin(
      Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
    );
    const λ2 =
      λ1 +
      Math.atan2(
        Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
        Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
      );

    return { lat: (φ2 * 180) / Math.PI, lng: (λ2 * 180) / Math.PI };
  }

  private static polygonCentroid(coords: GeoPoint[]): GeoPoint {
    let lat = 0;
    let lng = 0;
    for (const c of coords) {
      lat += c.lat;
      lng += c.lng;
    }
    return { lat: lat / coords.length, lng: lng / coords.length };
  }

  /** Perpendicular distance from a point to the segment (in meters, planar approx). */
  private static perpendicularDistanceToSegment(p: GeoPoint, a: GeoPoint, b: GeoPoint): number {
    const M_PER_DEG_LAT = 111_000;
    const M_PER_DEG_LNG = 111_000 * Math.cos((a.lat * Math.PI) / 180);

    const px = p.lng * M_PER_DEG_LNG, py = p.lat * M_PER_DEG_LAT;
    const ax = a.lng * M_PER_DEG_LNG, ay = a.lat * M_PER_DEG_LAT;
    const bx = b.lng * M_PER_DEG_LNG, by = b.lat * M_PER_DEG_LAT;

    const dx = bx - ax, dy = by - ay;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);

    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (len * len)));
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
  }

  /** Distance from `a` to the closest point of segment (a..b) to `p`. */
  private static distanceAlongSegment(p: GeoPoint, a: GeoPoint, b: GeoPoint): number {
    const M_PER_DEG_LAT = 111_000;
    const M_PER_DEG_LNG = 111_000 * Math.cos((a.lat * Math.PI) / 180);

    const px = p.lng * M_PER_DEG_LNG, py = p.lat * M_PER_DEG_LAT;
    const ax = a.lng * M_PER_DEG_LNG, ay = a.lat * M_PER_DEG_LAT;
    const bx = b.lng * M_PER_DEG_LNG, by = b.lat * M_PER_DEG_LAT;

    const dx = bx - ax, dy = by - ay;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return 0;

    return ((px - ax) * dx + (py - ay) * dy) / len;
  }
}

/**
 * Returns true if a point is visible (inside ANY of the fan's polygons).
 * Multi-polygon: a fan from a long POI has one polygon per sample point on the
 * boundary; a point is "visible" if it falls inside at least one.
 */
export function isPointVisible(point: GeoPoint, fan: VisibilityFan): boolean {
  for (const poly of fan.polygons) {
    if (isPointInPolygon(point, poly)) return true;
  }
  return false;
}

/**
 * Filter helper: returns the subset of points that fall inside any fan polygon.
 */
export function pointsInsideFan(points: GeoPoint[], fan: VisibilityFan): GeoPoint[] {
  return points.filter(p => isPointVisible(p, fan));
}

/**
 * VisibilityMapBuilder — produces a physics-driven "visibility fan" for a POI.
 *
 * IDEA (this is the heart of the new motor):
 *  Instead of picking a search radius by category (HIGH=5km, FLAT=120m, etc.),
 *  we cast rays in every direction from the POI over the relief surface (Copernicus
 *  GLO-30: ground + buildings + trees) and the tagged building heights to find HOW FAR
 *  the POI is actually visible in each direction.
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
 * Earth curvature and standard refraction (k = 0.13): every point of the profile drops by
 * d²(1 − k) / 2R below the tangent plane at the POI, observer and obstacles alike (#782).
 *
 * Relief (#782, INV-EPc): read from disk through `DemStore`, prepared once per city (EP).
 * Surface: produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and
 * Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights
 * reserved. Ground: GEDTM30 v1.2.0, OpenGeoHub, doi:10.5281/zenodo.18887460, CC BY 4.0.
 */

import type { BuildingData } from '../services/osm-data-fetcher';
import { calculateDistance, findClosestPointOnBoundary, isPointInPolygon } from '../utils/calculations';
import { DemStore } from '../../dem/dem-store';
import { MIN_APPARENT_ANGLE_DEG, heightFromTags } from '../config/visibility-class';

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
  /** Step when walking outward along a ray. Default: the relief grid spacing (~30 m, #782). */
  stepM?: number;
  /** Observer eye height (1.7m pedestrian, 1.5m car driver). Default 1.7m. */
  observerEyeHeightM?: number;
  /** Minimum visible distance per direction (avoids degenerate polygons). Default 30m. */
  minVisibleDistanceM?: number;
}

const EARTH_RADIUS_M = 6_371_000;
/** Standard atmospheric refraction coefficient: the sight line bends back k of the curvature (#782). */
export const REFRACTION_K = 0.13;
/**
 * How far an obstacle may stand above the sight line before it blocks: the absolute vertical
 * accuracy of Copernicus GLO-30 (< 4 m LE90, Copernicus DEM Product Handbook). One margin for the
 * surface and for tagged buildings, in the fan and per candidate (#782; SRTM needed 15 m).
 */
export const SIGHT_NOISE_MARGIN_M = 4;

/** Drop of a point d metres away below the tangent plane at the origin: curvature minus refraction. */
export function curvatureDropM(d: number): number {
  return ((1 - REFRACTION_K) * d * d) / (2 * EARTH_RADIUS_M);
}

/**
 * What the sight line reads (E4/E8); `DemStore` in the engine, a stub in tests. `obstacle` is the
 * top of what stands there: measured building or canopy over the ground, else the surface (#783).
 */
export interface SightRelief {
  ground(lat: number, lng: number): number | null;
  surface(lat: number, lng: number): number | null;
  obstacle(lat: number, lng: number): number | null;
}

type BuildingTop = { centroid: GeoPoint; topAltitudeM: number; polygon: GeoPoint[] };

/** INV-E8b: one point of the POI the sight line aims at (altitude in metres). */
export interface SightAim { at: GeoPoint; altM: number; kind: 'top' | 'mid' | 'edge' | 'relief' }

/** INV-E8b: graded sight from one observer; `fraction` and `angleDeg` go to the E8 trace. */
export interface SightMeasure { visible: number; total: number; fraction: number; angleDeg: number; passes: boolean }

/**
 * INV-E8b: boundary points the sight line aims at, and the share of the POI height each one
 * stands at. Technical choice (#784): 12 points × ground / half / full height = 36 edge aims,
 * a point every 30° around a compact POI.
 */
export const EDGE_AIM_COUNT = 12;
const EDGE_AIM_LEVELS = [0, 0.5, 1] as const;
/** INV-E8b, relief landmark: 8 bearings × rings to 800 m, cut where the upper half ends (#784). */
const RELIEF_AIM_BEARINGS = 8;
const RELIEF_AIM_RINGS_M = [50, 100, 200, 400, 800] as const;

/**
 * FAN ONLY: buildings this close to the POI (beyond its own boundary) are the POI itself or glued
 * to it (pedestal, chapel, summit station), so the coarse fan never collapses on them (#779: it
 * counted the Cristo's own buildings and fell to 30 m). The fan is a generous pre-filter; the
 * per-candidate check excludes only the POI footprint, never a radius (INV-E8b, #784).
 */
const SKIP_NEAR_POI_M = 50;
/** Observer eye above the ground at the TP (INV-E8): the one value for the fan and each candidate. */
export const OBSERVER_EYE_HEIGHT_M = 1.7;

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
  /**
   * INV-E8 (P8): what the sight line aims at — the ground at the highest point of the boundary
   * (E4, `boundary.physical.groundTopM`) plus the POI height (E3). One formula for the fan and
   * for each candidate; they used to pick `elevation.max|average|center` by a height>20 guess.
   * A POI with no height is still seen at eye level. `boundary.height` above the measured one
   * only comes from the host building (`predictor#useContainingBuildingHeight`, E2): the storefront
   * is seen by its facade.
   */
  static poiSightTarget(boundary: {
    physical?: { groundTopM: number | null; heightM: number };
    height?: number;
    elevation?: { center?: number };
  }): { groundM: number; heightM: number; topM: number } {
    const groundM = boundary.physical?.groundTopM ?? boundary.elevation?.center ?? 0;
    const heightM = Math.max(boundary.physical?.heightM ?? 0, boundary.height ?? 0, OBSERVER_EYE_HEIGHT_M);
    return { groundM, heightM, topM: groundM + heightM };
  }

  static async buildFan(
    boundaryCoords: GeoPoint[],
    poiTopAltitudeM: number,
    poiGroundAltitudeM: number,
    buildings: BuildingData[],
    options: BuildVisibilityFanOptions = {}
  ): Promise<VisibilityFan> {
    const maxHorizonM = options.maxHorizonM ?? 10_000;
    const directionCount = options.directionCount ?? 72;
    const dem = DemStore.getInstance();
    // Walk at the obstacle lattice (~15 m, #783); the observer's own relief cell stays out.
    const stepM = options.stepM ?? dem.sampleM;
    const cellM = options.stepM ?? dem.stepM;
    const observerEyeHeightM = options.observerEyeHeightM ?? OBSERVER_EYE_HEIGHT_M;
    const minVisibleDistanceM = options.minVisibleDistanceM ?? 30;

    const start = Date.now();

    // Tops of the buildings with a measured height (ground + tag); the rest is in the surface.
    const buildingTops = this.computeBuildingTops(buildings, dem);

    // Sample points along the boundary — quantos depende do tamanho do POI.
    // POI pequeno (boundary curto): 1 ponto (centroide).
    // POI grande/longo: até 12 pontos espaçados.
    const samplePoints = this.sampleBoundary(boundaryCoords);
    // Single sample (centroid): the POI's own footprint reaches as far as its boundary.
    const ownRadiusM = samplePoints.length === 1 && boundaryCoords.length
      ? Math.max(...boundaryCoords.map(c => calculateDistance(samplePoints[0], c)))
      : 0;
    const skipNearM = SKIP_NEAR_POI_M + ownRadiusM;

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
          dem,
          maxHorizonM,
          stepM,
          observerEyeHeightM,
          minVisibleDistanceM,
          skipNearM,
          cellM
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

  /**
   * INV-E8b (#784) — the points of the POI the sight line aims at: the top and the mid-height
   * over the highest point of the boundary (E4), and `EDGE_AIM_COUNT` points evenly spaced on the
   * boundary, each at `EDGE_AIM_LEVELS` of the POI height over the ground at that point. The mid
   * height runs from the lowest edge ground to the top, so a hill's mid aim is on its body. A
   * synthetic circle is not a footprint: its edge stands on the POI ground (E4), not on the DEM
   * under the circle — at the Cristo the GEDTM30 reads 513 m for a 710 m summit.
   *
   * A relief landmark (`landmark_prominence`) is the mountain, not the circle on its summit: it
   * also aims at the top of what stands on the upper half of its relief (ground above the summit
   * minus half the local prominence), along `RELIEF_AIM_BEARINGS` bearings at `RELIEF_AIM_RINGS_M`.
   * Its own slope stays an obstacle: the far side of the mountain is not seen.
   */
  static sightAims(
    boundary: {
      coordinates?: GeoPoint[];
      center?: GeoPoint;
      synthetic?: boolean;
      physical?: {
        groundTopM: number | null;
        heightM: number;
        topPoint?: GeoPoint | null;
        classRule?: string;
        localProminenceM?: number | null;
      };
      height?: number;
      elevation?: { center?: number };
    },
    relief: Pick<SightRelief, 'ground' | 'obstacle'> = DemStore.getInstance()
  ): SightAim[] {
    const { groundM, heightM, topM } = this.poiSightTarget(boundary);
    const ring = boundary.coordinates && boundary.coordinates.length >= 3 ? boundary.coordinates : [];
    const topAt = boundary.physical?.topPoint ?? boundary.center ?? (ring.length ? this.polygonCentroid(ring) : null);
    const edge = ring.length ? this.evenlyAlongRing(ring, EDGE_AIM_COUNT) : [];
    const edgeGround = edge.map(v => (boundary.synthetic ? groundM : relief.ground(v.lat, v.lng) ?? groundM));
    const baseM = Math.min(groundM, ...edgeGround);
    const aims: SightAim[] = topAt
      ? [{ at: topAt, altM: topM, kind: 'top' }, { at: topAt, altM: (baseM + topM) / 2, kind: 'mid' }]
      : [];
    edge.forEach((v, i) => {
      for (const f of EDGE_AIM_LEVELS) aims.push({ at: v, altM: edgeGround[i] + f * heightM, kind: 'edge' });
    });
    const ph = boundary.physical;
    if (topAt && ph?.classRule === 'landmark_prominence' && ph.localProminenceM) {
      const upperHalfM = groundM - ph.localProminenceM / 2;
      for (let k = 0; k < RELIEF_AIM_BEARINGS; k++) {
        for (const r of RELIEF_AIM_RINGS_M) {
          const at = this.offsetByBearing(topAt, (k * 360) / RELIEF_AIM_BEARINGS, r);
          const g = relief.ground(at.lat, at.lng);
          const top = relief.obstacle(at.lat, at.lng);
          if (g === null || top === null || g < upperHalfM) break; // left the upper half on this bearing
          aims.push({ at, altM: top, kind: 'relief' });
        }
      }
    }
    return aims;
  }

  /**
   * INV-E8b (#784) — the edge point facing one observer (nearest point of the boundary), with the
   * same levels as the sampled edge points: next to a 13 km bridge the 12 sampled points are a
   * kilometre away, and the stretch the observer stands beside must be an aim too.
   */
  static facingAims(
    boundary: Parameters<typeof VisibilityMapBuilder.sightAims>[0],
    observer: GeoPoint,
    relief: Pick<SightRelief, 'ground'> = DemStore.getInstance()
  ): SightAim[] {
    const ring = boundary.coordinates && boundary.coordinates.length >= 3 ? boundary.coordinates : null;
    if (!ring) return [];
    const { groundM, heightM } = this.poiSightTarget(boundary);
    const { lat, lng } = findClosestPointOnBoundary(observer, ring);
    const at = { lat, lng };
    const g = boundary.synthetic ? groundM : relief.ground(at.lat, at.lng) ?? groundM;
    return EDGE_AIM_LEVELS.map(f => ({ at, altM: g + f * heightM, kind: 'edge' as const }));
  }

  /**
   * INV-E8b (#784) — graded sight from one observer: which aims he sees (INV-E8, each by
   * `checkExactVisibility`, with the POI footprint as the only part of the line that is not an
   * obstacle) and the angle the visible part spans in his view — the largest angle between two
   * visible aims, seen from his eye. The candidate passes when that angle reaches
   * `MIN_APPARENT_ANGLE_DEG` (provisional, #775): one visible point is not a POI the tourist sees.
   */
  static async measureSight(
    aims: SightAim[],
    observer: GeoPoint,
    options: {
      footprint?: GeoPoint[] | null;
      buildingTops?: Array<{ centroid: GeoPoint; topAltitudeM: number; polygon?: GeoPoint[] }>;
      sampleIntervalM?: number;
    } = {}
  ): Promise<SightMeasure> {
    const seen: SightAim[] = [];
    for (const aim of aims) {
      if (await this.checkExactVisibility(aim.at, aim.altM, observer, options)) seen.push(aim);
    }
    const angleDeg = this.apparentAngleDeg(seen, observer);
    return {
      visible: seen.length,
      total: aims.length,
      fraction: aims.length ? seen.length / aims.length : 0,
      angleDeg,
      passes: angleDeg >= MIN_APPARENT_ANGLE_DEG,
    };
  }

  /** Largest angle between two aims seen from the observer eye (local metres, curvature included). */
  static apparentAngleDeg(aims: SightAim[], observer: GeoPoint, relief: Pick<SightRelief, 'ground'> = DemStore.getInstance()): number {
    if (aims.length < 2) return 0;
    const eyeM = (relief.ground(observer.lat, observer.lng) ?? 0) + OBSERVER_EYE_HEIGHT_M;
    const kx = 111_320 * Math.cos((observer.lat * Math.PI) / 180), ky = 110_540;
    const dirs = aims.map(a => {
      const x = (a.at.lng - observer.lng) * kx, y = (a.at.lat - observer.lat) * ky;
      const z = a.altM - curvatureDropM(Math.hypot(x, y)) - eyeM;
      const n = Math.hypot(x, y, z) || 1;
      return [x / n, y / n, z / n];
    });
    let minDot = 1;
    for (let i = 0; i < dirs.length; i++) {
      for (let j = i + 1; j < dirs.length; j++) {
        minDot = Math.min(minDot, dirs[i][0] * dirs[j][0] + dirs[i][1] * dirs[j][1] + dirs[i][2] * dirs[j][2]);
      }
    }
    return (Math.acos(Math.max(-1, Math.min(1, minDot))) * 180) / Math.PI;
  }

  /** `n` points evenly spaced along a closed ring, by walked length. */
  private static evenlyAlongRing(ring: GeoPoint[], n: number): GeoPoint[] {
    const pts = [...ring];
    if (pts[0].lat !== pts[pts.length - 1].lat || pts[0].lng !== pts[pts.length - 1].lng) pts.push(pts[0]);
    const seg = pts.slice(1).map((p, i) => calculateDistance(pts[i], p));
    const perimeter = seg.reduce((a, b) => a + b, 0);
    if (perimeter === 0) return [pts[0]];
    const out: GeoPoint[] = [];
    let i = 0, walked = 0;
    for (let k = 0; k < n; k++) {
      const target = (k * perimeter) / n;
      while (i < seg.length - 1 && walked + seg[i] < target) walked += seg[i++];
      const t = seg[i] ? (target - walked) / seg[i] : 0;
      out.push({ lat: pts[i].lat + (pts[i + 1].lat - pts[i].lat) * t, lng: pts[i].lng + (pts[i + 1].lng - pts[i].lng) * t });
    }
    return out;
  }

  /**
   * INV-E8 — one sight line, from the observer eye (ground at the TP + `OBSERVER_EYE_HEIGHT_M`) to
   * one aim of the POI (INV-E8b: `sightAims`), over `DemStore#obstacle` — measured building
   * (Overture, 3D-GloBFP) or canopy (Meta/WRI) over the ground, else the relief SURFACE
   * (Copernicus GLO-30) — and the buildings with a tagged height, walked at the obstacle lattice
   * (~15 m, #783; it was 30 m, and 100 m over SRTM 90 m). Short-circuits on the first obstacle.
   *
   * What is not an obstacle at the POI end is the POI itself: the stretch of the line inside
   * `footprint`, plus one obstacle cell (its own building, rasterised at ~15 m). There is no fixed
   * radius (#784: 50 m hid every building between a street and a low POI). At the observer end,
   * his own relief cell (~30 m) is the street he stands on — at 30 m the surface there mixes in
   * the facades beside the avenue (#782).
   */
  static async checkExactVisibility(
    poi: GeoPoint,
    poiTopAltitudeM: number,
    target: GeoPoint,
    options: {
      sampleIntervalM?: number;
      noiseMarginM?: number;
      observerEyeHeightM?: number;
      buildingTops?: Array<{ centroid: GeoPoint; topAltitudeM: number; polygon?: GeoPoint[] }>;
      footprint?: GeoPoint[] | null;
    } = {}
  ): Promise<boolean> {
    const dem: SightRelief = DemStore.getInstance();
    // Walked at the obstacle lattice (~15 m, #783); the observer keeps his relief cell (~30 m) out.
    const stepM = options.sampleIntervalM ?? DemStore.getInstance().sampleM;
    const cellM = options.sampleIntervalM ?? DemStore.getInstance().stepM;
    const marginM = options.noiseMarginM ?? SIGHT_NOISE_MARGIN_M;
    const observerEyeHeightM = options.observerEyeHeightM ?? OBSERVER_EYE_HEIGHT_M;
    const buildingTops = options.buildingTops;

    const distanceM = calculateDistance(poi, target);
    if (distanceM < cellM) return true; // inside one relief cell: nothing can stand between

    // No ground under the observer: the candidate cannot be judged, so it does not pass (INV-E8).
    const observerGround = dem.ground(target.lat, target.lng);
    if (observerGround === null) return false;
    const observerEyeAlt = observerGround + observerEyeHeightM - curvatureDropM(distanceM);
    // The sight line, as the slope from the aim; an obstacle blocks when its slope is steeper.
    const sightSlope = (observerEyeAlt - poiTopAltitudeM) / distanceM;
    const bearingDeg = this.bearing(poi, target);
    // INV-E8b: the POI's own stretch of the line — up to where it last leaves the footprint.
    const ring = options.footprint && options.footprint.length >= 3 ? options.footprint : null;
    const ownM = (ring ? (this.lastCrossingT(poi, target, ring) ?? 0) : 0) * distanceM + stepM;

    for (let d = stepM; d <= distanceM - cellM + 1e-6; d += stepM) {
      if (d < ownM - 1e-6) continue; // the first cell past the footprint is tested
      const p = this.offsetByBearing(poi, bearingDeg, d);
      const top = dem.obstacle(p.lat, p.lng);
      if (top === null) continue;
      if ((top - curvatureDropM(d) - marginM - poiTopAltitudeM) / d > sightSlope) return false;
    }

    // Buildings with a measured height (ground + tag). Foco no observador: a linha está mais
    // baixa perto dele, então prédios próximos ao observador bloqueiam com altura modesta.
    if (buildingTops && buildingTops.length > 0) {
      const CORRIDOR_WIDTH_M = 30; // semi-largura: prédio dentro de ±30m do raio é considerado
      for (const b of buildingTops) {
        const distFromPoi = calculateDistance(poi, b.centroid);
        if (distFromPoi >= distanceM) continue;       // atrás do observador
        const perpDist = this.perpendicularDistanceToSegment(b.centroid, poi, target);
        if (perpDist > CORRIDOR_WIDTH_M) continue;
        // With a footprint, the building blocks only where the ray CROSSES it, at the crossing
        // nearest the observer (the line is lowest there). By centroid ± corridor, the row of
        // buildings beside a beachfront avenue hid a peak seen straight along the avenue
        // (Irmão Menor from the Vieira Souto; profile in #772). A building behind or beside the
        // observer is not crossed.
        const t = b.polygon && b.polygon.length >= 3 ? this.lastCrossingT(poi, target, b.polygon) : distFromPoi / distanceM;
        if (t === null) continue;
        const d = t * distanceM;
        if (d < ownM) continue; // the POI itself, or inside its own stretch (INV-E8b)
        if ((b.topAltitudeM - curvatureDropM(d) - marginM - poiTopAltitudeM) / d > sightSlope) {
          return false; // prédio bloqueia
        }
      }
    }

    return true;
  }

  /**
   * Fraction (0–1, POI → observer) of the LAST point where the segment crosses the polygon
   * edge; null when it does not cross. Local planar metres: the segments are a few km.
   */
  static lastCrossingT(from: GeoPoint, to: GeoPoint, polygon: GeoPoint[]): number | null {
    const kx = 111_320 * Math.cos((from.lat * Math.PI) / 180), ky = 110_540;
    const xy = (p: GeoPoint) => ({ x: (p.lng - from.lng) * kx, y: (p.lat - from.lat) * ky });
    const r = xy(to);
    let best: number | null = null;
    for (let i = 0; i < polygon.length; i++) {
      const a = xy(polygon[i]), b = xy(polygon[(i + 1) % polygon.length]);
      const e = { x: b.x - a.x, y: b.y - a.y };
      const den = r.x * e.y - r.y * e.x;
      if (den === 0) continue;
      const t = (a.x * e.y - a.y * e.x) / den;
      const u = (a.x * r.y - a.y * r.x) / den;
      if (t >= 0 && t < 1 && u >= 0 && u <= 1 && (best === null || t > best)) best = t;
    }
    return best;
  }

  // ───────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────

  /**
   * Tops of the buildings whose height is MEASURED (`height` / `building:levels`): ground under
   * the centroid + that height. A building without it is already in the relief surface, with
   * the height the surface measured (#782: this replaced the 10 m guess); adding a guessed
   * block on top of the surface would count it twice.
   */
  private static computeBuildingTops(buildings: BuildingData[], dem: SightRelief): BuildingTop[] {
    const result: BuildingTop[] = [];
    for (const b of buildings) {
      if (!b.geometry || b.geometry.length < 3) continue;
      const heightM = this.measuredBuildingHeight(b);
      if (heightM === null) continue;
      const centroid = this.polygonCentroid(b.geometry);
      const groundAlt = dem.ground(centroid.lat, centroid.lng);
      if (groundAlt === null) continue;
      result.push({ centroid, topAltitudeM: groundAlt + heightM, polygon: b.geometry });
    }
    return result;
  }

  /** The tagged height of a building (the one floor ruler, INV-E3), or null when it has none. */
  private static measuredBuildingHeight(b: BuildingData): number | null {
    if (b.height && b.height > 0) return b.height;
    return heightFromTags(b.tags as Record<string, unknown> | undefined)?.heightM ?? null;
  }

  /**
   * For a single direction, walks outward from the POI at the obstacle lattice up to the horizon
   * and returns the FARTHEST distance at which the POI top is visible — not the first blocked step.
   * One pass: the steepest obstacle slope seen so far (`DemStore#obstacle`, and the tagged buildings passed)
   * against the slope of the line to the observer eye at each step.
   */
  private static computeMaxVisibleDistance(
    poi: GeoPoint,
    poiTopAltitudeM: number,
    bearing: number,
    buildings: BuildingTop[],
    dem: SightRelief,
    maxHorizonM: number,
    stepM: number,
    observerEyeHeightM: number,
    minVisibleDistanceM: number,
    skipNearM = SKIP_NEAR_POI_M,
    cellM = stepM
  ): number {
    // Pre-filter: keep only buildings whose footprint touches the ray corridor
    // (within ~50m perpendicular distance to the ray). This avoids O(N) per step.
    const buildingsSorted = this.filterBuildingsAlongRay(poi, bearing, maxHorizonM, buildings)
      .map(b => ({ ...b, distanceFromPoi: calculateDistance(poi, b.centroid) }))
      .filter(b => b.distanceFromPoi >= skipNearM)
      .sort((a, b) => a.distanceFromPoi - b.distanceFromPoi);

    let lastVisibleD = minVisibleDistanceM;
    // Steepest obstacle at least one relief cell before the current observer sample (his own
    // cell is the street): samples wait in `pending` until the observer is a cell past them.
    let maxSlope = -Infinity;
    const pending: Array<{ d: number; slope: number }> = [];
    let bi = 0;

    for (let d = stepM; d <= maxHorizonM; d += stepM) {
      while (pending.length && pending[0].d <= d - cellM + 1e-6) maxSlope = Math.max(maxSlope, pending.shift()!.slope);
      while (bi < buildingsSorted.length && buildingsSorted[bi].distanceFromPoi < d) {
        const b = buildingsSorted[bi++];
        const s = b.distanceFromPoi;
        maxSlope = Math.max(maxSlope, (b.topAltitudeM - curvatureDropM(s) - SIGHT_NOISE_MARGIN_M - poiTopAltitudeM) / s);
      }
      const p = this.offsetByBearing(poi, bearing, d);
      const ground = dem.ground(p.lat, p.lng);
      // Visibility is not monotonic along a ray: on a hill the slope right below the top
      // hides it from a close observer while the plain further out sees it (Cristo from the
      // Lagoa). The fan is the OUTER reach per bearing; each candidate is then checked by
      // `checkExactVisibility` (BR-AUDIO-010; #779).
      if (ground !== null) {
        const eye = ground + observerEyeHeightM - curvatureDropM(d);
        if ((eye - poiTopAltitudeM) / d >= maxSlope) lastVisibleD = d;
      }
      const top = dem.obstacle(p.lat, p.lng);
      if (top !== null && d >= skipNearM) pending.push({ d, slope: (top - curvatureDropM(d) - SIGHT_NOISE_MARGIN_M - poiTopAltitudeM) / d });
    }

    return Math.max(lastVisibleD, minVisibleDistanceM);
  }

  /**
   * Filters buildings whose footprint is "near" the ray (within ~50m perpendicular).
   * Used as a cheap O(N) pre-filter before per-step blocking checks.
   */
  private static filterBuildingsAlongRay(
    poi: GeoPoint,
    bearing: number,
    maxHorizonM: number,
    buildings: BuildingTop[]
  ): BuildingTop[] {
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

  private static bearing(from: GeoPoint, to: GeoPoint): number {
    const φ1 = (from.lat * Math.PI) / 180;
    const φ2 = (to.lat * Math.PI) / 180;
    const Δλ = ((to.lng - from.lng) * Math.PI) / 180;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (Math.atan2(y, x) * 180) / Math.PI;
  }

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

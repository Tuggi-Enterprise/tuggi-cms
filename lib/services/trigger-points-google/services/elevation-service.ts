import { GeographicContext, GeoPoint, POIData } from '../types/interfaces';
import { SRTMLocalService } from '../../srtm-local-service';
import { LRUCacheWithTTL } from '../utils/lru-cache';
import { LocalReverseGeocoder } from '../../local-reverse-geocoder';
import { calculateDistance, calculateDistanceToPolygon } from '../utils/calculations';
import {
  CITY_BASE_GRID_STEP_M,
  CITY_BASE_RADIUS_M,
  LOCAL_BASE_DIRECTIONS,
  LOCAL_BASE_PERCENTILE,
  LOCAL_BASE_RING_M,
  RELIEF_FOOT_FRACTION,
  RELIEF_MAX_RADIUS_M,
  RELIEF_MIN_M,
  RELIEF_RAYS,
  RELIEF_SADDLE_RISE_M,
  RELIEF_STEP_M,
  SUMMIT_MATCH_M,
  landPercentile,
} from '../config/visibility-class';

type LatLng = { lat: number; lng: number };
type ElevationReader = (lat: number, lng: number) => Promise<number | null>;

export interface CityBase {
  /** null when the DEM gave nothing (INV-E4c) */
  baseM: number | null;
  /** `geonames:<id>` (city centre) or `poi_cell:<lat,lng>` when no city was found */
  source: string;
}

export interface GroundTop {
  /** terrain at the highest point of the boundary; null when the DEM failed (INV-E4c) */
  groundM: number | null;
  at: LatLng | null;
  source: 'ele_tag' | 'summit_ele' | 'srtm_boundary_max' | 'none';
}

const srtmReader: ElevationReader = (lat, lng) =>
  SRTMLocalService.getInstance().getElevation(lat, lng).catch(() => null);

function offsetM(o: LatLng, northM: number, eastM: number): LatLng {
  return {
    lat: o.lat + northM / 110_540,
    lng: o.lng + eastM / (111_320 * Math.cos((o.lat * Math.PI) / 180)),
  };
}

function parseEle(raw: unknown): number | null {
  const m = String(raw ?? '').match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * E4 — elevation (P8). The single home of the city base and of the POI ground.
 */
export class ElevationAnalysisService {
  // One entry per city (or per 0.1° cell without a city). Deterministic: the key and the
  // value come from the city, never from the first POI that asked.
  private static cityBaseCache = new LRUCacheWithTTL<string, CityBase>(1000, 24 * 60 * 60 * 1000);

  static clearCache(): void {
    this.cityBaseCache.clear();
  }

  /**
   * City centre for the base: the GeoNames city named like the POI's city, nearest to the pin
   * (≤100 km); else the most populous city within 30 km; else null.
   */
  static cityCentre(pin: LatLng, cityName?: string): { id: string; centre: LatLng } | null {
    return LocalReverseGeocoder.getInstance().cityCentre(pin.lat, pin.lng, cityName);
  }

  /**
   * INV-E4b: ONE base per city, computed in one place — the lower quartile of the land SRTM
   * samples on a grid of CITY_BASE_RADIUS_M around the city centre. Cached per city; it was
   * per city but set by the 1st POI, then a 2 km ring around each POI, which is a local base,
   * not the city's (P8). No invented fallback (20/400/500/600 m): SRTM empty → null.
   */
  static async cityBaseElevation(
    pin: LatLng,
    cityName?: string,
    read: ElevationReader = srtmReader
  ): Promise<CityBase> {
    const city = this.cityCentre(pin, cityName);
    const key = city ? `geonames:${city.id}` : `poi_cell:${pin.lat.toFixed(1)},${pin.lng.toFixed(1)}`;
    const cached = this.cityBaseCache.get(key);
    if (cached) return cached;
    const centre = city?.centre ?? { lat: Number(pin.lat.toFixed(1)), lng: Number(pin.lng.toFixed(1)) };
    const reads: Promise<number | null>[] = [];
    const n = Math.floor(CITY_BASE_RADIUS_M / CITY_BASE_GRID_STEP_M);
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        if ((i * i + j * j) * CITY_BASE_GRID_STEP_M ** 2 > CITY_BASE_RADIUS_M ** 2) continue;
        const p = offsetM(centre, i * CITY_BASE_GRID_STEP_M, j * CITY_BASE_GRID_STEP_M);
        reads.push(read(p.lat, p.lng));
      }
    }
    const result: CityBase = { baseM: landPercentile(await Promise.all(reads)), source: key };
    this.cityBaseCache.set(key, result);
    return result;
  }

  /**
   * Local base (E4, #772): median of the land SRTM samples on a ring of LOCAL_BASE_RING_M
   * around the pin. The class asks for prominence over this too, so a POI on a plateau does
   * not become a landmark because the city below is low. null when the ring is all sea or the
   * DEM gave nothing (INV-E4c).
   */
  static async localBaseElevation(pin: LatLng, read: ElevationReader = srtmReader): Promise<number | null> {
    const reads: Promise<number | null>[] = [];
    for (let k = 0; k < LOCAL_BASE_DIRECTIONS; k++) {
      const a = (2 * Math.PI * k) / LOCAL_BASE_DIRECTIONS;
      const p = offsetM(pin, LOCAL_BASE_RING_M * Math.cos(a), LOCAL_BASE_RING_M * Math.sin(a));
      reads.push(read(p.lat, p.lng));
    }
    return landPercentile(await Promise.all(reads), LOCAL_BASE_PERCENTILE);
  }

  /**
   * E1 (#772): the footprint of a hill that has none mapped — where its slope ends, measured on
   * the DEM. From the pin, RELIEF_RAYS rays walk out every RELIEF_STEP_M until the terrain comes
   * down to `base + RELIEF_FOOT_FRACTION × relief` (interpolated), or climbs RELIEF_SADDLE_RISE_M
   * past its lowest point (a saddle to the next hill: the foot is that lowest point), or reaches
   * RELIEF_MAX_RADIUS_M. null when the pin is not RELIEF_MIN_M above the local base, or the DEM
   * gave nothing. The Morro do Patronato was a 10 m circle and `point_low` with one TP.
   */
  static async reliefFootprint(pin: LatLng, localBaseM: number | null, read: ElevationReader = srtmReader): Promise<LatLng[] | null> {
    const top = await read(pin.lat, pin.lng);
    if (top === null || localBaseM === null || top - localBaseM < RELIEF_MIN_M) return null;
    const foot = localBaseM + (top - localBaseM) * RELIEF_FOOT_FRACTION;
    const rays = await Promise.all(Array.from({ length: RELIEF_RAYS }, async (_, k) => {
      const a = (2 * Math.PI * k) / RELIEF_RAYS;
      const along = (d: number) => offsetM(pin, d * Math.cos(a), d * Math.sin(a));
      let prev = top, prevD = 0, low = top, lowD = 0;
      for (let d = RELIEF_STEP_M; d <= RELIEF_MAX_RADIUS_M; d += RELIEF_STEP_M) {
        const p = along(d);
        const e = (await read(p.lat, p.lng)) ?? prev;
        if (e <= foot) return along(prevD + ((d - prevD) * (prev - foot)) / Math.max(prev - e, 1e-6));
        if (e < low) { low = e; lowD = d; }
        if (e >= low + RELIEF_SADDLE_RISE_M) return along(lowD);
        prev = e; prevD = d;
      }
      return along(RELIEF_MAX_RADIUS_M);
    }));
    return [...rays, rays[0]];
  }

  /**
   * Legacy entry point, kept for geographic-analyzer and elevation.service: the same city base,
   * as a number or null.
   */
  static async estimateRegionalBaseElevation(
    location: LatLng,
    _context?: GeographicContext,
    poiData?: POIData
  ): Promise<number | null> {
    return (await this.cityBaseElevation(location, poiData?.city)).baseM;
  }

  /**
   * INV-E4a: the POI ground is the terrain at the HIGHEST point of its boundary, not at the
   * pin or centroid (Cristo read 522 m at the centroid, the summit is ~710 m). Candidates: SRTM
   * on every vertex, on an interior grid and at the pin; the POI `ele` tag; the `ele` of a
   * surveyed summit (`natural=peak`) inside or within SUMMIT_MATCH_M of the boundary. SRTM
   * (90 m grid here) flattens narrow summits, so a surveyed value above it wins.
   */
  static async groundTop(
    a: { pin: LatLng; boundary?: LatLng[]; tags?: Record<string, unknown>; peaks?: Array<{ lat: number; lng: number; ele?: unknown; tags?: Record<string, unknown> }> },
    read: ElevationReader = srtmReader
  ): Promise<GroundTop> {
    const pts: LatLng[] = [a.pin, ...(a.boundary ?? [])];
    if (a.boundary && a.boundary.length >= 3) {
      const lats = a.boundary.map(p => p.lat), lngs = a.boundary.map(p => p.lng);
      const [s, n, w, e] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
      const k = 6;
      for (let i = 0; i <= k; i++) for (let j = 0; j <= k; j++) {
        const p = { lat: s + ((n - s) * i) / k, lng: w + ((e - w) * j) / k };
        if (calculateDistanceToPolygon(p, a.boundary) === 0) pts.push(p);
      }
    }
    let best: GroundTop = { groundM: null, at: null, source: 'none' };
    const vals = await Promise.all(pts.map(p => read(p.lat, p.lng)));
    vals.forEach((v, i) => {
      if (v !== null && Number.isFinite(v) && (best.groundM === null || v > best.groundM)) {
        best = { groundM: v, at: pts[i], source: 'srtm_boundary_max' };
      }
    });
    const tagEle = parseEle(a.tags?.ele);
    if (tagEle !== null && (best.groundM === null || tagEle > best.groundM)) {
      best = { groundM: tagEle, at: a.pin, source: 'ele_tag' };
    }
    for (const pk of a.peaks ?? []) {
      const ele = parseEle(pk.ele ?? pk.tags?.ele);
      if (ele === null) continue;
      const near = a.boundary && a.boundary.length >= 3
        ? calculateDistanceToPolygon(pk, a.boundary) <= SUMMIT_MATCH_M
        : calculateDistance(pk, a.pin) <= SUMMIT_MATCH_M;
      if (near && (best.groundM === null || ele > best.groundM)) {
        best = { groundM: ele, at: { lat: pk.lat, lng: pk.lng }, source: 'summit_ele' };
      }
    }
    return best;
  }

  /**
   * Calcula diferença de elevação e determina se é alta elevação
   */
  static async analyzeElevationDifference(
    poiElevation: number,
    location: { lat: number; lng: number },
    context: GeographicContext,
    poiData?: POIData
  ): Promise<{ baseElevation: number | null; elevationDiff: number; isHighVisibility: boolean }> {
    const baseElevation = await this.estimateRegionalBaseElevation(location, context, poiData);
    // No base (DEM failed): no difference claimed (INV-E4c).
    const elevationDiff = baseElevation === null ? 0 : poiElevation - baseElevation;
    const isHighVisibility = elevationDiff > 200;
    
    console.log(`📏 [ElevationService] Elevation analysis:`);
    console.log(`  📍 POI elevation: ${poiElevation.toFixed(1)}m`);
    console.log(`  🏞️ Base elevation: ${baseElevation?.toFixed(1) ?? 'unknown'}m`);
    console.log(`  📈 Difference: ${elevationDiff.toFixed(1)}m`);
    console.log(`  🎯 High visibility: ${isHighVisibility}`);
    
    return { baseElevation, elevationDiff, isHighVisibility };
  }
}

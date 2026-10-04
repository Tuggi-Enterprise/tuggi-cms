/**
 * Local Reverse Geocoder
 *
 * Offline city/state/country lookup so the homolog enrichment pipeline
 * doesn't have to call Nominatim (which rate-limits at 1 req/sec per IP).
 *
 * Lookup priority — cheapest source first:
 *   1. POI's own `addr:city` / `addr:state` / `addr:country` tags from the
 *      local OSM dump. ~3% of POIs ship with these directly.
 *   2. GeoNames offline (cities500 dataset, ~233k cities worldwide).
 *      Built once by scripts/hotfix-geonames-import.ts. Sub-millisecond
 *      lookup via R-tree.
 *
 * Falls through (returns null on the relevant field) when neither layer can
 * answer — the caller then decides whether to fall back to Nominatim/Photon.
 *
 * The class auto-detects whether GeoNames has been imported. On machines
 * that haven't run the hotfix, only the tag-based path is active.
 */

import Database from 'better-sqlite3'
import fs from 'fs'
import { geonamesDbPath } from './local-osm-regions'

export interface ReverseGeocodeResult {
  city: string | null
  state: string | null
  country: string | null
  country_code: string | null
  admin1_code: string | null
  source: 'osm_tags' | 'geonames' | 'mixed'
  distance_km?: number   // only for geonames source (distance from query point to picked city)
}

export class LocalReverseGeocoder {
  private static instance: LocalReverseGeocoder
  private db: Database.Database | null = null
  private geonamesAvailable = false
  private nearestStmt: Database.Statement | null = null

  private constructor() {
    const dbPath = geonamesDbPath()
    try {
      if (!fs.existsSync(dbPath)) {
        console.log(`⚠️ [LocalReverseGeocoder] GeoNames database not found at ${dbPath} (npx tsx scripts/hotfix-geonames-import.ts)`)
        return
      }
      this.db = new Database(dbPath, { readonly: true })

      // Probe GeoNames tables at startup so per-call cost is zero.
      const probe = this.db.prepare(
        `SELECT 1 FROM sqlite_master WHERE type='table' AND name='geonames_cities_rtree'`
      ).get()
      this.geonamesAvailable = Boolean(probe)

      if (this.geonamesAvailable) {
        this.nearestStmt = this.db.prepare(`
          SELECT c.name, c.admin1_code, c.country_code,
                 a.name AS state_name, co.country_name,
                 c.lat, c.lng, c.population
          FROM geonames_cities c
          JOIN geonames_cities_rtree r ON r.rowid = c.geonameid
          LEFT JOIN geonames_admin1 a
            ON a.code = c.country_code || '.' || c.admin1_code
          LEFT JOIN geonames_countries co
            ON co.country_code = c.country_code
          WHERE r.min_lat <= ? AND r.max_lat >= ?
            AND r.min_lng <= ? AND r.max_lng >= ?
        `)
        console.log(`🌍 [LocalReverseGeocoder] GeoNames offline reverse-geocoder ready`)
      } else {
        console.log(`ℹ️  [LocalReverseGeocoder] GeoNames not imported — only addr:* tag lookups available. Run scripts/hotfix-geonames-import.ts to enable offline coords lookup.`)
      }
    } catch (err) {
      console.error(`❌ [LocalReverseGeocoder] init failed:`, err instanceof Error ? err.message : err)
    }
  }

  public static getInstance(): LocalReverseGeocoder {
    if (!LocalReverseGeocoder.instance) {
      LocalReverseGeocoder.instance = new LocalReverseGeocoder()
    }
    return LocalReverseGeocoder.instance
  }

  /**
   * Stage 1: read addr:city / addr:state / addr:country directly from OSM tags.
   * `tags` may be the parsed object or the raw JSON string from tags_json.
   */
  public extractFromTags(tags: unknown): Partial<ReverseGeocodeResult> | null {
    let t: any = tags
    if (typeof tags === 'string') {
      try { t = JSON.parse(tags) } catch { return null }
    }
    if (!t || typeof t !== 'object') return null

    const city =
      t['addr:city'] ||
      t['addr:town'] ||
      t['addr:village'] ||
      t['addr:municipality'] ||
      null
    const state = t['addr:state'] || t['addr:province'] || t['addr:region'] || null
    const country = t['addr:country'] || null
    const country_code = (t['addr:country_code'] || '').toUpperCase() || null

    if (!city && !state && !country) return null

    return {
      city: city || null,
      state: state || null,
      country: country || null,
      country_code,
      admin1_code: null,
      source: 'osm_tags'
    }
  }

  /**
   * Stage 2: nearest GeoNames city to (lat, lng). Uses R-tree for the bbox
   * filter (~100 km), then haversine to pick the truly nearest one.
   * Returns null if no city is within the search radius (oceans, remote
   * Antarctica, etc.).
   */
  public reverseGeocodeFromGeoNames(
    lat: number,
    lng: number,
    searchRadiusKm: number = 100
  ): ReverseGeocodeResult | null {
    if (!this.geonamesAvailable || !this.nearestStmt) return null
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

    const latDelta = searchRadiusKm / 111
    const lngDelta = searchRadiusKm / (111 * Math.cos(lat * Math.PI / 180))
    const rows = this.nearestStmt.all(
      lat + latDelta, lat - latDelta,
      lng + lngDelta, lng - lngDelta
    ) as Array<{
      name: string
      admin1_code: string | null
      country_code: string | null
      state_name: string | null
      country_name: string | null
      lat: number
      lng: number
      population: number
    }>
    if (rows.length === 0) return null

    let nearest = rows[0]
    let minDist = haversineKm(lat, lng, nearest.lat, nearest.lng)
    for (const r of rows) {
      const d = haversineKm(lat, lng, r.lat, r.lng)
      if (d < minDist) { minDist = d; nearest = r }
    }

    return {
      city: nearest.name,
      state: nearest.state_name ?? nearest.admin1_code ?? null,
      country: nearest.country_name ?? null,
      country_code: nearest.country_code,
      admin1_code: nearest.admin1_code,
      source: 'geonames',
      distance_km: minDist
    }
  }

  /**
   * Centre of the POI's city, for the city base elevation (TP engine E4, P8): the GeoNames city
   * whose name matches `cityName` (accent/case-insensitive), nearest to the point within 100 km;
   * else the most populous city within 30 km. null without GeoNames or without a city.
   */
  public cityCentre(
    lat: number,
    lng: number,
    cityName?: string | null
  ): { id: string; centre: { lat: number; lng: number } } | null {
    if (!this.geonamesAvailable || !this.db || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
    const box = (km: number) => {
      const dLat = km / 111
      const dLng = km / (111 * Math.cos(lat * Math.PI / 180))
      return this.db!.prepare(`
        SELECT c.geonameid AS id, c.name, c.ascii_name, c.lat, c.lng, c.population
        FROM geonames_cities c JOIN geonames_cities_rtree r ON r.rowid = c.geonameid
        WHERE r.min_lat <= ? AND r.max_lat >= ? AND r.min_lng <= ? AND r.max_lng >= ?
      `).all(lat + dLat, lat - dLat, lng + dLng, lng - dLng) as Array<{
        id: number; name: string; ascii_name: string | null; lat: number; lng: number; population: number | null
      }>
    }
    const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    const pick = (r: { id: number; lat: number; lng: number }) => ({ id: String(r.id), centre: { lat: r.lat, lng: r.lng } })
    if (cityName) {
      const want = fold(cityName)
      const named = box(100)
        .filter(r => fold(r.name) === want || fold(r.ascii_name ?? '') === want)
        .sort((a, b) => haversineKm(lat, lng, a.lat, a.lng) - haversineKm(lat, lng, b.lat, b.lng))
      if (named.length) return pick(named[0])
    }
    const near = box(30)
      .filter(r => haversineKm(lat, lng, r.lat, r.lng) <= 30)
      .sort((a, b) => (b.population ?? 0) - (a.population ?? 0))
    return near.length ? pick(near[0]) : null
  }

  /**
   * Combined lookup. Tries tags first (free, exact), then GeoNames
   * (offline, sub-millisecond), then fills any missing field by combining
   * the two sources.
   */
  public reverseGeocode(
    lat: number | null | undefined,
    lng: number | null | undefined,
    tags?: unknown
  ): ReverseGeocodeResult | null {
    const fromTags = tags != null ? this.extractFromTags(tags) : null
    const fromGeoNames =
      lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
        ? this.reverseGeocodeFromGeoNames(lat, lng)
        : null

    if (!fromTags && !fromGeoNames) return null

    // Merge: tag values win where present (more reliable when authored), then
    // GeoNames fills the rest. Source tag is 'mixed' when we used both.
    const usedBoth = Boolean(fromTags && fromGeoNames)
    return {
      city: fromTags?.city || fromGeoNames?.city || null,
      state: fromTags?.state || fromGeoNames?.state || null,
      country: fromTags?.country || fromGeoNames?.country || null,
      country_code: fromTags?.country_code || fromGeoNames?.country_code || null,
      admin1_code: fromTags?.admin1_code || fromGeoNames?.admin1_code || null,
      source: usedBoth ? 'mixed' : (fromTags ? 'osm_tags' : 'geonames'),
      distance_km: fromGeoNames?.distance_km
    }
  }
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

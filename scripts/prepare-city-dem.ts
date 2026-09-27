/**
 * EP (#782) — prepares the relief of one city for the TP engine: downloads Copernicus GLO-30
 * (surface) and GEDTM30 (ground) for the city + SANITY_MAX_TP_DISTANCE_M, checks every tile
 * and writes `data/dem-cache/<city>/manifest.json`. Run once per city, before generating.
 *
 *   npx tsx --env-file=.env --env-file=.env.local scripts/prepare-city-dem.ts --city "Rio de Janeiro"
 *   npx tsx scripts/prepare-city-dem.ts --city "Rio de Janeiro" --bbox -23.1,-43.8,-22.75,-43.1
 *
 * The area is the box of the city's POI pins (core.attractions, read only) and of the
 * city-base circle, within CITY_POINTS_MAX_KM of the city centre. Exit code 1 when the city
 * fails: its POIs will not generate until it is prepared again.
 */

import { getSupabase } from '@/lib/core/supabase-client'
import { LocalReverseGeocoder } from '@/lib/services/local-reverse-geocoder'
import { cityDemArea, prepareCityDem } from '@/lib/services/dem/dem-prepare'
import { CITY_BASE_RADIUS_M, SANITY_MAX_TP_DISTANCE_M } from '@/lib/services/trigger-points-google/config/visibility-class'

/** A pin farther than this from the city centre is a data error, not the city. */
const CITY_POINTS_MAX_KM = 100

type LatLng = { lat: number; lng: number }

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}

function km(a: LatLng, b: LatLng): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 12_742 * Math.asin(Math.sqrt(h))
}

async function cityPins(city: string): Promise<LatLng[]> {
  const sb = getSupabase('service')
  const ids: string[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.schema('core').from('attractions').select('id').eq('city', city).range(from, from + 999)
    if (error) throw new Error(error.message)
    ids.push(...(data ?? []).map((r: { id: string }) => r.id))
    if (!data || data.length < 1000) break
  }
  const pins: LatLng[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.schema('core').from('attraction_coordinate').select('latitude, longitude').in('attraction_id', ids.slice(i, i + 200))
    if (error) throw new Error(error.message)
    for (const r of data ?? []) if (Number.isFinite(r.latitude) && Number.isFinite(r.longitude)) pins.push({ lat: r.latitude, lng: r.longitude })
  }
  return pins
}

async function main() {
  const city = arg('city')
  if (!city) throw new Error('--city is required')
  const bbox = arg('bbox')
  let points: LatLng[]
  if (bbox) {
    const [s, w, n, e] = bbox.split(',').map(Number)
    points = [{ lat: s, lng: w }, { lat: n, lng: e }]
  } else {
    const pins = await cityPins(city)
    if (!pins.length) throw new Error(`no POI pins for city "${city}"`)
    const mid = { lat: pins.reduce((s, p) => s + p.lat, 0) / pins.length, lng: pins.reduce((s, p) => s + p.lng, 0) / pins.length }
    const centre = LocalReverseGeocoder.getInstance().cityCentre(mid.lat, mid.lng, city)?.centre ?? mid
    points = pins.filter(p => km(p, centre) <= CITY_POINTS_MAX_KM)
    const dLat = CITY_BASE_RADIUS_M / 110_540
    const dLng = CITY_BASE_RADIUS_M / (111_320 * Math.cos((centre.lat * Math.PI) / 180))
    points.push({ lat: centre.lat - dLat, lng: centre.lng - dLng }, { lat: centre.lat + dLat, lng: centre.lng + dLng })
    console.error(`EP ${city}: ${pins.length} pins, ${pins.length - (points.length - 2)} beyond ${CITY_POINTS_MAX_KM} km ignored`)
  }
  const area = cityDemArea(points, SANITY_MAX_TP_DISTANCE_M)
  const t0 = Date.now()
  const m = await prepareCityDem({ city, area, marginM: SANITY_MAX_TP_DISTANCE_M })
  console.log(JSON.stringify({ city: m.city, status: m.status, failures: m.failures, grid: m.grid, checks: m.checks, tiles: m.layers.map(l => [l.layer, l.tiles.map(t => `${t.name}:${t.status}`)]), seconds: Math.round((Date.now() - t0) / 1000) }, null, 1))
  process.exit(m.status === 'ok' ? 0 : 1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

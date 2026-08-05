/**
 * enrich-poi-from-osm.ts
 *
 * Busca um POI no OSM via Nominatim (com geometria e extratags) e grava boundary +
 * métricas em core.attractions, reusando OSMDataEnrichmentService — o mapeamento de
 * tag→coluna tem um dono só.
 *
 * Por que Nominatim e não Overpass: o Overpass público estava devolvendo
 * "Dispatcher_Client::request_read_and_idx::timeout" e o mirror da Kumi não respondeu.
 * O Nominatim entrega polygon_geojson + extratags + namedetails numa chamada, que é
 * tudo o que precisamos aqui.
 *
 * NÃO mexe na coordenada do POI: mover ponto de POI muda onde o trigger point dispara,
 * e isso é decisão de curadoria. O script só REPORTA quando o ponto cai fora do boundary.
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/enrich-poi-from-osm.ts <attraction_id> [--dry]
 *   npx tsx --env-file=.env scripts/enrich-poi-from-osm.ts <attraction_id> --query "Nome no OSM"
 *   ... --force-boundary   regrava o boundary operacional mesmo se já existir
 */
import { createClient } from '@supabase/supabase-js'
import { OSMDataEnrichmentService } from '../lib/services/osm-data-enrichment'

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: 'core' }, auth: { persistSession: false } },
)

const ID = process.argv[2]
const DRY = process.argv.includes('--dry')
const QUERY = (() => { const i = process.argv.indexOf('--query'); return i > -1 ? process.argv[i + 1] : null })()
const FORCE_BOUNDARY = process.argv.includes('--force-boundary')
const UA = 'tuggi-cms/1.0 (suporte@tuggi.app)'

if (!ID) { console.error('uso: enrich-poi-from-osm.ts <attraction_id> [--dry] [--query "nome"]'); process.exit(1) }

async function nominatim(q: string) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&polygon_geojson=1&extratags=1&namedetails=1&q=${encodeURIComponent(q)}`
  const r = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!r.ok) throw new Error(`nominatim ${r.status}`)
  return (await r.json()) as any[]
}

/** Área aproximada de um anel, em m², por projeção equirretangular local. */
function ringArea(ring: number[][]): number {
  const latm = ring.reduce((s, p) => s + p[1], 0) / ring.length
  const kx = Math.cos((latm * Math.PI) / 180) * 111320, ky = 110540
  let s = 0
  for (let i = 0; i < ring.length - 1; i++) {
    s += ring[i][0] * kx * (ring[i + 1][1] * ky) - ring[i + 1][0] * kx * (ring[i][1] * ky)
  }
  return Math.abs(s) / 2
}

/**
 * GeoJSON → WKT POLYGON.
 *
 * core.attractions.osm_geometry é geography(Polygon), não MultiPolygon. Relações do OSM
 * costumam vir multi: a da Sagrada Família tem o templo (6.076 m²) mais 8 lascas de 1–3 m².
 * Ficamos com o polígono de maior área e devolvemos os descartados para o chamador
 * imprimir — truncar em silêncio faria a saída parecer completa quando não é.
 */
function toWKT(g: any): { wkt: string | null; kept: number; dropped: number[] } {
  const ring = (r: number[][]) => '(' + r.map(([x, y]) => `${x} ${y}`).join(', ') + ')'
  if (g?.type === 'Polygon') {
    return { wkt: `POLYGON(${g.coordinates.map(ring).join(', ')})`, kept: ringArea(g.coordinates[0]), dropped: [] }
  }
  if (g?.type === 'MultiPolygon') {
    const areas: number[] = g.coordinates.map((p: number[][][]) => ringArea(p[0]))
    const idx = areas.indexOf(Math.max(...areas))
    const chosen = g.coordinates[idx]
    return {
      wkt: `POLYGON(${chosen.map(ring).join(', ')})`,
      kept: areas[idx],
      dropped: areas.filter((_: number, i: number) => i !== idx),
    }
  }
  return { wkt: null, kept: 0, dropped: [] }
}

/**
 * Reduce to the GeoJSON Polygon holding the largest ring.
 *
 * The front end does NOT render MultiPolygon. The Sagrada Familia had a stored boundary, the
 * right area and has_boundary=true, and still showed nothing on the map, while Placa de
 * Catalunya -- a Polygon -- rendered fine. Consumers read coordinates[0] expecting the outer
 * ring; on a MultiPolygon that index returns a whole polygon, one level deeper.
 */
function toSinglePolygonGeoJSON(g: any): any {
  if (g?.type !== 'MultiPolygon') return g
  const areas: number[] = g.coordinates.map((p: number[][][]) => ringArea(p[0]))
  return { type: 'Polygon', coordinates: g.coordinates[areas.indexOf(Math.max(...areas))] }
}

/** Centroide simples pela média dos vertices do anel externo de maior area. */
function centroid(g: any): { lat: number; lng: number } {
  const polys: number[][][][] = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]
  const outer = polys.map(p => p[0]).sort((a, b) => ringArea(b) - ringArea(a))[0]
  const n = outer.length
  return {
    lat: +(outer.reduce((s, p) => s + p[1], 0) / n).toFixed(7),
    lng: +(outer.reduce((s, p) => s + p[0], 0) / n).toFixed(7),
  }
}

async function main() {
  const { data: poi, error } = await db.from('attractions')
    .select('id, name, city, country, priority_level').eq('id', ID).single()
  if (error || !poi) { console.error(`POI não encontrado: ${error?.message}`); process.exit(1) }

  const q = QUERY || `${poi.name}, ${poi.city}, ${poi.country}`
  console.log(`\n=== ${poi.name} (${poi.city}) ${DRY ? '[DRY]' : ''} ===`)
  console.log(`consulta: ${q}\n`)

  const hits = await nominatim(q)
  if (!hits.length) { console.error('sem resultado no Nominatim'); process.exit(1) }

  // prefere o resultado que traz polígono — nó solto não tem boundary para extrair
  const hit = hits.find(h => h.geojson?.type === 'Polygon' || h.geojson?.type === 'MultiPolygon') || hits[0]
  console.log(`OSM: ${hit.osm_type}/${hit.osm_id}  "${hit.name}"  [${hit.category}/${hit.type}]  geom=${hit.geojson?.type || 'nenhuma'}`)

  const enrich: any = OSMDataEnrichmentService.extractFromNominatim(hit)
  const { wkt, kept, dropped } = toWKT(hit.geojson)
  if (wkt) {
    enrich.osm_geometry = wkt
    enrich.osm_area_m2 = Math.round(kept)
    if (dropped.length) {
      console.log(`\n⚠ MultiPolygon reduzido a Polygon (limite da coluna): mantido ${Math.round(kept).toLocaleString()} m²;`)
      console.log(`  descartados ${dropped.length} polígonos somando ${Math.round(dropped.reduce((a, b) => a + b, 0))} m²`)
    }
  }

  // identidade do elemento OSM — extractFromNominatim não preenche estes
  enrich.osm_id = String(hit.osm_id)
  enrich.osm_type = hit.osm_type

  const { osm_tags, osm_geometry, ...mostrar } = enrich
  console.log('\ncampos a gravar:')
  for (const [k, v] of Object.entries(mostrar)) console.log(`  ${k.padEnd(28)} ${JSON.stringify(v)}`)
  if (wkt) console.log(`  ${'osm_geometry'.padEnd(28)} POLYGON, ${wkt.length} chars`)

  // o ponto do POI cai dentro do boundary?
  if (wkt) {
    const { data: chk } = await db.rpc('diag_sql', {
      q: `select round(st_distance(ac.location_geography, st_geomfromtext('${wkt.replace(/'/g, "''")}', 4326)::geography)) dist_m
          from core.attraction_coordinate ac where ac.attraction_id = '${ID}'`,
    })
    const d = (chk as any[])?.[0]?.dist_m
    if (d !== undefined) {
      console.log(`\ncoordenada do POI × boundary: ${d === 0 ? 'DENTRO' : `${d} m FORA`}`)
      if (d > 0) console.log('  ⚠ ponto fora do polígono — revisar na curadoria (o script não move coordenada)')
    }
  }

  // ── Boundary operacional ────────────────────────────────────────────────────
  // attractions.osm_geometry é só o registro do footprint do OSM: NINGUÉM a lê rio abaixo.
  // Quem o motor de trigger point consulta é core.attraction_coordinate.boundary_geometry,
  // via a RPC get_boundary_geometry. É lá que o boundary precisa cair, e essa coluna aceita
  // MultiPolygon — então aqui vai a geometria inteira, sem reduzir a um polígono só.
  const { data: atual } = await db.from('attraction_coordinate')
    .select('boundary_geometry, boundary_source').eq('attraction_id', ID).maybeSingle()
  const jaTem = !!atual?.boundary_geometry

  console.log(`\nboundary operacional (attraction_coordinate): ${jaTem ? `JÁ EXISTE (source=${atual?.boundary_source ?? 'nulo'})` : 'AUSENTE'}`)
  if (jaTem && !FORCE_BOUNDARY) {
    console.log('  ↷ preservado. --force-boundary para regravar a partir do OSM.')
  }

  if (DRY) { console.log('\n[DRY] nada gravado.\n'); return }

  const ok = await OSMDataEnrichmentService.saveEnrichmentData(ID, enrich)
  console.log(ok ? '✓ campos + osm_geometry gravados' : '✗ falhou')

  if (hit.geojson && (!jaTem || FORCE_BOUNDARY)) {
    const cen = centroid(hit.geojson)
    const { error: eb } = await db.rpc('update_boundary_geometry', {
      p_attraction_id: ID,
      p_geojson: JSON.stringify(toSinglePolygonGeoJSON(hit.geojson)),
      // Canonical values, measured over the base: 2,097,535 rows use exactly
      // boundary_type='polygon' + boundary_source='osm'. 'multipolygon' and
      // 'osm_<type>_<id>' appear nowhere else and the front end cannot read them.
      p_boundary_type: 'polygon',
      p_boundary_source: 'osm',
      p_boundary_confidence: 1.0,
      // Only the surviving polygon counts: the discarded slivers are not in the geometry.
      p_boundary_area_m2: Math.round(kept),
      p_boundary_centroid_lat: cen.lat,
      p_boundary_centroid_lng: cen.lng,
    })
    console.log(eb ? `✗ boundary: ${eb.message}` : '✓ boundary operacional gravado')
  }
  console.log()
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })

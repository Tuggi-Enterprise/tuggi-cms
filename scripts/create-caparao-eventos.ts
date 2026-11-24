/**
 * create-caparao-eventos.ts
 *
 * Creates two 2027 Caparaó events as entity_kind='event' + core.event_details (#939).
 *
 * Source: unified 2027 Caparaó calendar, coordinated by Sebrae Caparaó with the regional
 * governance, published only in the press (aquinoticias.com, 2026-10-04):
 *   https://aquinoticias.com/2026/10/caparao-organiza-calendario-unificado-de-eventos-para-2027/
 * The operator accepted this article as the source on 2026-10-16. It gives dates and place, no
 * time, so both events are all-day (BRT -03:00). No rrule: the source only states the 2027 edition.
 *
 * Venue: the host POI is resolved by name in core.attractions, active POIs within 40 km of
 * Patrimônio da Penha (same-named POIs elsewhere in Brazil are ignored), and written to
 * event_details.venue_attraction_id (BR-EVENTO-002). The event takes the venue's coordinate.
 * Each event lists its venue candidates in order; the first one found wins and is logged.
 *
 * Idempotent: an event with the same name, entity_kind='event' and city is skipped.
 * Trigger points are manual (none generated here). Description is factual, from the source only.
 *
 * Usage:  npx tsx --env-file=.env scripts/create-caparao-eventos.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(URL, KEY, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')

const SOURCE_URL = 'https://aquinoticias.com/2026/10/caparao-organiza-calendario-unificado-de-eventos-para-2027/'
const STATE = 'Espírito Santo', COUNTRY = 'Brazil', TZ = 'America/Sao_Paulo'
const CENTER = { lat: -20.5836, lng: -41.7613 } // Patrimônio da Penha
const MAX_FROM_CENTER_M = 40_000

interface Ev {
  name: string
  city: string
  start: string // 'YYYY-MM-DD'
  end: string   // 'YYYY-MM-DD'
  category: string
  tags: string[]
  venues: string[] // POI names in core.attractions, in order of preference
  description: string
}

const EVENTS: Ev[] = [
  {
    name: 'Conexão Caparaó',
    city: 'Dores do Rio Preto',
    start: '2027-01-22', end: '2027-01-24',
    category: 'festival', tags: ['cafe'],
    // The article names Pedra Menina, in Dores do Rio Preto: the district POI is São José da Pedra Menina.
    venues: ['São José da Pedra Menina', 'Patrimônio da Penha'],
    description: 'A 9ª edição do Conexão Caparaó está prevista para 22 a 24 de janeiro de 2027 em Pedra Menina, no município de Dores do Rio Preto.',
  },
  {
    name: 'Festival de Inverno de Patrimônio da Penha',
    city: 'Divino de São Lourenço',
    start: '2027-04-16', end: '2027-04-18',
    category: 'festival', tags: ['inverno'],
    venues: ['Praça do Patrimônio', 'Patrimônio da Penha'],
    description: 'O Festival de Inverno de Patrimônio da Penha está previsto para 16 a 18 de abril de 2027, segundo o calendário unificado de eventos do Caparaó.',
  },
]

interface Poi { id: string; name: string; lat: number; lng: number }

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

async function getAdminId(): Promise<string | null> {
  const { data } = await db.from('cms_users').select('id').eq('email', 'suporte@tuggi.app').eq('is_active', true).maybeSingle()
  if (data?.id) return data.id
  const { data: a } = await db.from('cms_users').select('id').eq('role', 'admin').eq('is_active', true).limit(1).maybeSingle()
  return a?.id ?? null
}

/** Name → active POI in the region. A same-named POI outside the radius is ignored. */
async function loadPois(names: string[]): Promise<Map<string, Poi>> {
  const { data: rows, error } = await db.from('attractions').select('id,name').in('name', names).eq('entity_kind', 'poi').eq('is_active', true)
  if (error) throw new Error(`attractions: ${error.message}`)
  const ids = (rows || []).map(r => r.id)
  const { data: coords, error: e2 } = await db.from('attraction_coordinate').select('attraction_id,latitude,longitude')
    .in('attraction_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
  if (e2) throw new Error(`attraction_coordinate: ${e2.message}`)
  const cmap = new Map((coords || []).map(c => [c.attraction_id, c]))
  const out = new Map<string, Poi>()
  for (const r of rows || []) {
    const c = cmap.get(r.id)
    if (c?.latitude == null) continue
    const poi = { id: r.id, name: r.name, lat: Number(c.latitude), lng: Number(c.longitude) }
    if (haversine(CENTER, poi) > MAX_FROM_CENTER_M) continue
    if (!out.has(r.name)) out.set(r.name, poi)
  }
  return out
}

async function existsEvent(name: string, city: string): Promise<string | null> {
  const { data, error } = await db.from('attractions').select('id').eq('city', city).eq('entity_kind', 'event').ilike('name', name).maybeSingle()
  if (error) throw new Error(`exists ${name}: ${error.message}`)
  return data?.id ?? null
}

async function createEvent(e: Ev, pois: Map<string, Poi>, adminId: string | null) {
  const dup = await existsEvent(e.name, e.city)
  if (dup) { console.log(`  ↷ SKIP (already exists ${dup}) ${e.name}`); return }

  const venue = e.venues.map(n => pois.get(n)).find(Boolean) ?? null
  const fallback = venue && venue.name !== e.venues[0] ? ` (fallback: "${e.venues[0]}" not in the database)` : ''
  console.log(`  + ${e.name}  [${e.category}]  ${e.start} → ${e.end}  all-day  ${e.city}`)
  console.log(`      venue: ${venue ? `${venue.name} ${venue.id}${fallback}` : 'NO POI found, event without venue and coordinate'}`)
  console.log(`      description: ${e.description}`)
  if (DRY) return

  const { data: att, error: e1 } = await db.from('attractions').insert({
    name: e.name, city: e.city, state: STATE, country: COUNTRY, description: e.description,
    entity_kind: 'event', is_active: true, approved: true, created_by: adminId,
  }).select('id').single()
  if (e1 || !att) { console.error(`      ✗ attraction: ${e1?.message}`); return }

  const { error: e2 } = await db.from('event_details').insert({
    attraction_id: att.id, starts_at: `${e.start}T00:00:00-03:00`, ends_at: `${e.end}T23:59:59-03:00`,
    timezone: TZ, all_day: true, rrule: null, status: 'scheduled', event_category: e.category, tags: e.tags,
    venue_attraction_id: venue?.id ?? null, created_by: adminId,
  })
  if (e2) { console.error(`      ✗ event_details: ${e2.message}, removing ${att.id}`); await db.from('attractions').delete().eq('id', att.id); return }

  if (venue) {
    const { error: e3 } = await db.rpc('insert_coordinate_safe', { p_attraction_id: att.id, p_latitude: venue.lat, p_longitude: venue.lng, p_show_in_map: true })
    if (e3) console.error(`      ⚠ coordinate failed (event created without coordinate): ${e3.message}`)
  }
  console.log(`      ✓ id=${att.id}`)
}

async function main() {
  console.log(`\n=== Caparaó 2027 events ${DRY ? '(DRY RUN)' : '(EXECUTANDO)'}, ${EVENTS.length} events ===`)
  console.log(`source: ${SOURCE_URL}\n`)
  const adminId = await getAdminId()
  console.log(`admin: ${adminId ?? '(null)'}\n`)
  const pois = await loadPois([...new Set(EVENTS.flatMap(e => e.venues))])
  for (const e of EVENTS) await createEvent(e, pois, adminId)
  console.log('\n=== done ===\n')
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })

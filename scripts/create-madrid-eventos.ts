/**
 * create-madrid-eventos.ts
 *
 * Creates Madrid's landmark events as entity_kind='event' + core.event_details, following
 * scripts/create-barcelona-eventos.ts.
 *
 * Scope rule, same as Barcelona: only events with a verifiable date get in -- fixed calendar
 * feasts (Cabalgata de Reyes, Dos de Mayo, San Antonio de la Florida) or editions already
 * announced (San Cayetano / San Lorenzo / La Paloma 2026, Almudena 2026). Anything that moves
 * with Easter or has no published day stays in HELD: reported, not created. Inventing a date
 * here becomes a broken promise on the tourist's screen.
 *
 * `starts_at` is always the NEXT occurrence from today (2026-08-05), with rrule=FREQ=YEARLY on
 * the annual feasts -- the event window (BR-EVENTO-002) reads real dates, so a lapsed one
 * would keep the feast mute until the year turns.
 *
 * Usage:  npx tsx --env-file=.env scripts/create-madrid-eventos.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: 'core' }, auth: { persistSession: false } },
)
const DRY = process.argv.includes('--dry')

const CITY = 'Madrid', STATE = 'Madrid', COUNTRY = 'Spain', TZ = 'Europe/Madrid', CURRENCY = 'EUR'

const VENUES = {
  plaza_mayor: { lat: 40.41544, lng: -3.70736 },
  sol: { lat: 40.41654, lng: -3.70382 },          // Reloj de la Puerta del Sol
  pradera: { lat: 40.39773, lng: -3.72792 },      // Pradera de San Isidro
  vistillas: { lat: 40.40839, lng: -3.71576 },
  almudena: { lat: 40.41571, lng: -3.71459 },
  paloma: { lat: 40.40825, lng: -3.71143 },       // Parroquia Virgen de la Paloma
  retiro: { lat: 40.41641, lng: -3.68882 },
  florida: { lat: 40.42571, lng: -3.72603 },      // Ermita de San Antonio de la Florida
  matadero: { lat: 40.39190, lng: -3.69813 },
  villa: { lat: 40.41522, lng: -3.71040 },        // Plaza de la Villa (pregon)
} as const

/**
 * Host POI (BR-EVENTO-001), only where the link is unambiguous. Citywide street feasts stay
 * autonomous on purpose: linking them would hand the narration to a single square.
 */
const HOSTS: Record<string, string> = {
  'Fiestas de San Isidro': '2b90ed3f-b023-4d8f-9b64-c8f92168185d',           // Pradera de San Isidro
  'Fiestas de la Almudena': '309cafa3-02ca-419e-9364-a826767c76f0',          // Catedral de la Almudena
  'Romería de San Antonio de la Florida': '',                               // resolved at runtime
}

interface Ev {
  name: string
  start: string
  end?: string
  time?: string
  rrule?: boolean
  category: string
  venue?: keyof typeof VENUES
  free?: boolean
  tags?: string[]
  note?: string
}

const EVENTS: Ev[] = [
  { name: 'Fiestas de San Cayetano', start: '2026-08-05', end: '2026-08-08', rrule: true, category: 'festival', venue: 'paloma', free: true, tags: ['verbena', 'lavapies'], note: 'First of the three August verbenas of old Madrid' },
  { name: 'Fiestas de San Lorenzo', start: '2026-08-09', end: '2026-08-12', rrule: true, category: 'festival', venue: 'paloma', free: true, tags: ['verbena'] },
  { name: 'Fiestas de la Virgen de la Paloma', start: '2026-08-14', end: '2026-08-17', rrule: true, category: 'festival', venue: 'paloma', free: true, tags: ['verbena', 'la latina', 'chulapos'], note: 'The best known of the August verbenas' },
  { name: 'Fiestas de la Almudena', start: '2026-11-06', end: '2026-11-09', rrule: true, category: 'festival', venue: 'almudena', free: true, tags: ['padroeira'], note: 'Patron saint of Madrid, feast day 9 November' },
  { name: 'Mercado Navideño de la Plaza Mayor', start: '2026-11-27', end: '2026-12-31', rrule: true, category: 'fair', venue: 'plaza_mayor', free: true, tags: ['natal', 'mercado'] },
  { name: 'Campanadas de Nochevieja en la Puerta del Sol', start: '2026-12-31', time: '23:30', rrule: true, category: 'festival', venue: 'sol', free: true, tags: ['reveillon', 'uvas'], note: 'The twelve grapes, broadcast nationwide from the Sol clock' },
  { name: 'Cabalgata de Reyes', start: '2027-01-05', time: '18:00', rrule: true, category: 'kids', venue: 'plaza_mayor', free: true, tags: ['reis magos', 'desfile'] },
  { name: 'Fiesta del Dos de Mayo', start: '2027-05-02', rrule: true, category: 'festival', venue: 'sol', free: true, tags: ['malasana', 'historico'], note: 'Community of Madrid day; 1808 uprising against the French' },
  { name: 'Fiestas de San Isidro', start: '2027-05-07', end: '2027-05-17', rrule: true, category: 'festival', venue: 'pradera', free: true, tags: ['padroeiro', 'chulapos', 'verbena'], note: 'The city feast; pregon from the Plaza de la Villa, stages at the Pradera, Plaza Mayor, Vistillas and Matadero' },
  { name: 'Romería de San Antonio de la Florida', start: '2027-06-13', rrule: true, category: 'festival', venue: 'florida', free: true, tags: ['modistillas', 'goya'], note: 'The hermitage holds the Goya frescoes and his tomb' },
]

// Date not verifiable today: moves with Easter, depends on a future announcement, or only the
// month is public. Reported, NOT created.
const HELD: string[] = [
  'Veranos de la Villa (jul-ago, programa anunciado em junho)',
  'MADO / Orgullo de Madrid (jun-jul)',
  'Feria del Libro de Madrid (mai-jun, no Retiro)',
  'Carnaval de Madrid (móvel, depende da Páscoa)',
  'Semana Santa (móvel)',
  'Mad Cool 2027 (jul, datas não anunciadas)',
  'ARCOmadrid 2027 (fev/mar, datas não confirmadas)',
  'FITUR 2027 (jan)',
  'Maratón de Madrid (abr)',
  'Mercedes-Benz Fashion Week Madrid (fev e set)',
  'La Noche de los Libros (abr)',
  'DecorAccion / Barrio de las Letras (jun)',
]

/** Europe/Madrid offset on the date -- CET or CEST, read from the runtime tz database. */
function offsetFor(date: string): string {
  const d = new Date(`${date}T12:00:00Z`)
  const s = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' }).format(d)
  const m = s.match(/GMT([+-]\d{2}:\d{2})/)
  if (!m) throw new Error(`undetermined offset for ${date}`)
  return m[1]
}

function iso(date: string, time?: string, endOfDay = false): string {
  const t = time ? `${time}:00` : (endOfDay ? '23:59:59' : '00:00:00')
  return `${date}T${t}${offsetFor(date)}`
}

async function adminId(): Promise<string | null> {
  const { data } = await db.from('cms_users').select('id').eq('email', 'suporte@tuggi.app').eq('is_active', true).maybeSingle()
  if (data?.id) return data.id
  // Same fallback as the Barcelona script: any active admin, so created_by is not left null.
  const { data: a } = await db.from('cms_users').select('id').eq('role', 'admin').eq('is_active', true).limit(1).maybeSingle()
  return a?.id ?? null
}

async function hostFor(name: string): Promise<string | null> {
  if (name === 'Romería de San Antonio de la Florida') {
    const { data } = await db.from('attractions').select('id')
      .eq('city', CITY).eq('country', COUNTRY).eq('entity_kind', 'poi')
      .eq('name', 'Ermita de San Antonio de la Florida').maybeSingle()
    return data?.id ?? null
  }
  return HOSTS[name] || null
}

async function createEvent(e: Ev, admin: string | null) {
  const { data: dup } = await db.from('attractions').select('id')
    .eq('city', CITY).eq('entity_kind', 'event').ilike('name', e.name).maybeSingle()
  if (dup) { console.log(`  skip (exists ${dup.id}) -- ${e.name}`); return }

  const end = e.end || e.start
  const starts_at = iso(e.start, e.time)
  const ends_at = e.time ? null : iso(end, undefined, true)
  const coord = e.venue ? VENUES[e.venue] : null
  const host = await hostFor(e.name)

  console.log(`  + ${e.name}  [${e.category}${e.rrule ? ' YEARLY' : ''}]  ${e.start}${e.end ? '->' + e.end : ''}${e.time ? ' ' + e.time : ''}  ${coord ? '@' + e.venue : 'no-coord'}${host ? ' host' : ''}`)
  if (e.note) console.log(`      ${e.note}`)
  if (DRY) return

  const { data: att, error: e1 } = await db.from('attractions').insert({
    name: e.name, city: CITY, state: STATE, country: COUNTRY,
    entity_kind: 'event', is_active: true, approved: true, created_by: admin,
  }).select('id').single()
  if (e1 || !att) { console.error(`      FAIL attraction: ${e1?.message}`); return }

  const { error: e2 } = await db.from('event_details').insert({
    attraction_id: att.id, starts_at, ends_at, timezone: TZ, all_day: !e.time,
    rrule: e.rrule ? 'FREQ=YEARLY' : null, status: 'scheduled',
    event_category: e.category, tags: e.tags || [],
    is_free: !!e.free, currency: CURRENCY, venue_attraction_id: host,
    created_by: admin,
  })
  if (e2) { console.error(`      FAIL event_details: ${e2.message} -- removing ${att.id}`); await db.from('attractions').delete().eq('id', att.id); return }

  if (coord) {
    const { error: e3 } = await db.rpc('insert_coordinate_safe', { p_attraction_id: att.id, p_latitude: coord.lat, p_longitude: coord.lng, p_show_in_map: true })
    if (e3) console.error(`      WARN coordinate: ${e3.message}`)
  }
  console.log(`      ok id=${att.id}`)
}

async function main() {
  console.log(`\n=== Madrid events ${DRY ? '(DRY RUN)' : '(EXECUTING)'} -- ${EVENTS.length} events ===\n`)
  const admin = await adminId()
  console.log(`admin: ${admin ?? '(null)'}  tz ${TZ}  currency ${CURRENCY}\n`)
  for (const e of EVENTS) await createEvent(e, admin)
  console.log(`\n-- HELD (date not verifiable today; confirm and add later): ${HELD.length} --`)
  for (const h of HELD) console.log(`  . ${h}`)
  console.log('\n=== done ===\n')
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })

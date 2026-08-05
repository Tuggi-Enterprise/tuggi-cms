/**
 * create-barcelona-eventos.ts
 *
 * Cria os EVENTOS ÍCONE de Barcelona como entity_kind='event' + core.event_details,
 * já ativados. Segue o mesmo padrão de scripts/create-buzios-eventos.ts.
 *
 * Regra de escopo: SÓ entram eventos com data verificável — festa de calendário fixo
 * (Sant Jordi, Reis, Diada) ou edição com data já anunciada (Gràcia 2026, Mercè 2026,
 * Primavera Sound 2027). O que depende da Páscoa, de anúncio futuro ou de "mês sem dia"
 * fica em HELD: é reportado e NÃO é criado. Inventar data aqui vira promessa quebrada
 * na tela do turista.
 *
 * `starts_at` é sempre a PRÓXIMA ocorrência a partir de hoje (2026-08-05), com
 * rrule=FREQ=YEARLY nas festas anuais — a janela do evento (BR-EVENTO-002) usa as datas
 * reais, então uma data já vencida deixaria a festa muda até a virada do ano.
 *
 * Uso:  npx tsx --env-file=.env scripts/create-barcelona-eventos.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(URL, KEY, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')

const CITY = 'Barcelona', STATE = 'Catalunya', COUNTRY = 'Spain', TZ = 'Europe/Madrid', CURRENCY = 'EUR'

/** Coordenada de referência de cada local, quando o evento tem um ponto claro. */
const VENUES = {
  vila_gracia: { lat: 41.40252, lng: 2.15644 },      // Plaça de la Vila de Gràcia
  sant_jaume: { lat: 41.38257, lng: 2.17657 },       // Plaça de Sant Jaume
  rambla: { lat: 41.38108, lng: 2.17334 },           // La Rambla (trecho central)
  catedral: { lat: 41.38386, lng: 2.17565 },         // Catedral de Barcelona
  forum: { lat: 41.40808, lng: 2.22536 },            // Parc del Fòrum
  font_magica: { lat: 41.37108, lng: 2.15138 },      // Font Màgica de Montjuïc
  barceloneta: { lat: 41.37753, lng: 2.19152 },      // Platja de la Barceloneta
  gracia_medir: { lat: 41.40350, lng: 2.15200 },     // Gran de Gràcia (Sant Medir)
  hospital: { lat: 41.38119, lng: 2.16899 },         // Carrer de l'Hospital (Sant Ponç)
  catedral_placa: { lat: 41.38400, lng: 2.17600 },   // Pla de la Seu (Fira de Santa Llúcia)
} as const

/**
 * POI anfitrião (BR-EVENTO-001) — só onde o vínculo é inequívoco.
 * Ficam AUTÔNOMOS de propósito: festas de rua que tomam a cidade inteira (Mercè, Sant
 * Jordi, Sant Joan) e tudo cujo anfitrião natural está DUPLICADO na base — La Rambla tem
 * 12 linhas, Plaça de Sant Jaume 3, Font Màgica 2. Vincular a uma duplicata prende a
 * narração ao POI errado. Revisar depois do dedup.
 */
const HOSTS: Record<string, string> = {
  'Primavera Sound': '50426b74-6843-5b0c-8777-78b945f75092',  // Parc dels Auditoris - El Parc del Fòrum
  'Festes de Santa Eulàlia': '165edade-a02c-5d85-85dc-ab011d246efc', // Catedral de la Santa Creu i Santa Eulàlia
}

interface Ev {
  name: string
  start: string           // 'YYYY-MM-DD'
  end?: string            // default = start
  time?: string           // 'HH:MM' local → all_day=false
  rrule?: boolean         // true → FREQ=YEARLY
  category: string        // music|sports|festival|theatre|exhibition|kids|conference|fair|other
  venue?: keyof typeof VENUES
  free?: boolean
  tags?: string[]
  note?: string
}

// Eventos com data verificável. Ordem cronológica a partir de 2026-08-05.
const EVENTS: Ev[] = [
  { name: 'Festa Major de Gràcia', start: '2026-08-15', end: '2026-08-21', rrule: true, category: 'festival', venue: 'vila_gracia', free: true, tags: ['carrers guarnits', 'festa major', 'gràcia'], note: 'Datas fixas 15–21/ago, ruas decoradas por concurso' },
  { name: 'Diada Nacional de Catalunya', start: '2026-09-11', rrule: true, category: 'festival', venue: 'sant_jaume', free: true, tags: ['diada', 'catalunya'] },
  { name: 'Festes de la Mercè', start: '2026-09-23', end: '2026-09-27', rrule: true, category: 'festival', venue: 'sant_jaume', free: true, tags: ['festa major', 'correfoc', 'castellers', 'gegants'], note: 'Festa maior da cidade; dia oficial 24/set' },
  { name: 'Piromusical de la Mercè', start: '2026-09-27', time: '22:00', rrule: true, category: 'festival', venue: 'font_magica', free: true, tags: ['fogos', 'montjuïc'], note: 'Encerra a Mercè, na Font Màgica' },
  { name: 'La Castanyada', start: '2026-11-01', rrule: true, category: 'festival', free: true, tags: ['tradição', 'gastronomia'], note: 'Tots Sants; castanhas, panellets e moniato' },
  { name: 'Fira de Santa Llúcia', start: '2026-12-01', end: '2026-12-23', rrule: true, category: 'fair', venue: 'catedral_placa', free: true, tags: ['natal', 'mercado'], note: 'Mercado de Natal diante da Catedral, desde 1786' },
  { name: 'Cap d’Any a Barcelona', start: '2026-12-31', time: '23:00', rrule: true, category: 'festival', venue: 'font_magica', free: true, tags: ['réveillon'] },
  { name: 'Cavalcada de Reis', start: '2027-01-05', time: '18:00', rrule: true, category: 'kids', venue: 'rambla', free: true, tags: ['reis mags', 'desfile'], note: 'Chegada dos Reis Magos pelo porto, desfile à noite' },
  { name: 'Els Tres Tombs de Sant Antoni', start: '2027-01-17', rrule: true, category: 'festival', free: true, tags: ['tradição', 'cavalos'], note: 'Sant Antoni Abat, data fixa 17/jan' },
  { name: 'Festes de Santa Eulàlia', start: '2027-02-12', end: '2027-02-15', rrule: true, category: 'kids', venue: 'catedral', free: true, tags: ['festa major d’hivern', 'infantil'], note: 'Copadroeira; festa de inverno voltada às crianças' },
  { name: 'Sant Medir', start: '2027-03-03', rrule: true, category: 'festival', venue: 'gracia_medir', free: true, tags: ['gràcia', 'caramels'], note: 'A "festa mais doce"; data fixa 3/mar' },
  { name: 'Sant Jordi', start: '2027-04-23', rrule: true, category: 'festival', venue: 'rambla', free: true, tags: ['livros', 'rosas', 'tradição'], note: 'Dia do livro e da rosa; data fixa 23/abr' },
  { name: 'Fira de Sant Ponç', start: '2027-05-11', rrule: true, category: 'fair', venue: 'hospital', free: true, tags: ['ervas', 'mel', 'tradição'], note: 'Feira de ervas e doces no Carrer de l’Hospital; data fixa 11/mai' },
  { name: 'Primavera Sound', start: '2027-06-03', end: '2027-06-05', category: 'music', venue: 'forum', free: false, tags: ['festival', 'indie'], note: '25ª edição, no Parc del Fòrum' },
  { name: 'Revetlla de Sant Joan', start: '2027-06-23', end: '2027-06-24', rrule: true, category: 'festival', venue: 'barceloneta', free: true, tags: ['fogueiras', 'praia', 'nit del foc'], note: 'A noite do fogo; praias e ruas, data fixa 23/jun' },
]

// Data NÃO verificável hoje (depende da Páscoa, de anúncio futuro, ou só o mês é público).
// Reportados, NÃO criados — confirmar na fonte oficial e acrescentar depois.
const HELD: string[] = [
  'Festa Major de Sants (ago, semana variável)',
  'Festa Major de la Barceloneta (set/out)',
  'Festa Major del Poblenou (set)',
  'Festival Internacional de Jazz de Barcelona (out–nov)',
  'Manga Barcelona (out/nov)',
  'Saló Nàutic de Barcelona (out)',
  'Llum BCN (fev)',
  'Carnaval de Barcelona (móvel, depende da Páscoa)',
  'Corpus Christi / L’Ou com Balla (móvel, depende da Páscoa)',
  'Mobile World Congress 2027 (fev/mar, datas não anunciadas)',
  'Sónar 2027 (jun, datas não anunciadas)',
  'Marató de Barcelona (mar)',
  'La Nit dels Museus (mai)',
  'Pride Barcelona (jun/jul)',
  'Festival Grec (jul)',
  'Cruïlla (jul)',
  'Concurs de Castells (bienal, Tarragona)',
]

/**
 * Offset de Europe/Madrid na data — CET (+01:00) ou CEST (+02:00).
 * Lê da base de fusos do runtime em vez de codificar a regra de verão da UE, que já mudou
 * antes e pode mudar de novo.
 */
function offsetFor(date: string): string {
  const d = new Date(`${date}T12:00:00Z`)
  const s = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' }).format(d)
  const m = s.match(/GMT([+-]\d{2}:\d{2})/)
  if (!m) throw new Error(`offset indeterminado para ${date}`)
  return m[1]
}

function iso(date: string, time?: string, endOfDay = false): string {
  const t = time ? `${time}:00` : (endOfDay ? '23:59:59' : '00:00:00')
  return `${date}T${t}${offsetFor(date)}`
}

async function getAdminId(): Promise<string | null> {
  const { data } = await db.from('cms_users').select('id').eq('email', 'suporte@tuggi.app').eq('is_active', true).maybeSingle()
  if (data?.id) return data.id
  const { data: a } = await db.from('cms_users').select('id').eq('role', 'admin').eq('is_active', true).limit(1).maybeSingle()
  return a?.id ?? null
}

async function existsEvent(name: string): Promise<string | null> {
  const { data } = await db.from('attractions').select('id').eq('city', CITY).eq('entity_kind', 'event').ilike('name', name).maybeSingle()
  return data?.id ?? null
}

async function createEvent(e: Ev, adminId: string | null) {
  const dup = await existsEvent(e.name)
  if (dup) { console.log(`  ↷ SKIP (já existe ${dup}) — ${e.name}`); return }

  const end = e.end || e.start
  const starts_at = iso(e.start, e.time)
  const ends_at = e.time ? null : iso(end, undefined, true)
  const all_day = !e.time
  const rrule = e.rrule ? 'FREQ=YEARLY' : null
  const coord = e.venue ? VENUES[e.venue] : null
  const host = HOSTS[e.name] || null

  console.log(`  + ${e.name}  [${e.category}${rrule ? ' · YEARLY' : ''}]  ${e.start}${e.end ? '→' + e.end : ''}${e.time ? ' ' + e.time : ''}  ${coord ? '@' + e.venue : 'sem-coord'}${host ? ' · anfitrião' : ''}`)
  if (e.note) console.log(`      ${e.note}`)
  if (DRY) return

  const { data: att, error: e1 } = await db.from('attractions').insert({
    name: e.name, city: CITY, state: STATE, country: COUNTRY,
    entity_kind: 'event', is_active: true, approved: true, created_by: adminId,
  }).select('id').single()
  if (e1 || !att) { console.error(`      ✗ attraction: ${e1?.message}`); return }

  const { error: e2 } = await db.from('event_details').insert({
    attraction_id: att.id, starts_at, ends_at, timezone: TZ, all_day,
    rrule, status: 'scheduled', event_category: e.category, tags: e.tags || [],
    is_free: !!e.free, currency: CURRENCY, venue_attraction_id: host,
    created_by: adminId,
  })
  if (e2) { console.error(`      ✗ event_details: ${e2.message} — removendo ${att.id}`); await db.from('attractions').delete().eq('id', att.id); return }

  if (coord) {
    const { error: e3 } = await db.rpc('insert_coordinate_safe', { p_attraction_id: att.id, p_latitude: coord.lat, p_longitude: coord.lng, p_show_in_map: true })
    if (e3) console.error(`      ⚠ coord falhou (evento criado sem coord): ${e3.message}`)
  }
  console.log(`      ✓ id=${att.id}`)
}

async function main() {
  console.log(`\n=== Barcelona eventos ${DRY ? '(DRY RUN)' : '(EXECUTANDO)'} — ${EVENTS.length} eventos ===\n`)
  const adminId = await getAdminId()
  console.log(`admin: ${adminId ?? '(null)'}  ·  tz ${TZ}  ·  moeda ${CURRENCY}\n`)
  for (const e of EVENTS) await createEvent(e, adminId)
  console.log(`\n— HELD (data não verificável hoje; confirmar e acrescentar): ${HELD.length} —`)
  for (const h of HELD) console.log(`  · ${h}`)
  console.log('\n=== fim ===\n')
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })

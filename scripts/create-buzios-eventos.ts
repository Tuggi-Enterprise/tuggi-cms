/**
 * create-buzios-eventos.ts
 *
 * Cria os EVENTOS futuros do calendário oficial da prefeitura de Armação dos Búzios
 * (turismo.buzios.rj.gov.br/eventos → "vai acontecer") como entity_kind='event' +
 * core.event_details, já ativados (is_active=true). Localização geocodificada por
 * venue via OSM quando o local é nomeado. Trigger Points → manuais.
 *
 * Escopo: só futuros. Meses NÃO impressos e sem data fixa → NÃO criados (held).
 * Ano assumido = 2026 (calendário atual do site; BRT -03:00, sem DST).
 *
 * Uso:  npx tsx --env-file=.env scripts/create-buzios-eventos.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(URL, KEY, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')

const CITY = 'Armação dos Búzios', STATE = 'Rio de Janeiro', COUNTRY = 'Brazil', TZ = 'America/Sao_Paulo'

const VENUES: Record<string, { lat: number; lng: number }> = {
  rua_das_pedras: { lat: -22.75519, lng: -41.88750 },   // OSM way/161828841
  capela_santanna: { lat: -22.74717, lng: -41.88181 },  // OSM way/552233821 (Igreja de Sant'Anna)
  praca_darcy: { lat: -22.75931, lng: -41.88614 },       // OSM way/552469336 (Praça Darcy Ribeiro)
  ossos: { lat: -22.74712, lng: -41.88080 },             // OSM way/161820656 (Praça dos Ossos)
}

interface Ev {
  name: string
  start: string          // 'YYYY-MM-DD'
  end?: string           // 'YYYY-MM-DD' (default = start)
  time?: string          // 'HH:MM' local → all_day=false
  rrule?: boolean        // true → 'FREQ=YEARLY'
  category: string       // music|sports|festival|theatre|conference|fair
  venue?: keyof typeof VENUES
  tags?: string[]
  note?: string
}

// 21 eventos com data determinável (mês impresso OU data cultural/nacional fixa).
const EVENTS: Ev[] = [
  { name: '11ª Parada do Orgulho LGBT+ de Búzios', start: '2026-07-12', rrule: true, category: 'festival', venue: 'rua_das_pedras', tags: ['lgbt','parada'] },
  { name: 'Festa do Divino', start: '2026-07-02', end: '2026-07-05', rrule: true, category: 'festival', venue: 'capela_santanna', tags: ['religioso','tradicional'] },
  { name: '2ª Corrida das Guardas de Búzios', start: '2026-07-04', category: 'sports', venue: 'praca_darcy', tags: ['corrida'] },
  { name: 'Festival de Inverno de Búzios', start: '2026-07-17', end: '2026-07-18', rrule: true, category: 'festival', tags: ['musica','inverno'] },
  { name: 'Búzios Sailing Week Optimist', start: '2026-07-24', end: '2026-07-26', category: 'sports', tags: ['vela','nautico'] },
  { name: 'Búzios ON', start: '2026-07-24', end: '2026-07-25', category: 'festival' },
  { name: "Festa de Sant'Anna", start: '2026-07-24', end: '2026-07-26', rrule: true, category: 'festival', venue: 'ossos', tags: ['religioso','padroeira'], note: 'Padroeira, sempre em torno de 26/jul' },
  { name: 'Degusta Búzios', start: '2026-07-31', end: '2026-08-02', rrule: true, category: 'fair', tags: ['gastronomia'], note: 'Também 07–09/08 (2ª edição do mês)' },
  { name: 'Mister Búzios', start: '2026-08-15', category: 'festival' },
  { name: 'Encontro de Motos', start: '2026-08-27', end: '2026-08-30', category: 'fair', tags: ['motos'] },
  { name: 'Evento Pets', start: '2026-09-11', end: '2026-09-12', category: 'fair', tags: ['pets'] },
  { name: 'Festival da Sardinha', start: '2026-09-18', end: '2026-09-19', rrule: true, category: 'festival', tags: ['gastronomia','tradicional'] },
  { name: 'Parafina', start: '2026-09-24', end: '2026-09-27', category: 'sports', tags: ['surf'] },
  { name: 'Encontro de Carros Antigos', start: '2026-09-24', end: '2026-09-27', category: 'fair', tags: ['carros'] },
  { name: 'Búzios Café e Chocolate', start: '2026-09-25', end: '2026-09-27', rrule: true, category: 'fair', tags: ['gastronomia'] },
  { name: 'Circuito Bike Lagos', start: '2026-10-13', category: 'sports', tags: ['ciclismo'] },
  { name: 'Dia das Crianças', start: '2026-10-12', rrule: true, category: 'festival' },
  { name: 'Festa Literária de Búzios', start: '2026-11-09', end: '2026-11-11', rrule: true, category: 'festival', tags: ['literatura'] },
  { name: 'Consciência Negra', start: '2026-11-20', time: '18:00', rrule: true, category: 'festival', note: 'Data nacional fixa 20/nov' },
  { name: 'Cantata de Natal', start: '2026-12-11', end: '2026-12-12', time: '18:00', rrule: true, category: 'music', tags: ['natal'] },
  { name: 'Natal Luz', start: '2026-12-01', end: '2026-12-31', rrule: true, category: 'festival', tags: ['natal'] },
]

// Held (mês não impresso e sem data fixa) — reportados, NÃO criados.
const HELD = ['Paralímpiada (24–26)', 'HERO SWIMRUN (30)', 'Búzios Biker Fest (27–30)', 'Circuito das Artes (03–05)', 'XC Run (18)', 'MPBúzios (09–11)', 'Festa da Cidade (12–14)']

function iso(date: string, time?: string, endOfDay = false): string {
  const t = time ? `${time}:00` : (endOfDay ? '23:59:59' : '00:00:00')
  return `${date}T${t}-03:00`
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

  console.log(`  + ${e.name}  [${e.category}${rrule ? ' · YEARLY' : ''}]  ${e.start}${e.end ? '→' + e.end : ''}${e.time ? ' ' + e.time : ''}  ${coord ? `@venue` : 'sem-coord'}`)
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
  console.log(`\n=== Búzios eventos ${DRY ? '(DRY RUN)' : '(EXECUTANDO)'} — ${EVENTS.length} eventos ===\n`)
  const adminId = await getAdminId()
  console.log(`admin: ${adminId ?? '(null)'}\n`)
  for (const e of EVENTS) await createEvent(e, adminId)
  console.log(`\n— HELD (mês não impresso, confirmar data manualmente): ${HELD.length} —`)
  for (const h of HELD) console.log(`  · ${h}`)
  console.log('\n=== fim ===\n')
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })

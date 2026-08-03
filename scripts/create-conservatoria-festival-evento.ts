/**
 * create-conservatoria-festival-evento.ts
 *
 * Cadastra o Festival Delícias do Vale do Café 2026 como evento (entity_kind='event'
 * + event_details), vinculado à Praça de Conservatória (venue_attraction_id → o TP
 * da Praça narra o evento). Já ativado. Idempotente por nome.
 *
 * Fonte: deliciasdovaledocafe.com.br + imprensa (5ª edição, 7–16/ago/2026).
 *
 * Uso:  npx tsx --env-file=.env scripts/create-conservatoria-festival-evento.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')
const CITY = 'Conservatória', STATE = 'Rio de Janeiro', COUNTRY = 'Brazil', TZ = 'America/Sao_Paulo'

const NAME = 'Festival Delícias do Vale do Café'
const DESC = '5ª edição do Festival Delícias do Vale do Café, em Conservatória, distrito de Valença, no coração do Vale do Café. De 7 a 16 de agosto de 2026, inspirado na Cozinha de Fazenda, reúne os restaurantes e produtores da região com pratos criados exclusivamente para a edição, a preços tabelados. A abertura — o Delícias na Praça — acontece em 7 e 8 de agosto na Praça de Conservatória, com shows, demonstrações culinárias com chefs, degustações de produtos regionais e feira de artesanato.'
const PRACA_COORD = { lat: -22.289553, lng: -43.927002 }

async function adminId(): Promise<string | null> {
  const { data } = await db.from('cms_users').select('id').eq('email', 'suporte@tuggi.app').eq('is_active', true).maybeSingle()
  return data?.id ?? null
}

async function main() {
  console.log(`\n=== Festival Delícias do Vale do Café — evento ${DRY ? '(DRY)' : '(EXECUTANDO)'} ===\n`)
  const admin = await adminId()

  // dedup por nome + cidade + kind
  const { data: dup } = await db.from('attractions').select('id').eq('name', NAME).eq('city', CITY).eq('entity_kind', 'event').maybeSingle()
  if (dup) { console.log(`  ↷ já existe (${dup.id})`); return }

  // venue = Praça de Conservatória (POI)
  const { data: praca } = await db.from('attractions').select('id').eq('name', 'Praça de Conservatória').eq('city', CITY).eq('entity_kind', 'poi').maybeSingle()
  if (!praca) { console.error('  ✗ Praça de Conservatória (POI) não encontrada — abortando'); return }
  console.log(`  venue (Praça) = ${praca.id}`)

  if (DRY) { console.log('  (dry) criaria evento 2026-08-07→16, all_day, vinculado à Praça'); return }

  const { data: att, error: e1 } = await db.from('attractions').insert({
    name: NAME, city: CITY, state: STATE, country: COUNTRY, neighborhood: 'Conservatória',
    entity_kind: 'event', is_active: true, approved: true, description: DESC,
    import_source: 'manual', source_type: 'manual', created_by: admin, processing_status: 'pending',
  }).select('id').single()
  if (e1 || !att) { console.error(`  ✗ attraction: ${e1?.message}`); return }

  const { error: e2 } = await db.from('event_details').insert({
    attraction_id: att.id, starts_at: '2026-08-07T00:00:00-03:00', ends_at: '2026-08-16T23:59:59-03:00',
    timezone: TZ, all_day: true, rrule: null, status: 'scheduled', event_category: 'festival',
    is_free: true, organizer_name: 'Delícias do Vale do Café', organizer_url: 'https://www.deliciasdovaledocafe.com.br',
    tags: ['gastronomia', 'vale-do-cafe', 'cozinha-de-fazenda', 'seresta', 'delicias-vale-do-cafe-2026'],
    venue_attraction_id: praca.id, created_by: admin,
  })
  if (e2) { console.error(`  ✗ event_details: ${e2.message} — removendo`); await db.from('attractions').delete().eq('id', att.id); return }

  const { error: e3 } = await db.rpc('insert_coordinate_safe', { p_attraction_id: att.id, p_latitude: PRACA_COORD.lat, p_longitude: PRACA_COORD.lng, p_show_in_map: true })
  if (e3) console.error(`  ⚠ coord: ${e3.message}`)
  await db.from('attraction_descriptions').insert({ attraction_id: att.id, language: 'pt-br', description: DESC, play_count: 0 })

  console.log(`  ✓ evento criado: ${att.id}`)
  console.log(`    7–16/ago/2026 · all_day · vinculado à Praça (TP da Praça narra) · gratuito`)
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })

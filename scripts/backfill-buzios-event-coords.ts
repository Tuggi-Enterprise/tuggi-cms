/**
 * backfill-buzios-event-coords.ts
 *
 * Dá localização aos eventos de Búzios que ficaram sem coordenada. Venue fortemente
 * implícito → local certo; o resto → centro de Búzios (Praça Santos Dumont) como
 * padrão sensato/refinável. show_in_map=true. Idempotente (só toca quem NÃO tem coord).
 *
 * Uso:  npx tsx --env-file=.env scripts/backfill-buzios-event-coords.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(URL, KEY, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')

const CENTER = { lat: -22.75570, lng: -41.88603, label: 'Praça Santos Dumont (centro)' } // OSM way/161828929
// Overrides por venue fortemente implícito no tipo do evento.
const OVERRIDES: { match: RegExp; lat: number; lng: number; label: string }[] = [
  { match: /sailing/i, lat: -22.74980, lng: -41.95870, label: 'Marina (BR Marinas Búzios)' },     // vela → marina
  { match: /natal luz/i, lat: -22.75119, lng: -41.88379, label: 'Orla Bardot' },                   // luzes de natal na orla
  { match: /sardinha/i, lat: -22.75119, lng: -41.88379, label: 'Orla Bardot' },                    // festival do pescado na orla
]

function target(name: string) {
  for (const o of OVERRIDES) if (o.match.test(name)) return o
  return CENTER
}

async function main() {
  console.log(`\n=== Backfill localização eventos Búzios ${DRY ? '(DRY)' : '(EXECUTANDO)'} ===\n`)
  const { data } = await db.from('attractions')
    .select('id,name,coords:attraction_coordinate(latitude)')
    .eq('city', 'Armação dos Búzios').eq('entity_kind', 'event').order('name')
  const noCoord = (data || []).filter((r: any) => !(Array.isArray(r.coords) ? r.coords[0] : r.coords))
  console.log(`Eventos sem coord: ${noCoord.length}\n`)

  let done = 0
  for (const r of noCoord) {
    const t = target(r.name)
    console.log(`  → ${r.name.padEnd(40)} → ${t.label}  (${t.lat},${t.lng})`)
    if (DRY) continue
    const { error } = await db.rpc('insert_coordinate_safe', { p_attraction_id: r.id, p_latitude: t.lat, p_longitude: t.lng, p_show_in_map: true })
    if (error) console.error(`      ✗ ${error.message}`); else { console.log('      ✓'); done++ }
  }
  console.log(`\n${DRY ? '[DRY] ' : ''}${DRY ? noCoord.length : done} eventos com localização adicionada`)

  const { data: after } = await db.from('attractions').select('id,coords:attraction_coordinate(latitude)').eq('city', 'Armação dos Búzios').eq('entity_kind', 'event')
  const withC = (after || []).filter((r: any) => (Array.isArray(r.coords) ? r.coords[0] : r.coords)).length
  console.log(`Agora: ${withC}/${after?.length} eventos com coordenada\n=== fim ===\n`)
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })

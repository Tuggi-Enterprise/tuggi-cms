/**
 * create-buzios-comercios.ts
 *
 * TESTE do módulo Locais/Comércios: mapeia 3 restaurantes + 3 hotéis famosos de
 * Armação dos Búzios como entity_kind='place' + core.place_details, já ativados,
 * OSM-first (osm_id/coord reaproveitados). Inserção direta via service role
 * (o RPC cms_create_place exige JWT). Trigger Points → manuais.
 *
 * Uso:  npx tsx --env-file=.env scripts/create-buzios-comercios.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(URL, KEY, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')
const CITY = 'Armação dos Búzios', STATE = 'Rio de Janeiro', COUNTRY = 'Brazil'

interface Biz {
  name: string; lat: number; lng: number
  osm_type: 'node' | 'way' | 'relation'; osm_id: number
  neighborhood: string
  primary_category: string; category_group: string; osm_category: string
  place_type: string; cuisine: string[]; price_range: number
  serves_alcohol?: boolean; has_wifi?: boolean; has_outdoor_seating?: boolean; has_takeaway?: boolean
  tags: string[]; description: string
}

const BIZ: Biz[] = [
  // ---- Restaurantes famosos ----
  {
    name: 'Rocka Beach Lounge', lat: -22.75467, lng: -41.87297, osm_type: 'node', osm_id: 5347257846,
    neighborhood: 'Brava', primary_category: 'restaurant', category_group: 'leisure', osm_category: 'restaurant',
    place_type: 'restaurant', cuisine: ['contemporânea', 'frutos do mar'], price_range: 4,
    serves_alcohol: true, has_outdoor_seating: true,
    tags: ['beach club', 'praia brava', 'pôr do sol'],
    description: 'Beach club e restaurante contemporâneo debruçado sobre a Praia Brava, um dos points mais concorridos de Búzios ao pôr do sol.',
  },
  {
    name: 'Chez Michou', lat: -22.75559, lng: -41.88813, osm_type: 'node', osm_id: 5478989652,
    neighborhood: 'Centro', primary_category: 'restaurant', category_group: 'leisure', osm_category: 'restaurant',
    place_type: 'restaurant', cuisine: ['crepe'], price_range: 2,
    serves_alcohol: true, has_outdoor_seating: true, has_takeaway: true,
    tags: ['creperia', 'rua das pedras', 'tradicional'],
    description: 'Creperia icônica na Rua das Pedras desde os anos 1980, um clássico da vida noturna de Búzios.',
  },
  {
    name: 'Bananaland', lat: -22.75635, lng: -41.88856, osm_type: 'node', osm_id: 6257055185,
    neighborhood: 'Centro', primary_category: 'restaurant', category_group: 'leisure', osm_category: 'restaurant',
    place_type: 'restaurant', cuisine: ['natural', 'vegetariana', 'regional'], price_range: 2,
    has_takeaway: true,
    tags: ['comida natural', 'tradicional', 'centro'],
    description: 'Restaurante de comida natural/caseira, um dos mais antigos e queridos de Búzios, no centrinho.',
  },
  // ---- Hotéis famosos ----
  {
    name: 'Hotel PortoBay Búzios', lat: -22.75417, lng: -41.87963, osm_type: 'way', osm_id: 966900287,
    neighborhood: 'Centro', primary_category: 'hotel', category_group: 'lodging', osm_category: 'hotel',
    place_type: 'hotel', cuisine: [], price_range: 4, has_wifi: true,
    tags: ['boutique', 'praia da armação', 'rede portobay'],
    description: 'Hotel boutique da rede portuguesa PortoBay, junto à orla, com vista para a Baía da Armação.',
  },
  {
    name: 'Pérola Búzios', lat: -22.75706, lng: -41.89060, osm_type: 'way', osm_id: 553323767,
    neighborhood: 'Centro', primary_category: 'hotel', category_group: 'lodging', osm_category: 'hotel',
    place_type: 'hotel', cuisine: [], price_range: 4, has_wifi: true,
    tags: ['boutique', 'design', 'centro'],
    description: 'Hotel boutique de design no centro de Búzios, a poucos passos da Rua das Pedras.',
  },
  {
    name: 'La Chimère', lat: -22.74672, lng: -41.88052, osm_type: 'relation', osm_id: 2921518,
    neighborhood: 'Ossos', primary_category: 'hotel', category_group: 'lodging', osm_category: 'hotel',
    place_type: 'hotel', cuisine: [], price_range: 3, has_wifi: true,
    tags: ['pousada', 'ossos', 'vista mar'],
    description: 'Pousada charmosa de inspiração francesa na Praia dos Ossos, com vista para a enseada.',
  },
]

async function getAdminId(): Promise<string | null> {
  const { data } = await db.from('cms_users').select('id').eq('email', 'suporte@tuggi.app').eq('is_active', true).maybeSingle()
  if (data?.id) return data.id
  const { data: a } = await db.from('cms_users').select('id').eq('role', 'admin').eq('is_active', true).limit(1).maybeSingle()
  return a?.id ?? null
}

async function create(b: Biz, adminId: string | null) {
  const { data: byOsm } = await db.from('attractions').select('id,name').eq('osm_type', b.osm_type).eq('osm_id', b.osm_id).maybeSingle()
  if (byOsm) { console.log(`  ↷ SKIP (osm existe ${byOsm.id}) — ${b.name}`); return }
  const { data: byName } = await db.from('attractions').select('id').eq('city', CITY).ilike('name', b.name).maybeSingle()
  if (byName) { console.log(`  ↷ SKIP (nome existe) — ${b.name}`); return }

  console.log(`  + ${b.place_type.toUpperCase().padEnd(10)} ${b.name}  [$${b.price_range}]  osm ${b.osm_type}/${b.osm_id}  (${b.lat},${b.lng})`)
  if (DRY) return

  const { data: att, error: e1 } = await db.from('attractions').insert({
    name: b.name, city: CITY, state: STATE, country: COUNTRY, neighborhood: b.neighborhood,
    entity_kind: 'place', is_active: true, approved: true,
    primary_category: b.primary_category, category_group: b.category_group,
    osm_type: b.osm_type, osm_id: b.osm_id, osm_category: b.osm_category,
    is_touristic: true, description: b.description,
    import_source: 'manual', source_type: 'manual', created_by: adminId, processing_status: 'pending',
  }).select('id').single()
  if (e1 || !att) { console.error(`      ✗ attraction: ${e1?.message}`); return }

  const { error: e2 } = await db.from('place_details').insert({
    attraction_id: att.id, place_type: b.place_type, cuisine: b.cuisine, price_range: b.price_range,
    accepts_reservations: b.place_type === 'restaurant' ? true : null,
    serves_alcohol: b.serves_alcohol ?? null, has_wifi: b.has_wifi ?? null,
    has_outdoor_seating: b.has_outdoor_seating ?? null, has_takeaway: b.has_takeaway ?? null,
    tags: b.tags, created_by: adminId,
  })
  if (e2) { console.error(`      ✗ place_details: ${e2.message} — removendo ${att.id}`); await db.from('attractions').delete().eq('id', att.id); return }

  const { error: e3 } = await db.rpc('insert_coordinate_safe', { p_attraction_id: att.id, p_latitude: b.lat, p_longitude: b.lng, p_show_in_map: true })
  if (e3) { console.error(`      ✗ coord ${e3.message} — removendo ${att.id}`); await db.from('place_details').delete().eq('attraction_id', att.id); await db.from('attractions').delete().eq('id', att.id); return }
  console.log(`      ✓ id=${att.id}`)
}

async function main() {
  console.log(`\n=== Búzios comércios (módulo Locais) ${DRY ? '(DRY)' : '(EXECUTANDO)'} ===\n`)
  const adminId = await getAdminId()
  console.log(`admin: ${adminId ?? '(null)'}\n`)
  for (const b of BIZ) await create(b, adminId)
  console.log('\n=== fim ===\n')
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })

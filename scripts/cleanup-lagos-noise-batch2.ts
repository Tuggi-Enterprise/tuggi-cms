/**
 * cleanup-lagos-noise-batch2.ts
 *
 * Depuração de ruído nas 3 cidades turísticas (Cabo Frio, Armação dos Búzios,
 * Arraial do Cabo): bairros/localidade/rio com categoria nula + duplicatas.
 * SOFT-DELETE (is_active=false). "Maria Joaquina" (praia famosa sem contrapartida)
 * é RECATEGORIZADA em vez de removida. "Praia dos Amores" (2 registros distantes)
 * fica intacta para conferência manual.
 *
 * Uso:  npx tsx --env-file=.env scripts/cleanup-lagos-noise-batch2.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')
const CITIES = ['Cabo Frio', 'Armação dos Búzios', 'Arraial do Cabo']

// desativar por (cidade, nome exato)
const BY_NAME: { city: string; name: string; why: string }[] = [
  { city: 'Cabo Frio', name: 'Vila Manoel Correa', why: 'localidade/bairro' },
  { city: 'Armação dos Búzios', name: 'Porto Bello', why: 'bairro' },
  { city: 'Armação dos Búzios', name: 'Vila Verde', why: 'bairro' },
  { city: 'Armação dos Búzios', name: 'Armação dos Búzios', why: 'nome da cidade (redundante)' },
  { city: 'Armação dos Búzios', name: 'José Gonçalves', why: 'bairro (existe "Praia de José Gonçalves")' },
  { city: 'Armação dos Búzios', name: 'Alto de Búzios', why: 'bairro' },
  { city: 'Armação dos Búzios', name: 'Aldeia de Geribá', why: 'bairro/condomínio' },
  { city: 'Armação dos Búzios', name: 'Vila Cruzeiro', why: 'bairro' },
  { city: 'Armação dos Búzios', name: 'Rasa', why: 'bairro (existe "Praia Rasa")' },
  { city: 'Armação dos Búzios', name: 'Vila Caranga', why: 'bairro' },
  { city: 'Armação dos Búzios', name: 'Cem Braças', why: 'bairro' },
  { city: 'Armação dos Búzios', name: 'São José', why: 'bairro (existe "Igreja São José")' },
  { city: 'Armação dos Búzios', name: 'Ferradura', why: 'bairro (existe "Praia da Ferradura")' },
  { city: 'Armação dos Búzios', name: 'Brava', why: 'bairro (existe "Praia Brava")' },
  { city: 'Armação dos Búzios', name: 'Manguinhos', why: 'bairro (existe "Praia de Manguinhos")' },
  { city: 'Armação dos Búzios', name: 'Rio Una', why: 'rio' },
  { city: 'Arraial do Cabo', name: 'Vila Sítio', why: 'bairro' },
  { city: 'Arraial do Cabo', name: 'Imbetiba', why: 'dup naufrágio (fica "Naufrágio do Navio Imbetiba")' },
  { city: 'Arraial do Cabo', name: 'Naufrágio Navio Imbetiba', why: 'dup naufrágio (fica "Naufrágio do Navio Imbetiba")' },
]

// desativar por prefixo de id (escolha entre duplicatas exatas — fica a versão com osm_id)
const BY_IDPREFIX: { id: string; label: string }[] = [
  { id: '63803342', label: 'Ilha Dois Irmãos (pl3, CF) — fica pl2' },
  { id: 'cc97b09f', label: 'Mirante Ponta da Ferradura (sem osm) — fica c/ osm' },
  { id: 'e002ab38', label: 'Mirante Boca da Barra (sem osm) — fica c/ osm' },
  { id: '2be02ce2', label: 'Pedra do Guardião (sem osm) — fica c/ osm' },
  { id: '50f619b7', label: 'Ponta do Pai Vitório (coast pl2) — fica attraction pl1' },
  { id: '2a0394be', label: 'Ilha Branca (coast pl2) — fica lighthouse pl1' },
  { id: 'f70d3fe2', label: 'Prainhas do Atalaia (dup) — fica osm 227123005' },
]

const RECAT = { city: 'Armação dos Búzios', name: 'Maria Joaquina',
  patch: { primary_category: 'beach', category_group: 'water', priority_level: 2, is_touristic: true } }

async function main() {
  console.log(`\n=== Cleanup CF/Búzios/Arraial ${DRY ? '(DRY)' : '(EXECUTANDO)'} ===\n`)
  const rows: any[] = []
  for (const c of CITIES) {
    const { data } = await db.from('attractions').select('id,name,city,primary_category,is_active').eq('city', c).eq('entity_kind', 'poi')
    rows.push(...(data || []))
  }
  let ok = 0, skip = 0
  const deactivate = async (id: string, label: string) => {
    if (DRY) { console.log(`  − ${label}`); ok++; return }
    const { error } = await db.from('attractions').update({ is_active: false }).eq('id', id)
    if (error) { console.error(`      ✗ ${label}: ${error.message}`); skip++ } else { console.log(`  − ${label}`); ok++ }
  }

  console.log('· por nome:')
  for (const t of BY_NAME) {
    const m = rows.filter(r => r.city === t.city && r.name === t.name && r.is_active !== false)
    if (m.length === 0) { console.log(`  ? não achado: [${t.city}] ${t.name}`); skip++; continue }
    if (m.length > 1) { console.log(`  ⚠ ambíguo (${m.length}): [${t.city}] ${t.name}`); skip++; continue }
    await deactivate(m[0].id, `${t.name} (${t.why})`)
  }
  console.log('\n· por id (duplicatas):')
  for (const t of BY_IDPREFIX) {
    const m = rows.filter(r => r.id.startsWith(t.id) && r.is_active !== false)
    if (m.length === 0) { console.log(`  ? não achado: ${t.id} ${t.label}`); skip++; continue }
    if (m.length > 1) { console.log(`  ⚠ ambíguo: ${t.id}`); skip++; continue }
    await deactivate(m[0].id, t.label)
  }
  // recat
  const rm = rows.filter(r => r.city === RECAT.city && r.name === RECAT.name && r.is_active !== false)
  if (rm.length === 1) {
    console.log(`\n  ✎ recategoriza: ${RECAT.name} → beach/water pl2`)
    if (!DRY) { const { error } = await db.from('attractions').update(RECAT.patch).eq('id', rm[0].id); if (error) console.error(`      ✗ ${error.message}`) }
  } else console.log(`\n  ? recat não resolvido (${rm.length})`)

  console.log(`\n=== desativados: ${ok} | pulados: ${skip} ===`)
  for (const c of CITIES) {
    const { count } = await db.from('attractions').select('id', { count: 'exact', head: true }).eq('city', c).eq('entity_kind', 'poi').neq('is_active', false)
    console.log(`  ${c}: ${count} POIs ativos`)
  }
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })

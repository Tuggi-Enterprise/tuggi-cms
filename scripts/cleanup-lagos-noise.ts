/**
 * cleanup-lagos-noise.ts
 *
 * Depuração de ruído de import antigo na Região dos Lagos (POIs bairro/localidade/rio
 * e duplicatas). SOFT-DELETE: is_active=false (reversível). Um item histórico com
 * categoria nula é recategorizado (não removido). Resolução por (cidade, nome) — com
 * desempate por primary_category no único nome repetido ("Ponta d'água").
 *
 * Uso:  npx tsx --env-file=.env scripts/cleanup-lagos-noise.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')

interface T { city: string; name: string; cat?: string; why: string }
const DEACTIVATE: T[] = [
  // Iguaba Grande — bairros (categoria nula)
  { city: 'Iguaba Grande', name: 'Pedreira', why: 'bairro' },
  { city: 'Iguaba Grande', name: 'Estação', why: 'bairro' },
  { city: 'Iguaba Grande', name: 'Capivara', why: 'bairro' },
  { city: 'Iguaba Grande', name: 'Centro', why: 'bairro' },
  { city: 'Iguaba Grande', name: 'Boa Vista', why: 'bairro' },
  { city: 'Iguaba Grande', name: 'Coqueiros', why: 'bairro' },
  { city: 'Iguaba Grande', name: 'Vila Nova', why: 'bairro' },
  { city: 'Iguaba Grande', name: 'União', why: 'bairro' },
  { city: 'Iguaba Grande', name: 'Cidade Nova', why: 'bairro' },
  { city: 'Iguaba Grande', name: 'Iguabinha', why: 'bairro' },
  // Iguaba Grande — duplicatas
  { city: 'Iguaba Grande', name: 'Arcos de Iguaba Grande', why: 'dup de "Arcos de Iguaba"' },
  { city: 'Iguaba Grande', name: 'Pedra do Lagarto (Iguaba Grande)', why: 'dup de "Pedra do Lagarto"' },
  // Saquarema — localidades/bairros
  { city: 'Saquarema', name: 'Porto da Roça I', why: 'localidade' },
  { city: 'Saquarema', name: 'Jacundá', why: 'localidade' },
  { city: 'Saquarema', name: 'Sampaio Correia', why: 'localidade (dup grafia)' },
  { city: 'Saquarema', name: 'Sampaio Corrêa', why: 'localidade (dup grafia)' },
  { city: 'Saquarema', name: 'Bacaxá', why: 'localidade' },
  { city: 'Saquarema', name: 'Campo da Turfa', why: 'localidade' },
  { city: 'Saquarema', name: 'Guarani', why: 'localidade' },
  { city: 'Saquarema', name: 'Mato Grosso', why: 'localidade' },
  { city: 'Saquarema', name: 'Park swan', why: 'localidade' },
  { city: 'Saquarema', name: 'Vertentes', why: 'localidade' },
  { city: 'Saquarema', name: 'Porto Novo', why: 'localidade' },
  // Saquarema — rios
  { city: 'Saquarema', name: 'Rio Mole', why: 'rio' },
  { city: 'Saquarema', name: 'Palmital (Rio Bonito)', why: 'rio' },
  { city: 'Saquarema', name: 'Mineiros (Rio Bonito)', why: 'rio' },
  // São Pedro da Aldeia — vilas militares/bairros
  { city: 'São Pedro da Aldeia', name: 'Vila Militar', why: 'bairro' },
  { city: 'São Pedro da Aldeia', name: 'Vila dos Oficiais', why: 'bairro' },
  { city: 'São Pedro da Aldeia', name: 'Vila SO/SG', why: 'bairro' },
  { city: 'São Pedro da Aldeia', name: 'Balneário São Pedro', why: 'bairro' },
  { city: 'São Pedro da Aldeia', name: 'Campo Redondo', why: 'bairro' },
  // São Pedro da Aldeia — duplicatas
  { city: 'São Pedro da Aldeia', name: "Ponta d'água", cat: 'coast', why: 'dup de "Ponta d\'água" (beach pl1)' },
  { city: 'São Pedro da Aldeia', name: 'Ponta da Peça', why: 'dup de "Praia Ponta da Peça"' },
  // Araruama
  { city: 'Araruama', name: 'Viaduto', why: 'infra sem valor turístico' },
]

const RECAT = { city: 'São Pedro da Aldeia', name: 'Antiga Estação da Estrada de Ferro Maricá - 1935-1966',
  patch: { primary_category: 'historic_site', category_group: 'culture', is_historic: true, is_touristic: true } }

const CITIES = ['Iguaba Grande', 'Saquarema', 'São Pedro da Aldeia', 'Araruama']

async function main() {
  console.log(`\n=== Cleanup Região dos Lagos ${DRY ? '(DRY)' : '(EXECUTANDO)'} ===\n`)
  const rows: any[] = []
  for (const c of CITIES) {
    const { data } = await db.from('attractions').select('id,name,city,primary_category,is_active').eq('city', c).eq('entity_kind', 'poi')
    rows.push(...(data || []))
  }
  const find = (t: T) => rows.filter(r => r.city === t.city && r.name === t.name && (t.cat ? r.primary_category === t.cat : true))

  let ok = 0, skip = 0
  for (const t of DEACTIVATE) {
    const m = find(t)
    if (m.length === 0) { console.log(`  ? não achado: [${t.city}] ${t.name}`); skip++; continue }
    if (m.length > 1) { console.log(`  ⚠ ambíguo (${m.length}): [${t.city}] ${t.name} — pulado`); skip++; continue }
    const r = m[0]
    if (r.is_active === false) { console.log(`  · já inativo: ${t.name}`); continue }
    console.log(`  − ${t.name.padEnd(38)} (${t.why})`)
    if (DRY) { ok++; continue }
    const { error } = await db.from('attractions').update({ is_active: false }).eq('id', r.id)
    if (error) { console.error(`      ✗ ${error.message}`); skip++ } else ok++
  }
  // recat
  const rm = rows.filter(r => r.city === RECAT.city && r.name === RECAT.name)
  if (rm.length === 1) {
    console.log(`\n  ✎ recategoriza: ${RECAT.name} → historic_site/culture`)
    if (!DRY) { const { error } = await db.from('attractions').update(RECAT.patch).eq('id', rm[0].id); if (error) console.error(`      ✗ ${error.message}`) }
  } else console.log(`\n  ? recat não resolvido (${rm.length})`)

  console.log(`\n=== desativados: ${ok} | pulados: ${skip} ===`)
  for (const c of CITIES) {
    const { count } = await db.from('attractions').select('id', { count: 'exact', head: true }).eq('city', c).eq('entity_kind', 'poi').neq('is_active', false)
    console.log(`  ${c}: ${count} POIs ativos`)
  }
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })

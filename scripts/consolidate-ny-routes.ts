/**
 * consolidate-ny-routes.ts
 *
 * Consolida rotas duplicadas de Nova York (soft-delete da redundante + limpeza das
 * traduções da desativada). Mantém a versão mais completa de cada par:
 *   - Cinema:  mantém "Cenas de Cinema em Nova York" (12 paradas, superset) ;
 *              desativa "Locações de Cinema em Nova York" (11, subconjunto).
 *   - Friends: mantém a versão com episódios (descrição mais rica) e tira o
 *              "(com os episódios)" do nome; desativa a sem episódios.
 *   - Ferry:   mantém "Nova York pelas Pontes"; desativa "East River de Ferry"
 *              (~90% dos mesmos pontos).
 *
 * Uso:  npx tsx --env-file=.env scripts/consolidate-ny-routes.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')

// rotas a desativar (duplicatas)
const DEACTIVATE = [
  { id: 'fd2127ae-6d6e-46fd-af83-afccf15ece4b', label: 'Locações de Cinema em Nova York (subconjunto de Cenas)' },
  { id: 'fd8e1716-84ee-44e7-839a-cd1cf6d8c62d', label: 'Nova York dos Fãs de Friends (sem episódios)' },
  { id: '74c0bb47-6b9d-4230-bea8-5d8ba26f77f7', label: 'East River de Ferry (dup de Nova York pelas Pontes)' },
]

// rota mantida que ganha nome/descrição limpos (já não há a "sem episódios" para distinguir)
const RENAME = {
  id: 'aac2630f-184e-461e-b2ed-c97a47fc5f40',
  name: 'Nova York dos Fãs de Friends',
  description: 'Uma volta pelos cenários reais de Friends em Nova York, com o episódio em que cada lugar aparece. O prédio de 90 Bedford Street está em todos os 236 episódios. A rua de Phoebe aparece no episódio 15 da 7ª temporada; o museu de Ross e aquela data marcante, no 15 da 2ª; a estreia de Rachel na Bloomingdale’s, no 10 da 3ª; e o Central Park onde Phoebe corre do seu jeito, no 7 da 6ª. Todos os locais com fonte confirmada. É uma caminhada pelo Greenwich Village e pelo Upper West Side.',
}

async function main() {
  console.log(`\n=== Consolidação de rotas de NY ${DRY ? '(DRY)' : '(EXECUTANDO)'} ===\n`)
  for (const r of DEACTIVATE) {
    const { data: exists } = await db.from('custom_routes').select('id,is_active').eq('id', r.id).maybeSingle()
    if (!exists) { console.log(`  ? não achada: ${r.label}`); continue }
    console.log(`  − desativa: ${r.label}`)
    if (DRY) continue
    const { error: e1 } = await db.from('custom_routes').update({ is_active: false }).eq('id', r.id)
    if (e1) { console.error(`      ✗ route: ${e1.message}`); continue }
    const { data: trs } = await db.from('custom_route_descriptions').select('id').eq('route_id', r.id)
    if (trs?.length) { await db.from('custom_route_descriptions').delete().eq('route_id', r.id); console.log(`      ✗ ${trs.length} traduções removidas`) }
  }
  console.log(`\n  ✎ renomeia mantida: ${RENAME.name}`)
  if (!DRY) {
    const { error } = await db.from('custom_routes').update({ name: RENAME.name, description: RENAME.description }).eq('id', RENAME.id)
    if (error) console.error(`      ✗ ${error.message}`)
    // a tradução de nome da mantida também fica desatualizada — sinalizar? deixamos p/ regeneração no front
  }
  const { count } = await db.from('custom_routes').select('id', { count: 'exact', head: true }).eq('is_active', true)
  console.log(`\n=== rotas ativas agora: ${count} ===`)
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })


import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'
import * as fs from 'fs'

// Carregar variáveis de ambiente
dotenv.config({ path: resolve(process.cwd(), '.env.local') })
dotenv.config({ path: resolve(process.cwd(), '.env') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Erro: Variáveis de ambiente não encontradas')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

const BATCH_SIZE = 20
const OUTPUT_FILE = 'migrated_duplicates.json'

async function analyzeMigratedDuplicates() {
  console.log('🔍 Iniciando análise de POIs do homolog que já existem no core...\n')
  
  let totalHomolog = 0
  let totalDuplicates = 0
  let duplicatesList: string[] = []

  // 1. Contar total em homolog
  const { count, error: countError } = await supabase
    .schema('homolog')
    .from('pois')
    .select('*', { count: 'exact', head: true })
  
  if (countError) {
    console.error('Erro ao contar POIs em homolog:', countError)
    process.exit(1)
  }
  
  console.log(`📊 Total de POIs em homolog: ${count}`)
  totalHomolog = count || 0

  // 2. Processar em lotes
  let processed = 0
  
  while (processed < totalHomolog) {
    // Buscar lote de homolog
    const { data: homologPois, error: fetchError } = await supabase
      .schema('homolog')
      .from('pois')
      .select('uuid_id, name')
      .order('uuid_id')
      .range(processed, processed + BATCH_SIZE - 1)
      
    if (fetchError) {
      console.error(`Erro ao buscar lote ${processed}:`, fetchError)
      break
    }

    if (!homologPois || homologPois.length === 0) break

    const homologIds = homologPois
      .filter(p => p.uuid_id)
      .map(p => p.uuid_id) as string[]

    if (homologIds.length === 0) {
        processed += homologPois.length
        continue
    }

    // Verificar quais desses existem no core
    const { data: corePois, error: coreError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id')
      .in('id', homologIds)
      
    if (coreError) {
      console.error(`Erro ao verificar lote no core:`, coreError)
    } else if (corePois) {
      const coreIds = new Set(corePois.map(p => p.id))
      
      // Identificar duplicados neste lote
      const duplicatesInBatch = homologIds.filter(id => coreIds.has(id))
      
      duplicatesList.push(...duplicatesInBatch)
      totalDuplicates += duplicatesInBatch.length
      
      process.stdout.write(`\r✅ Processado: ${processed + homologPois.length}/${totalHomolog} | Duplicados encontrados: ${totalDuplicates}`)
    }

    processed += homologPois.length
  }

  console.log('\n\n🏁 Análise concluída!')
  console.log(`   Total em Homolog: ${totalHomolog}`)
  console.log(`   Total já migrados (Duplicados): ${totalDuplicates}`)
  console.log(`   Porcentagem de redundância: ${((totalDuplicates / totalHomolog) * 100).toFixed(2)}%`)

  // Salvar lista de IDs para uso futuro (ex: deleção)
  if (duplicatesList.length > 0) {
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(duplicatesList, null, 2))
    console.log(`\n📄 Lista de IDs duplicados salva em: ${OUTPUT_FILE}`)
    console.log(`   (Use este arquivo para deletar os registros posteriormente)`)
  } else {
    console.log('\n✨ Nenhum duplicado encontrado. Homolog está limpo!')
  }
}

analyzeMigratedDuplicates()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Erro fatal:', error)
    process.exit(1)
  })

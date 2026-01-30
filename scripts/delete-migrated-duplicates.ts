
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

const INPUT_FILE = 'migrated_duplicates.json'
const BATCH_SIZE = 100

async function deleteMigratedDuplicates() {
  console.log('🗑️  Iniciando limpeza de duplicados no homolog...\n')
  
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`❌ Arquivo ${INPUT_FILE} não encontrado. Execute a análise primeiro.`)
    process.exit(1)
  }

  const duplicates = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8')) as string[]
  const total = duplicates.length

  console.log(`📋 Encontrados ${total} IDs para deletar.`)
  
  // Confirmação simples (simulada para script, normalmente pediria input)
  console.log(`   Preparando para deletar ${total} registros da tabela 'homolog.pois'...`)
  
  // await new Promise(resolve => setTimeout(resolve, 2000)) // Pequena pausa

  let deletedCount = 0
  let errorCount = 0

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = duplicates.slice(i, i + BATCH_SIZE)
    
    const { error } = await supabase
      .schema('homolog')
      .from('pois')
      .delete()
      .in('uuid_id', batch)
      
    if (error) {
      console.error(`❌ Erro ao deletar lote ${i}:`, error.message)
      errorCount += batch.length
    } else {
      deletedCount += batch.length
      process.stdout.write(`\r✅ Deletados: ${deletedCount}/${total}`)
    }
  }

  console.log('\n\n🏁 Limpeza concluída!')
  console.log(`   Sucesso: ${deletedCount}`)
  console.log(`   Falhas: ${errorCount}`)
  
  if (deletedCount === total) {
      // Opcional: deletar o arquivo de json após sucesso
      // fs.unlinkSync(INPUT_FILE) 
      console.log('   (Arquivo de lista mantido por segurança)')
  }
}

deleteMigratedDuplicates()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Erro fatal:', error)
    process.exit(1)
  })

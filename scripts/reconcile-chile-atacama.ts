import { getSupabase } from '../lib/core/supabase-client'
import * as dotenv from 'dotenv'

// Carregar variáveis de ambiente
dotenv.config()

/**
 * Script para mapear e atualizar POIs na região do Deserto do Atacama (Antofagasta, Chile)
 * 
 * Este script busca POIs na tabela homolog.pois baseando-se em coordenadas geográficas
 * que compreendem a Região de Antofagasta (II Região do Chile) e atualiza o campo 
 * 'state' para 'Antofagasta' e 'country' para 'Chile'.
 */
async function reconcileAtacamaRegion() {
  console.log('🇨🇱 Reconciliando POIs na região de Antofagasta (Deserto do Atacama)...\n')
  
  const supabase = getSupabase('service')
  
  // Bounding box aproximado da Região de Antofagasta (Chile)
  // Sul: ~ -26.1, Norte: ~ -20.9
  // Oeste: ~ -71.5, Leste: ~ -67.0
  const bounds = {
    minLat: -26.1,
    maxLat: -20.9,
    minLon: -71.5,
    maxLon: -67.0
  }

  console.log(`🔍 Critérios de busca:`)
  console.log(`   Latitude:  [${bounds.minLat}, ${bounds.maxLat}]`)
  console.log(`   Longitude: [${bounds.minLon}, ${bounds.maxLon}]\n`)

  // 1. Contagem inicial
  const { count, error: countError } = await supabase
    .schema('homolog')
    .from('pois')
    .select('*', { count: 'exact', head: true })
    .gte('lat', bounds.minLat)
    .lte('lat', bounds.maxLat)
    .gte('lon', bounds.minLon)
    .lte('lon', bounds.maxLon)

  if (countError) {
    console.error('❌ Erro ao contar POIs:', countError.message)
    return
  }

  console.log(`📊 Total de POIs encontrados na região: ${count}`)

  if (!count || count === 0) {
    console.log('⚠️ Nenhum POI encontrado nestas coordenadas.')
    return
  }

  // 2. Mostrar alguns exemplos antes de atualizar (opcional, mas bom para debug)
  const { data: examples } = await supabase
    .schema('homolog')
    .from('pois')
    .select('name, city, state, country, lat, lon')
    .gte('lat', bounds.minLat)
    .lte('lat', bounds.maxLat)
    .gte('lon', bounds.minLon)
    .lte('lon', bounds.maxLon)
    .limit(5)

  if (examples && examples.length > 0) {
    console.log('\n📝 Exemplos de POIs encontrados:')
    examples.forEach(ex => {
      console.log(`   - ${ex.name} (${ex.city || 'Cidade s/ nome'}) | Atual: ${ex.state || 'N/A'}, ${ex.country || 'N/A'}`)
    })
  }

  // 3. Executar o Update
  console.log(`\n🔄 Atualizando state para 'Antofagasta' e country para 'Chile'...`)
  
  const { error: updateError } = await supabase
    .schema('homolog')
    .from('pois')
    .update({
      state: 'Antofagasta',
      country: 'Chile'
    })
    .gte('lat', bounds.minLat)
    .lte('lat', bounds.maxLat)
    .gte('lon', bounds.minLon)
    .lte('lon', bounds.maxLon)

  if (updateError) {
    console.error('❌ Erro no update:', updateError.message)
  } else {
    console.log('✅ Sincronização concluída com sucesso!')
    
    // Verificação final
    const { count: finalCount } = await supabase
      .schema('homolog')
      .from('pois')
      .select('*', { count: 'exact', head: true })
      .eq('state', 'Antofagasta')
      .eq('country', 'Chile')
      .gte('lat', bounds.minLat)
      .lte('lat', bounds.maxLat)
      .gte('lon', bounds.minLon)
      .lte('lon', bounds.maxLon)
      
    console.log(`✅ Verificação: ${finalCount} POIs agora estão configurados corretamente.`)
  }
}

reconcileAtacamaRegion().catch(err => {
  console.error('❌ Erro fatal no script:', err)
})

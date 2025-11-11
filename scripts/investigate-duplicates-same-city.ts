#!/usr/bin/env tsx

/**
 * Script de Investigação: POIs Duplicados (mesmo nome na mesma cidade)
 * 
 * Objetivo: Identificar POIs que têm o mesmo nome na mesma cidade
 * Regra: N POIs com mesmo nome na mesma cidade = Deixar 1, apagar demais
 * Regra: N POIs com mesmo nome em cidades diferentes = Não apagar nada
 * 
 * Uso: npx tsx scripts/investigate-duplicates-same-city.ts
 * ou: npm run investigate:duplicates
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { writeFileSync } from 'fs'

// Carregar variáveis de ambiente
dotenv.config({ path: resolve(process.cwd(), '.env.local') })
dotenv.config({ path: resolve(process.cwd(), '.env') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Erro: Variáveis de ambiente não encontradas')
  console.error('   Necessário: NEXT_PUBLIC_SUPABASE_URL (ou SUPABASE_URL)')
  console.error('   Necessário: SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

interface DuplicateGroup {
  name: string
  city: string
  state: string | null
  total_duplicates: number
  pois: Array<{
    uuid_id: string
    name: string
    city: string
    state: string | null
    osm_id: number | null
    osm_type: string | null
    lat: number
    lon: number
    created_at: string
    source_file: string | null
    importance: number | null
    action: 'MANTER' | 'APAGAR'
  }>
}

interface InvestigationStats {
  total_pois: number
  pois_with_null_name: number
  pois_with_null_city: number
  duplicate_groups: number
  total_duplicate_pois: number
  pois_to_keep: number
  pois_to_delete: number
  pois_same_name_different_cities: number
}

async function investigateDuplicates() {
  console.log('🔍 Iniciando investigação de duplicatas em homolog.pois...\n')
  console.log('📋 Regras:')
  console.log('   - N POIs com mesmo nome na mesma cidade = Deixar 1, apagar demais')
  console.log('   - N POIs com mesmo nome em cidades diferentes = Não apagar nada\n')

  const stats: InvestigationStats = {
    total_pois: 0,
    pois_with_null_name: 0,
    pois_with_null_city: 0,
    duplicate_groups: 0,
    total_duplicate_pois: 0,
    pois_to_keep: 0,
    pois_to_delete: 0,
    pois_same_name_different_cities: 0
  }

  try {
    // 1. Estatísticas gerais
    console.log('1️⃣ Coletando estatísticas gerais...')
    
    const { count: totalCount, error: countError } = await supabase
      .schema('homolog')
      .from('pois')
      .select('*', { count: 'exact', head: true })
    
    if (countError) {
      throw new Error(`Erro ao contar POIs: ${countError.message}`)
    }
    stats.total_pois = totalCount || 0
    console.log(`   ✅ Total de POIs: ${stats.total_pois.toLocaleString()}`)

    const { count: nullNameCount } = await supabase
      .schema('homolog')
      .from('pois')
      .select('*', { count: 'exact', head: true })
      .is('name', null)
    
    stats.pois_with_null_name = nullNameCount || 0
    console.log(`   ⚠️  POIs com nome NULL: ${stats.pois_with_null_name.toLocaleString()}`)

    const { count: nullCityCount } = await supabase
      .schema('homolog')
      .from('pois')
      .select('*', { count: 'exact', head: true })
      .is('city', null)
    
    stats.pois_with_null_city = nullCityCount || 0
    console.log(`   ⚠️  POIs com cidade NULL: ${stats.pois_with_null_city.toLocaleString()}`)

    // 2. Identificar grupos de duplicatas (nome + cidade)
    console.log('\n2️⃣ Identificando grupos de duplicatas (nome + cidade)...')
    console.log('   📥 Buscando todos os POIs com paginação (limite 1000 por batch)...')
    
    // Buscar todos os POIs com nome e cidade usando paginação
    const allPois: Array<{
      uuid_id: string
      name: string
      city: string
      state: string | null
      osm_id: number | null
      osm_type: string | null
      lat: number
      lon: number
      created_at: string
      source_file: string | null
      importance: number | null
    }> = []
    
    let offset = 0
    const batchSize = 1000
    let hasMore = true
    
    while (hasMore) {
      const { data: batch, error: batchError } = await supabase
        .schema('homolog')
        .from('pois')
        .select('uuid_id, name, city, state, osm_id, osm_type, lat, lon, created_at, source_file, importance')
        .not('name', 'is', null)
        .not('city', 'is', null)
        .order('uuid_id') // Ordenação determinística
        .range(offset, offset + batchSize - 1)
      
      if (batchError) {
        throw new Error(`Erro ao buscar POIs (offset ${offset}): ${batchError.message}`)
      }
      
      if (!batch || batch.length === 0) {
        hasMore = false
        break
      }
      
      allPois.push(...batch)
      offset += batchSize
      
      // Mostrar progresso a cada 5000 POIs
      if (allPois.length % 5000 === 0 || batch.length < batchSize) {
        console.log(`   📊 POIs carregados: ${allPois.length.toLocaleString()}...`)
      }
      
      // Se retornou menos que batchSize, é o último batch
      if (batch.length < batchSize) {
        hasMore = false
      }
    }
    
    if (allPois.length === 0) {
      console.log('   ⚠️  Nenhum POI encontrado com nome e cidade')
      return
    }

    console.log(`   ✅ Total de POIs analisados: ${allPois.length.toLocaleString()}`)

    // Agrupar por nome + cidade
    const groupsMap = new Map<string, Array<typeof allPois[0]>>()
    
    allPois.forEach(poi => {
      const key = `${poi.name}|${poi.city}`
      if (!groupsMap.has(key)) {
        groupsMap.set(key, [])
      }
      groupsMap.get(key)!.push(poi)
    })

    // Filtrar apenas grupos com mais de 1 POI
    const duplicateGroups: DuplicateGroup[] = []
    
    groupsMap.forEach((pois, key) => {
      if (pois.length > 1) {
        const [name, city] = key.split('|')
        const state = pois[0].state
        
        // Ordenar por created_at (mais antigo primeiro)
        const sortedPois = [...pois].sort((a, b) => {
          const dateA = new Date(a.created_at || 0).getTime()
          const dateB = new Date(b.created_at || 0).getTime()
          if (dateA !== dateB) return dateA - dateB
          // Se mesma data, ordenar por UUID para consistência
          return (a.uuid_id || '').localeCompare(b.uuid_id || '')
        })

        duplicateGroups.push({
          name,
          city,
          state,
          total_duplicates: pois.length,
          pois: sortedPois.map((poi, index) => ({
            ...poi,
            action: index === 0 ? 'MANTER' : 'APAGAR'
          }))
        })
      }
    })

    // Ordenar grupos por número de duplicatas (maior primeiro)
    duplicateGroups.sort((a, b) => b.total_duplicates - a.total_duplicates)

    stats.duplicate_groups = duplicateGroups.length
    stats.total_duplicate_pois = duplicateGroups.reduce((sum, g) => sum + g.total_duplicates, 0)
    stats.pois_to_keep = duplicateGroups.length // 1 por grupo
    stats.pois_to_delete = stats.total_duplicate_pois - stats.pois_to_keep

    console.log(`   ✅ Grupos de duplicatas encontrados: ${stats.duplicate_groups.toLocaleString()}`)
    console.log(`   ✅ Total de POIs duplicados: ${stats.total_duplicate_pois.toLocaleString()}`)
    console.log(`   ✅ POIs que serão MANTIDOS: ${stats.pois_to_keep.toLocaleString()}`)
    console.log(`   ✅ POIs que serão APAGADOS: ${stats.pois_to_delete.toLocaleString()}`)

    // 3. Verificar POIs com mesmo nome em cidades diferentes (NÃO apagar)
    console.log('\n3️⃣ Verificando POIs com mesmo nome em cidades diferentes...')
    
    const nameGroupsMap = new Map<string, Set<string>>()
    
    allPois.forEach(poi => {
      if (poi.name && poi.city) {
        if (!nameGroupsMap.has(poi.name)) {
          nameGroupsMap.set(poi.name, new Set())
        }
        nameGroupsMap.get(poi.name)!.add(poi.city)
      }
    })

    let sameNameDifferentCities = 0
    nameGroupsMap.forEach((cities, name) => {
      if (cities.size > 1) {
        sameNameDifferentCities++
      }
    })

    stats.pois_same_name_different_cities = sameNameDifferentCities
    console.log(`   ✅ Nomes que aparecem em múltiplas cidades: ${sameNameDifferentCities.toLocaleString()}`)
    console.log(`   ℹ️  Estes POIs NÃO serão apagados (regra: cidades diferentes)`)

    // 4. Verificar dependências (coordenadas)
    console.log('\n4️⃣ Verificando dependências (coordenadas relacionadas)...')
    
    const poisToDelete = duplicateGroups.flatMap(g => 
      g.pois.filter(p => p.action === 'APAGAR').map(p => p.uuid_id)
    )

    let coordinatesCount = 0
    if (poisToDelete.length > 0) {
      // Verificar coordenadas relacionadas aos POIs que serão apagados
      const { count } = await supabase
        .schema('homolog')
        .from('coordinates')
        .select('*', { count: 'exact', head: true })
        .in('poi_uuid_id', poisToDelete)
      
      coordinatesCount = count || 0
      console.log(`   ⚠️  Coordenadas relacionadas a POIs que serão apagados: ${coordinatesCount.toLocaleString()}`)
      console.log(`   ℹ️  Estas coordenadas também precisarão ser removidas`)
    }

    // 5. Mostrar top 20 grupos de duplicatas
    console.log('\n5️⃣ Top 20 grupos de duplicatas:')
    console.log('─'.repeat(100))
    
    duplicateGroups.slice(0, 20).forEach((group, index) => {
      console.log(`\n${index + 1}. "${group.name}" em ${group.city}${group.state ? `, ${group.state}` : ''}`)
      console.log(`   Total: ${group.total_duplicates} POIs`)
      console.log(`   Ações: 1 MANTER, ${group.total_duplicates - 1} APAGAR`)
      
      group.pois.forEach((poi, poiIndex) => {
        console.log(`   ${poiIndex + 1}. [${poi.action}] UUID: ${poi.uuid_id?.substring(0, 8)}...`)
        console.log(`       OSM: ${poi.osm_id || 'NULL'} (${poi.osm_type || 'NULL'})`)
        console.log(`       Coord: (${poi.lat}, ${poi.lon})`)
        console.log(`       Criado: ${poi.created_at}`)
        console.log(`       Arquivo: ${poi.source_file || 'NULL'}`)
      })
    })

    // 6. Gerar relatório detalhado
    console.log('\n6️⃣ Gerando relatório detalhado...')
    
    const report = {
      investigation_date: new Date().toISOString(),
      stats,
      duplicate_groups: duplicateGroups.map(g => ({
        name: g.name,
        city: g.city,
        state: g.state,
        total_duplicates: g.total_duplicates,
        pois_to_keep: 1,
        pois_to_delete: g.total_duplicates - 1,
        pois: g.pois.map(p => ({
          uuid_id: p.uuid_id,
          action: p.action,
          osm_id: p.osm_id,
          osm_type: p.osm_type,
          created_at: p.created_at,
          source_file: p.source_file
        }))
      })),
      summary: {
        total_pois: stats.total_pois,
        duplicate_groups: stats.duplicate_groups,
        total_duplicate_pois: stats.total_duplicate_pois,
        pois_to_keep: stats.pois_to_keep,
        pois_to_delete: stats.pois_to_delete,
        coordinates_to_delete: coordinatesCount || 0
      }
    }

    const reportFile = `duplicates-investigation-${Date.now()}.json`
    writeFileSync(reportFile, JSON.stringify(report, null, 2))
    console.log(`   ✅ Relatório salvo em: ${reportFile}`)

    // 7. Resumo final
    console.log('\n' + '='.repeat(100))
    console.log('📊 RESUMO DA INVESTIGAÇÃO')
    console.log('='.repeat(100))
    console.log(`Total de POIs na tabela: ${stats.total_pois.toLocaleString()}`)
    console.log(`POIs com nome NULL: ${stats.pois_with_null_name.toLocaleString()}`)
    console.log(`POIs com cidade NULL: ${stats.pois_with_null_city.toLocaleString()}`)
    console.log(`\nGrupos de duplicatas (nome + cidade): ${stats.duplicate_groups.toLocaleString()}`)
    console.log(`Total de POIs duplicados: ${stats.total_duplicate_pois.toLocaleString()}`)
    console.log(`POIs que serão MANTIDOS: ${stats.pois_to_keep.toLocaleString()}`)
    console.log(`POIs que serão APAGADOS: ${stats.pois_to_delete.toLocaleString()}`)
    console.log(`\nNomes em múltiplas cidades (NÃO serão apagados): ${stats.pois_same_name_different_cities.toLocaleString()}`)
    console.log('='.repeat(100))

    console.log('\n✅ Investigação concluída!')
    console.log(`\n📄 Próximos passos:`)
    console.log(`   1. Revisar o relatório: ${reportFile}`)
    console.log(`   2. Executar o script SQL de investigação para mais detalhes`)
    console.log(`   3. Criar script de limpeza baseado nos resultados`)

  } catch (error) {
    console.error('\n❌ Erro durante investigação:', error)
    if (error instanceof Error) {
      console.error('   Mensagem:', error.message)
      console.error('   Stack:', error.stack)
    }
    process.exit(1)
  }
}

// Executar investigação
investigateDuplicates()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Erro fatal:', error)
    process.exit(1)
  })


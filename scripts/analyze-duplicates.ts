/**
 * Script para analisar duplicados na tabela homolog.pois
 * Executa consultas no banco e mostra os resultados
 * 
 * Uso: npm run analyze:duplicates
 * ou: npx tsx scripts/analyze-duplicates.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

// Carregar variáveis de ambiente (tentar .env.local primeiro, depois .env)
dotenv.config({ path: resolve(process.cwd(), '.env.local') })
dotenv.config({ path: resolve(process.cwd(), '.env') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Erro: Variáveis de ambiente não encontradas')
  console.error('   Necessário: NEXT_PUBLIC_SUPABASE_URL (ou SUPABASE_URL)')
  console.error('   Necessário: SUPABASE_SERVICE_ROLE_KEY')
  console.error('   Certifique-se de que o arquivo .env.local ou .env existe e contém essas variáveis')
  console.error('')
  console.error('   Variáveis encontradas:')
  console.error(`   NEXT_PUBLIC_SUPABASE_URL: ${process.env.NEXT_PUBLIC_SUPABASE_URL ? '✅' : '❌'}`)
  console.error(`   SUPABASE_URL: ${process.env.SUPABASE_URL ? '✅' : '❌'}`)
  console.error(`   SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅' : '❌'}`)
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function analyzeDuplicates() {
  console.log('🔍 Iniciando análise de duplicados em homolog.pois...\n')

  try {
    // 1. Verificar se a função create_poi_with_uuid existe (tentando chamá-la)
    console.log('1️⃣ Verificando se a função create_poi_with_uuid existe...')
    try {
      // Tentar chamar a função com parâmetros mínimos para ver se existe
      const { data: testCall, error: testError } = await supabase
        .schema('homolog')
        .rpc('create_poi_with_uuid', {
          p_name: 'TEST',
          p_city: 'TEST',
          p_state: 'TEST',
          p_country: 'Brazil',
          p_category: 'test',
          p_osm_id: null,
          p_osm_type: null,
          p_lat: 0,
          p_lon: 0,
          p_source_file: 'test'
        })
      
      if (testError) {
        if (testError.message.includes('does not exist') || testError.message.includes('function') || testError.code === '42883') {
          console.log('   ❌ FUNÇÃO create_poi_with_uuid NÃO EXISTE no banco!')
          console.log('   Erro:', testError.message)
        } else {
          console.log('   ⚠️  Função existe mas retornou erro:', testError.message)
        }
      } else {
        console.log('   ✅ Função create_poi_with_uuid existe no banco')
      }
    } catch (error) {
      console.log('   ⚠️  Não foi possível verificar a função:', error)
    }

    // 2. Verificar contagem total de POIs
    console.log('\n2️⃣ Verificando contagem total de POIs...')
    const { count: totalCount, error: countError } = await supabase
      .schema('homolog')
      .from('pois')
      .select('*', { count: 'exact', head: true })
    
    if (countError) {
      console.error('   ❌ Erro ao contar POIs:', countError)
    } else {
      console.log(`   Total de POIs na tabela: ${totalCount || 0}`)
    }

    // 3. Verificar quantos registros têm uuid_id NULL
    console.log('\n3️⃣ Verificando registros com uuid_id NULL...')
    const { data: poisData, error: poisError } = await supabase
      .schema('homolog')
      .from('pois')
      .select('uuid_id')
      .limit(1000)

    if (poisError) {
      console.error('❌ Erro ao buscar POIs:', poisError)
    } else {
      const total = poisData?.length || 0
      const withUuid = poisData?.filter(p => p.uuid_id !== null).length || 0
      const withoutUuid = total - withUuid
      
      console.log(`   Total de POIs consultados: ${total}`)
      console.log(`   POIs com UUID: ${withUuid}`)
      console.log(`   POIs sem UUID: ${withoutUuid}`)
      
      if (withoutUuid > 0) {
        console.log('   ⚠️  PROBLEMA: Existem POIs sem UUID!')
      }
    }

    // 4. Verificar duplicados por UUID
    console.log('\n4️⃣ Verificando UUIDs duplicados...')
    const { data: allPois } = await supabase
      .schema('homolog')
      .from('pois')
      .select('uuid_id')
      .not('uuid_id', 'is', null)

    if (allPois) {
      const uuidMap = new Map<string, number>()
      allPois.forEach(poi => {
        const uuid = poi.uuid_id as string
        uuidMap.set(uuid, (uuidMap.get(uuid) || 0) + 1)
      })

      const duplicates = Array.from(uuidMap.entries())
        .filter(([_, count]) => count > 1)
        .sort(([_, a], [__, b]) => b - a)
        .slice(0, 20)

      if (duplicates.length > 0) {
        console.log(`   ❌ PROBLEMA: Encontrados ${duplicates.length} UUIDs duplicados!`)
        console.log('   Top 10 duplicados:')
        duplicates.slice(0, 10).forEach(([uuid, count]) => {
          console.log(`      UUID: ${uuid.substring(0, 8)}... - ${count} ocorrências`)
        })
      } else {
        console.log('   ✅ Nenhum UUID duplicado encontrado')
      }
    }

    // 5. Analisar exemplos específicos
    console.log('\n5️⃣ Analisando exemplos específicos...')
    const { data: exemplos } = await supabase
      .schema('homolog')
      .from('pois')
      .select('uuid_id, name, city, state, osm_id, osm_type, created_at, source_file')
      .or('name.ilike.%Congonhas%,name.ilike.%Universidade Estadual de Campinas%,name.ilike.%UNICAMP%')
      .order('name,created_at')

    if (exemplos && exemplos.length > 0) {
      console.log(`   Encontrados ${exemplos.length} registros para os exemplos:`)
      
      // Agrupar por nome
      const grouped = new Map<string, typeof exemplos>()
      exemplos.forEach(poi => {
        const key = poi.name || 'Unknown'
        if (!grouped.has(key)) {
          grouped.set(key, [])
        }
        grouped.get(key)!.push(poi)
      })

      grouped.forEach((pois, name) => {
        console.log(`\n   📍 ${name}:`)
        console.log(`      Total de registros: ${pois.length}`)
        
        const uuids = new Set(pois.map(p => p.uuid_id).filter(Boolean))
        console.log(`      UUIDs únicos: ${uuids.size}`)
        
        if (uuids.size > 1) {
          console.log(`      ❌ PROBLEMA: Múltiplos UUIDs para o mesmo POI!`)
          uuids.forEach(uuid => {
            const count = pois.filter(p => p.uuid_id === uuid).length
            console.log(`         UUID: ${uuid?.substring(0, 8)}... - ${count} ocorrências`)
          })
        }

        pois.forEach((poi, idx) => {
          console.log(`\n      Registro ${idx + 1}:`)
          console.log(`         UUID: ${poi.uuid_id || 'NULL'}`)
          console.log(`         OSM ID: ${poi.osm_id || 'NULL'}`)
          console.log(`         OSM Type: ${poi.osm_type || 'NULL'}`)
          console.log(`         Cidade: ${poi.city || 'NULL'}`)
          console.log(`         Estado: ${poi.state || 'NULL'}`)
          console.log(`         Arquivo: ${poi.source_file || 'NULL'}`)
          console.log(`         Criado em: ${poi.created_at}`)
        })
      })
    } else {
      console.log('   ⚠️  Nenhum registro encontrado para os exemplos')
    }

    // 6. Verificar POIs com mesmo nome mas UUIDs diferentes
    console.log('\n6️⃣ Verificando POIs com mesmo nome/cidade/estado mas UUIDs diferentes...')
    const { data: allPoisForDuplicates } = await supabase
      .schema('homolog')
      .from('pois')
      .select('uuid_id, name, city, state, source_file')
      .not('name', 'is', null)
      .limit(10000)

    if (allPoisForDuplicates) {
      const nameMap = new Map<string, typeof allPoisForDuplicates>()
      
      allPoisForDuplicates.forEach(poi => {
        const key = `${poi.name}|${poi.city}|${poi.state}`
        if (!nameMap.has(key)) {
          nameMap.set(key, [])
        }
        nameMap.get(key)!.push(poi)
      })

      const nameDuplicates = Array.from(nameMap.entries())
        .filter(([_, pois]) => {
          const uuids = new Set(pois.map(p => p.uuid_id).filter(Boolean))
          return pois.length > 1 && uuids.size > 1
        })
        .sort(([_, a], [__, b]) => b.length - a.length)
        .slice(0, 20)

      if (nameDuplicates.length > 0) {
        console.log(`   ❌ PROBLEMA: ${nameDuplicates.length} POIs com mesmo nome mas UUIDs diferentes:`)
        nameDuplicates.slice(0, 10).forEach(([key, pois]) => {
          const [name, city, state] = key.split('|')
          const uuids = new Set(pois.map(p => p.uuid_id).filter(Boolean))
          console.log(`\n      "${name}" (${city}, ${state}):`)
          console.log(`         Total: ${pois.length} registros`)
          console.log(`         UUIDs diferentes: ${uuids.size}`)
          uuids.forEach(uuid => {
            const count = pois.filter(p => p.uuid_id === uuid).length
            console.log(`            ${uuid?.substring(0, 8)}... - ${count}x`)
          })
        })
      } else {
        console.log('   ✅ Nenhum POI com mesmo nome mas UUIDs diferentes encontrado')
      }
    }

    // 7. Verificar valores NULL
    console.log('\n7️⃣ Verificando valores NULL nos campos usados para gerar UUID...')
    const { data: nullCheck } = await supabase
      .schema('homolog')
      .from('pois')
      .select('osm_id, osm_type, name')
      .limit(10000)

    if (nullCheck) {
      const nullStats = {
        osm_id: nullCheck.filter(p => p.osm_id === null).length,
        osm_type: nullCheck.filter(p => p.osm_type === null).length,
        name: nullCheck.filter(p => p.name === null).length,
      }

      console.log(`   Total analisado: ${nullCheck.length}`)
      console.log(`   osm_id NULL: ${nullStats.osm_id} (${((nullStats.osm_id / nullCheck.length) * 100).toFixed(1)}%)`)
      console.log(`   osm_type NULL: ${nullStats.osm_type} (${((nullStats.osm_type / nullCheck.length) * 100).toFixed(1)}%)`)
      console.log(`   name NULL: ${nullStats.name} (${((nullStats.name / nullCheck.length) * 100).toFixed(1)}%)`)

      if (nullStats.osm_id > 0 || nullStats.osm_type > 0) {
        console.log('   ⚠️  PROBLEMA: Campos OSM NULL podem causar UUIDs inconsistentes!')
      }
    }

    console.log('\n✅ Análise concluída!')

  } catch (error) {
    console.error('❌ Erro durante análise:', error)
    if (error instanceof Error) {
      console.error('   Mensagem:', error.message)
      console.error('   Stack:', error.stack)
    }
  }
}

// Executar análise
analyzeDuplicates()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Erro fatal:', error)
    process.exit(1)
  })


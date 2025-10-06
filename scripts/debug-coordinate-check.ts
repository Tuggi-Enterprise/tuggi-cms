#!/usr/bin/env tsx

/**
 * Script para debugar a verificação de coordenadas
 * 
 * Este script investiga por que POIs com coordenadas estão sendo
 * reportados como sem coordenadas.
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

// Carregar variáveis de ambiente
config()

class CoordinateDebugger {
  private supabase: any

  constructor() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing required Supabase environment variables')
    }
    
    this.supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
      }
    })
  }

  /**
   * Debug específico para o POI "Museu do Telefone CRTB"
   */
  async debugSpecificPOI(): Promise<void> {
    console.log('🔍 Debugando POI específico: "Museu do Telefone CRTB"')
    
    try {
      // 1. Buscar o POI pelo nome
      const { data: poi, error: poiError } = await this.supabase
        .schema('core')
        .from('attractions')
        .select('id, name, city, country')
        .ilike('name', '%Museu do Telefone CRTB%')
        .limit(5)

      if (poiError) {
        console.error('❌ Erro ao buscar POI:', poiError.message)
        return
      }

      console.log(`📊 POIs encontrados: ${poi?.length || 0}`)
      poi?.forEach((p, index) => {
        console.log(`   ${index + 1}. ID: ${p.id}, Nome: ${p.name}, Cidade: ${p.city}`)
      })

      if (poi && poi.length > 0) {
        const targetPOI = poi[0]
        console.log(`\n🎯 Analisando POI: ${targetPOI.name} (ID: ${targetPOI.id})`)

        // 2. Buscar coordenadas para este POI
        const { data: coordinates, error: coordsError } = await this.supabase
          .schema('core')
          .from('attraction_coordinate')
          .select('*')
          .eq('attraction_id', targetPOI.id)

        if (coordsError) {
          console.error('❌ Erro ao buscar coordenadas:', coordsError.message)
        } else {
          console.log(`📊 Coordenadas encontradas: ${coordinates?.length || 0}`)
          coordinates?.forEach((coord, index) => {
            console.log(`   ${index + 1}. ID: ${coord.id}, Lat: ${coord.latitude}, Lng: ${coord.longitude}`)
          })
        }
      }

    } catch (error) {
      console.error('❌ Erro no debug:', error)
    }
  }

  /**
   * Debug geral da lógica de verificação
   */
  async debugVerificationLogic(): Promise<void> {
    console.log('\n🔍 Debugando lógica de verificação...')
    
    try {
      // 1. Buscar alguns POIs
      const { data: samplePOIs, error: poisError } = await this.supabase
        .schema('core')
        .from('attractions')
        .select('id, name, city, country')
        .limit(10)

      if (poisError) {
        console.error('❌ Erro ao buscar POIs:', poisError.message)
        return
      }

      console.log(`📊 POIs de amostra: ${samplePOIs?.length || 0}`)

      // 2. Buscar algumas coordenadas
      const { data: sampleCoords, error: coordsError } = await this.supabase
        .schema('core')
        .from('attraction_coordinate')
        .select('attraction_id')
        .limit(10)

      if (coordsError) {
        console.error('❌ Erro ao buscar coordenadas:', coordsError.message)
        return
      }

      console.log(`📊 Coordenadas de amostra: ${sampleCoords?.length || 0}`)

      // 3. Verificar correspondências
      if (samplePOIs && sampleCoords) {
        console.log('\n🔍 Verificando correspondências:')
        
        const coordIds = new Set(sampleCoords.map(coord => coord.attraction_id))
        
        samplePOIs.forEach(poi => {
          const hasCoordinates = coordIds.has(poi.id)
          console.log(`   ${poi.name}: ${hasCoordinates ? '✅ TEM' : '❌ NÃO TEM'} coordenadas`)
        })
      }

    } catch (error) {
      console.error('❌ Erro no debug da lógica:', error)
    }
  }

  /**
   * Verificar se há problema com paginação
   */
  async debugPagination(): Promise<void> {
    console.log('\n🔍 Debugando paginação...')
    
    try {
      // 1. Contar total de POIs
      const { count: totalPOIs, error: poisCountError } = await this.supabase
        .schema('core')
        .from('attractions')
        .select('*', { count: 'exact', head: true })

      if (poisCountError) {
        console.error('❌ Erro ao contar POIs:', poisCountError.message)
        return
      }

      // 2. Contar total de coordenadas
      const { count: totalCoords, error: coordsCountError } = await this.supabase
        .schema('core')
        .from('attraction_coordinate')
        .select('*', { count: 'exact', head: true })

      if (coordsCountError) {
        console.error('❌ Erro ao contar coordenadas:', coordsCountError.message)
        return
      }

      console.log(`📊 Total de POIs: ${totalPOIs}`)
      console.log(`📊 Total de coordenadas: ${totalCoords}`)

      // 3. Buscar coordenadas com paginação
      let allCoordinates: any[] = []
      let from = 0
      const limit = 1000
      let hasMore = true
      let batchCount = 0

      console.log('📊 Buscando coordenadas com paginação...')
      
      while (hasMore) {
        batchCount++
        const { data: batch, error: fetchError } = await this.supabase
          .schema('core')
          .from('attraction_coordinate')
          .select('attraction_id')
          .order('attraction_id')
          .range(from, from + limit - 1)

        if (fetchError) {
          console.error(`❌ Erro no lote ${batchCount}:`, fetchError.message)
          break
        }

        if (batch && batch.length > 0) {
          allCoordinates = allCoordinates.concat(batch)
          from += limit
          console.log(`   Lote ${batchCount}: ${batch.length} coordenadas (total: ${allCoordinates.length})`)
          
          hasMore = batch.length === limit
        } else {
          hasMore = false
        }
      }

      console.log(`📊 Total de coordenadas encontradas: ${allCoordinates.length}`)
      console.log(`📊 Lotes processados: ${batchCount}`)

    } catch (error) {
      console.error('❌ Erro no debug de paginação:', error)
    }
  }

  /**
   * Executar todos os debugs
   */
  async runAllDebugs(): Promise<void> {
    console.log('🚀 Iniciando debug completo...')
    
    await this.debugSpecificPOI()
    await this.debugVerificationLogic()
    await this.debugPagination()
    
    console.log('\n✅ Debug concluído!')
  }
}

// Executar se script for chamado diretamente
if (require.main === module) {
  const coordinateDebugger = new CoordinateDebugger()
  
  coordinateDebugger.runAllDebugs()
    .then(() => {
      console.log('\n✅ Debug completo finalizado!')
      process.exit(0)
    })
    .catch((error) => {
      console.error('❌ Erro no debug:', error)
      process.exit(1)
    })
}

export { CoordinateDebugger }

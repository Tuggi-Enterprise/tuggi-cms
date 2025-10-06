#!/usr/bin/env tsx

/**
 * Script para analisar POIs com múltiplas coordenadas
 * 
 * Este script identifica POIs que têm mais de uma coordenada na tabela
 * core.attraction_coordinate e desenvolve uma estratégia para resolver
 * essas duplicatas.
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'fs'
import { join } from 'path'

// Carregar variáveis de ambiente
config()

interface DuplicateCoordinateAnalysis {
  attraction_id: string
  attraction_name: string
  city: string
  country: string
  coordinate_count: number
  coordinates: Array<{
    id: string
    latitude: number
    longitude: number
    created_at: string
    show_in_map: boolean | null
    distance_from_sao_paulo_km: number | null
    distance_from_rio_km: number | null
  }>
  recommended_coordinate: {
    id: string
    latitude: number
    longitude: number
    reason: string
  } | null
}

interface AnalysisSummary {
  total_attractions: number
  attractions_with_multiple_coordinates: number
  total_duplicate_coordinates: number
  duplicates_by_city: Record<string, number>
  duplicates_by_country: Record<string, number>
  analysis_timestamp: string
}

class DuplicateCoordinateAnalyzer {
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
   * Analisa todos os POIs com múltiplas coordenadas
   */
  async analyzeDuplicates(): Promise<{
    summary: AnalysisSummary
    duplicates: DuplicateCoordinateAnalysis[]
  }> {
    console.log('🔍 Iniciando análise de coordenadas duplicadas...')

    // 1. Buscar TODAS as coordenadas com paginação (limite Supabase: 1000)
    let allCoordinates: any[] = []
    let from = 0
    const limit = 1000
    let hasMore = true

    console.log('📊 Buscando todas as coordenadas com paginação...')
    
    while (hasMore) {
      const { data: batch, error } = await this.supabase
        .schema('core')
        .from('attraction_coordinate')
        .select(`
          attraction_id,
          id,
          latitude,
          longitude,
          created_at,
          show_in_map,
          distance_from_sao_paulo_km,
          distance_from_rio_km,
          attractions!inner(
            id,
            name,
            city,
            country
          )
        `)
        .order('attraction_id, created_at')
        .range(from, from + limit - 1)

      if (error) {
        throw new Error(`Erro ao buscar coordenadas: ${error.message}`)
      }

      if (batch && batch.length > 0) {
        allCoordinates = allCoordinates.concat(batch)
        from += limit
        console.log(`   Processadas ${allCoordinates.length} coordenadas...`)
        
        // Se retornou menos que o limite, chegamos ao fim
        hasMore = batch.length === limit
      } else {
        hasMore = false
      }
    }

    console.log(`📊 Total de coordenadas encontradas: ${allCoordinates.length}`)

    // 2. Agrupar por attraction_id e identificar duplicatas
    const groupedByAttraction = this.groupByAttraction(allCoordinates)
    const attractionsWithDuplicates = Object.entries(groupedByAttraction)
      .filter(([_, coordinates]) => coordinates.length > 1)
      .map(([attractionId, coordinates]) => ({
        attraction_id: attractionId,
        attraction_name: coordinates[0].attractions.name,
        city: coordinates[0].attractions.city,
        country: coordinates[0].attractions.country,
        coordinate_count: coordinates.length,
        coordinates: coordinates.map(coord => ({
          id: coord.id,
          latitude: coord.latitude,
          longitude: coord.longitude,
          created_at: coord.created_at,
          show_in_map: coord.show_in_map,
          distance_from_sao_paulo_km: coord.distance_from_sao_paulo_km,
          distance_from_rio_km: coord.distance_from_rio_km
        })),
        recommended_coordinate: null
      }))

    console.log(`⚠️  Encontrados ${attractionsWithDuplicates.length} POIs com múltiplas coordenadas`)

    // 3. Desenvolver estratégia para cada POI
    const analyzedDuplicates = attractionsWithDuplicates.map(attraction => 
      this.analyzeAttractionStrategy(attraction)
    )

    // 4. Gerar resumo
    const summary = this.generateSummary(analyzedDuplicates)

    return {
      summary,
      duplicates: analyzedDuplicates
    }
  }

  /**
   * Agrupa coordenadas por attraction_id
   */
  private groupByAttraction(coordinates: any[]): Record<string, any[]> {
    return coordinates.reduce((acc, coord) => {
      const attractionId = coord.attraction_id
      if (!acc[attractionId]) {
        acc[attractionId] = []
      }
      acc[attractionId].push(coord)
      return acc
    }, {} as Record<string, any[]>)
  }

  /**
   * Analisa estratégia para resolver duplicatas de um POI específico
   */
  private analyzeAttractionStrategy(attraction: DuplicateCoordinateAnalysis): DuplicateCoordinateAnalysis {
    const coordinates = attraction.coordinates

    // Estratégia 1: Priorizar coordenada marcada para mostrar no mapa
    const showInMapCoordinate = coordinates.find(coord => coord.show_in_map === true)
    if (showInMapCoordinate) {
      return {
        ...attraction,
        recommended_coordinate: {
          id: showInMapCoordinate.id,
          latitude: showInMapCoordinate.latitude,
          longitude: showInMapCoordinate.longitude,
          reason: 'Marcada para exibição no mapa (show_in_map = true)'
        }
      }
    }

    // Estratégia 2: Priorizar coordenada mais recente
    const mostRecentCoordinate = coordinates.reduce((latest, current) => 
      new Date(current.created_at) > new Date(latest.created_at) ? current : latest
    )

    // Estratégia 3: Verificar se há coordenadas muito próximas (possível duplicata exata)
    const uniqueCoordinates = this.findUniqueCoordinates(coordinates)
    
    if (uniqueCoordinates.length === 1) {
      // Todas as coordenadas são praticamente iguais, manter a mais recente
      return {
        ...attraction,
        recommended_coordinate: {
          id: mostRecentCoordinate.id,
          latitude: mostRecentCoordinate.latitude,
          longitude: mostRecentCoordinate.longitude,
          reason: 'Coordenadas muito próximas, mantendo a mais recente'
        }
      }
    }

    // Estratégia 4: Coordenadas significativamente diferentes - manter a mais recente
    return {
      ...attraction,
      recommended_coordinate: {
        id: mostRecentCoordinate.id,
        latitude: mostRecentCoordinate.latitude,
        longitude: mostRecentCoordinate.longitude,
        reason: 'Coordenadas diferentes, mantendo a mais recente'
      }
    }
  }

  /**
   * Encontra coordenadas únicas (com tolerância de ~10 metros)
   */
  private findUniqueCoordinates(coordinates: Array<{latitude: number, longitude: number}>): Array<{latitude: number, longitude: number}> {
    const unique: Array<{latitude: number, longitude: number}> = []
    const tolerance = 0.0001 // ~10 metros

    for (const coord of coordinates) {
      const isUnique = !unique.some(existing => 
        Math.abs(existing.latitude - coord.latitude) < tolerance &&
        Math.abs(existing.longitude - coord.longitude) < tolerance
      )
      
      if (isUnique) {
        unique.push(coord)
      }
    }

    return unique
  }

  /**
   * Gera resumo da análise
   */
  private generateSummary(duplicates: DuplicateCoordinateAnalysis[]): AnalysisSummary {
    const totalAttractions = duplicates.length
    const totalDuplicateCoordinates = duplicates.reduce((sum, attraction) => 
      sum + attraction.coordinate_count, 0
    )

    const duplicatesByCity = duplicates.reduce((acc, attraction) => {
      acc[attraction.city] = (acc[attraction.city] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    const duplicatesByCountry = duplicates.reduce((acc, attraction) => {
      acc[attraction.country] = (acc[attraction.country] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    return {
      total_attractions: totalAttractions,
      attractions_with_multiple_coordinates: totalAttractions,
      total_duplicate_coordinates: totalDuplicateCoordinates,
      duplicates_by_city: duplicatesByCity,
      duplicates_by_country: duplicatesByCountry,
      analysis_timestamp: new Date().toISOString()
    }
  }

  /**
   * Gera relatório detalhado
   */
  async generateReport(): Promise<void> {
    try {
      const analysis = await this.analyzeDuplicates()
      
      // Salvar relatório JSON
      const reportPath = join(process.cwd(), 'scripts', 'duplicate-coordinates-report.json')
      writeFileSync(reportPath, JSON.stringify(analysis, null, 2))
      
      // Exibir resumo no console
      console.log('\n📋 RESUMO DA ANÁLISE')
      console.log('=' .repeat(50))
      console.log(`Total de POIs com múltiplas coordenadas: ${analysis.summary.attractions_with_multiple_coordinates}`)
      console.log(`Total de coordenadas duplicadas: ${analysis.summary.total_duplicate_coordinates}`)
      console.log(`Timestamp da análise: ${analysis.summary.analysis_timestamp}`)
      
      console.log('\n🌍 Duplicatas por país:')
      Object.entries(analysis.summary.duplicates_by_country)
        .sort(([,a], [,b]) => b - a)
        .forEach(([country, count]) => {
          console.log(`  ${country}: ${count} POIs`)
        })
      
      console.log('\n🏙️  Top 10 cidades com mais duplicatas:')
      Object.entries(analysis.summary.duplicates_by_city)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .forEach(([city, count]) => {
          console.log(`  ${city}: ${count} POIs`)
        })

      console.log('\n📄 Relatório detalhado salvo em:', reportPath)
      
      // Exibir alguns exemplos
      console.log('\n🔍 EXEMPLOS DE DUPLICATAS:')
      console.log('=' .repeat(50))
      analysis.duplicates.slice(0, 5).forEach((duplicate, index) => {
        console.log(`\n${index + 1}. ${duplicate.attraction_name} (${duplicate.city}, ${duplicate.country})`)
        console.log(`   Coordenadas: ${duplicate.coordinate_count}`)
        console.log(`   Recomendação: ${duplicate.recommended_coordinate?.reason}`)
        console.log(`   Coordenada recomendada: ${duplicate.recommended_coordinate?.latitude}, ${duplicate.recommended_coordinate?.longitude}`)
      })

    } catch (error) {
      console.error('❌ Erro ao gerar relatório:', error)
      throw error
    }
  }

  /**
   * Gera script SQL para limpeza das duplicatas
   */
  async generateCleanupScript(): Promise<void> {
    try {
      const analysis = await this.analyzeDuplicates()
      
      let sqlScript = `-- Script de limpeza de coordenadas duplicadas
-- Gerado em: ${new Date().toISOString()}
-- Total de POIs afetados: ${analysis.summary.attractions_with_multiple_coordinates}

BEGIN;

-- Backup das coordenadas que serão removidas
CREATE TEMP TABLE coordinates_to_remove AS
SELECT 
  ac.id,
  ac.attraction_id,
  ac.latitude,
  ac.longitude,
  ac.created_at,
  a.name as attraction_name,
  a.city,
  a.country
FROM core.attraction_coordinate ac
JOIN core.attractions a ON ac.attraction_id = a.id
WHERE ac.attraction_id IN (
  SELECT attraction_id 
  FROM core.attraction_coordinate 
  GROUP BY attraction_id 
  HAVING COUNT(*) > 1
)
AND ac.id NOT IN (
`

      // Adicionar IDs das coordenadas recomendadas (que devem ser mantidas)
      const recommendedIds = analysis.duplicates
        .map(d => d.recommended_coordinate?.id)
        .filter(Boolean)
        .map(id => `'${id}'`)
        .join(',\n  ')

      sqlScript += `  ${recommendedIds}
);

-- Exibir estatísticas antes da remoção
SELECT 
  'Coordenadas a serem removidas' as operation,
  COUNT(*) as count
FROM coordinates_to_remove;

-- Remover coordenadas duplicadas
DELETE FROM core.attraction_coordinate 
WHERE id IN (SELECT id FROM coordinates_to_remove);

-- Verificar resultado
SELECT 
  'POIs ainda com múltiplas coordenadas' as check_type,
  COUNT(*) as count
FROM (
  SELECT attraction_id 
  FROM core.attraction_coordinate 
  GROUP BY attraction_id 
  HAVING COUNT(*) > 1
) duplicates;

-- Exibir resumo final
SELECT 
  'Total de coordenadas após limpeza' as operation,
  COUNT(*) as count
FROM core.attraction_coordinate;

COMMIT;

-- Relatório de coordenadas removidas
SELECT 
  attraction_name,
  city,
  country,
  COUNT(*) as removed_coordinates
FROM coordinates_to_remove
GROUP BY attraction_name, city, country
ORDER BY removed_coordinates DESC;
`

      const scriptPath = join(process.cwd(), 'scripts', 'cleanup-duplicate-coordinates.sql')
      writeFileSync(scriptPath, sqlScript)
      
      console.log('\n🧹 Script de limpeza gerado em:', scriptPath)
      console.log('⚠️  IMPORTANTE: Execute este script com cuidado e faça backup antes!')
      
    } catch (error) {
      console.error('❌ Erro ao gerar script de limpeza:', error)
      throw error
    }
  }
}

// Executar análise se script for chamado diretamente
if (require.main === module) {
  const analyzer = new DuplicateCoordinateAnalyzer()
  
  analyzer.generateReport()
    .then(() => analyzer.generateCleanupScript())
    .then(() => {
      console.log('\n✅ Análise concluída com sucesso!')
      process.exit(0)
    })
    .catch((error) => {
      console.error('❌ Erro na análise:', error)
      process.exit(1)
    })
}

export { DuplicateCoordinateAnalyzer }

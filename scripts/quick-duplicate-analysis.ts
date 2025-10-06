#!/usr/bin/env tsx

/**
 * Análise rápida de coordenadas duplicadas
 * Versão otimizada para processar grandes volumes de dados
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'fs'
import { join } from 'path'

// Carregar variáveis de ambiente
config()

interface QuickAnalysisResult {
  totalCoordinates: number
  totalAttractions: number
  attractionsWithDuplicates: number
  totalDuplicateCoordinates: number
  duplicatesByCity: Record<string, number>
  duplicatesByCountry: Record<string, number>
  topDuplicates: Array<{
    attraction_id: string
    attraction_name: string
    city: string
    country: string
    coordinate_count: number
  }>
}

class QuickDuplicateAnalyzer {
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
   * Análise rápida usando agregação SQL
   */
  async quickAnalysis(): Promise<QuickAnalysisResult> {
    console.log('🚀 Iniciando análise rápida...')

    // 1. Estatísticas gerais usando SQL agregado
    const { data: stats, error: statsError } = await this.supabase
      .schema('core')
      .rpc('get_coordinate_statistics')

    if (statsError) {
      console.log('⚠️  Função RPC não encontrada, usando método alternativo...')
      return await this.alternativeAnalysis()
    }

    console.log('📊 Estatísticas gerais obtidas via SQL')

    // 2. Top POIs com mais duplicatas
    const { data: topDuplicates, error: duplicatesError } = await this.supabase
      .schema('core')
      .rpc('get_pois_with_multiple_coordinates')
      .limit(50)

    if (duplicatesError) {
      console.log('⚠️  Função RPC não encontrada, usando método alternativo...')
      return await this.alternativeAnalysis()
    }

    // 3. Agrupar por cidade e país
    const duplicatesByCity: Record<string, number> = {}
    const duplicatesByCountry: Record<string, number> = {}

    topDuplicates?.forEach((poi: any) => {
      duplicatesByCity[poi.city] = (duplicatesByCity[poi.city] || 0) + 1
      duplicatesByCountry[poi.country] = (duplicatesByCountry[poi.country] || 0) + 1
    })

    return {
      totalCoordinates: stats[0]?.total_coordinates || 0,
      totalAttractions: stats[0]?.total_attractions || 0,
      attractionsWithDuplicates: stats[0]?.attractions_with_multiple_coordinates || 0,
      totalDuplicateCoordinates: stats[0]?.total_duplicate_coordinates || 0,
      duplicatesByCity,
      duplicatesByCountry,
      topDuplicates: topDuplicates?.slice(0, 20) || []
    }
  }

  /**
   * Método alternativo usando queries diretas
   */
  private async alternativeAnalysis(): Promise<QuickAnalysisResult> {
    console.log('📊 Usando método alternativo...')

    // Contar total de coordenadas
    const { count: totalCoordinates } = await this.supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('*', { count: 'exact', head: true })

    // Contar total de attractions
    const { count: totalAttractions } = await this.supabase
      .schema('core')
      .from('attractions')
      .select('*', { count: 'exact', head: true })

    // Buscar POIs com múltiplas coordenadas (limitado para performance)
    const { data: duplicates, error } = await this.supabase
      .schema('core')
      .from('attraction_coordinate')
      .select(`
        attraction_id,
        attractions!inner(
          id,
          name,
          city,
          country
        )
      `)
      .order('attraction_id')

    if (error) throw error

    // Agrupar e contar
    const groupedByAttraction = duplicates?.reduce((acc, coord) => {
      const attractionId = coord.attraction_id
      if (!acc[attractionId]) {
        acc[attractionId] = {
          attraction_id: attractionId,
          attraction_name: coord.attractions.name,
          city: coord.attractions.city,
          country: coord.attractions.country,
          coordinate_count: 0
        }
      }
      acc[attractionId].coordinate_count++
      return acc
    }, {} as Record<string, any>) || {}

    const attractionsWithDuplicates = Object.values(groupedByAttraction)
      .filter((poi: any) => poi.coordinate_count > 1)

    const duplicatesByCity: Record<string, number> = {}
    const duplicatesByCountry: Record<string, number> = {}

    attractionsWithDuplicates.forEach((poi: any) => {
      duplicatesByCity[poi.city] = (duplicatesByCity[poi.city] || 0) + 1
      duplicatesByCountry[poi.country] = (duplicatesByCountry[poi.country] || 0) + 1
    })

    const totalDuplicateCoordinates = attractionsWithDuplicates.reduce(
      (sum, poi) => sum + poi.coordinate_count - 1, 0
    )

    return {
      totalCoordinates: totalCoordinates || 0,
      totalAttractions: totalAttractions || 0,
      attractionsWithDuplicates: attractionsWithDuplicates.length,
      totalDuplicateCoordinates,
      duplicatesByCity,
      duplicatesByCountry,
      topDuplicates: attractionsWithDuplicates
        .sort((a, b) => b.coordinate_count - a.coordinate_count)
        .slice(0, 20)
    }
  }

  /**
   * Gera relatório rápido
   */
  async generateQuickReport(): Promise<void> {
    try {
      const analysis = await this.quickAnalysis()
      
      // Salvar relatório
      const reportPath = join(process.cwd(), 'scripts', 'quick-duplicate-analysis.json')
      writeFileSync(reportPath, JSON.stringify(analysis, null, 2))
      
      // Exibir resumo
      console.log('\n📋 RESUMO RÁPIDO')
      console.log('=' .repeat(50))
      console.log(`Total de coordenadas: ${analysis.totalCoordinates.toLocaleString()}`)
      console.log(`Total de POIs: ${analysis.totalAttractions.toLocaleString()}`)
      console.log(`POIs com duplicatas: ${analysis.attractionsWithDuplicates.toLocaleString()}`)
      console.log(`Coordenadas duplicadas: ${analysis.totalDuplicateCoordinates.toLocaleString()}`)
      console.log(`Percentual de duplicatas: ${((analysis.totalDuplicateCoordinates / analysis.totalCoordinates) * 100).toFixed(1)}%`)
      
      console.log('\n🏙️  Top 10 cidades com mais duplicatas:')
      Object.entries(analysis.duplicatesByCity)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .forEach(([city, count]) => {
          console.log(`  ${city}: ${count} POIs`)
        })

      console.log('\n🔍 Top 10 POIs com mais coordenadas:')
      analysis.topDuplicates.slice(0, 10).forEach((poi, index) => {
        console.log(`  ${index + 1}. ${poi.attraction_name} (${poi.city}) - ${poi.coordinate_count} coordenadas`)
      })

      console.log(`\n📄 Relatório salvo em: ${reportPath}`)

      // Gerar script de limpeza básico
      await this.generateBasicCleanupScript(analysis)

    } catch (error) {
      console.error('❌ Erro na análise:', error)
      throw error
    }
  }

  /**
   * Gera script de limpeza básico
   */
  private async generateBasicCleanupScript(analysis: QuickAnalysisResult): Promise<void> {
    const script = `-- Script de limpeza básico de coordenadas duplicadas
-- Gerado em: ${new Date().toISOString()}
-- Baseado em análise de ${analysis.totalCoordinates} coordenadas

-- IMPORTANTE: Este é um script básico. Use o script completo para limpeza segura!

-- 1. Identificar POIs com múltiplas coordenadas
CREATE TEMP TABLE pois_with_duplicates AS
SELECT 
  attraction_id,
  COUNT(*) as coordinate_count,
  ARRAY_AGG(id ORDER BY created_at DESC) as coordinate_ids
FROM core.attraction_coordinate
GROUP BY attraction_id
HAVING COUNT(*) > 1;

-- 2. Para cada POI, manter apenas a coordenada mais recente
-- (Este script deve ser executado com cuidado e validação prévia)

-- Exemplo de remoção (NÃO EXECUTAR SEM VALIDAÇÃO):
-- DELETE FROM core.attraction_coordinate 
-- WHERE id IN (
--   SELECT unnest(coordinate_ids[2:]) 
--   FROM pois_with_duplicates
-- );

-- 3. Verificar resultado
SELECT 
  'POIs ainda com múltiplas coordenadas' as status,
  COUNT(*) as count
FROM (
  SELECT attraction_id 
  FROM core.attraction_coordinate 
  GROUP BY attraction_id 
  HAVING COUNT(*) > 1
) remaining_duplicates;
`

    const scriptPath = join(process.cwd(), 'scripts', 'basic-cleanup-duplicates.sql')
    writeFileSync(scriptPath, script)
    
    console.log(`🧹 Script básico de limpeza salvo em: ${scriptPath}`)
    console.log('⚠️  IMPORTANTE: Valide o script antes de executar!')
  }
}

// Executar se script for chamado diretamente
if (require.main === module) {
  const analyzer = new QuickDuplicateAnalyzer()
  
  analyzer.generateQuickReport()
    .then(() => {
      console.log('\n✅ Análise rápida concluída!')
      process.exit(0)
    })
    .catch((error) => {
      console.error('❌ Erro na análise:', error)
      process.exit(1)
    })
}

export { QuickDuplicateAnalyzer }


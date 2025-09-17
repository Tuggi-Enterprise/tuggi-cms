#!/usr/bin/env tsx

/**
 * Script para verificar POIs duplicados no banco de dados
 * Verifica POIs com mesmo nome, mesma cidade e localização próxima
 * Estados: SP, RJ, MG
 */

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

// Configuração do Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis de ambiente do Supabase não configuradas')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

interface DuplicatePOI {
  nome_normalizado: string
  cidade: string
  estado: string
  total_pois: number
  menor_distancia_metros: number
  ids_dos_pois: string[]
  nomes_dos_pois: string[]
  latitudes: number[]
  longitudes: number[]
  datas_criacao: string[]
  status_aprovacao: boolean[]
  avaliacoes: number[]
  google_place_ids: string[]
  todas_distancias_metros: number[]
  nivel_proximidade: string
  sugestao_acao: string
}

interface StateStats {
  estado: string
  total_grupos_duplicatas: number
  total_pois_envolvidos: number
  distancia_media_metros: number
  menor_distancia_encontrada: number
  maior_distancia_encontrada: number
}

class DuplicatePOIChecker {
  private results: DuplicatePOI[] = []
  private stats: StateStats[] = []

  /**
   * Executa a verificação de POIs duplicados
   */
  async checkDuplicates(): Promise<void> {
    console.log('🔍 Iniciando verificação de POIs duplicados...')
    console.log('📍 Estados: SP, RJ, MG')
    console.log('📏 Critério: POIs com mesmo nome, mesma cidade e distância < 100m\n')

    try {
      // Executar a consulta principal
      const { data: duplicates, error: duplicatesError } = await supabase
        .rpc('check_duplicate_pois')

      if (duplicatesError) {
        console.error('❌ Erro ao executar consulta de duplicatas:', duplicatesError)
        return
      }

      this.results = duplicates || []
      console.log(`✅ Encontrados ${this.results.length} grupos de POIs duplicados\n`)

      // Executar consulta de estatísticas
      const { data: statistics, error: statsError } = await supabase
        .rpc('get_duplicate_pois_stats')

      if (statsError) {
        console.error('❌ Erro ao obter estatísticas:', statsError)
      } else {
        this.stats = statistics || []
      }

    } catch (error) {
      console.error('❌ Erro durante a verificação:', error)
    }
  }

  /**
   * Gera relatório detalhado
   */
  generateReport(): void {
    console.log('📊 RELATÓRIO DE POIs DUPLICADOS')
    console.log('=' .repeat(50))

    // Estatísticas por estado
    if (this.stats.length > 0) {
      console.log('\n📈 ESTATÍSTICAS POR ESTADO:')
      this.stats.forEach(stat => {
        console.log(`\n🏛️  ${stat.estado}:`)
        console.log(`   • Grupos de duplicatas: ${stat.total_grupos_duplicatas}`)
        console.log(`   • POIs envolvidos: ${stat.total_pois_envolvidos}`)
        console.log(`   • Distância média: ${stat.distancia_media_metros.toFixed(1)}m`)
        console.log(`   • Menor distância: ${stat.menor_distancia_encontrada.toFixed(1)}m`)
        console.log(`   • Maior distância: ${stat.maior_distancia_encontrada.toFixed(1)}m`)
      })
    }

    // Análise por nível de proximidade
    const proximityAnalysis = this.analyzeByProximity()
    console.log('\n🎯 ANÁLISE POR PROXIMIDADE:')
    Object.entries(proximityAnalysis).forEach(([level, count]) => {
      console.log(`   • ${level}: ${count} grupos`)
    })

    // Top 10 duplicatas mais próximas
    console.log('\n🔝 TOP 10 DUPLICATAS MAIS PRÓXIMAS:')
    const topDuplicates = this.results
      .sort((a, b) => a.menor_distancia_metros - b.menor_distancia_metros)
      .slice(0, 10)

    topDuplicates.forEach((duplicate, index) => {
      console.log(`\n${index + 1}. ${duplicate.nomes_dos_pois[0]} (${duplicate.cidade}, ${duplicate.estado})`)
      console.log(`   📏 Distância: ${duplicate.menor_distancia_metros.toFixed(1)}m`)
      console.log(`   📍 POIs: ${duplicate.total_pois}`)
      console.log(`   🎯 Ação: ${duplicate.sugestao_acao}`)
      console.log(`   🆔 IDs: ${duplicate.ids_dos_pois.join(', ')}`)
    })

    // Análise por sugestão de ação
    const actionAnalysis = this.analyzeByAction()
    console.log('\n⚡ ANÁLISE POR SUGESTÃO DE AÇÃO:')
    Object.entries(actionAnalysis).forEach(([action, count]) => {
      console.log(`   • ${action}: ${count} grupos`)
    })
  }

  /**
   * Analisa duplicatas por nível de proximidade
   */
  private analyzeByProximity(): Record<string, number> {
    const analysis: Record<string, number> = {}
    
    this.results.forEach(duplicate => {
      const level = duplicate.nivel_proximidade
      analysis[level] = (analysis[level] || 0) + 1
    })

    return analysis
  }

  /**
   * Analisa duplicatas por sugestão de ação
   */
  private analyzeByAction(): Record<string, number> {
    const analysis: Record<string, number> = {}
    
    this.results.forEach(duplicate => {
      const action = duplicate.sugestao_acao
      analysis[action] = (analysis[action] || 0) + 1
    })

    return analysis
  }

  /**
   * Salva relatório em arquivo JSON
   */
  async saveReportToFile(): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `duplicate-pois-report-${timestamp}.json`
    const filepath = path.join(process.cwd(), 'reports', filename)

    // Criar diretório reports se não existir
    const reportsDir = path.dirname(filepath)
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true })
    }

    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        total_duplicate_groups: this.results.length,
        total_pois_involved: this.results.reduce((sum, group) => sum + group.total_pois, 0),
        states_analyzed: ['SP', 'RJ', 'MG']
      },
      statistics: this.stats,
      duplicates: this.results,
      analysis: {
        by_proximity: this.analyzeByProximity(),
        by_action: this.analyzeByAction()
      }
    }

    fs.writeFileSync(filepath, JSON.stringify(report, null, 2))
    console.log(`\n💾 Relatório salvo em: ${filepath}`)
  }

  /**
   * Gera relatório CSV para análise em planilhas
   */
  async saveCSVReport(): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `duplicate-pois-report-${timestamp}.csv`
    const filepath = path.join(process.cwd(), 'reports', filename)

    // Criar diretório reports se não existir
    const reportsDir = path.dirname(filepath)
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true })
    }

    // Cabeçalho CSV
    const headers = [
      'Nome Normalizado',
      'Cidade',
      'Estado',
      'Total POIs',
      'Menor Distância (m)',
      'Nível Proximidade',
      'Sugestão Ação',
      'IDs dos POIs',
      'Nomes dos POIs',
      'Latitudes',
      'Longitudes',
      'Datas Criação',
      'Status Aprovação',
      'Avaliações',
      'Google Place IDs'
    ]

    // Converter dados para CSV
    const csvRows = [headers.join(',')]
    
    this.results.forEach(duplicate => {
      const row = [
        `"${duplicate.nome_normalizado}"`,
        `"${duplicate.cidade}"`,
        `"${duplicate.estado}"`,
        duplicate.total_pois,
        duplicate.menor_distancia_metros.toFixed(2),
        `"${duplicate.nivel_proximidade}"`,
        `"${duplicate.sugestao_acao}"`,
        `"${duplicate.ids_dos_pois.join(';')}"`,
        `"${duplicate.nomes_dos_pois.join(';')}"`,
        `"${duplicate.latitudes.join(';')}"`,
        `"${duplicate.longitudes.join(';')}"`,
        `"${duplicate.datas_criacao.join(';')}"`,
        `"${duplicate.status_aprovacao.join(';')}"`,
        `"${duplicate.avaliacoes.join(';')}"`,
        `"${duplicate.google_place_ids.join(';')}"`
      ]
      csvRows.push(row.join(','))
    })

    fs.writeFileSync(filepath, csvRows.join('\n'))
    console.log(`📊 Relatório CSV salvo em: ${filepath}`)
  }
}

/**
 * Função principal
 */
async function main() {
  const checker = new DuplicatePOIChecker()
  
  try {
    await checker.checkDuplicates()
    checker.generateReport()
    await checker.saveReportToFile()
    await checker.saveCSVReport()
    
    console.log('\n✅ Verificação de duplicatas concluída com sucesso!')
    
  } catch (error) {
    console.error('❌ Erro durante a execução:', error)
    process.exit(1)
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  main()
}

export { DuplicatePOIChecker }

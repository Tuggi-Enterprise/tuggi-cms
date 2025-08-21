import { createClient } from '@supabase/supabase-js'

interface TrainingExample {
  id: string
  poi_category: string
  urban_density: string
  access_type: string
  distance_m: number
  bearing_deg: number
  priority: number
  radius_meters: number
  quality_score: number
  created_at: string
}

interface LearningPattern {
  poi_category: string
  urban_density: string
  preferred_access_type: string
  successful_distance_range: string
  successful_bearing_sectors: string[]
  total_examples: number
  success_rate: number
  avg_priority: number
  avg_radius_meters: number
  avg_distance_meters: number
  pattern_confidence: number
}

interface PatternInsights {
  totalPatterns: number
  strongPatterns: number // confidence > 0.7
  weakPatterns: number // confidence < 0.4
  topCategories: Array<{category: string, count: number}>
  recommendations: string[]
}

/**
 * Serviço para extrair e analisar padrões de trigger points bem-sucedidos
 */
export class POVPatternExtractor {
  private supabase: ReturnType<typeof createClient>

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey)
  }

  /**
   * Extrai padrões de todos os exemplos de treinamento
   */
  async extractAllPatterns(): Promise<LearningPattern[]> {
    console.log('🔍 Extracting patterns from training examples...')

    const { data: examples, error } = await this.supabase

      .from('pov_training_examples')
      .select('*')
      .eq('is_positive_example', true)
      .gte('quality_score', 70)
      .order('created_at', { ascending: false })

    if (error) {
      throw new Error(`Failed to fetch training examples: ${error.message}`)
    }

    if (!examples || examples.length === 0) {
      console.log('ℹ️  No training examples found')
      return []
    }

    console.log(`📊 Analyzing ${examples.length} training examples...`)

    // Agrupar por categoria, densidade urbana e tipo de acesso
    const groupedPatterns = this.groupExamplesByPattern(examples as any[])
    
    // Extrair padrões estatísticos
    const patterns: LearningPattern[] = []
    
    for (const [key, group] of groupedPatterns.entries()) {
      const pattern = this.analyzePatternGroup(key, group)
      if (pattern.total_examples >= 3) { // Mínimo de 3 exemplos
        patterns.push(pattern)
      }
    }

    console.log(`✅ Extracted ${patterns.length} patterns`)
    return patterns
  }

  /**
   * Analisa padrões para uma categoria específica
   */
  async extractPatternsForCategory(category: string): Promise<LearningPattern[]> {
    console.log(`🔍 Extracting patterns for category: ${category}`)

    const { data: examples, error } = await this.supabase

      .from('pov_training_examples')
      .select('*')
      .eq('poi_category', category)
      .eq('is_positive_example', true)
      .gte('quality_score', 70)

    if (error) {
      throw new Error(`Failed to fetch examples for category ${category}: ${error.message}`)
    }

    if (!examples || examples.length === 0) {
      return []
    }

    const groupedPatterns = this.groupExamplesByPattern(examples as any[])
    const patterns: LearningPattern[] = []
    
    for (const [key, group] of groupedPatterns.entries()) {
      const pattern = this.analyzePatternGroup(key, group)
      patterns.push(pattern)
    }

    return patterns
  }

  /**
   * Gera insights sobre os padrões extraídos
   */
  async generatePatternInsights(): Promise<PatternInsights> {
    console.log('🧠 Generating pattern insights...')

    const { data: patterns, error } = await this.supabase

      .from('pov_learning_patterns')
      .select('*')
      .order('pattern_confidence', { ascending: false })

    if (error) {
      throw new Error(`Failed to fetch patterns: ${error.message}`)
    }

    if (!patterns || patterns.length === 0) {
      return {
        totalPatterns: 0,
        strongPatterns: 0,
        weakPatterns: 0,
        topCategories: [],
        recommendations: ['No patterns found. Add more trigger points to start learning.']
      }
    }

    const strongPatterns = (patterns as any[]).filter((p: any) => p.pattern_confidence > 0.7)
    const weakPatterns = (patterns as any[]).filter((p: any) => p.pattern_confidence < 0.4)

    // Contar por categoria
    const categoryCount = new Map<string, number>()
    ;(patterns as any[]).forEach((p: any) => {
      const count = categoryCount.get(p.poi_category) || 0
      categoryCount.set(p.poi_category, count + 1)
    })

    const topCategories: Array<{category: string, count: number}> = Array.from(categoryCount.entries())
      .map(([category, count]: [string, number]) => ({ category, count }))
      .sort((a: any, b: any) => b.count - a.count)
      .slice(0, 5)

    // Gerar recomendações
    const recommendations = this.generateRecommendations(patterns as any[])

    return {
      totalPatterns: patterns.length,
      strongPatterns: strongPatterns.length,
      weakPatterns: weakPatterns.length,
      topCategories,
      recommendations
    }
  }

  /**
   * Busca padrões similares para um contexto específico
   */
  async findSimilarPatterns(context: {
    poi_category: string
    urban_density: string
    access_type?: string
  }): Promise<LearningPattern[]> {
    console.log(`🔍 Finding patterns similar to: ${JSON.stringify(context)}`)

    let query = this.supabase

      .from('pov_learning_patterns')
      .select('*')
      .eq('poi_category', context.poi_category)
      .eq('urban_density', context.urban_density)
      .gte('pattern_confidence', 0.3)

    if (context.access_type) {
      query = query.eq('preferred_access_type', context.access_type)
    }

    const { data: patterns, error } = await query
      .order('pattern_confidence', { ascending: false })
      .limit(10)

    if (error) {
      throw new Error(`Failed to find similar patterns: ${error.message}`)
    }

    return (patterns as any[]) || []
  }

  /**
   * Atualiza padrões baseado em novos exemplos
   */
  async updatePatterns(): Promise<void> {
    console.log('🔄 Updating learning patterns...')

    const { error } = await this.supabase
      .rpc('update_learning_patterns', {})

    if (error) {
      throw new Error(`Failed to update patterns: ${error.message}`)
    }

    console.log('✅ Patterns updated successfully')
  }

  /**
   * Agrupa exemplos por padrão (categoria + densidade + acesso)
   */
  private groupExamplesByPattern(examples: TrainingExample[]): Map<string, TrainingExample[]> {
    const groups = new Map<string, TrainingExample[]>()

    examples.forEach(example => {
      const key = `${example.poi_category}|${example.urban_density}|${example.access_type}`
      
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      
      groups.get(key)!.push(example)
    })

    return groups
  }

  /**
   * Analisa um grupo de exemplos para extrair padrão
   */
  private analyzePatternGroup(key: string, examples: TrainingExample[]): LearningPattern {
    const [poi_category, urban_density, preferred_access_type] = key.split('|')

    // Calcular estatísticas
    const totalExamples = examples.length
    const avgQualityScore = examples.reduce((sum, ex) => sum + ex.quality_score, 0) / totalExamples
    const avgPriority = examples.reduce((sum, ex) => sum + ex.priority, 0) / totalExamples
    const avgRadius = examples.reduce((sum, ex) => sum + ex.radius_meters, 0) / totalExamples
    const avgDistance = examples.reduce((sum, ex) => sum + ex.distance_m, 0) / totalExamples

    // Calcular setores de bearing
    const bearingSectors = this.calculateBearingSectors(examples)

    // Calcular range de distância
    const distanceRange = this.calculateDistanceRange(avgDistance)

    // Calcular confiança do padrão
    const patternConfidence = Math.min(totalExamples / 20.0, 1.0) * (avgQualityScore / 100.0)

    return {
      poi_category,
      urban_density,
      preferred_access_type,
      successful_distance_range: distanceRange,
      successful_bearing_sectors: bearingSectors,
      total_examples: totalExamples,
      success_rate: avgQualityScore / 100.0,
      avg_priority: avgPriority,
      avg_radius_meters: avgRadius,
      avg_distance_meters: avgDistance,
      pattern_confidence: patternConfidence
    }
  }

  /**
   * Calcula setores de bearing predominantes
   */
  private calculateBearingSectors(examples: TrainingExample[]): string[] {
    const sectorCount = new Map<string, number>()

    examples.forEach(example => {
      const sector = this.bearingToSector(example.bearing_deg)
      const count = sectorCount.get(sector) || 0
      sectorCount.set(sector, count + 1)
    })

    // Retornar setores com pelo menos 20% dos exemplos
    const threshold = examples.length * 0.2
    return Array.from(sectorCount.entries())
      .filter(([_, count]) => count >= threshold)
      .map(([sector, _]) => sector)
  }

  /**
   * Converte bearing em setor cardinal
   */
  private bearingToSector(bearing: number): string {
    if (bearing >= 0 && bearing < 45) return 'N'
    if (bearing >= 45 && bearing < 90) return 'NE'
    if (bearing >= 90 && bearing < 135) return 'E'
    if (bearing >= 135 && bearing < 180) return 'SE'
    if (bearing >= 180 && bearing < 225) return 'S'
    if (bearing >= 225 && bearing < 270) return 'SW'
    if (bearing >= 270 && bearing < 315) return 'W'
    return 'NW'
  }

  /**
   * Calcula range de distância
   */
  private calculateDistanceRange(avgDistance: number): string {
    if (avgDistance < 100) return 'close'
    if (avgDistance < 500) return 'medium'
    return 'far'
  }

  /**
   * Gera recomendações baseadas nos padrões
   */
  private generateRecommendations(patterns: LearningPattern[]): string[] {
    const recommendations: string[] = []

    if (patterns.length === 0) {
      return ['No patterns found. Add more trigger points to start learning.']
    }

    // Analisar padrões mais fortes
    const strongPatterns = patterns.filter(p => p.pattern_confidence > 0.7)
    
    if (strongPatterns.length > 0) {
      const mostConfident = strongPatterns[0]
      recommendations.push(
        `Strong pattern found for ${mostConfident.poi_category} in ${mostConfident.urban_density} areas: ` +
        `prefer ${mostConfident.preferred_access_type} access at ${mostConfident.successful_distance_range} distance`
      )
    }

    // Analisar padrões por categoria
    const categoryPatterns = new Map<string, LearningPattern[]>()
    patterns.forEach(p => {
      if (!categoryPatterns.has(p.poi_category)) {
        categoryPatterns.set(p.poi_category, [])
      }
      categoryPatterns.get(p.poi_category)!.push(p)
    })

    for (const [category, catPatterns] of categoryPatterns.entries()) {
      if (catPatterns.length >= 2) {
        const avgDistance = catPatterns.reduce((sum, p) => sum + p.avg_distance_meters, 0) / catPatterns.length
        const preferredAccess = this.getMostCommonAccess(catPatterns)
        
        recommendations.push(
          `For ${category} POIs: optimal distance is ~${Math.round(avgDistance)}m with ${preferredAccess} access`
        )
      }
    }

    // Analisar padrões por densidade urbana
    const densityPatterns = new Map<string, LearningPattern[]>()
    patterns.forEach(p => {
      if (!densityPatterns.has(p.urban_density)) {
        densityPatterns.set(p.urban_density, [])
      }
      densityPatterns.get(p.urban_density)!.push(p)
    })

    for (const [density, denPatterns] of densityPatterns.entries()) {
      if (denPatterns.length >= 2) {
        const avgDistance = denPatterns.reduce((sum, p) => sum + p.avg_distance_meters, 0) / denPatterns.length
        
        recommendations.push(
          `In ${density} areas: average successful distance is ${Math.round(avgDistance)}m`
        )
      }
    }

    // Recomendações gerais
    if (patterns.length >= 10) {
      const avgConfidence = patterns.reduce((sum, p) => sum + p.pattern_confidence, 0) / patterns.length
      
      if (avgConfidence > 0.6) {
        recommendations.push('System has learned strong patterns. AI recommendations should be highly accurate.')
      } else if (avgConfidence > 0.4) {
        recommendations.push('System has moderate learning. Continue adding trigger points for better accuracy.')
      } else {
        recommendations.push('System needs more training data. Add more diverse trigger points.')
      }
    }

    return recommendations.slice(0, 5) // Máximo 5 recomendações
  }

  /**
   * Encontra o tipo de acesso mais comum
   */
  private getMostCommonAccess(patterns: LearningPattern[]): string {
    const accessCount = new Map<string, number>()
    
    patterns.forEach(p => {
      const count = accessCount.get(p.preferred_access_type) || 0
      accessCount.set(p.preferred_access_type, count + 1)
    })

    let mostCommon = 'both'
    let maxCount = 0
    
    for (const [access, count] of accessCount.entries()) {
      if (count > maxCount) {
        maxCount = count
        mostCommon = access
      }
    }

    return mostCommon
  }
}

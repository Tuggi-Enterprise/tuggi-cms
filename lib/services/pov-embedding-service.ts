import { getSupabase } from '../core/supabase-client'

interface TrainingExample {
  id: string
  poi_name: string
  poi_category: string
  urban_density: string
  access_type: string
  trigger_type: string
  distance_m: number
  bearing_deg: number
  priority: number
  context_text: string
  quality_score: number
}

interface SimilarExample {
  example: TrainingExample
  similarity: number
  distance: number
}

interface EmbeddingSearchResult {
  examples: SimilarExample[]
  patterns: string[]
  recommendations: string[]
}

/**
 * Serviço para gerar e gerenciar embeddings para busca semântica de padrões POV
 * Utiliza OpenAI embeddings para encontrar exemplos similares
 */
export class POVEmbeddingService {
  private supabase: any
  private openaiApiKey: string

  constructor(supabaseUrl: string, supabaseKey: string, openaiApiKey: string) {
    this.supabase = getSupabase('service')
    this.openaiApiKey = openaiApiKey
  }

  /**
   * Gera embedding para um contexto de POV
   */
  async generateEmbedding(contextText: string): Promise<number[]> {
    if (!this.openaiApiKey) {
      throw new Error('OpenAI API key not configured')
    }

    try {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: contextText,
          model: 'text-embedding-3-small', // Modelo mais eficiente
          encoding_format: 'float'
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`)
      }

      const data = await response.json()
      return data.data[0].embedding
    } catch (error) {
      console.error('Failed to generate embedding:', error)
      throw error
    }
  }

  /**
   * Gera embeddings para todos os exemplos de treinamento que não têm
   */
  async generateMissingEmbeddings(): Promise<void> {
    console.log('🔍 Checking for training examples without embeddings...')

    // Buscar exemplos sem embeddings
    const { data: examples, error } = await this.supabase
      .from('pov_training_examples')
      .select('id, context_text')
      .is('context_embedding', null)
      .limit(100) // Processar em lotes

    if (error) {
      throw new Error(`Failed to fetch examples: ${error.message}`)
    }

    if (!examples || examples.length === 0) {
      console.log('✅ All training examples already have embeddings')
      return
    }

    console.log(`📊 Generating embeddings for ${examples.length} examples...`)

    let successCount = 0
    let errorCount = 0

    for (const [index, example] of (examples as any[]).entries()) {
      try {
        console.log(`⚙️  Processing ${index + 1}/${examples.length}: ${example.id}`)

        // Gerar embedding
        const embedding = await this.generateEmbedding(String(example.context_text))

        // Atualizar no banco
        const { error: updateError } = await (this.supabase as any)
          .from('pov_training_examples')
          .update({ context_embedding: `[${embedding.join(',')}]` })
          .eq('id', String(example.id))

        if (updateError) {
          throw new Error(`Failed to update embedding: ${updateError.message}`)
        }

        successCount++
        console.log(`✅ Generated embedding for example ${example.id}`)

        // Pausa para respeitar rate limits da OpenAI
        if (index < examples.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }

      } catch (error) {
        console.error(`❌ Error processing example ${example.id}:`, error)
        errorCount++
      }
    }

    console.log(`📊 Embedding generation completed: ${successCount} success, ${errorCount} errors`)
  }

  /**
   * Busca exemplos similares usando embeddings
   */
  async findSimilarExamples(
    contextText: string, 
    limit: number = 10,
    threshold: number = 0.7
  ): Promise<EmbeddingSearchResult> {
    console.log(`🔍 Searching for similar examples: "${contextText.substring(0, 50)}..."`)

    // Gerar embedding para o contexto de busca
    const queryEmbedding = await this.generateEmbedding(contextText)

    // Buscar exemplos similares usando função de similaridade do PostgreSQL
    const { data: results, error } = await (this.supabase as any)
      .rpc('find_similar_pov_examples', {
        query_embedding: `[${queryEmbedding.join(',')}]`,
        match_threshold: threshold,
        match_count: limit
      })

    if (error) {
      // Se a função RPC não existir, usar busca alternativa
      console.warn('RPC function not found, using alternative search')
      return await this.findSimilarExamplesAlternative(contextText, limit)
    }

    if (!results || !Array.isArray(results) || results.length === 0) {
      console.log('ℹ️  No similar examples found')
      return {
        examples: [],
        patterns: [],
        recommendations: ['No similar examples found. This might be a new pattern.']
      }
    }

    // Processar resultados
    const similarExamples: SimilarExample[] = (results as any[]).map((result: any) => ({
      example: {
        id: result.id,
        poi_name: result.poi_name,
        poi_category: result.poi_category,
        urban_density: result.urban_density,
        access_type: result.access_type,
        trigger_type: result.trigger_type,
        distance_m: result.distance_m,
        bearing_deg: result.bearing_deg,
        priority: result.priority,
        context_text: result.context_text,
        quality_score: result.quality_score
      },
      similarity: result.similarity,
      distance: result.distance_m
    }))

    // Extrair padrões dos exemplos similares
    const patterns = this.extractPatternsFromSimilarExamples(similarExamples)
    const recommendations = this.generateRecommendationsFromSimilarExamples(similarExamples)

    console.log(`✅ Found ${similarExamples.length} similar examples`)

    return {
      examples: similarExamples,
      patterns,
      recommendations
    }
  }

  /**
   * Busca alternativa quando RPC não está disponível
   */
  private async findSimilarExamplesAlternative(
    contextText: string, 
    limit: number
  ): Promise<EmbeddingSearchResult> {
    // Buscar por palavras-chave como fallback
    const keywords = this.extractKeywords(contextText)
    
    let query = this.supabase
      .from('pov_training_examples')
      .select('*')
      .limit(limit)

    // Adicionar filtros baseados em palavras-chave
    if (keywords.category) {
      query = query.eq('poi_category', keywords.category)
    }
    if (keywords.density) {
      query = query.eq('urban_density', keywords.density)
    }
    if (keywords.access) {
      query = query.eq('access_type', keywords.access)
    }

    const { data: examples, error } = await query.order('quality_score', { ascending: false })

    if (error) {
      throw new Error(`Failed to search examples: ${error.message}`)
    }

    const similarExamples: SimilarExample[] = (examples || []).map((example: any) => ({
      example: {
        id: example.id,
        poi_name: example.poi_name || '',
        poi_category: example.poi_category || '',
        urban_density: example.urban_density || '',
        access_type: example.access_type || '',
        trigger_type: example.trigger_type || '',
        distance_m: example.distance_m || 0,
        bearing_deg: example.bearing_deg || 0,
        priority: example.priority || 0,
        context_text: example.context_text || '',
        quality_score: example.quality_score || 0
      },
      similarity: 0.5, // Similaridade estimada
      distance: example.distance_m || 0
    }))

    const patterns = this.extractPatternsFromSimilarExamples(similarExamples)
    const recommendations = this.generateRecommendationsFromSimilarExamples(similarExamples)

    return {
      examples: similarExamples,
      patterns,
      recommendations
    }
  }

  /**
   * Extrai palavras-chave do contexto para busca alternativa
   */
  private extractKeywords(contextText: string): {
    category?: string
    density?: string
    access?: string
  } {
    const text = contextText.toLowerCase()
    const keywords: any = {}

    // Detectar categoria
    if (text.includes('building') || text.includes('edifício')) keywords.category = 'building'
    if (text.includes('park') || text.includes('parque')) keywords.category = 'park'
    if (text.includes('landmark') || text.includes('monumento')) keywords.category = 'landmark'

    // Detectar densidade
    if (text.includes('very_dense') || text.includes('centro')) keywords.density = 'very_dense'
    if (text.includes('dense') || text.includes('urbano')) keywords.density = 'dense'
    if (text.includes('mixed') || text.includes('misto')) keywords.density = 'mixed'
    if (text.includes('open') || text.includes('rural')) keywords.density = 'open'

    // Detectar acesso
    if (text.includes('car') || text.includes('carro')) keywords.access = 'car'
    if (text.includes('walk') || text.includes('caminhada')) keywords.access = 'walk'
    if (text.includes('both') || text.includes('ambos')) keywords.access = 'both'

    return keywords
  }

  /**
   * Extrai padrões dos exemplos similares
   */
  private extractPatternsFromSimilarExamples(examples: SimilarExample[]): string[] {
    if (examples.length === 0) return []

    const patterns: string[] = []

    // Analisar categorias mais comuns
    const categories = new Map<string, number>()
    examples.forEach(ex => {
      const count = categories.get(ex.example.poi_category) || 0
      categories.set(ex.example.poi_category, count + 1)
    })

    const topCategory = Array.from(categories.entries())
      .sort((a, b) => b[1] - a[1])[0]

    if (topCategory && topCategory[1] >= examples.length * 0.5) {
      patterns.push(`Most similar examples are ${topCategory[0]} POIs`)
    }

    // Analisar distâncias
    const distances = examples.map(ex => ex.example.distance_m)
    const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length
    const minDistance = Math.min(...distances)
    const maxDistance = Math.max(...distances)

    patterns.push(`Distance range: ${minDistance}m - ${maxDistance}m (avg: ${Math.round(avgDistance)}m)`)

    // Analisar tipos de acesso
    const accessTypes = new Map<string, number>()
    examples.forEach(ex => {
      const count = accessTypes.get(ex.example.access_type) || 0
      accessTypes.set(ex.example.access_type, count + 1)
    })

    const topAccess = Array.from(accessTypes.entries())
      .sort((a, b) => b[1] - a[1])[0]

    if (topAccess) {
      patterns.push(`Preferred access: ${topAccess[0]} (${Math.round(topAccess[1] / examples.length * 100)}%)`)
    }

    // Analisar prioridades
    const priorities = examples.map(ex => ex.example.priority)
    const avgPriority = priorities.reduce((sum, p) => sum + p, 0) / priorities.length

    patterns.push(`Average priority: ${avgPriority.toFixed(1)}`)

    return patterns
  }

  /**
   * Gera recomendações baseadas nos exemplos similares
   */
  private generateRecommendationsFromSimilarExamples(examples: SimilarExample[]): string[] {
    if (examples.length === 0) {
      return ['No similar examples found. This might be a new pattern.']
    }

    const recommendations: string[] = []

    // Recomendação de distância
    const distances = examples.map(ex => ex.example.distance_m)
    const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length

    recommendations.push(`Recommended distance: ~${Math.round(avgDistance)}m based on similar examples`)

    // Recomendação de acesso
    const accessTypes = new Map<string, number>()
    examples.forEach(ex => {
      const count = accessTypes.get(ex.example.access_type) || 0
      accessTypes.set(ex.example.access_type, count + 1)
    })

    const topAccess = Array.from(accessTypes.entries())
      .sort((a, b) => b[1] - a[1])[0]

    if (topAccess && topAccess[1] >= examples.length * 0.6) {
      recommendations.push(`Recommended access: ${topAccess[0]} (successful in ${Math.round(topAccess[1] / examples.length * 100)}% of similar cases)`)
    }

    // Recomendação de prioridade
    const avgPriority = examples.reduce((sum, ex) => sum + ex.example.priority, 0) / examples.length
    const avgQuality = examples.reduce((sum, ex) => sum + ex.example.quality_score, 0) / examples.length

    if (avgQuality >= 80) {
      recommendations.push(`High confidence recommendation (avg quality: ${Math.round(avgQuality)}%)`)
    } else if (avgQuality >= 70) {
      recommendations.push(`Moderate confidence recommendation (avg quality: ${Math.round(avgQuality)}%)`)
    } else {
      recommendations.push(`Low confidence recommendation - consider alternative approaches`)
    }

    // Recomendação específica baseada no padrão mais forte
    const bestExample = examples.sort((a, b) => b.example.quality_score - a.example.quality_score)[0]
    
    if (bestExample.example.quality_score >= 85) {
      recommendations.push(
        `Best practice: ${bestExample.example.poi_name} pattern - ` +
        `${bestExample.example.distance_m}m distance with ${bestExample.example.access_type} access`
      )
    }

    return recommendations.slice(0, 4) // Máximo 4 recomendações
  }

  /**
   * Cria função RPC no Supabase para busca por similaridade (se não existir)
   */
  async createSimilarityFunction(): Promise<void> {
    console.log('🔧 Creating similarity search function...')

    const functionSQL = `
      CREATE OR REPLACE FUNCTION core.find_similar_pov_examples(
        query_embedding vector(1536),
        match_threshold float DEFAULT 0.7,
        match_count int DEFAULT 10
      )
      RETURNS TABLE (
        id uuid,
        poi_name text,
        poi_category text,
        urban_density text,
        access_type text,
        trigger_type text,
        distance_m int,
        bearing_deg int,
        priority int,
        context_text text,
        quality_score real,
        similarity float
      )
      LANGUAGE sql STABLE
      AS $$
        SELECT
          pte.id,
          pte.poi_name,
          pte.poi_category,
          pte.urban_density,
          pte.access_type,
          pte.trigger_type,
          pte.distance_m,
          pte.bearing_deg,
          pte.priority,
          pte.context_text,
          pte.quality_score,
          1 - (pte.context_embedding <=> query_embedding) as similarity
        FROM core.pov_training_examples pte
        WHERE pte.context_embedding IS NOT NULL
          AND 1 - (pte.context_embedding <=> query_embedding) > match_threshold
        ORDER BY pte.context_embedding <=> query_embedding
        LIMIT match_count;
      $$;
    `

    const { error } = await (this.supabase as any).rpc('exec_sql', { sql: functionSQL })

    if (error) {
      console.warn('Failed to create similarity function:', error.message)
      console.log('ℹ️  Function might already exist or require manual creation')
    } else {
      console.log('✅ Similarity search function created successfully')
    }
  }
}

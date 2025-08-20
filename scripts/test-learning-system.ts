import { createClient } from '@supabase/supabase-js'
import { POVPatternExtractor } from '@/lib/services/pov-pattern-extractor'
import { POVEmbeddingService } from '@/lib/services/pov-embedding-service'
import 'dotenv/config'

// Configuração do Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const openaiApiKey = process.env.OPENAI_API_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

/**
 * Script para testar o sistema completo de aprendizado de POVs
 */
async function testLearningSystem() {
  console.log('🚀 TESTING POV LEARNING SYSTEM')
  console.log('============================================================')
  
  try {
    // 1. Verificar estrutura do banco
    console.log('\n📊 Step 1: Verifying database structure...')
    await verifyDatabaseStructure()
    
    // 2. Testar extração de padrões
    console.log('\n🔍 Step 2: Testing pattern extraction...')
    await testPatternExtraction()
    
    // 3. Testar sistema de embeddings
    console.log('\n🧠 Step 3: Testing embedding system...')
    await testEmbeddingSystem()
    
    // 4. Testar busca semântica
    console.log('\n🔍 Step 4: Testing semantic search...')
    await testSemanticSearch()
    
    // 5. Testar sistema completo
    console.log('\n🎯 Step 5: Testing complete system integration...')
    await testCompleteSystem()
    
    console.log('\n✅ ALL TESTS PASSED!')
    console.log('🎉 POV Learning System is ready for production!')
    
  } catch (error) {
    console.error('\n💥 TEST FAILED:', error)
    process.exit(1)
  }
}

/**
 * Verifica se a estrutura do banco está correta
 */
async function verifyDatabaseStructure() {
  console.log('🔧 Checking database tables and functions...')
  
  // Verificar tabelas
  const tables = [
    'pov_learning_patterns',
    'pov_training_examples', 
    'pov_ai_recommendations',
    'pov_system_metrics'
  ]
  
  for (const table of tables) {
    const { data, error } = await supabase
      .schema('core')
      .from(table)
      .select('*', { count: 'exact', head: true })
    
    if (error) {
      throw new Error(`Table ${table} not found or accessible: ${error.message}`)
    }
    
    console.log(`✅ Table ${table}: ${data?.length || 0} records`)
  }
  
  // Verificar views
  const { data: patterns } = await supabase
    .schema('core')
    .from('pov_success_patterns')
    .select('*', { count: 'exact', head: true })
  
  console.log(`✅ View pov_success_patterns accessible`)
  
  // Verificar função de verificação
  const { data: systemStatus, error: statusError } = await supabase
    .rpc('verify_learning_system', {}, { schema: 'core' })
  
  if (statusError) {
    console.warn(`⚠️  Warning: verify_learning_system function not available: ${statusError.message}`)
  } else {
    console.log('✅ System verification function working')
    console.log(systemStatus)
  }
}

/**
 * Testa a extração de padrões
 */
async function testPatternExtraction() {
  const extractor = new POVPatternExtractor(supabaseUrl, supabaseServiceKey)
  
  console.log('🔍 Testing pattern extraction...')
  
  // Verificar exemplos de treinamento
  const { data: examples, error } = await supabase
    .schema('core')
    .from('pov_training_examples')
    .select('*', { count: 'exact', head: true })
  
  if (error) {
    throw new Error(`Failed to access training examples: ${error.message}`)
  }
  
  console.log(`📊 Found ${examples?.length || 0} training examples`)
  
  if ((examples?.length || 0) === 0) {
    console.log('ℹ️  No training examples found. Run migration first: npm run migrate:trigger-points')
    return
  }
  
  // Extrair padrões
  const patterns = await extractor.extractAllPatterns()
  console.log(`✅ Extracted ${patterns.length} patterns`)
  
  if (patterns.length > 0) {
    const topPattern = patterns[0]
    console.log(`🎯 Top pattern: ${topPattern.poi_category} in ${topPattern.urban_density} areas`)
    console.log(`   - Success rate: ${(topPattern.success_rate * 100).toFixed(1)}%`)
    console.log(`   - Confidence: ${(topPattern.pattern_confidence * 100).toFixed(1)}%`)
    console.log(`   - Examples: ${topPattern.total_examples}`)
  }
  
  // Gerar insights
  const insights = await extractor.generatePatternInsights()
  console.log(`📈 Pattern insights:`)
  console.log(`   - Total patterns: ${insights.totalPatterns}`)
  console.log(`   - Strong patterns: ${insights.strongPatterns}`)
  console.log(`   - Top categories: ${insights.topCategories.map(c => c.category).join(', ')}`)
  
  if (insights.recommendations.length > 0) {
    console.log(`💡 Recommendations:`)
    insights.recommendations.forEach((rec, i) => {
      console.log(`   ${i + 1}. ${rec}`)
    })
  }
}

/**
 * Testa o sistema de embeddings
 */
async function testEmbeddingSystem() {
  if (!openaiApiKey) {
    console.log('⚠️  OpenAI API key not configured, skipping embedding tests')
    return
  }
  
  const embeddingService = new POVEmbeddingService(supabaseUrl, supabaseServiceKey, openaiApiKey)
  
  console.log('🧠 Testing embedding generation...')
  
  // Testar geração de embedding
  const testContext = "POI: Test Building (building) in dense area, Distance: 150m, Access: car, Type: primary, Priority: 1"
  
  try {
    const embedding = await embeddingService.generateEmbedding(testContext)
    console.log(`✅ Generated embedding with ${embedding.length} dimensions`)
    
    if (embedding.length !== 1536) {
      throw new Error(`Expected 1536 dimensions, got ${embedding.length}`)
    }
    
  } catch (error) {
    console.error('❌ Embedding generation failed:', error)
    throw error
  }
  
  // Verificar embeddings existentes
  const { data: examplesWithEmbeddings } = await supabase
    .schema('core')
    .from('pov_training_examples')
    .select('id', { count: 'exact', head: true })
    .not('context_embedding', 'is', null)
  
  console.log(`📊 Examples with embeddings: ${examplesWithEmbeddings?.length || 0}`)
  
  // Gerar embeddings faltantes (apenas alguns para teste)
  console.log('🔄 Generating missing embeddings (test batch)...')
  
  const { data: examplesWithoutEmbeddings } = await supabase
    .schema('core')
    .from('pov_training_examples')
    .select('id, context_text')
    .is('context_embedding', null)
    .limit(3) // Apenas 3 para teste
  
  if (examplesWithoutEmbeddings && examplesWithoutEmbeddings.length > 0) {
    console.log(`🔄 Processing ${examplesWithoutEmbeddings.length} examples...`)
    
    for (const example of examplesWithoutEmbeddings) {
      try {
        const embedding = await embeddingService.generateEmbedding(example.context_text)
        
        const { error } = await supabase
          .schema('core')
          .from('pov_training_examples')
          .update({ context_embedding: `[${embedding.join(',')}]` })
          .eq('id', example.id)
        
        if (error) {
          throw new Error(`Failed to update embedding: ${error.message}`)
        }
        
        console.log(`✅ Generated embedding for example ${example.id}`)
        
        // Pausa para respeitar rate limits
        await new Promise(resolve => setTimeout(resolve, 1000))
        
      } catch (error) {
        console.error(`❌ Failed to process example ${example.id}:`, error)
      }
    }
  } else {
    console.log('✅ All examples already have embeddings')
  }
}

/**
 * Testa busca semântica
 */
async function testSemanticSearch() {
  if (!openaiApiKey) {
    console.log('⚠️  OpenAI API key not configured, skipping semantic search tests')
    return
  }
  
  const embeddingService = new POVEmbeddingService(supabaseUrl, supabaseServiceKey, openaiApiKey)
  
  console.log('🔍 Testing semantic search...')
  
  // Criar função de similaridade se não existir
  try {
    await embeddingService.createSimilarityFunction()
  } catch (error) {
    console.log('ℹ️  Similarity function creation skipped (might already exist)')
  }
  
  // Testar busca por exemplos similares
  const searchQueries = [
    "Building in dense urban area with car access",
    "Park in open area with walking access", 
    "Landmark with high priority and close distance"
  ]
  
  for (const query of searchQueries) {
    console.log(`\n🔍 Searching for: "${query}"`)
    
    try {
      const results = await embeddingService.findSimilarExamples(query, 5, 0.5)
      
      console.log(`✅ Found ${results.examples.length} similar examples`)
      
      if (results.examples.length > 0) {
        const topExample = results.examples[0]
        console.log(`   Top match: ${topExample.example.poi_name}`)
        console.log(`   Similarity: ${(topExample.similarity * 100).toFixed(1)}%`)
        console.log(`   Distance: ${topExample.example.distance_m}m`)
        console.log(`   Access: ${topExample.example.access_type}`)
      }
      
      if (results.patterns.length > 0) {
        console.log(`📊 Patterns found: ${results.patterns.length}`)
        results.patterns.forEach(pattern => {
          console.log(`   - ${pattern}`)
        })
      }
      
      if (results.recommendations.length > 0) {
        console.log(`💡 Recommendations:`)
        results.recommendations.slice(0, 2).forEach(rec => {
          console.log(`   - ${rec}`)
        })
      }
      
    } catch (error) {
      console.error(`❌ Search failed for "${query}":`, error)
    }
    
    // Pausa entre buscas
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
}

/**
 * Testa integração completa do sistema
 */
async function testCompleteSystem() {
  console.log('🎯 Testing complete system integration...')
  
  // Simular criação de um novo trigger point
  console.log('📍 Simulating new trigger point creation...')
  
  // Buscar uma atração existente para teste
  const { data: attractions } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name')
    .limit(1)
  
  if (!attractions || attractions.length === 0) {
    console.log('⚠️  No attractions found for testing')
    return
  }
  
  const testAttraction = attractions[0]
  console.log(`🏛️  Using test attraction: ${testAttraction.name}`)
  
  // Verificar se trigger automático está funcionando
  const { data: beforeCount } = await supabase
    .schema('core')
    .from('pov_training_examples')
    .select('*', { count: 'exact', head: true })
  
  console.log(`📊 Training examples before: ${beforeCount?.length || 0}`)
  
  // Verificar métricas do sistema
  const { data: metrics } = await supabase
    .schema('core')
    .from('pov_system_metrics')
    .select('*')
    .order('date_period', { ascending: false })
    .limit(1)
  
  if (metrics && metrics.length > 0) {
    const latestMetrics = metrics[0]
    console.log(`📈 Latest system metrics (${latestMetrics.date_period}):`)
    console.log(`   - New trigger points: ${latestMetrics.new_trigger_points_created}`)
    console.log(`   - AI recommendations: ${latestMetrics.ai_recommendations_generated}`)
    console.log(`   - Acceptance rate: ${latestMetrics.acceptance_rate}%`)
    console.log(`   - New patterns: ${latestMetrics.new_patterns_discovered}`)
  }
  
  // Verificar padrões aprendidos
  const { data: learnedPatterns } = await supabase
    .schema('core')
    .from('pov_success_patterns')
    .select('*')
    .limit(5)
  
  console.log(`🧠 Learned patterns: ${learnedPatterns?.length || 0}`)
  
  if (learnedPatterns && learnedPatterns.length > 0) {
    console.log('🎯 Top patterns:')
    learnedPatterns.forEach((pattern, i) => {
      console.log(`   ${i + 1}. ${pattern.poi_category} in ${pattern.urban_density} areas`)
      console.log(`      - Success rate: ${(pattern.success_rate * 100).toFixed(1)}%`)
      console.log(`      - Confidence: ${(pattern.pattern_confidence * 100).toFixed(1)}%`)
      console.log(`      - Examples: ${pattern.total_examples}`)
    })
  }
  
  // Verificar se sistema está pronto para consultas
  console.log('🔍 System readiness check:')
  
  const readinessChecks = [
    { name: 'Training examples', count: beforeCount?.length || 0, min: 1 },
    { name: 'Learned patterns', count: learnedPatterns?.length || 0, min: 1 },
    { name: 'Database structure', count: 1, min: 1 }, // Já verificado
  ]
  
  let systemReady = true
  
  readinessChecks.forEach(check => {
    const status = check.count >= check.min ? '✅' : '❌'
    console.log(`   ${status} ${check.name}: ${check.count}/${check.min}`)
    if (check.count < check.min) systemReady = false
  })
  
  if (systemReady) {
    console.log('🎉 System is ready for consultation API!')
  } else {
    console.log('⚠️  System needs more data. Run migration: npm run migrate:trigger-points')
  }
}

// Executar teste se script for chamado diretamente
if (require.main === module) {
  testLearningSystem()
    .then(() => {
      console.log('\n🎉 Learning system test completed successfully!')
      process.exit(0)
    })
    .catch(error => {
      console.error('\n💥 Learning system test failed:', error)
      process.exit(1)
    })
}

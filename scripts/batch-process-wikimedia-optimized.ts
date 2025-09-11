import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface POI {
  id: string;
  name: string;
  city: string;
  state: string;
  country: string;
  image_url: string | null;
  image_source: string | null;
}

interface BatchResult {
  poi: POI;
  success: boolean;
  imageUrl?: string;
  imageSource?: string;
  processingTime?: number;
  error?: string;
  oldImageDeleted?: boolean;
}

interface BatchStats {
  totalProcessed: number;
  successful: number;
  failed: number;
  imagesDeleted: number;
  totalProcessingTime: number;
  startTime: Date;
  currentOffset: number;
  totalPOIs: number;
  lastProcessedId?: string;
}

// Configurações otimizadas para Supabase
const PROCESSING_BATCH_SIZE = 25; // Smaller processing batches
const FETCH_LIMIT = 1000; // Supabase fetch limit
const RATE_LIMIT_DELAY = 800; // 800ms between requests
const PROGRESS_FILE = 'batch-progress-optimized.json';

// Function to delete old image from storage
async function deleteOldImage(imageUrl: string): Promise<boolean> {
  try {
    if (!imageUrl || !imageUrl.includes('travel-app-images')) {
      return false; // Not our storage, skip
    }

    // Extract file path from URL
    const urlParts = imageUrl.split('/');
    const fileName = urlParts[urlParts.length - 1];
    
    if (!fileName) return false;

    const { error } = await supabase.storage
      .from('travel-app-images')
      .remove([fileName]);

    if (error) {
      console.log(`   ⚠️  Erro ao deletar imagem antiga: ${error.message}`);
      return false;
    }

    console.log(`   🗑️  Imagem antiga deletada: ${fileName}`);
    return true;

  } catch (error) {
    console.log(`   💥 Erro ao processar deleção: ${error.message}`);
    return false;
  }
}

// Function to process a single POI
async function processPOI(poi: POI): Promise<BatchResult> {
  const startTime = Date.now();
  
  try {
    console.log(`   🔄 ${poi.name} (${poi.city}, ${poi.country})`);
    
    // Call the Wikimedia-only Edge Function
    const response = await fetch(`${supabaseUrl}/functions/v1/unified-image-processing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({
        attractionId: poi.id,
        attractionName: poi.name,
        city: poi.city,
        state: poi.state,
        country: poi.country
      })
    });

    const processingTime = Date.now() - startTime;

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.success && data.imageUrl) {
      // Delete old image if exists
      let oldImageDeleted = false;
      if (poi.image_url) {
        oldImageDeleted = await deleteOldImage(poi.image_url);
      }

      // Update database with new image
      const { error: updateError } = await supabase
        .schema('core')
        .from('attractions')
        .update({
          image_url: data.imageUrl,
          image_source: 'wikimedia'
        })
        .eq('id', poi.id);

      if (updateError) {
        throw new Error(`Erro ao atualizar DB: ${updateError.message}`);
      }

      console.log(`     ✅ Nova imagem salva`);
      
      return {
        poi,
        success: true,
        imageUrl: data.imageUrl,
        imageSource: 'wikimedia',
        processingTime,
        oldImageDeleted
      };
    } else {
      console.log(`     ❌ Sem imagem: ${data.error || 'N/A'}`);
      
      return {
        poi,
        success: false,
        error: data.error,
        processingTime
      };
    }

  } catch (error) {
    console.log(`     💥 Erro: ${error.message}`);
    
    return {
      poi,
      success: false,
      error: error.message,
      processingTime: Date.now() - startTime
    };
  }
}

// Function to save progress
function saveProgress(stats: BatchStats): void {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(stats, null, 2));
}

// Function to load progress
function loadProgress(): BatchStats | null {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      const data = fs.readFileSync(PROGRESS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.log('⚠️  Erro ao carregar progresso anterior');
  }
  return null;
}

// Function to fetch POIs in chunks
async function fetchPOIsChunk(offset: number, limit: number, lastId?: string): Promise<POI[]> {
  let query = supabase
    .schema('core')
    .from('attractions')
    .select('id, name, city, state, country, image_url, image_source')
    .order('id')
    .limit(limit);

  if (lastId) {
    query = query.gt('id', lastId);
  } else {
    query = query.range(offset, offset + limit - 1);
  }

  const { data: pois, error } = await query;

  if (error) {
    throw new Error(`Erro ao buscar POIs: ${error.message}`);
  }

  return pois || [];
}

// Main batch processing function
async function batchProcessWikimediaOptimized(): Promise<void> {
  console.log('🚀 Processamento em Lote Otimizado - Wikimedia Commons');
  console.log('='.repeat(80));

  try {
    // Load previous progress if exists
    let stats = loadProgress();
    const isResuming = process.argv.includes('--resume') && stats;

    if (stats && !isResuming) {
      console.log(`📄 Progresso anterior encontrado (use --resume para continuar)`);
      stats = null;
    } else if (isResuming) {
      console.log(`🔄 Retomando do offset ${stats!.currentOffset}`);
    }

    // Get total count
    const { count: totalCount, error: countError } = await supabase
      .schema('core')
      .from('attractions')
      .select('*', { count: 'exact', head: true });

    if (countError || !totalCount) {
      throw new Error(`Erro ao contar POIs: ${countError?.message}`);
    }

    // Initialize stats if not resuming
    if (!stats) {
      stats = {
        totalProcessed: 0,
        successful: 0,
        failed: 0,
        imagesDeleted: 0,
        totalProcessingTime: 0,
        startTime: new Date(),
        currentOffset: 0,
        totalPOIs: totalCount
      };
    }

    const totalBatches = Math.ceil((totalCount - stats.currentOffset) / PROCESSING_BATCH_SIZE);

    console.log(`\n📊 Configuração:`);
    console.log(`   Total de POIs: ${totalCount.toLocaleString()}`);
    console.log(`   Já processados: ${stats.totalProcessed.toLocaleString()}`);
    console.log(`   Restantes: ${(totalCount - stats.currentOffset).toLocaleString()}`);
    console.log(`   Batch de processamento: ${PROCESSING_BATCH_SIZE}`);
    console.log(`   Fetch limit: ${FETCH_LIMIT}`);
    console.log(`   Rate limit: ${RATE_LIMIT_DELAY}ms`);
    console.log(`   Batches estimados: ${totalBatches}`);

    let currentOffset = stats.currentOffset;
    let batchNumber = 0;

    // Process until we reach the end
    while (currentOffset < totalCount) {
      batchNumber++;
      
      // Fetch a chunk of POIs (respecting 1000 limit)
      const remainingPOIs = totalCount - currentOffset;
      const chunkSize = Math.min(FETCH_LIMIT, remainingPOIs);
      
      console.log(`\n📦 Buscando chunk ${batchNumber} - Offset: ${currentOffset}, Tamanho: ${chunkSize}`);
      
      const poisChunk = await fetchPOIsChunk(currentOffset, chunkSize, stats.lastProcessedId);
      
      if (poisChunk.length === 0) {
        console.log('✅ Nenhum POI restante para processar');
        break;
      }

      // Process this chunk in smaller batches
      for (let i = 0; i < poisChunk.length; i += PROCESSING_BATCH_SIZE) {
        const batch = poisChunk.slice(i, i + PROCESSING_BATCH_SIZE);
        const batchNum = Math.floor((currentOffset + i) / PROCESSING_BATCH_SIZE) + 1;
        const totalEstimatedBatches = Math.ceil(totalCount / PROCESSING_BATCH_SIZE);
        
        console.log(`\n🔄 Processando batch ${batchNum}/${totalEstimatedBatches} (${batch.length} POIs)`);
        console.log('-'.repeat(50));

        const batchResults: BatchResult[] = [];

        // Process each POI in the batch
        for (let j = 0; j < batch.length; j++) {
          const poi = batch[j];
          process.stdout.write(`[${j + 1}/${batch.length}] `);
          
          const result = await processPOI(poi);
          batchResults.push(result);
          
          stats.lastProcessedId = poi.id;

          // Rate limiting
          if (j < batch.length - 1) {
            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
          }
        }

        // Update stats
        stats.totalProcessed += batchResults.length;
        stats.successful += batchResults.filter(r => r.success).length;
        stats.failed += batchResults.filter(r => !r.success).length;
        stats.imagesDeleted += batchResults.filter(r => r.oldImageDeleted).length;
        stats.totalProcessingTime += batchResults.reduce((sum, r) => sum + (r.processingTime || 0), 0);
        stats.currentOffset = currentOffset + i + batch.length;

        // Save progress
        saveProgress(stats);

        // Show batch summary
        const batchSuccess = batchResults.filter(r => r.success).length;
        const progressPercent = (stats.currentOffset / totalCount * 100).toFixed(1);
        
        console.log(`\n📊 Batch ${batchNum}: ✅ ${batchSuccess}/${batch.length} sucessos`);
        console.log(`📈 Progresso: ${stats.totalProcessed}/${totalCount} (${progressPercent}%)`);
        console.log(`   ✅ Total sucessos: ${stats.successful}`);
        console.log(`   ❌ Total falhas: ${stats.failed}`);
        console.log(`   🗑️  Imagens deletadas: ${stats.imagesDeleted}`);

        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      currentOffset += poisChunk.length;
      
      // Delay between chunks
      if (currentOffset < totalCount) {
        console.log(`\n⏸️  Aguardando 5s antes do próximo chunk...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    // Final summary
    console.log('\n' + '='.repeat(80));
    console.log('🎉 PROCESSAMENTO EM LOTE CONCLUÍDO!');
    console.log('='.repeat(80));
    console.log(`📊 Estatísticas finais:`);
    console.log(`   Total processado: ${stats.totalProcessed.toLocaleString()}`);
    console.log(`   ✅ Sucessos: ${stats.successful.toLocaleString()} (${(stats.successful / stats.totalProcessed * 100).toFixed(1)}%)`);
    console.log(`   ❌ Falhas: ${stats.failed.toLocaleString()} (${(stats.failed / stats.totalProcessed * 100).toFixed(1)}%)`);
    console.log(`   🗑️  Imagens antigas deletadas: ${stats.imagesDeleted.toLocaleString()}`);
    console.log(`   ⏱️  Tempo de processamento: ${(stats.totalProcessingTime / 1000 / 60).toFixed(1)} min`);
    console.log(`   🕐 Tempo total: ${((Date.now() - new Date(stats.startTime).getTime()) / 1000 / 60).toFixed(1)} min`);

    // Clean up progress file
    if (fs.existsSync(PROGRESS_FILE)) {
      fs.unlinkSync(PROGRESS_FILE);
      console.log(`🧹 Arquivo de progresso removido`);
    }

  } catch (error) {
    console.error('💥 Erro no processamento em lote:', error.message);
    console.log('💡 Use --resume para continuar de onde parou');
  }
}

// Handle command line arguments
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
🚀 Processamento em Lote Otimizado - Wikimedia Commons

Uso:
  npx tsx scripts/batch-process-wikimedia-optimized.ts [opções]

Opções:
  --resume    Continua processamento anterior
  --help, -h  Mostra esta ajuda

Configurações:
  - Batch de processamento: ${PROCESSING_BATCH_SIZE} POIs por vez
  - Fetch limit: ${FETCH_LIMIT} (limite do Supabase)
  - Rate limit: ${RATE_LIMIT_DELAY}ms entre requisições
  - Auto-save do progresso a cada batch

Exemplos:
  npx tsx scripts/batch-process-wikimedia-optimized.ts
  npx tsx scripts/batch-process-wikimedia-optimized.ts --resume
`);
  process.exit(0);
}

// Run the batch processing
batchProcessWikimediaOptimized().catch(console.error);

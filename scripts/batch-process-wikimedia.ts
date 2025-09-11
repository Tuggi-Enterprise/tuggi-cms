import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

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
  currentBatch: number;
  totalBatches: number;
}

const BATCH_SIZE = 50; // Smaller batches for processing
const FETCH_SIZE = 1000; // Supabase limit for fetching
const RATE_LIMIT_DELAY = 1000; // 1 second between requests
const PROGRESS_FILE = 'batch-progress.json';

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
    console.log(`   🔄 Processando: ${poi.name} (${poi.city}, ${poi.country})`);
    
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

      console.log(`   ✅ Sucesso: Nova imagem salva`);
      
      return {
        poi,
        success: true,
        imageUrl: data.imageUrl,
        imageSource: 'wikimedia',
        processingTime,
        oldImageDeleted
      };
    } else {
      console.log(`   ❌ Nenhuma imagem encontrada: ${data.error}`);
      
      return {
        poi,
        success: false,
        error: data.error,
        processingTime
      };
    }

  } catch (error) {
    console.log(`   💥 Erro: ${error.message}`);
    
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

// Function to process a batch
async function processBatch(pois: POI[], batchNumber: number, totalBatches: number): Promise<BatchResult[]> {
  console.log(`\n📦 Processando batch ${batchNumber}/${totalBatches} (${pois.length} POIs)`);
  console.log('='.repeat(60));

  const results: BatchResult[] = [];

  for (let i = 0; i < pois.length; i++) {
    const poi = pois[i];
    console.log(`\n[${i + 1}/${pois.length}]`);
    
    const result = await processPOI(poi);
    results.push(result);

    // Rate limiting
    if (i < pois.length - 1) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
    }
  }

  return results;
}

// Main batch processing function
async function batchProcessWikimedia(): Promise<void> {
  console.log('🚀 Iniciando processamento em lote - Wikimedia Commons');
  console.log('='.repeat(80));

  try {
    // Load previous progress if exists
    let stats = loadProgress();
    let startBatch = 0;

    if (stats) {
      console.log(`📄 Progresso anterior encontrado:`);
      console.log(`   Processados: ${stats.totalProcessed}`);
      console.log(`   Sucessos: ${stats.successful}`);
      console.log(`   Falhas: ${stats.failed}`);
      console.log(`   Último batch: ${stats.currentBatch}/${stats.totalBatches}`);
      
      const resume = process.argv.includes('--resume');
      if (resume) {
        startBatch = stats.currentBatch;
        console.log(`🔄 Retomando do batch ${startBatch + 1}`);
      } else {
        console.log(`🆕 Iniciando novo processamento (use --resume para continuar)`);
        stats = null;
      }
    }

    // Get total count and calculate batches
    const { count: totalCount, error: countError } = await supabase
      .schema('core')
      .from('attractions')
      .select('*', { count: 'exact', head: true });

    if (countError || !totalCount) {
      throw new Error(`Erro ao contar POIs: ${countError?.message}`);
    }

    const totalBatches = Math.ceil(totalCount / BATCH_SIZE);

    // Initialize stats if not resuming
    if (!stats) {
      stats = {
        totalProcessed: 0,
        successful: 0,
        failed: 0,
        imagesDeleted: 0,
        totalProcessingTime: 0,
        startTime: new Date(),
        currentBatch: 0,
        totalBatches
      };
    }

    console.log(`\n📊 Estatísticas do processamento:`);
    console.log(`   Total de POIs: ${totalCount.toLocaleString()}`);
    console.log(`   Tamanho do batch: ${BATCH_SIZE}`);
    console.log(`   Total de batches: ${totalBatches}`);
    console.log(`   Rate limit: ${RATE_LIMIT_DELAY}ms entre requisições`);

    // Process in chunks of FETCH_SIZE, then in smaller batches
    let globalOffset = startBatch * BATCH_SIZE;
    
    for (let batchNum = startBatch; batchNum < totalBatches; batchNum++) {
      // Calculate how many POIs we need for this batch
      const remainingPOIs = totalCount - globalOffset;
      const poisNeeded = Math.min(BATCH_SIZE, remainingPOIs);
      
      if (poisNeeded <= 0) break;
      
      // Get POIs for this batch (respecting 1000 limit)
      const { data: pois, error: poisError } = await supabase
        .schema('core')
        .from('attractions')
        .select('id, name, city, state, country, image_url, image_source')
        .range(globalOffset, globalOffset + poisNeeded - 1)
        .order('id');

      if (poisError || !pois) {
        console.error(`💥 Erro ao buscar batch ${batchNum + 1}: ${poisError?.message}`);
        globalOffset += poisNeeded;
        continue;
      }

      // Process the batch
      const batchResults = await processBatch(pois, batchNum + 1, totalBatches);
      
      globalOffset += pois.length;

      // Update stats
      stats.currentBatch = batchNum + 1;
      stats.totalProcessed += batchResults.length;
      stats.successful += batchResults.filter(r => r.success).length;
      stats.failed += batchResults.filter(r => !r.success).length;
      stats.imagesDeleted += batchResults.filter(r => r.oldImageDeleted).length;
      stats.totalProcessingTime += batchResults.reduce((sum, r) => sum + (r.processingTime || 0), 0);

      // Save progress
      saveProgress(stats);

      // Show batch summary
      const batchSuccess = batchResults.filter(r => r.success).length;
      const batchFailed = batchResults.filter(r => !r.success).length;
      
      console.log(`\n📊 Resumo do batch ${batchNum + 1}:`);
      console.log(`   ✅ Sucessos: ${batchSuccess}/${batchResults.length}`);
      console.log(`   ❌ Falhas: ${batchFailed}/${batchResults.length}`);
      console.log(`   🗑️  Imagens deletadas: ${batchResults.filter(r => r.oldImageDeleted).length}`);

      // Show overall progress
      const progressPercent = ((batchNum + 1) / totalBatches * 100).toFixed(1);
      console.log(`\n📈 Progresso geral: ${stats.totalProcessed}/${totalCount} (${progressPercent}%)`);
      console.log(`   ✅ Total sucessos: ${stats.successful}`);
      console.log(`   ❌ Total falhas: ${stats.failed}`);
      console.log(`   🗑️  Total imagens deletadas: ${stats.imagesDeleted}`);

      // Small delay between batches
      if (batchNum < totalBatches - 1) {
        console.log(`\n⏸️  Aguardando 5s antes do próximo batch...`);
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
    console.log(`   ⏱️  Tempo total de processamento: ${(stats.totalProcessingTime / 1000 / 60).toFixed(1)} minutos`);
    console.log(`   🕐 Tempo total decorrido: ${((Date.now() - new Date(stats.startTime).getTime()) / 1000 / 60).toFixed(1)} minutos`);

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
🚀 Processamento em Lote - Wikimedia Commons

Uso:
  npx tsx scripts/batch-process-wikimedia.ts [opções]

Opções:
  --resume    Continua processamento anterior
  --help, -h  Mostra esta ajuda

Exemplos:
  npx tsx scripts/batch-process-wikimedia.ts
  npx tsx scripts/batch-process-wikimedia.ts --resume
`);
  process.exit(0);
}

// Run the batch processing
batchProcessWikimedia().catch(console.error);

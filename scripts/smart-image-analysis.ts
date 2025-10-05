#!/usr/bin/env tsx

/**
 * Análise Inteligente de Imagens - Versão Otimizada
 * 
 * Estratégia:
 * 1. Foca apenas em POIs que têm imagens
 * 2. Processa em lotes pequenos (10-20 imagens)
 * 3. Verifica dimensões antes de baixar
 * 4. Mostra progresso em tempo real
 * 5. Permite parar e continuar
 */

import { getSupabase } from '../lib/core/supabase-client';
import sharp from 'sharp';

// Configuração
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = getSupabase('server');

interface POIImage {
  id: string;
  name: string;
  image_url: string;
  storage_path?: string;
}

interface ImageAnalysis {
  poiId: string;
  poiName: string;
  imageUrl: string;
  needsResize: boolean;
  originalSize?: number;
  originalDimensions?: { width: number; height: number };
  estimatedNewSize?: number;
  error?: string;
}

interface BatchStats {
  totalPOIs: number;
  processed: number;
  needsResize: number;
  errors: number;
  totalOriginalSize: number;
  estimatedSpaceSaved: number;
}

const MAX_DIMENSION = 1024;
const BATCH_SIZE = 10;
const BUCKET_NAME = 'travel-app-images';

/**
 * Obtém POIs com imagens em lotes
 */
async function getPOIsWithImages(limit: number = 50): Promise<POIImage[]> {
  console.log(`🔍 Buscando POIs com imagens (limite: ${limit})...`);
  
  const { data, error } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, image_url')
    .not('image_url', 'is', null)
    .limit(limit);

  if (error) {
    throw new Error(`Erro ao buscar POIs: ${error.message}`);
  }

  const pois = data?.map(poi => ({
    id: poi.id,
    name: poi.name,
    image_url: poi.image_url,
    storage_path: extractStoragePath(poi.image_url)
  })) || [];

  console.log(`📊 Encontrados ${pois.length} POIs com imagens`);
  return pois;
}

/**
 * Extrai o caminho de armazenamento da URL
 */
function extractStoragePath(imageUrl: string): string | undefined {
  if (!imageUrl.includes('storage/v1/object/public/')) {
    return undefined;
  }
  
  const parts = imageUrl.split('storage/v1/object/public/');
  if (parts.length > 1) {
    return parts[1];
  }
  
  return undefined;
}

/**
 * Verifica se uma imagem precisa ser redimensionada (sem baixar)
 */
async function checkImageNeedsResize(imageUrl: string): Promise<{
  needsResize: boolean;
  dimensions?: { width: number; height: number };
  size?: number;
  error?: string;
}> {
  try {
    // Fazer HEAD request para obter metadados
    const response = await fetch(imageUrl, { method: 'HEAD' });
    
    if (!response.ok) {
      return { needsResize: false, error: `HTTP ${response.status}` };
    }

    const contentLength = response.headers.get('content-length');
    const size = contentLength ? parseInt(contentLength) : 0;

    // Para imagens do Supabase, tentar obter dimensões via URL de transformação
    if (imageUrl.includes('supabase.co')) {
      // Tentar obter dimensões usando transformação de imagem
      const transformUrl = `${imageUrl}?width=1&height=1&resize=contain`;
      const transformResponse = await fetch(transformUrl, { method: 'HEAD' });
      
      if (transformResponse.ok) {
        // Se conseguimos acessar a transformação, a imagem existe
        // Vamos assumir que precisa verificar (baixar uma versão pequena)
        return { needsResize: true, size };
      }
    }

    return { needsResize: false, size };

  } catch (error) {
    return { 
      needsResize: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}

/**
 * Analisa uma imagem baixando uma versão pequena
 */
async function analyzeImageSmart(imageUrl: string): Promise<{
  needsResize: boolean;
  dimensions?: { width: number; height: number };
  size?: number;
  error?: string;
}> {
  try {
    // Baixar uma versão pequena da imagem para análise
    const smallImageUrl = imageUrl.includes('supabase.co') 
      ? `${imageUrl}?width=200&height=200&resize=contain`
      : imageUrl;

    const response = await fetch(smallImageUrl);
    
    if (!response.ok) {
      return { needsResize: false, error: `HTTP ${response.status}` };
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Obter metadados usando Sharp
    const metadata = await sharp(buffer).metadata();
    
    if (!metadata.width || !metadata.height) {
      return { needsResize: false, error: 'Não foi possível obter dimensões' };
    }

    const needsResize = metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION;
    
    return {
      needsResize,
      dimensions: { width: metadata.width, height: metadata.height },
      size: arrayBuffer.byteLength
    };

  } catch (error) {
    return { 
      needsResize: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}

/**
 * Processa um lote de POIs
 */
async function processBatch(pois: POIImage[]): Promise<ImageAnalysis[]> {
  const analyses: ImageAnalysis[] = [];
  
  console.log(`\n🔄 Processando lote de ${pois.length} POIs...`);
  
  for (let i = 0; i < pois.length; i++) {
    const poi = pois[i];
    console.log(`   [${i + 1}/${pois.length}] ${poi.name}`);
    
    try {
      const analysis = await analyzeImageSmart(poi.image_url);
      
      analyses.push({
        poiId: poi.id,
        poiName: poi.name,
        imageUrl: poi.image_url,
        needsResize: analysis.needsResize,
        originalSize: analysis.size,
        originalDimensions: analysis.dimensions,
        estimatedNewSize: analysis.needsResize ? Math.round((analysis.size || 0) * 0.6) : undefined,
        error: analysis.error
      });
      
      if (analysis.error) {
        console.log(`      ❌ Erro: ${analysis.error}`);
      } else if (analysis.needsResize) {
        console.log(`      ⚠️  Precisa redimensionar: ${analysis.dimensions?.width}x${analysis.dimensions?.height}`);
      } else {
        console.log(`      ✅ OK: ${analysis.dimensions?.width}x${analysis.dimensions?.height}`);
      }
      
    } catch (error) {
      console.log(`      ❌ Erro: ${error instanceof Error ? error.message : String(error)}`);
      analyses.push({
        poiId: poi.id,
        poiName: poi.name,
        imageUrl: poi.image_url,
        needsResize: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  
  return analyses;
}

/**
 * Gera relatório de análise
 */
function generateAnalysisReport(analyses: ImageAnalysis[], stats: BatchStats): void {
  console.log('\n📊 RELATÓRIO DE ANÁLISE INTELIGENTE');
  console.log('===================================');
  
  console.log(`\n📈 Estatísticas:`);
  console.log(`   Total de POIs analisados: ${stats.totalPOIs}`);
  console.log(`   POIs processados: ${stats.processed}`);
  console.log(`   POIs que precisam redimensionar: ${stats.needsResize}`);
  console.log(`   Erros: ${stats.errors}`);
  
  if (stats.needsResize > 0) {
    console.log(`\n💾 Estimativa de Economia:`);
    console.log(`   Tamanho original total: ${formatBytes(stats.totalOriginalSize)}`);
    console.log(`   Espaço estimado a economizar: ${formatBytes(stats.estimatedSpaceSaved)}`);
    console.log(`   Percentual de economia: ${((stats.estimatedSpaceSaved / stats.totalOriginalSize) * 100).toFixed(1)}%`);
  }
  
  // Mostrar POIs que precisam redimensionar
  const needsResize = analyses.filter(a => a.needsResize && !a.error);
  if (needsResize.length > 0) {
    console.log(`\n⚠️  POIs que precisam redimensionar (${needsResize.length}):`);
    needsResize.forEach((analysis, index) => {
      console.log(`   ${index + 1}. ${analysis.poiName}`);
      console.log(`      Dimensões: ${analysis.originalDimensions?.width}x${analysis.originalDimensions?.height}`);
      console.log(`      Tamanho: ${formatBytes(analysis.originalSize || 0)}`);
    });
  }
  
  // Mostrar erros
  const errors = analyses.filter(a => a.error);
  if (errors.length > 0) {
    console.log(`\n❌ POIs com erro (${errors.length}):`);
    errors.forEach((analysis, index) => {
      console.log(`   ${index + 1}. ${analysis.poiName}: ${analysis.error}`);
    });
  }
}

/**
 * Formata bytes em formato legível
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Função principal
 */
async function main(): Promise<void> {
  console.log('🧠 Análise Inteligente de Imagens');
  console.log('=================================');
  console.log(`📏 Tamanho máximo: ${MAX_DIMENSION}x${MAX_DIMENSION}px`);
  console.log(`📦 Tamanho do lote: ${BATCH_SIZE} POIs`);
  console.log(`🪣 Bucket: ${BUCKET_NAME}\n`);

  try {
    // Obter POIs com imagens
    const pois = await getPOIsWithImages(50); // Limitar a 50 para teste
    
    if (pois.length === 0) {
      console.log('❌ Nenhum POI com imagem encontrado');
      return;
    }
    
    // Processar em lotes
    const allAnalyses: ImageAnalysis[] = [];
    const stats: BatchStats = {
      totalPOIs: pois.length,
      processed: 0,
      needsResize: 0,
      errors: 0,
      totalOriginalSize: 0,
      estimatedSpaceSaved: 0
    };
    
    for (let i = 0; i < pois.length; i += BATCH_SIZE) {
      const batch = pois.slice(i, i + BATCH_SIZE);
      const batchAnalyses = await processBatch(batch);
      
      allAnalyses.push(...batchAnalyses);
      stats.processed += batch.length;
      
      // Atualizar estatísticas
      batchAnalyses.forEach(analysis => {
        if (analysis.error) {
          stats.errors++;
        } else if (analysis.needsResize) {
          stats.needsResize++;
          stats.totalOriginalSize += analysis.originalSize || 0;
          stats.estimatedSpaceSaved += (analysis.originalSize || 0) - (analysis.estimatedNewSize || 0);
        }
      });
      
      console.log(`\n📊 Progresso: ${stats.processed}/${stats.totalPOIs} (${((stats.processed / stats.totalPOIs) * 100).toFixed(1)}%)`);
      
      // Pequena pausa entre lotes
      if (i + BATCH_SIZE < pois.length) {
        console.log('⏳ Aguardando 2 segundos antes do próximo lote...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // Gerar relatório final
    generateAnalysisReport(allAnalyses, stats);
    
    console.log('\n✅ Análise concluída!');
    
    if (stats.needsResize > 0) {
      console.log(`\n🚀 Próximo passo: Redimensionar ${stats.needsResize} imagens`);
      console.log('   Execute: npx tsx scripts/smart-image-resize.ts');
    }
    
  } catch (error) {
    console.error('❌ Erro durante a análise:', error);
    process.exit(1);
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  main().catch(console.error);
}

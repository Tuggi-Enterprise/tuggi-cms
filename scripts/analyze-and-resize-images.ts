#!/usr/bin/env tsx

/**
 * Script para analisar e redimensionar imagens no bucket Supabase
 * 
 * Funcionalidades:
 * - Analisa todas as imagens no bucket
 * - Identifica imagens que excedem 1024x1024
 * - Redimensiona imagens grandes mantendo aspect ratio
 * - Gera relatório de otimização
 * - Cria backup das imagens originais
 */

import { getSupabase } from '../lib/core/supabase-client';
import sharp from 'sharp';

// Configuração do Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = getSupabase('server');

interface ImageAnalysis {
  path: string;
  size: number;
  width?: number;
  height?: number;
  format?: string;
  needsResize: boolean;
  originalSize: number;
  estimatedNewSize?: number;
  error?: string;
}

interface ResizeStats {
  totalImages: number;
  imagesAnalyzed: number;
  imagesNeedingResize: number;
  imagesResized: number;
  totalOriginalSize: number;
  totalNewSize: number;
  spaceSaved: number;
  errors: number;
}

const MAX_DIMENSION = 1024;
const QUALITY = 85;
const BUCKET_NAME = 'travel-app-images';

/**
 * Analisa uma imagem e determina se precisa ser redimensionada
 */
async function analyzeImage(imagePath: string): Promise<ImageAnalysis> {
  try {
    // Baixar a imagem do bucket
    const { data: imageData, error: downloadError } = await supabase.storage
      .from(BUCKET_NAME)
      .download(imagePath);

    if (downloadError) {
      return {
        path: imagePath,
        size: 0,
        needsResize: false,
        originalSize: 0,
        error: `Download error: ${downloadError.message}`
      };
    }

    const arrayBuffer = await imageData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const originalSize = buffer.length;

    // Analisar metadados da imagem
    const metadata = await sharp(buffer).metadata();
    const { width = 0, height = 0, format } = metadata;

    const needsResize = width > MAX_DIMENSION || height > MAX_DIMENSION;

    // Estimar novo tamanho se precisar redimensionar
    let estimatedNewSize = originalSize;
    if (needsResize) {
      const scaleFactor = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
      estimatedNewSize = Math.round(originalSize * scaleFactor * scaleFactor * 0.8); // Fator de compressão
    }

    return {
      path: imagePath,
      size: originalSize,
      width,
      height,
      format,
      needsResize,
      originalSize,
      estimatedNewSize
    };

  } catch (error) {
    return {
      path: imagePath,
      size: 0,
      needsResize: false,
      originalSize: 0,
      error: `Analysis error: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Redimensiona uma imagem mantendo aspect ratio
 */
async function resizeImage(imagePath: string, analysis: ImageAnalysis): Promise<{ success: boolean; newSize?: number; error?: string }> {
  try {
    // Baixar a imagem original
    const { data: imageData, error: downloadError } = await supabase.storage
      .from(BUCKET_NAME)
      .download(imagePath);

    if (downloadError) {
      return { success: false, error: `Download error: ${downloadError.message}` };
    }

    const arrayBuffer = await imageData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Redimensionar usando Sharp
    const resizedBuffer = await sharp(buffer)
      .resize(MAX_DIMENSION, MAX_DIMENSION, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: QUALITY })
      .toBuffer();

    // Fazer backup da imagem original
    const backupPath = `${imagePath}.backup`;
    await supabase.storage
      .from(BUCKET_NAME)
      .upload(backupPath, buffer, {
        contentType: 'image/jpeg',
        upsert: true
      });

    // Upload da imagem redimensionada
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(imagePath, resizedBuffer, {
        contentType: 'image/jpeg',
        upsert: true
      });

    if (uploadError) {
      return { success: false, error: `Upload error: ${uploadError.message}` };
    }

    return { success: true, newSize: resizedBuffer.length };

  } catch (error) {
    return { 
      success: false, 
      error: `Resize error: ${error instanceof Error ? error.message : String(error)}` 
    };
  }
}

/**
 * Lista todas as imagens no bucket
 */
async function listAllImages(): Promise<string[]> {
  const images: string[] = [];
  let pageToken: string | null = null;

  do {
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .list('', {
        limit: 1000,
        offset: pageToken ? parseInt(pageToken) : 0
      });

    if (error) {
      console.error('❌ Error listing images:', error);
      throw error;
    }

    if (data) {
      // Filtrar apenas arquivos de imagem
      const imageFiles = data
        .filter(file => 
          file.name.match(/\.(jpg|jpeg|png|webp)$/i) && 
          !file.name.includes('.backup')
        )
        .map(file => file.name);
      
      images.push(...imageFiles);
    }

    pageToken = data && data.length === 1000 ? String(images.length) : null;
  } while (pageToken);

  return images;
}

/**
 * Analisa todas as imagens no bucket
 */
async function analyzeAllImages(): Promise<ImageAnalysis[]> {
  console.log('🔍 Listando todas as imagens no bucket...');
  const imagePaths = await listAllImages();
  console.log(`📊 Encontradas ${imagePaths.length} imagens`);

  const analyses: ImageAnalysis[] = [];
  
  for (let i = 0; i < imagePaths.length; i++) {
    const path = imagePaths[i];
    console.log(`🔍 Analisando ${i + 1}/${imagePaths.length}: ${path}`);
    
    const analysis = await analyzeImage(path);
    analyses.push(analysis);
    
    if (analysis.error) {
      console.log(`   ❌ Erro: ${analysis.error}`);
    } else if (analysis.needsResize) {
      console.log(`   ⚠️  Precisa redimensionar: ${analysis.width}x${analysis.height} (${formatBytes(analysis.originalSize)})`);
    } else {
      console.log(`   ✅ OK: ${analysis.width}x${analysis.height} (${formatBytes(analysis.originalSize)})`);
    }
  }

  return analyses;
}

/**
 * Redimensiona imagens que precisam
 */
async function resizeNeededImages(analyses: ImageAnalysis[]): Promise<ResizeStats> {
  const stats: ResizeStats = {
    totalImages: analyses.length,
    imagesAnalyzed: analyses.length,
    imagesNeedingResize: 0,
    imagesResized: 0,
    totalOriginalSize: 0,
    totalNewSize: 0,
    spaceSaved: 0,
    errors: 0
  };

  const imagesToResize = analyses.filter(a => a.needsResize && !a.error);
  stats.imagesNeedingResize = imagesToResize.length;

  console.log(`\n🔄 Redimensionando ${imagesToResize.length} imagens...`);

  for (let i = 0; i < imagesToResize.length; i++) {
    const analysis = imagesToResize[i];
    console.log(`🔄 Redimensionando ${i + 1}/${imagesToResize.length}: ${analysis.path}`);
    
    const result = await resizeImage(analysis.path, analysis);
    
    if (result.success && result.newSize) {
      stats.imagesResized++;
      stats.totalOriginalSize += analysis.originalSize;
      stats.totalNewSize += result.newSize;
      stats.spaceSaved += (analysis.originalSize - result.newSize);
      
      console.log(`   ✅ Redimensionado: ${formatBytes(analysis.originalSize)} → ${formatBytes(result.newSize)}`);
    } else {
      stats.errors++;
      console.log(`   ❌ Erro: ${result.error}`);
    }
  }

  return stats;
}

/**
 * Gera relatório de otimização
 */
function generateReport(analyses: ImageAnalysis[], stats: ResizeStats): void {
  console.log('\n📊 RELATÓRIO DE OTIMIZAÇÃO DE IMAGENS');
  console.log('=====================================');
  
  console.log(`\n📈 Estatísticas Gerais:`);
  console.log(`   Total de imagens: ${stats.totalImages}`);
  console.log(`   Imagens analisadas: ${stats.imagesAnalyzed}`);
  console.log(`   Imagens que precisavam redimensionar: ${stats.imagesNeedingResize}`);
  console.log(`   Imagens redimensionadas com sucesso: ${stats.imagesResized}`);
  console.log(`   Erros: ${stats.errors}`);

  console.log(`\n💾 Economia de Espaço:`);
  console.log(`   Tamanho original total: ${formatBytes(stats.totalOriginalSize)}`);
  console.log(`   Tamanho novo total: ${formatBytes(stats.totalNewSize)}`);
  console.log(`   Espaço economizado: ${formatBytes(stats.spaceSaved)}`);
  console.log(`   Percentual de economia: ${((stats.spaceSaved / stats.totalOriginalSize) * 100).toFixed(1)}%`);

  // Análise por formato
  const formatStats = analyses.reduce((acc, analysis) => {
    if (!analysis.error && analysis.format) {
      acc[analysis.format] = (acc[analysis.format] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  console.log(`\n📋 Distribuição por Formato:`);
  Object.entries(formatStats).forEach(([format, count]) => {
    console.log(`   ${format}: ${count} imagens`);
  });

  // Imagens com problemas
  const problematicImages = analyses.filter(a => a.error);
  if (problematicImages.length > 0) {
    console.log(`\n⚠️  Imagens com Problemas (${problematicImages.length}):`);
    problematicImages.forEach(img => {
      console.log(`   ${img.path}: ${img.error}`);
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
  console.log('🖼️  Análise e Redimensionamento de Imagens');
  console.log('==========================================');
  console.log(`📏 Tamanho máximo: ${MAX_DIMENSION}x${MAX_DIMENSION}px`);
  console.log(`🎨 Qualidade: ${QUALITY}%`);
  console.log(`🪣 Bucket: ${BUCKET_NAME}\n`);

  try {
    // Analisar todas as imagens
    const analyses = await analyzeAllImages();
    
    // Redimensionar imagens que precisam
    const stats = await resizeNeededImages(analyses);
    
    // Gerar relatório
    generateReport(analyses, stats);
    
    console.log('\n✅ Processo concluído com sucesso!');
    
  } catch (error) {
    console.error('❌ Erro durante o processo:', error);
    process.exit(1);
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  main().catch(console.error);
}

export { analyzeImage, resizeImage, listAllImages };

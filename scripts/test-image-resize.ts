#!/usr/bin/env tsx

/**
 * Script para testar a funcionalidade de redimensionamento de imagens
 * 
 * Este script testa:
 * - Download de imagens do Google Places
 * - Redimensionamento para 1024x1024
 * - Criação de thumbnails
 * - Comparação de tamanhos
 */

import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

// Configuração
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const googleApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface TestResult {
  attractionId: string;
  attractionName: string;
  photoReference: string;
  originalSize: number;
  resizedSize: number;
  thumbnailSize: number;
  originalDimensions: { width: number; height: number };
  resizedDimensions: { width: number; height: number };
  thumbnailDimensions: { width: number; height: number };
  spaceSaved: number;
  success: boolean;
  error?: string;
}

/**
 * Baixa uma imagem do Google Places
 */
async function downloadGoogleImage(photoReference: string, maxWidth: string = '1600'): Promise<ArrayBuffer> {
  const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photoreference=${photoReference}&key=${googleApiKey}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'image/jpeg, image/png, image/webp, image/*'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.statusText}`);
  }

  return await response.arrayBuffer();
}

/**
 * Redimensiona uma imagem usando Sharp
 */
async function resizeImageWithSharp(
  imageData: ArrayBuffer,
  maxWidth: number = 1024,
  maxHeight: number = 1024,
  quality: number = 85
): Promise<{ data: Buffer; dimensions: { width: number; height: number } }> {
  const buffer = Buffer.from(imageData);
  
  // Obter metadados originais
  const metadata = await sharp(buffer).metadata();
  
  // Redimensionar mantendo aspect ratio
  const resizedBuffer = await sharp(buffer)
    .resize(maxWidth, maxHeight, {
      fit: 'inside',
      withoutEnlargement: true
    })
    .jpeg({ quality })
    .toBuffer();
  
  // Obter dimensões finais
  const resizedMetadata = await sharp(resizedBuffer).metadata();
  
  return {
    data: resizedBuffer,
    dimensions: {
      width: resizedMetadata.width!,
      height: resizedMetadata.height!
    }
  };
}

/**
 * Cria thumbnail usando Sharp
 */
async function createThumbnailWithSharp(
  imageData: ArrayBuffer,
  size: number = 300,
  quality: number = 80
): Promise<{ data: Buffer; dimensions: { width: number; height: number } }> {
  const buffer = Buffer.from(imageData);
  
  const thumbnailBuffer = await sharp(buffer)
    .resize(size, size, {
      fit: 'cover',
      position: 'center'
    })
    .jpeg({ quality })
    .toBuffer();
  
  const metadata = await sharp(thumbnailBuffer).metadata();
  
  return {
    data: thumbnailBuffer,
    dimensions: {
      width: metadata.width!,
      height: metadata.height!
    }
  };
}

/**
 * Obtém metadados de uma imagem
 */
async function getImageMetadata(imageData: ArrayBuffer): Promise<{ width: number; height: number; format: string }> {
  const buffer = Buffer.from(imageData);
  const metadata = await sharp(buffer).metadata();
  
  return {
    width: metadata.width!,
    height: metadata.height!,
    format: metadata.format!
  };
}

/**
 * Testa redimensionamento em uma imagem específica
 */
async function testImageResize(attractionId: string, attractionName: string, photoReference: string): Promise<TestResult> {
  try {
    console.log(`🔍 Testing image resize for: ${attractionName}`);
    
    // Baixar imagem original
    console.log(`   📥 Downloading original image...`);
    const originalData = await downloadGoogleImage(photoReference, '1600');
    const originalMetadata = await getImageMetadata(originalData);
    
    console.log(`   📏 Original: ${originalMetadata.width}x${originalMetadata.height}, ${formatBytes(originalData.byteLength)}`);
    
    // Redimensionar imagem
    console.log(`   🔄 Resizing to max 1024x1024...`);
    const { data: resizedData, dimensions: resizedDimensions } = await resizeImageWithSharp(originalData);
    
    console.log(`   📏 Resized: ${resizedDimensions.width}x${resizedDimensions.height}, ${formatBytes(resizedData.length)}`);
    
    // Criar thumbnail
    console.log(`   🖼️ Creating thumbnail 300x300...`);
    const { data: thumbnailData, dimensions: thumbnailDimensions } = await createThumbnailWithSharp(originalData, 300);
    
    console.log(`   📏 Thumbnail: ${thumbnailDimensions.width}x${thumbnailDimensions.height}, ${formatBytes(thumbnailData.length)}`);
    
    const spaceSaved = originalData.byteLength - resizedData.length;
    const spaceSavedPercent = ((spaceSaved / originalData.byteLength) * 100).toFixed(1);
    
    console.log(`   💾 Space saved: ${formatBytes(spaceSaved)} (${spaceSavedPercent}%)`);
    
    return {
      attractionId,
      attractionName,
      photoReference,
      originalSize: originalData.byteLength,
      resizedSize: resizedData.length,
      thumbnailSize: thumbnailData.length,
      originalDimensions: { width: originalMetadata.width, height: originalMetadata.height },
      resizedDimensions: resizedDimensions,
      thumbnailDimensions: thumbnailDimensions,
      spaceSaved,
      success: true
    };
    
  } catch (error) {
    console.error(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    
    return {
      attractionId,
      attractionName,
      photoReference,
      originalSize: 0,
      resizedSize: 0,
      thumbnailSize: 0,
      originalDimensions: { width: 0, height: 0 },
      resizedDimensions: { width: 0, height: 0 },
      thumbnailDimensions: { width: 0, height: 0 },
      spaceSaved: 0,
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Obtém POIs com fotos do Google Places para teste
 */
async function getTestPOIs(): Promise<Array<{ id: string; name: string; photo_reference: string }>> {
  const { data, error } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, photos_references')
    .not('photos_references', 'is', null)
    .limit(5);

  if (error) {
    throw new Error(`Failed to fetch POIs: ${error.message}`);
  }

  return data?.map(poi => ({
    id: poi.id,
    name: poi.name,
    photo_reference: poi.photos_references[0]
  })) || [];
}

/**
 * Gera relatório de teste
 */
function generateTestReport(results: TestResult[]): void {
  console.log('\n📊 RELATÓRIO DE TESTE DE REDIMENSIONAMENTO');
  console.log('==========================================');
  
  const successfulTests = results.filter(r => r.success);
  const failedTests = results.filter(r => !r.success);
  
  console.log(`\n📈 Estatísticas:`);
  console.log(`   Testes realizados: ${results.length}`);
  console.log(`   Testes bem-sucedidos: ${successfulTests.length}`);
  console.log(`   Testes com erro: ${failedTests.length}`);
  
  if (successfulTests.length > 0) {
    const totalOriginalSize = successfulTests.reduce((sum, r) => sum + r.originalSize, 0);
    const totalResizedSize = successfulTests.reduce((sum, r) => sum + r.resizedSize, 0);
    const totalThumbnailSize = successfulTests.reduce((sum, r) => sum + r.thumbnailSize, 0);
    const totalSpaceSaved = successfulTests.reduce((sum, r) => sum + r.spaceSaved, 0);
    
    console.log(`\n💾 Economia de Espaço:`);
    console.log(`   Tamanho original total: ${formatBytes(totalOriginalSize)}`);
    console.log(`   Tamanho redimensionado total: ${formatBytes(totalResizedSize)}`);
    console.log(`   Tamanho thumbnails total: ${formatBytes(totalThumbnailSize)}`);
    console.log(`   Espaço economizado: ${formatBytes(totalSpaceSaved)}`);
    console.log(`   Percentual de economia: ${((totalSpaceSaved / totalOriginalSize) * 100).toFixed(1)}%`);
    
    console.log(`\n📋 Detalhes por Imagem:`);
    successfulTests.forEach((result, index) => {
      console.log(`\n   ${index + 1}. ${result.attractionName}`);
      console.log(`      Original: ${result.originalDimensions.width}x${result.originalDimensions.height} (${formatBytes(result.originalSize)})`);
      console.log(`      Redimensionado: ${result.resizedDimensions.width}x${result.resizedDimensions.height} (${formatBytes(result.resizedSize)})`);
      console.log(`      Thumbnail: ${result.thumbnailDimensions.width}x${result.thumbnailDimensions.height} (${formatBytes(result.thumbnailSize)})`);
      console.log(`      Economia: ${formatBytes(result.spaceSaved)} (${((result.spaceSaved / result.originalSize) * 100).toFixed(1)}%)`);
    });
  }
  
  if (failedTests.length > 0) {
    console.log(`\n❌ Testes com Erro:`);
    failedTests.forEach((result, index) => {
      console.log(`   ${index + 1}. ${result.attractionName}: ${result.error}`);
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
  console.log('🧪 Teste de Redimensionamento de Imagens');
  console.log('=======================================');
  console.log(`📏 Tamanho máximo: 1024x1024px`);
  console.log(`🎨 Qualidade: 85%`);
  console.log(`🖼️ Thumbnail: 300x300px\n`);

  try {
    // Obter POIs para teste
    console.log('🔍 Buscando POIs com fotos do Google Places...');
    const testPOIs = await getTestPOIs();
    
    if (testPOIs.length === 0) {
      console.log('❌ Nenhum POI com fotos encontrado para teste');
      return;
    }
    
    console.log(`📊 Encontrados ${testPOIs.length} POIs para teste\n`);
    
    // Testar redimensionamento em cada POI
    const results: TestResult[] = [];
    
    for (let i = 0; i < testPOIs.length; i++) {
      const poi = testPOIs[i];
      console.log(`\n[${i + 1}/${testPOIs.length}] Testando: ${poi.name}`);
      
      const result = await testImageResize(poi.id, poi.name, poi.photo_reference);
      results.push(result);
    }
    
    // Gerar relatório
    generateTestReport(results);
    
    console.log('\n✅ Teste concluído!');
    
  } catch (error) {
    console.error('❌ Erro durante o teste:', error);
    process.exit(1);
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  main().catch(console.error);
}

/**
 * Utilitário para redimensionamento de imagens
 * Compatível com Deno Edge Functions
 */

interface ResizeOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: 'jpeg' | 'png' | 'webp';
  maintainAspectRatio?: boolean;
}

interface ResizeResult {
  success: boolean;
  data?: Uint8Array;
  originalSize?: number;
  newSize?: number;
  width?: number;
  height?: number;
  error?: string;
}

/**
 * Redimensiona uma imagem usando a API nativa do Deno
 * Esta função é otimizada para Edge Functions do Supabase
 */
export async function resizeImage(
  imageData: ArrayBuffer,
  options: ResizeOptions = {}
): Promise<ResizeResult> {
  const {
    maxWidth = 1024,
    maxHeight = 1024,
    quality = 85,
    format = 'jpeg',
    maintainAspectRatio = true
  } = options;

  try {
    // Converter ArrayBuffer para Uint8Array
    const uint8Array = new Uint8Array(imageData);
    const originalSize = uint8Array.length;

    // Para Edge Functions, vamos usar uma abordagem mais simples
    // que não requer bibliotecas externas como Sharp
    const resizedData = await resizeImageNative(uint8Array, {
      maxWidth,
      maxHeight,
      quality,
      format,
      maintainAspectRatio
    });

    return {
      success: true,
      data: resizedData,
      originalSize,
      newSize: resizedData.length
    };

  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Implementação nativa de redimensionamento para Edge Functions
 * Usa Canvas API quando disponível, senão retorna a imagem original
 */
async function resizeImageNative(
  imageData: Uint8Array,
  options: ResizeOptions
): Promise<Uint8Array> {
  const { maxWidth, maxHeight, quality, format, maintainAspectRatio } = options;

  try {
    // Tentar usar Canvas API se disponível (Deno com --allow-canvas)
    if (typeof OffscreenCanvas !== 'undefined') {
      return await resizeWithCanvas(imageData, options);
    }

    // Fallback: retornar imagem original se Canvas não estiver disponível
    console.warn('Canvas API não disponível, retornando imagem original');
    return imageData;

  } catch (error) {
    console.warn('Erro no redimensionamento, retornando imagem original:', error);
    return imageData;
  }
}

/**
 * Redimensiona usando Canvas API
 */
async function resizeWithCanvas(
  imageData: Uint8Array,
  options: ResizeOptions
): Promise<Uint8Array> {
  const { maxWidth, maxHeight, quality, format, maintainAspectRatio } = options;

  // Criar blob a partir dos dados da imagem
  const blob = new Blob([imageData]);
  const imageUrl = URL.createObjectURL(blob);

  try {
    // Carregar imagem
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = imageUrl;
    });

    // Calcular novas dimensões
    let { width, height } = calculateNewDimensions(
      img.width,
      img.height,
      maxWidth!,
      maxHeight!,
      maintainAspectRatio!
    );

    // Criar canvas
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d')!;

    // Desenhar imagem redimensionada
    ctx.drawImage(img, 0, 0, width, height);

    // Converter para blob
    const mimeType = `image/${format}`;
    const blob = await canvas.convertToBlob({
      type: mimeType,
      quality: quality! / 100
    });

    // Converter blob para Uint8Array
    const arrayBuffer = await blob.arrayBuffer();
    return new Uint8Array(arrayBuffer);

  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

/**
 * Calcula novas dimensões mantendo aspect ratio
 */
function calculateNewDimensions(
  originalWidth: number,
  originalHeight: number,
  maxWidth: number,
  maxHeight: number,
  maintainAspectRatio: boolean
): { width: number; height: number } {
  if (!maintainAspectRatio) {
    return {
      width: Math.min(originalWidth, maxWidth),
      height: Math.min(originalHeight, maxHeight)
    };
  }

  // Calcular escala para manter aspect ratio
  const scaleX = maxWidth / originalWidth;
  const scaleY = maxHeight / originalHeight;
  const scale = Math.min(scaleX, scaleY, 1); // Não aumentar imagens menores

  return {
    width: Math.round(originalWidth * scale),
    height: Math.round(originalHeight * scale)
  };
}

/**
 * Cria thumbnail de uma imagem
 */
export async function createThumbnail(
  imageData: ArrayBuffer,
  size: number = 300
): Promise<ResizeResult> {
  return resizeImage(imageData, {
    maxWidth: size,
    maxHeight: size,
    quality: 80,
    format: 'jpeg'
  });
}

/**
 * Verifica se uma imagem precisa ser redimensionada
 */
export function needsResize(
  width: number,
  height: number,
  maxWidth: number = 1024,
  maxHeight: number = 1024
): boolean {
  return width > maxWidth || height > maxHeight;
}

/**
 * Obtém metadados básicos de uma imagem
 */
export async function getImageMetadata(imageData: ArrayBuffer): Promise<{
  width?: number;
  height?: number;
  format?: string;
  size: number;
}> {
  const size = imageData.byteLength;
  
  try {
    // Tentar extrair metadados básicos do header da imagem
    const uint8Array = new Uint8Array(imageData);
    
    // Verificar formato JPEG
    if (uint8Array[0] === 0xFF && uint8Array[1] === 0xD8) {
      const dimensions = getJPEGDimensions(uint8Array);
      return {
        width: dimensions.width,
        height: dimensions.height,
        format: 'jpeg',
        size
      };
    }
    
    // Verificar formato PNG
    if (uint8Array[0] === 0x89 && uint8Array[1] === 0x50 && 
        uint8Array[2] === 0x4E && uint8Array[3] === 0x47) {
      const dimensions = getPNGDimensions(uint8Array);
      return {
        width: dimensions.width,
        height: dimensions.height,
        format: 'png',
        size
      };
    }
    
    // Verificar formato WebP
    if (uint8Array[8] === 0x57 && uint8Array[9] === 0x45 && 
        uint8Array[10] === 0x42 && uint8Array[11] === 0x50) {
      const dimensions = getWebPDimensions(uint8Array);
      return {
        width: dimensions.width,
        height: dimensions.height,
        format: 'webp',
        size
      };
    }
    
    return { size };
    
  } catch (error) {
    console.warn('Erro ao extrair metadados da imagem:', error);
    return { size };
  }
}

/**
 * Extrai dimensões de imagem JPEG
 */
function getJPEGDimensions(data: Uint8Array): { width: number; height: number } {
  let i = 2;
  while (i < data.length) {
    if (data[i] === 0xFF && (data[i + 1] === 0xC0 || data[i + 1] === 0xC2)) {
      const height = (data[i + 5] << 8) | data[i + 6];
      const width = (data[i + 7] << 8) | data[i + 8];
      return { width, height };
    }
    i++;
  }
  return { width: 0, height: 0 };
}

/**
 * Extrai dimensões de imagem PNG
 */
function getPNGDimensions(data: Uint8Array): { width: number; height: number } {
  const width = (data[16] << 24) | (data[17] << 16) | (data[18] << 8) | data[19];
  const height = (data[20] << 24) | (data[21] << 16) | (data[22] << 8) | data[23];
  return { width, height };
}

/**
 * Extrai dimensões de imagem WebP
 */
function getWebPDimensions(data: Uint8Array): { width: number; height: number } {
  if (data[12] === 0x56 && data[13] === 0x50 && data[14] === 0x38) {
    // VP8 format
    const width = ((data[26] | (data[27] << 8)) & 0x3FFF) + 1;
    const height = ((data[28] | (data[29] << 8)) & 0x3FFF) + 1;
    return { width, height };
  }
  return { width: 0, height: 0 };
}

/**
 * Utilitário para formatar bytes
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

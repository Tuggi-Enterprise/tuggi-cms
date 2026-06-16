import { GeographicContext, POIData } from '../types/interfaces';
import { SRTMLocalService } from '../../srtm-local-service';
import { LRUCacheWithTTL } from '../utils/lru-cache';

/**
 * Serviço centralizado para análise de elevação
 * Fonte única de verdade para cálculos de elevação base regional
 */
export class ElevationAnalysisService {
  // ✅ LRU cache: max 1000 entries, TTL 24h. Antes era Map<> ilimitado e sem TTL.
  // Em batch 10k POIs (cidade grande), poderia crescer indefinidamente.
  private static elevationCache = new LRUCacheWithTTL<string, number>(1000, 24 * 60 * 60 * 1000);

  /**
   * Limpa o cache de elevação (útil para testes ou entre diferentes POIs)
   */
  static clearCache(): void {
    this.elevationCache.clear();
    console.log(`🗑️ [ElevationService] Cache cleared`);
  }
  
  /**
   * Estima a elevação base regional para comparação usando APIs dinâmicas
   * FONTE ÚNICA DE VERDADE - usada por todos os analyzers
   */
  static async estimateRegionalBaseElevation(
    location: { lat: number; lng: number }, 
    context: GeographicContext,
    poiData?: POIData
  ): Promise<number> {
    // 🚀 VERIFICAR CACHE PRIMEIRO
    const cacheKey = poiData?.city && poiData?.country 
      ? `${poiData.city}-${poiData.country}` 
      : `${location.lat.toFixed(4)}-${location.lng.toFixed(4)}`;
    
    if (this.elevationCache.has(cacheKey)) {
      const cachedValue = this.elevationCache.get(cacheKey)!;
      console.log(`🚀 [ElevationService] Using cached elevation: ${cachedValue}m (key: ${cacheKey})`);
      return cachedValue;
    }
    
    console.log(`🏞️ [ElevationService] Estimating regional base elevation for (${location.lat.toFixed(4)}, ${location.lng.toFixed(4)})`);
    
    // 🌍 Amostragem de elevação regional (rápida e 100% offline via SRTM)
    try {
      const regionalElevation = await this.sampleRegionalElevation(location, context);
      if (regionalElevation !== null) {
        console.log(`🗺️ [ElevationService] Regional elevation from sampling: ${regionalElevation}m`);
        // 🚀 SALVAR NO CACHE
        this.elevationCache.set(cacheKey, regionalElevation);
        return regionalElevation;
      }
    } catch (error) {
      console.warn(`⚠️ [ElevationService] Failed to sample regional elevation:`, error);
    }
    
    // 📊 ESTRATÉGIA 3: Estimativa baseada em contexto (último recurso)
    let baseElevation = 500; // Default global average
    
    if (context.elevationContext && context.elevationContext.variance) {
      if (context.elevationContext.variance < 50) {
        baseElevation = 400;
        console.log(`📊 [ElevationService] Low elevation variance (${context.elevationContext.variance.toFixed(1)}m) → flat area base: ${baseElevation}m`);
      } else if (context.elevationContext.variance > 200) {
        baseElevation = 600;
        console.log(`📊 [ElevationService] High elevation variance (${context.elevationContext.variance.toFixed(1)}m) → mountainous area base: ${baseElevation}m`);
      }
    }
    
    // 🌊 VERIFICAR SE É CIDADE COSTEIRA PRIMEIRO (coordenadas próximas ao oceano)
    const isCoastalCity = await this.isCoastalLocation(location);
    if (isCoastalCity) {
      baseElevation = 20; // Cidades costeiras ficam ao nível do mar
      console.log(`🏖️ [ElevationService] Coastal city detected → base: ${baseElevation}m`);
    } else {
      switch (context.urbanDensity.level) {
        case 'very_dense':
        case 'dense':
          baseElevation = 400; // Cidades grandes tendem a ter elevação moderada
          console.log(`🏙️ [ElevationService] Dense urban area → base: ${baseElevation}m`);
          break;
        case 'rural':
          baseElevation += 100;
          console.log(`🌾 [ElevationService] Rural area adjustment → base: ${baseElevation}m`);
          break;
      }
    }
    
    console.log(`✅ [ElevationService] Fallback estimated base elevation: ${baseElevation}m`);
    // 🚀 SALVAR NO CACHE
    this.elevationCache.set(cacheKey, baseElevation);
    return baseElevation;
  }



  /**
   * Amostra elevação regional fazendo múltiplas consultas ao redor do POI
   */
  private static async sampleRegionalElevation(location: { lat: number; lng: number }, context: GeographicContext): Promise<number | null> {
    try {
      // Definir raio de amostragem baseado na densidade urbana
      const samplingRadius = context.urbanDensity.level === 'very_dense' || context.urbanDensity.level === 'dense' 
        ? 0.02 // ~2km para áreas urbanas
        : 0.05; // ~5km para áreas rurais
      
      // 4 pontos cardeais ao redor do POI
      const samplePoints = [
        { lat: location.lat + samplingRadius, lng: location.lng }, // Norte
        { lat: location.lat - samplingRadius, lng: location.lng }, // Sul  
        { lat: location.lat, lng: location.lng + samplingRadius }, // Leste
        { lat: location.lat, lng: location.lng - samplingRadius }  // Oeste
      ];
      
      console.log(`🎯 [ElevationService] Sampling regional elevation at ${(samplingRadius * 111).toFixed(1)}km radius (${samplePoints.length} points)`);
      
      const srtm = SRTMLocalService.getInstance();
      const validElevations: number[] = [];
      
      // Amostragem local SRTM é tão rápida que podemos fazer em série ou Promise.all.
      // Catch per-sample rejections so one bad tile (e.g. > 60°N) doesn't crash the worker.
      const results = await Promise.all(
        samplePoints.map(p =>
          srtm.getElevation(p.lat, p.lng).catch(err => {
            console.error(`[ElevationService] sample failed at ${p.lat},${p.lng}:`, err);
            return null;
          })
        )
      );
      
      for (const ele of results) {
        if (ele !== null && !isNaN(ele)) {
          validElevations.push(ele);
        }
      }
      
      if (validElevations.length === 0) {
        console.log(`❌ [ElevationService] No valid SRTM elevation samples found`);
        return null;
      }
      
      // Calcular mediana (mais robusta que média)
      const sortedElevations = validElevations.sort((a: number, b: number) => a - b);
      const medianElevation = sortedElevations[Math.floor(sortedElevations.length / 2)];
      
      console.log(`📊 [ElevationService] Regional elevation samples: [${validElevations.map((e: number) => e.toFixed(0)).join(', ')}]m`);
      console.log(`🎯 [ElevationService] Regional median elevation: ${medianElevation}m`);
      
      return medianElevation;
    } catch (error) {
      console.error('[ElevationService] Error sampling regional elevation:', error);
      return null;
    }
  }



  /**
   * Detecta se uma localização é costeira usando amostragem de elevação dinâmica
   */
  private static async isCoastalLocation(location: { lat: number; lng: number }): Promise<boolean> {
    try {
      // 🌊 ESTRATÉGIA DINÂMICA: Amostrar elevação em 4 direções cardeais próximas
      const samplingRadius = 0.01; // ~1km
      const samplePoints = [
        { lat: location.lat + samplingRadius, lng: location.lng }, // Norte
        { lat: location.lat - samplingRadius, lng: location.lng }, // Sul  
        { lat: location.lat, lng: location.lng + samplingRadius }, // Leste
        { lat: location.lat, lng: location.lng - samplingRadius }  // Oeste
      ];
      
      const srtm = SRTMLocalService.getInstance();
      const validElevations: number[] = [];
      
      const results = await Promise.all(
        samplePoints.map(p => srtm.getElevation(p.lat, p.lng))
      );
      
      for (const ele of results) {
        if (ele !== null && !isNaN(ele)) {
          validElevations.push(ele);
        }
      }
      
      if (validElevations.length >= 2) {
        const avgElevation = validElevations.reduce((a: number, b: number) => a + b, 0) / validElevations.length;
        const isCoastal = avgElevation < 100; // Se a média da região é < 100m, provavelmente é costeira
        
        console.log(`🌊 [ElevationService] Coastal detection: avg elevation ${avgElevation.toFixed(0)}m → coastal: ${isCoastal}`);
        return isCoastal;
      }
      
      return false;
    } catch (error) {
      console.warn(`⚠️ [ElevationService] Coastal detection failed:`, error);
      return false;
    }
  }



  /**
   * Calcula diferença de elevação e determina se é alta elevação
   */
  static async analyzeElevationDifference(
    poiElevation: number,
    location: { lat: number; lng: number },
    context: GeographicContext,
    poiData?: POIData
  ): Promise<{ baseElevation: number; elevationDiff: number; isHighVisibility: boolean }> {
    const baseElevation = await this.estimateRegionalBaseElevation(location, context, poiData);
    const elevationDiff = poiElevation - baseElevation;
    const isHighVisibility = elevationDiff > 200;
    
    console.log(`📏 [ElevationService] Elevation analysis:`);
    console.log(`  📍 POI elevation: ${poiElevation.toFixed(1)}m`);
    console.log(`  🏞️ Base elevation: ${baseElevation.toFixed(1)}m`);
    console.log(`  📈 Difference: ${elevationDiff.toFixed(1)}m`);
    console.log(`  🎯 High visibility: ${isHighVisibility}`);
    
    return { baseElevation, elevationDiff, isHighVisibility };
  }
}

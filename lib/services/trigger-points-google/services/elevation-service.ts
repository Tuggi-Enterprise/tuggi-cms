import { GeographicContext, POIData } from '../types/interfaces';

/**
 * Serviço centralizado para análise de elevação
 * Fonte única de verdade para cálculos de elevação base regional
 */
export class ElevationAnalysisService {
  // 🚀 CACHE SIMPLES para evitar múltiplas chamadas de API para o mesmo POI
  private static elevationCache = new Map<string, number>();
  
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
    
    // 🌍 ESTRATÉGIA 1: Buscar elevação da cidade via GeoNames + Open Elevation
    if (poiData?.city && poiData?.country) {
      try {
        const cityElevation = await this.getCityElevation(poiData.city, poiData.country, cacheKey);
        if (cityElevation !== null) {
          console.log(`🏙️ [ElevationService] City elevation from APIs: ${cityElevation}m (${poiData.city}, ${poiData.country})`);
          // 🚀 SALVAR NO CACHE
          this.elevationCache.set(cacheKey, cityElevation);
          return cityElevation;
        }
      } catch (error) {
        console.warn(`⚠️ [ElevationService] Failed to get city elevation via APIs:`, error);
      }
    }
    
    // 🎯 ESTRATÉGIA 2: Amostragem de elevação regional (fallback)
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
   * Obtém elevação da cidade usando GeoNames + Open Elevation
   */
  private static async getCityElevation(city: string, country: string, cacheKey: string): Promise<number | null> {
    try {
      // 1️⃣ Buscar coordenadas da cidade via GeoNames
      const geonamesUsername = process.env.GEONAMES_USERNAME;
      if (!geonamesUsername) {
        console.warn('⚠️ [ElevationService] GEONAMES_USERNAME not found in environment');
        return null;
      }

      const cityQuery = encodeURIComponent(city);
      const countryCode = this.getCountryCode(country);
      const geonamesUrl = `http://api.geonames.org/searchJSON?q=${cityQuery}&country=${countryCode}&maxRows=1&username=${geonamesUsername}`;
      
      console.log(`🌍 [ElevationService] Fetching city coordinates: ${city}, ${country}`);
      const geonamesResponse = await fetch(geonamesUrl);
      const geonamesData = await geonamesResponse.json();
      
      if (!geonamesData.geonames || geonamesData.geonames.length === 0) {
        console.log(`❌ [ElevationService] City not found in GeoNames: ${city}, ${country}`);
        return null;
      }
      
      const cityData = geonamesData.geonames[0];
      const cityLat = parseFloat(cityData.lat);
      const cityLng = parseFloat(cityData.lng);
      
      console.log(`📍 [ElevationService] City coordinates: ${cityLat.toFixed(4)}, ${cityLng.toFixed(4)}`);
      
      // 2️⃣ Buscar elevação das coordenadas da cidade via Open Elevation
      const elevationUrl = `https://api.open-elevation.com/api/v1/lookup?locations=${cityLat},${cityLng}`;
      const elevationResponse = await fetch(elevationUrl);
      const elevationData = await elevationResponse.json();
      
      if (elevationData.results && elevationData.results.length > 0) {
        const cityElevation = elevationData.results[0].elevation;
        console.log(`🏙️ [ElevationService] City elevation: ${cityElevation}m`);
        // 🚀 SALVAR NO CACHE
        this.elevationCache.set(cacheKey, cityElevation);
        return cityElevation;
      }
      
      // 🆘 FALLBACK INTELIGENTE: Se Open Elevation falhar, usar conhecimento geográfico básico
      const fallbackElevation = this.getFallbackCityElevation(city, country, cityLat, cityLng);
      if (fallbackElevation !== null) {
        console.log(`🆘 [ElevationService] Using fallback city elevation: ${fallbackElevation}m (${city}, ${country})`);
        // 🚀 SALVAR NO CACHE
        this.elevationCache.set(cacheKey, fallbackElevation);
        return fallbackElevation;
      }
      
      return null;
    } catch (error) {
      console.error('[ElevationService] Error getting city elevation:', error);
      return null;
    }
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
      
      const response = await fetch('https://api.open-elevation.com/api/v1/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locations: samplePoints.map(p => ({ latitude: p.lat, longitude: p.lng }))
        })
      });

      if (!response.ok) {
        throw new Error(`Open Elevation API failed: ${response.status}`);
      }

      const data = await response.json();
      const validElevations = (data.results || []).map((r: any) => r.elevation).filter((e: any) => e !== null && !isNaN(e));
      
      if (validElevations.length === 0) {
        console.log(`❌ [ElevationService] No valid elevation samples found`);
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
   * Fallback inteligente para elevação de cidades quando APIs falham
   * Baseado em geografia física, não dados hardcoded
   */
  private static getFallbackCityElevation(city: string, country: string, lat: number, lng: number): number | null {
    // 🌊 LÓGICA GEOGRÁFICA: Proximidade com oceanos
    const distanceToAtlantic = Math.abs(lng + 40); // Aproximação do Atlântico Sul
    const distanceToPacific = Math.abs(lng + 80);   // Aproximação do Pacífico
    
    const nearOcean = Math.min(distanceToAtlantic, distanceToPacific) < 20; // Dentro de ~20 graus do oceano
    
    if (nearOcean) {
      // Cidades próximas ao oceano tendem a ser baixas
      console.log(`🌊 [ElevationService] City near ocean (dist: ${Math.min(distanceToAtlantic, distanceToPacific).toFixed(1)}°) → low elevation`);
      return 20; // Elevação baixa para cidades costeiras
    }
    
    // 🏔️ LÓGICA GEOGRÁFICA: Latitude e continentalidade
    const isEquatorial = Math.abs(lat) < 10;
    const isTemperate = Math.abs(lat) > 20 && Math.abs(lat) < 40;
    const isContinental = Math.min(distanceToAtlantic, distanceToPacific) > 30;
    
    if (isEquatorial) {
      return isContinental ? 300 : 50; // Equatorial: continental alto, costeiro baixo
    } else if (isTemperate) {
      return isContinental ? 600 : 100; // Temperado: continental mais alto
    }
    
    // Fallback geral baseado em continentalidade
    return isContinental ? 400 : 80;
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
      
      const response = await fetch('https://api.open-elevation.com/api/v1/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locations: samplePoints.map(p => ({ latitude: p.lat, longitude: p.lng }))
        })
      });

      if (!response.ok) {
        throw new Error(`Open Elevation API failed: ${response.status}`);
      }

      const data = await response.json();
      const validElevations = (data.results || []).map((r: any) => r.elevation).filter((e: any) => e !== null && !isNaN(e));
      
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
   * Converte nome do país para código ISO
   */
  private static getCountryCode(country: string): string {
    const countryMap: { [key: string]: string } = {
      'Brazil': 'BR',
      'Brasil': 'BR',
      'United States': 'US',
      'USA': 'US',
      'Canada': 'CA',
      'Mexico': 'MX',
      'Argentina': 'AR',
      'Chile': 'CL',
      'Colombia': 'CO',
      'Peru': 'PE'
    };
    
    return countryMap[country] || country.substring(0, 2).toUpperCase();
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

// Serviço de elevação com múltiplas fontes
// Estratégia: OSM tags → Google Elevation API → Estimativa

import { GoogleAPIsService } from './google-apis.service';
import { BoundaryData, GeographicContext, POIData } from '../types/interfaces';
import { TRIGGER_POINTS_CONSTANTS } from '../config/trigger-points-config';
import { ElevationAnalysisService } from './elevation-service';

export interface ElevationData {
  ground: number; // elevação do solo (metros acima do nível do mar)
  structure?: number; // altura da estrutura (metros) 
  total: number; // elevação total (ground + structure)
  // NOVO: Elevação relativa à vizinhança
  relative: {
    aboveNeighborhood: number; // metros acima da vizinhança média
    neighborhoodAverage: number; // elevação média da vizinhança
    prominence: number; // proeminência topográfica (0-1)
    isElevated: boolean; // se está significativamente elevado
  };
  confidence: number; // 0.0 - 1.0
  source: 'osm_tags' | 'google_elevation' | 'estimated';
  details: {
    groundSource: string;
    structureSource?: string;
    samplePoints?: number;
    neighborhoodSamples?: number;
    method: string;
  };
}

export class ElevationService {
  private googleAPIs: GoogleAPIsService;

  constructor() {
    this.googleAPIs = new GoogleAPIsService();
  }

  /**
   * Obter elevação de um POI usando múltiplas estratégias
   * INTELIGENTE: Considera elevação relativa à vizinhança
   */
  async getElevation(
    location: { lat: number; lng: number },
    boundary?: BoundaryData,
    osmElement?: any,
    context?: GeographicContext,
    poiData?: POIData
  ): Promise<ElevationData> {
    console.log(`🏔️ Getting elevation for: ${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}`);

    try {
      // 0. Obter a elevação base regional (média da cidade) - FONTE ÚNICA DE VERDADE
      const regionalBase = await ElevationAnalysisService.estimateRegionalBaseElevation(
        location, 
        context || { urbanDensity: { level: 'medium', score: 0.5 } } as any, 
        poiData
      );
      
      let groundElevation = 0;
      let structureHeight = 0;
      let groundSource = 'estimated';
      let structureSource = undefined;
      let confidence = 0.0;

      // Estratégia 1: OSM Tags (se disponível) - Muito bom para altura da estrutura
      if (osmElement) {
        const osmElevation = await this.getElevationFromOSM(osmElement, location);
        groundElevation = osmElevation.ground;
        structureHeight = osmElevation.structure || 0;
        groundSource = osmElevation.details.groundSource;
        structureSource = osmElevation.details.structureSource;
        confidence = osmElevation.confidence;
      }

      // Estratégia 2: Open Elevation API (gratuita) para o Ground
      // Sempre tentamos o Open Elevation pois ele é o que o usuário quer como primário
      try {
        const openElevationResult = await this.getElevationFromOpenElevationAPI(location);
        if (openElevationResult.confidence > 0.5) {
          groundElevation = openElevationResult.ground;
          groundSource = 'open_elevation';
          confidence = Math.max(confidence, 0.8);
        }
      } catch (error) {
        console.warn('⚠️ Open Elevation API failed, using OSM or fallback ground');
      }

      // Se groundElevation ainda for 0, usar regionalBase como ground
      if (groundElevation === 0) {
        groundElevation = regionalBase;
        groundSource = 'regional_base';
      }

      const totalElevation = groundElevation + structureHeight;
      const elevationDiff = totalElevation - regionalBase;
      const isElevated = elevationDiff > 50; // Threshold do usuário

      console.log(`📊 Current Elevation State: Ground=${groundElevation}m, Structure=${structureHeight}m, Total=${totalElevation}m, Base=${regionalBase}m, Diff=${elevationDiff}m`);

      // ✅ REGRA DE OURO DO USUÁRIO: Se temos dados do Open Elevation + OSM e a diferença é clara, SAIR CEDO
      if (confidence >= 0.7 || (groundSource === 'open_elevation' && isElevated)) {
        console.log(`✅ Sufficient data from Open Elevation + OSM. Diff from base: ${elevationDiff}m. Skipping Google API.`);
        
        return {
          ground: groundElevation,
          structure: structureHeight > 0 ? structureHeight : undefined,
          total: totalElevation,
          relative: {
            aboveNeighborhood: elevationDiff,
            neighborhoodAverage: regionalBase,
            prominence: Math.min(1.0, Math.max(0.1, elevationDiff / 200)), // Estimativa de proeminência
            isElevated: isElevated
          },
          confidence: confidence,
          source: 'osm_tags', // Simplificado para indicar que não usou Google
          details: {
            groundSource,
            structureSource,
            method: 'open_elevation_osm_combination'
          }
        };
      }

      // Estratégia 3: Google Elevation API com análise de vizinhança (fallback FINAL se os dados acima forem fracos)
      console.log(`🧠 Local data weak or elevation unclear, calling Google Elevation API as last resort...`);
      const googleElevation = await this.getIntelligentElevationFromGoogle(location, boundary, context);
      
      // Atualizar com ground do Google mas manter structure do OSM se for melhor
      const finalGround = googleElevation.ground;
      const finalTotal = finalGround + structureHeight;
      const finalDiff = finalTotal - regionalBase;
      
      return {
        ...googleElevation,
        ground: finalGround,
        structure: structureHeight > 0 ? structureHeight : undefined,
        total: finalTotal,
        relative: {
          ...googleElevation.relative,
          aboveNeighborhood: finalDiff,
          neighborhoodAverage: regionalBase,
          isElevated: finalDiff > 50 || googleElevation.relative.isElevated
        }
      };

    } catch (error) {
      console.error('Error in integrated elevation logic:', error);
      return this.getDefaultElevation(location);
    }
  }

  /**
   * Estratégia 2: Open Elevation API (gratuita, SRTM data, igual ao sistema legado)
   */
  private async getElevationFromOpenElevationAPI(
    location: { lat: number; lng: number }
  ): Promise<ElevationData> {
    console.log(`🌍 Using Open Elevation API (free, like legacy system)...`);
    
    try {
      const response = await fetch('https://api.open-elevation.com/api/v1/lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'TuggiCMS/1.0 (trigger-points-elevation)'
        },
        body: JSON.stringify({
          locations: [{ latitude: location.lat, longitude: location.lng }]
        })
      });

      if (!response.ok) {
        throw new Error(`Open Elevation API failed: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.results || data.results.length === 0) {
        throw new Error('No elevation data from Open Elevation API');
      }

      const elevation = data.results[0].elevation;
      console.log(`✅ Open Elevation API: ${elevation}m (SRTM data)`);

      return {
        ground: elevation,
        total: elevation,
        relative: {
          aboveNeighborhood: 0, // Will be calculated if needed
          neighborhoodAverage: elevation,
          prominence: 0.5,
          isElevated: elevation > 500
        },
        confidence: 0.9, // High confidence for Open Elevation
        source: 'open_elevation' as any,
        details: {
          groundSource: 'open_elevation_api',
          method: 'srtm_data'
        }
      };

    } catch (error) {
      console.error('Open Elevation API error:', error);
      throw error;
    }
  }

  /**
   * Estratégia 1: Extrair elevação de tags OSM
   */
  private async getElevationFromOSM(
    osmElement: any,
    location: { lat: number; lng: number }
  ): Promise<ElevationData> {
    console.log(`🗺️ Extracting elevation from OSM tags...`);

    const tags = osmElement.tags || {};
    let groundElevation: number | null = null;
    let structureHeight: number | null = null;
    let groundSource = 'none';
    let structureSource: string | undefined;

    // Buscar elevação do solo
    if (tags.ele) {
      groundElevation = this.parseElevationValue(tags.ele);
      groundSource = 'ele_tag';
    } else if (tags.elevation) {
      groundElevation = this.parseElevationValue(tags.elevation);
      groundSource = 'elevation_tag';
    } else if (tags['height:ground']) {
      groundElevation = this.parseElevationValue(tags['height:ground']);
      groundSource = 'height_ground_tag';
    }

    // Buscar altura da estrutura
    if (tags.height) {
      structureHeight = this.parseElevationValue(tags.height);
      structureSource = 'height_tag';
    } else if (tags['building:height']) {
      structureHeight = this.parseElevationValue(tags['building:height']);
      structureSource = 'building_height_tag';
    } else if (tags['building:levels']) {
      const levels = parseInt(tags['building:levels']);
      if (!isNaN(levels) && levels > 0) {
        structureHeight = levels * 3.5; // ~3.5m por andar
        structureSource = 'building_levels_tag';
      }
    }

    // Se temos dados OSM válidos
    if (groundElevation !== null || structureHeight !== null) {
      const ground = groundElevation || 0;
      const structure = structureHeight || 0;
      const total = ground + structure;

      // Calcular confiança baseada na qualidade dos dados
      let confidence = 0.5;
      if (groundElevation !== null) confidence += 0.3;
      if (structureHeight !== null) confidence += 0.2;

      console.log(`📊 OSM elevation: ground=${ground}m (${groundSource}), structure=${structure}m (${structureSource || 'none'})`);

      return {
        ground,
        structure: structure > 0 ? structure : undefined,
        total,
        relative: {
          aboveNeighborhood: 0, // OSM tags não têm análise de vizinhança
          neighborhoodAverage: ground,
          prominence: 0.5, // Assumir média
          isElevated: structure ? structure > 50 : false // Baseado na altura da estrutura
        },
        confidence: Math.min(1.0, confidence),
        source: 'osm_tags',
        details: {
          groundSource,
          structureSource,
          method: 'osm_tag_extraction'
        }
      };
    }

    // Se não temos dados OSM, usar Google como fallback
    console.log(`⚠️ No elevation data in OSM tags, falling back to Google API`);
    return this.getElevationFromGoogle(location);
  }

  /**
   * Estratégia 2: Google Elevation API com análise inteligente de vizinhança
   */
  private async getIntelligentElevationFromGoogle(
    location: { lat: number; lng: number },
    boundary?: BoundaryData,
    context?: GeographicContext
  ): Promise<ElevationData> {
    console.log(`🧠 Getting intelligent elevation from Google API...`);

    try {
      // 1. Obter elevação do POI
      const poiResponse = await this.googleAPIs.getElevation([location]);
      if (!poiResponse.success || !poiResponse.data?.results?.[0]) {
        throw new Error('Failed to get POI elevation');
      }

      const poiElevation = poiResponse.data.results[0].elevation;
      console.log(`📍 POI elevation: ${poiElevation.toFixed(1)}m`);

      // 2. Análise da vizinhança para elevação relativa
      const neighborhoodAnalysis = await this.analyzeNeighborhoodElevation(location, context);
      
      // 3. Calcular elevação relativa
      const aboveNeighborhood = poiElevation - neighborhoodAnalysis.average;
      const prominence = this.calculateTopographicProminence(
        poiElevation, 
        neighborhoodAnalysis.elevations
      );
      
      // 4. Determinar se está significativamente elevado
      const isElevated = aboveNeighborhood > 30 && prominence > 0.3; // >30m e >30% de proeminência

      console.log(`📊 Neighborhood analysis: POI=${poiElevation.toFixed(1)}m, Avg=${neighborhoodAnalysis.average.toFixed(1)}m, Relative=${aboveNeighborhood > 0 ? '+' : ''}${aboveNeighborhood.toFixed(1)}m`);
      console.log(`⛰️ Topographic prominence: ${(prominence * 100).toFixed(1)}%, Elevated: ${isElevated}`);

      return {
        ground: poiElevation,
        structure: undefined,
        total: poiElevation,
        relative: {
          aboveNeighborhood,
          neighborhoodAverage: neighborhoodAnalysis.average,
          prominence,
          isElevated
        },
        confidence: 0.8,
        source: 'google_elevation',
        details: {
          groundSource: 'google_elevation_api',
          samplePoints: 1,
          neighborhoodSamples: neighborhoodAnalysis.sampleCount,
          method: 'intelligent_neighborhood_analysis'
        }
      };

    } catch (error) {
      console.error('Intelligent Google Elevation API error:', error);
      throw error;
    }
  }

  /**
   * Estratégia 2 (Legacy): Google Elevation API simples
   */
  private async getElevationFromGoogle(
    location: { lat: number; lng: number },
    boundary?: BoundaryData
  ): Promise<ElevationData> {
    console.log(`🌐 Getting elevation from Google Elevation API...`);

    try {
      let locations = [location];

      // Se temos boundary, pegar alguns pontos adicionais para melhor precisão
      if (boundary && boundary.coordinates.length > 4) {
        const samplePoints = this.selectElevationSamplePoints(boundary.coordinates, location, 4);
        locations = [location, ...samplePoints];
      }

      const response = await this.googleAPIs.getElevation(locations);

      if (!response.success || !response.data?.results || response.data.results.length === 0) {
        throw new Error('Google Elevation API failed');
      }

      const elevations = response.data.results.map((r: any) => r.elevation);
      const primaryElevation = elevations[0]; // Elevação do ponto central
      const avgElevation = elevations.reduce((sum: number, e: number) => sum + e, 0) / elevations.length;

      console.log(`📊 Google elevation: primary=${primaryElevation.toFixed(1)}m, avg=${avgElevation.toFixed(1)}m (${elevations.length} points)`);

      return {
        ground: primaryElevation,
        structure: undefined, // Google só dá elevação do terreno
        total: primaryElevation,
        relative: {
          aboveNeighborhood: 0, // Método legado não faz análise de vizinhança
          neighborhoodAverage: avgElevation,
          prominence: 0.5, // Assumir média
          isElevated: false // Sem análise de proeminência
        },
        confidence: 0.8, // Google é confiável para elevação do terreno
        source: 'google_elevation',
        details: {
          groundSource: 'google_elevation_api',
          samplePoints: elevations.length,
          method: 'google_api_query'
        }
      };

    } catch (error) {
      console.error('Google Elevation API error:', error);
      throw error;
    }
  }

  /**
   * Estratégia 3: Estimativa baseada em contexto geográfico
   */
  private estimateElevation(
    location: { lat: number; lng: number },
    context?: GeographicContext
  ): ElevationData {
    console.log(`📊 Estimating elevation based on geographic context...`);

    // Estimativas básicas por região (Brasil)
    let estimatedGround = 700; // Default para região de São Paulo

    // Ajustar baseado na latitude (aproximação grosseira)
    if (location.lat > -15) { // Norte do Brasil
      estimatedGround = 200;
    } else if (location.lat < -25) { // Sul do Brasil
      estimatedGround = 500;
    }

    // Ajustar baseado na densidade urbana
    if (context) {
      switch (context.urbanDensity.level) {
        case 'very_dense':
        case 'dense':
          estimatedGround += 50; // Cidades grandes tendem a ser mais altas
          break;
        case 'rural':
          estimatedGround -= 100; // Áreas rurais tendem a ser mais baixas
          break;
      }
    }

    console.log(`📊 Estimated elevation: ${estimatedGround}m (low confidence)`);

    return {
      ground: estimatedGround,
      structure: undefined,
      total: estimatedGround,
      relative: {
        aboveNeighborhood: 0, // Estimativa não tem análise de vizinhança
        neighborhoodAverage: estimatedGround,
        prominence: 0.3, // Baixa proeminência
        isElevated: false // Sem dados suficientes
      },
      confidence: 0.2, // Baixa confiança
      source: 'estimated',
      details: {
        groundSource: 'geographic_estimation',
        method: 'context_based_estimation'
      }
    };
  }

  /**
   * Fallback padrão quando tudo falha
   */
  private getDefaultElevation(location: { lat: number; lng: number }): ElevationData {
    console.log(`❌ All elevation methods failed, using default`);

    return {
      ground: 0,
      structure: undefined,
      total: 0,
      relative: {
        aboveNeighborhood: 0,
        neighborhoodAverage: 0,
        prominence: 0,
        isElevated: false
      },
      confidence: 0.0, // Zero confidence
      source: 'estimated',
      details: {
        groundSource: 'default_fallback',
        method: 'error_fallback'
      }
    };
  }

  // === HELPER METHODS ===

  private parseElevationValue(value: string): number | null {
    if (!value) return null;

    // Remover unidades e espaços
    const cleanValue = value.replace(/[^\d.-]/g, '');
    const parsed = parseFloat(cleanValue);

    return !isNaN(parsed) ? parsed : null;
  }

  private selectElevationSamplePoints(
    boundaryCoords: Array<{ lat: number; lng: number }>,
    center: { lat: number; lng: number },
    maxPoints: number
  ): Array<{ lat: number; lng: number }> {
    if (boundaryCoords.length <= maxPoints) {
      return boundaryCoords;
    }

    const step = Math.floor(boundaryCoords.length / maxPoints);
    return boundaryCoords.filter((_, index) => index % step === 0).slice(0, maxPoints);
  }

  /**
   * Analisa elevação da vizinhança para cálculo de elevação relativa
   */
  private async analyzeNeighborhoodElevation(
    center: { lat: number; lng: number },
    context?: GeographicContext
  ): Promise<{
    elevations: number[];
    average: number;
    min: number;
    max: number;
    sampleCount: number;
  }> {
    console.log(`🏘️ Analyzing neighborhood elevation around ${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}`);

    // Determinar raio de análise baseado no contexto urbano
    let analysisRadius = 1000; // 1km padrão
    if (context) {
      switch (context.urbanDensity.level) {
        case 'very_dense':
        case 'dense':
          analysisRadius = 500; // Vizinhança menor em áreas densas
          break;
        case 'low':
        case 'rural':
          analysisRadius = 2000; // Vizinhança maior em áreas rurais
          break;
      }
    }

    // Criar pontos de amostragem em círculo ao redor do POI
    const samplePoints = this.createNeighborhoodSamplePoints(center, analysisRadius, 12);
    
    console.log(`📍 Sampling ${samplePoints.length} points in ${analysisRadius}m radius`);

    try {
      const response = await this.googleAPIs.getElevation(samplePoints);
      
      if (!response.success || !response.data?.results) {
        throw new Error('Failed to get neighborhood elevation');
      }

      const elevations = response.data.results.map((r: any) => r.elevation);
      const average = elevations.reduce((sum: number, e: number) => sum + e, 0) / elevations.length;
      const min = Math.min(...elevations);
      const max = Math.max(...elevations);

      console.log(`📊 Neighborhood elevation: avg=${average.toFixed(1)}m, range=${min.toFixed(1)}-${max.toFixed(1)}m`);

      return {
        elevations,
        average,
        min,
        max,
        sampleCount: elevations.length
      };

    } catch (error) {
      console.error('Neighborhood elevation analysis failed:', error);
      // Fallback: usar estimativa baseada em contexto
      const estimatedElevation = this.estimateRegionalElevation(center, context);
      return {
        elevations: [estimatedElevation],
        average: estimatedElevation,
        min: estimatedElevation,
        max: estimatedElevation,
        sampleCount: 1
      };
    }
  }

  /**
   * Criar pontos de amostragem ao redor do POI para análise de vizinhança
   */
  private createNeighborhoodSamplePoints(
    center: { lat: number; lng: number },
    radius: number,
    numPoints: number
  ): Array<{ lat: number; lng: number }> {
    const points: Array<{ lat: number; lng: number }> = [];
    
    // Converter raio para graus (aproximação)
    const radiusInDegrees = radius / TRIGGER_POINTS_CONSTANTS.geographic.metersPerDegree;
    
    for (let i = 0; i < numPoints; i++) {
      const angle = (i * 360 / numPoints) * (Math.PI / 180); // Converter para radianos
      
      const lat = center.lat + (radiusInDegrees * Math.cos(angle));
      const lng = center.lng + (radiusInDegrees * Math.sin(angle) / Math.cos(center.lat * Math.PI / 180));
      
      points.push({ lat, lng });
    }
    
    return points;
  }

  /**
   * Calcular proeminência topográfica (quão elevado está em relação à vizinhança)
   */
  private calculateTopographicProminence(
    poiElevation: number,
    neighborhoodElevations: number[]
  ): number {
    if (neighborhoodElevations.length === 0) return 0;

    const maxNeighborhood = Math.max(...neighborhoodElevations);
    const minNeighborhood = Math.min(...neighborhoodElevations);
    const elevationRange = maxNeighborhood - minNeighborhood;
    
    // Se não há variação significativa na vizinhança, proeminência é baixa
    if (elevationRange < 10) return 0.1;
    
    // Calcular onde o POI se posiciona na faixa de elevação da vizinhança
    const relativePosition = (poiElevation - minNeighborhood) / elevationRange;
    
    // Proeminência é alta se o POI está muito acima da vizinhança
    return Math.max(0, Math.min(1, relativePosition));
  }

  /**
   * Estimar elevação regional baseada em localização e contexto
   */
  private estimateRegionalElevation(
    location: { lat: number; lng: number },
    context?: GeographicContext
  ): number {
    // Estimativas básicas por região brasileira
    let estimatedElevation = 500; // Default

    // Região Sudeste (aproximação)
    if (location.lat > -25 && location.lat < -19 && location.lng > -50 && location.lng < -39) {
      if (location.lat > -24 && location.lng > -47) {
        estimatedElevation = 750; // São Paulo (planalto)
      } else if (location.lat > -23 && location.lng > -44) {
        estimatedElevation = 300; // Rio de Janeiro (baixada + morros)
      } else {
        estimatedElevation = 600; // Interior sudeste
      }
    }
    // Região Sul
    else if (location.lat < -25) {
      estimatedElevation = 400; // Região Sul (mais baixa)
    }
    // Região Norte/Nordeste
    else if (location.lat > -15) {
      estimatedElevation = 200; // Norte/Nordeste (mais baixo)
    }

    console.log(`🗺️ Regional elevation estimate: ${estimatedElevation}m for lat=${location.lat.toFixed(2)}, lng=${location.lng.toFixed(2)}`);
    
    return estimatedElevation;
  }
}

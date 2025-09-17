// Core Trigger Point Predictor - Orquestrador principal do sistema

import { GeographicContextAnalyzer } from './geographic-analyzer';
import { BoundaryDetector } from './boundary-detector';
import { StreetAnalyzer } from '../analyzers/street-analyzer';
import { OptimalPointCalculator } from '../analyzers/point-calculator';
import { TriggerPointValidator } from '../analyzers/validator';
import { GoogleAPIsService } from '../services/google-apis.service';
import { POIData, TriggerPoint, TriggerPointGenerationOptions, TriggerPointPredictionResult, BoundaryData, GeographicContext } from '../types/interfaces';

export class CoreTriggerPointPredictor {
  private geographicAnalyzer: GeographicContextAnalyzer;
  private boundaryDetector: BoundaryDetector;
  private streetAnalyzer: StreetAnalyzer;
  private pointCalculator: OptimalPointCalculator;
  private validator: TriggerPointValidator;
  private googleAPIs: GoogleAPIsService;
  
  constructor() {
    this.googleAPIs = new GoogleAPIsService();
    this.geographicAnalyzer = new GeographicContextAnalyzer();
    this.boundaryDetector = new BoundaryDetector();
    this.streetAnalyzer = new StreetAnalyzer();
    this.pointCalculator = new OptimalPointCalculator();
    this.validator = new TriggerPointValidator(this.googleAPIs);
  }
  
  /**
   * Prediz trigger points para um POI (método simplificado)
   */
  async predictTriggerPoints(
    poiData: POIData, 
    options: TriggerPointGenerationOptions = {}
  ): Promise<TriggerPoint[]> {
    const result = await this.predictTriggerPointsComplete(poiData, options);
    return result.triggerPoints;
  }

  /**
   * Prediz trigger points para um POI (resultado completo)
   */
  async predictTriggerPointsComplete(
    poiData: POIData, 
    options: TriggerPointGenerationOptions = {}
  ): Promise<TriggerPointPredictionResult> {
    console.log(`🚀 Starting trigger point prediction for: ${poiData.name}`);
    const startTime = Date.now();
    
    try {
      // Validar dados de entrada
      const validation = this.validatePOIData(poiData);
      if (!validation.valid) {
        throw new Error(`Invalid POI data: ${validation.errors.join(', ')}`);
      }
      
      // 1. Análise automática do contexto geográfico
      console.log('📊 Step 1: Analyzing geographic context...');
      const context = await this.geographicAnalyzer.analyzeGeographicContext(poiData);
      
      // 2. Detecção de boundary
      console.log('🔍 Step 2: Detecting boundary...');
      const boundaryResult = await this.boundaryDetector.detectBoundary(poiData, context);
      if (!boundaryResult.success || !boundaryResult.data) {
        throw new Error(`Boundary detection failed: ${boundaryResult.error}`);
      }
      const boundary = boundaryResult.data;
      
      // NOVA LÓGICA: Se boundary é estimado (POI não encontrado), usar fallback SUPER SIMPLES
      if (boundary.source === 'estimated') {
        console.log('🎯 POI NOT FOUND (estimated boundary) - using SUPER SIMPLE fallback');
        console.log(`📏 Estimated boundary: ${boundary.area.toFixed(0)}m² - POI likely small/irrelevant`);
        console.log('🚀 Skipping complex street analysis - using direct lat/lng approach');
        
        const simpleFallbackPoints = await this.generateSuperSimpleFallbackTriggerPoints(poiData, context);
        const processingTime = Date.now() - startTime;
        
        return {
          triggerPoints: simpleFallbackPoints,
          boundary,
          context,
          processingTime,
          metadata: {
            boundarySource: boundary.source,
            boundaryConfidence: boundary.confidence,
            streetCount: 0,
            optimalPointsFound: 0,
            validatedPoints: simpleFallbackPoints.length,
            finalPoints: simpleFallbackPoints.length,
            fallbackUsed: true,
            searchRadius: 300, // Default fallback radius
            elevationAnalysis: null
          }
        };
      }

      // 3. Análise de ruas acessíveis (apenas para POIs com boundary real)
      console.log('🛣️ Step 3: Finding accessible streets...');
      const streetAnalysisResult = await this.streetAnalyzer.findAccessibleStreetsWithMetadata(poiData, boundary, context);
      const accessibleStreets = streetAnalysisResult.streets;
      
      if (accessibleStreets.length === 0) {
        console.warn('⚠️ No accessible streets found, using fallback strategy');
        const fallbackPoints = await this.generateFallbackTriggerPoints(poiData, boundary, context);
        const processingTime = Date.now() - startTime;
        
        return {
          triggerPoints: fallbackPoints,
          boundary,
          context,
          processingTime,
          metadata: {
            boundarySource: boundary.source,
            boundaryConfidence: boundary.confidence,
            streetCount: 0,
            optimalPointsFound: 0,
            validatedPoints: fallbackPoints.length,
            finalPoints: fallbackPoints.length,
            fallbackUsed: true,
            searchRadius: 300, // Default fallback radius
            elevationAnalysis: null
          }
        };
      }
      
      // 4. Cálculo de pontos ótimos
      console.log('🎯 Step 4: Calculating optimal points...');
      const optimalPoints = await this.pointCalculator.calculateOptimalPoints(poiData, accessibleStreets, boundary, context);
      
      if (optimalPoints.length === 0) {
        console.warn('⚠️ No optimal points calculated, using fallback strategy');
        const fallbackPoints = await this.generateFallbackTriggerPoints(poiData, boundary, context);
        const processingTime = Date.now() - startTime;
        
        return {
          triggerPoints: fallbackPoints,
          boundary,
          context,
          processingTime,
          metadata: {
            boundarySource: boundary.source,
            boundaryConfidence: boundary.confidence,
            streetCount: accessibleStreets.length,
            optimalPointsFound: 0,
            validatedPoints: fallbackPoints.length,
            finalPoints: fallbackPoints.length,
            fallbackUsed: true,
            searchRadius: streetAnalysisResult.searchRadius,
            elevationAnalysis: streetAnalysisResult.elevationAnalysis
          }
        };
      }
      
      // 5. Validação e ranking com distância mínima
      console.log('✅ Step 5: Validating and ranking points with optimal spacing...');
      const maxTPs = options.maxTriggerPoints || 50;
      const minDistance = this.calculateMinDistance(context, boundary);
      
      const validatedPoints = await this.validator.validateAndRankPoints(
        optimalPoints, 
        poiData, 
        context,
        boundary,
        maxTPs,
        minDistance
      );
      
      // 6. Aplicar opções de filtro adicionais (se houver)
      const filteredPoints = this.applyOptions(validatedPoints, options);
      
      // 7. Otimização final (agora menos necessária devido à distância mínima)
      const optimizedPoints = this.validator.optimizeTriggerPoints(filteredPoints);
      
      const processingTime = Date.now() - startTime;
      console.log(`🎉 Generated ${optimizedPoints.length} trigger points in ${processingTime}ms`);
      
      return {
        triggerPoints: optimizedPoints,
        boundary,
        context,
        processingTime,
        metadata: {
          boundarySource: boundary.source,
          boundaryConfidence: boundary.confidence,
          streetCount: accessibleStreets.length,
          optimalPointsFound: optimalPoints.length,
          validatedPoints: validatedPoints.length,
          finalPoints: optimizedPoints.length,
          fallbackUsed: false,
          searchRadius: streetAnalysisResult.searchRadius,
          elevationAnalysis: streetAnalysisResult.elevationAnalysis
        }
      };
      
    } catch (error) {
      console.error('Error in trigger point prediction:', error);
      throw new Error(`Failed to generate trigger points: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * NOVO: Gera trigger points de fallback SUPER SIMPLES - apenas 1 TP na rua mais próxima
   */
  private async generateSuperSimpleFallbackTriggerPoints(
    poiData: POIData,
    context: GeographicContext
  ): Promise<TriggerPoint[]> {
    console.log('🎯 SUPER SIMPLE fallback for unfound POI - no complex validations');
    console.log(`📍 POI: ${poiData.name} at ${poiData.location.lat.toFixed(6)}, ${poiData.location.lng.toFixed(6)}`);
    
    try {
      // Estratégia ÚNICA: Encontrar rua mais próxima via Google Roads
      console.log('🔍 Finding nearest street using Google Roads API (simple approach)...');
      
      const roadsResponse = await this.googleAPIs.getNearestRoads([poiData.location]);
      
      if (roadsResponse.success && roadsResponse.data?.snappedPoints && roadsResponse.data.snappedPoints.length > 0) {
        const snappedPoint = roadsResponse.data.snappedPoints[0];
        const streetLocation = {
          lat: snappedPoint.location.latitude,
          lng: snappedPoint.location.longitude
        };
        
        const distance = this.calculateDistance(poiData.location, streetLocation);
        console.log(`✅ Found nearest street at ${distance.toFixed(0)}m from POI`);
        
        // Criar APENAS 1 TP simples
        const triggerPoint: TriggerPoint = {
          id: 'simple_fallback_1',
          location: streetLocation,
          radius: 30, // Raio generoso para compensar imprecisão
          expectedBearing: this.calculateBearing(streetLocation, poiData.location),
          bearingThreshold: 90, // Muito tolerante
          type: 'primary',
          priority: 1,
          confidence: 0.7, // Boa confiança - Google Roads é preciso
          quality: 0.7,
          street: {
            id: snappedPoint.placeId || 'google_road',
            type: 'primary',
            coordinates: [streetLocation],
            accessibility: 'public',
            confidence: 0.8
          },
          distance,
          generationMethod: 'google_apis',
          contextData: context,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        
        console.log(`✅ Created 1 SIMPLE TP at ${streetLocation.lat.toFixed(6)}, ${streetLocation.lng.toFixed(6)} (${distance.toFixed(0)}m from POI)`);
        return [triggerPoint];
        
      } else {
        console.warn('⚠️ Google Roads failed, creating minimal directional TP');
        return this.createMinimalDirectionalTP(poiData, context);
      }
      
    } catch (error) {
      console.warn('Super simple fallback failed:', error);
      return this.createMinimalDirectionalTP(poiData, context);
    }
  }

  /**
   * Cria 1 TP mínimo quando nem Google Roads funciona
   */
  private createMinimalDirectionalTP(poiData: POIData, context: GeographicContext): TriggerPoint[] {
    console.log('🎯 Creating minimal directional TP (last resort)');
    
    const direction = 180; // Sul (direção comum de aproximação)
    const distance = 30; // Muito próximo
    const point = this.calculatePointAtDistance(poiData.location, distance, direction);
    
    const triggerPoint: TriggerPoint = {
      id: 'minimal_fallback_1',
      location: point,
      radius: 35,
      expectedBearing: 0, // Norte (olhando para o POI)
      bearingThreshold: 120, // Muito tolerante
      type: 'fallback',
      priority: 1,
      confidence: 0.5,
      quality: 0.5,
      street: {
        id: 'estimated_access',
        type: 'estimated',
        coordinates: [point],
        accessibility: 'public',
        confidence: 0.4
      },
      distance,
      generationMethod: 'google_apis',
      contextData: context,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    console.log(`✅ Created 1 minimal TP at ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)} (${distance}m south of POI)`);
    return [triggerPoint];
  }

  /**
   * Gera trigger points de fallback INTELIGENTE - apenas 1-2 TPs na rua mais próxima (LEGACY)
   */
  private async generateFallbackTriggerPoints(
    poiData: POIData, 
    boundary: any, 
    context: any
  ): Promise<TriggerPoint[]> {
    console.log('🎯 Generating SMART fallback trigger points for small/unfound POI...');
    console.log(`📍 POI location: ${poiData.name} at ${poiData.location.lat.toFixed(6)}, ${poiData.location.lng.toFixed(6)}`);
    
    try {
      // Estratégia 1: Encontrar a rua mais próxima do POI
      const nearestStreet = await this.findNearestStreetToPOI(poiData.location);
      
      if (nearestStreet && nearestStreet.coordinates.length > 0) {
        console.log(`🛣️ Found nearest street: ${nearestStreet.id || 'unnamed'}`);
        return this.createMinimalStreetTriggerPoints(poiData, nearestStreet, context);
      }
      
      // Estratégia 2: Se não encontrou rua, criar apenas 1 TP na direção da rua principal
      console.log('⚠️ No nearby street found, creating single directional TP');
      return this.createSingleDirectionalTP(poiData, context);
      
    } catch (error) {
      console.warn('Smart fallback failed, using minimal fallback:', error);
      return this.createSingleDirectionalTP(poiData, context);
    }
  }

  /**
   * NOVA: Encontrar a rua mais próxima do POI usando Google Roads API
   */
  private async findNearestStreetToPOI(poiLocation: { lat: number; lng: number }): Promise<any | null> {
    try {
      console.log('🔍 Searching for nearest street using Google Roads API...');
      
      const roadsResponse = await this.googleAPIs.getNearestRoads([poiLocation]);
      
      if (roadsResponse.success && roadsResponse.data?.snappedPoints && roadsResponse.data.snappedPoints.length > 0) {
        const snappedPoint = roadsResponse.data.snappedPoints[0];
        
        console.log(`✅ Found nearest road point: ${snappedPoint.location.latitude.toFixed(6)}, ${snappedPoint.location.longitude.toFixed(6)}`);
        
        return {
          id: snappedPoint.placeId || 'google_road',
          type: 'primary',
          coordinates: [{
            lat: snappedPoint.location.latitude,
            lng: snappedPoint.location.longitude
          }],
          accessibility: 'public',
          confidence: 0.8
        };
      }
      
      console.warn('No roads found near POI');
      return null;
      
    } catch (error) {
      console.warn('Error finding nearest street:', error);
      return null;
    }
  }

  /**
   * NOVA: Criar apenas 1-2 TPs na rua encontrada
   */
  private createMinimalStreetTriggerPoints(
    poiData: POIData,
    street: any,
    context: any
  ): TriggerPoint[] {
    console.log('🎯 Creating 1-2 minimal trigger points on nearest street');
    
    const streetPoint = street.coordinates[0];
    const distanceToPOI = this.calculateDistance(poiData.location, streetPoint);
    
    console.log(`📏 Distance from POI to street: ${distanceToPOI.toFixed(0)}m`);
    
    // Criar apenas 1 TP principal na rua mais próxima
    const triggerPoint: TriggerPoint = {
      id: 'smart_fallback_1',
      location: streetPoint,
      radius: 25, // Raio pequeno para POI pequeno
      expectedBearing: this.calculateBearing(streetPoint, poiData.location),
      bearingThreshold: 60, // Mais tolerante
      type: 'primary',
      priority: 1,
      confidence: 0.6, // Melhor confiança que fallback básico
      quality: 0.6,
      street: {
        id: street.id,
        type: street.type,
        coordinates: street.coordinates,
        accessibility: street.accessibility,
        confidence: street.confidence
      },
      distance: distanceToPOI,
        generationMethod: 'google_apis',
      contextData: context,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    console.log(`✅ Created 1 smart fallback TP at ${streetPoint.lat.toFixed(6)}, ${streetPoint.lng.toFixed(6)}`);
    return [triggerPoint];
  }

  /**
   * NOVA: Criar apenas 1 TP direcional quando não há rua próxima
   */
  private createSingleDirectionalTP(poiData: POIData, context: any): TriggerPoint[] {
    console.log('🎯 Creating single directional TP for isolated POI');
    
    // Criar 1 TP a 50m na direção mais provável (sul - direção de aproximação comum)
    const direction = 180; // Sul
    const distance = 50; // metros
    const point = this.calculatePointAtDistance(poiData.location, distance, direction);
    
    const triggerPoint: TriggerPoint = {
      id: 'minimal_fallback_1',
      location: point,
      radius: 30,
      expectedBearing: 0, // Norte (olhando para o POI)
      bearingThreshold: 90, // Muito tolerante
      type: 'fallback',
      priority: 1,
      confidence: 0.4,
      quality: 0.4,
      street: {
        id: 'estimated_access',
        type: 'estimated',
        coordinates: [point],
        accessibility: 'public',
        confidence: 0.3
      },
      distance,
      generationMethod: 'google_apis',
      contextData: context,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    console.log(`✅ Created 1 minimal TP at ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)} (${distance}m south of POI)`);
    return [triggerPoint];
  }

  /**
   * Calcula distância entre dois pontos
   */
  private calculateDistance(point1: { lat: number; lng: number }, point2: { lat: number; lng: number }): number {
    const R = 6371e3; // Raio da Terra em metros
    const φ1 = point1.lat * Math.PI / 180;
    const φ2 = point2.lat * Math.PI / 180;
    const Δφ = (point2.lat - point1.lat) * Math.PI / 180;
    const Δλ = (point2.lng - point1.lng) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  }

  /**
   * Calcula bearing entre dois pontos
   */
  private calculateBearing(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
    const φ1 = from.lat * Math.PI / 180;
    const φ2 = to.lat * Math.PI / 180;
    const Δλ = (to.lng - from.lng) * Math.PI / 180;

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

    const θ = Math.atan2(y, x);
    return (θ * 180 / Math.PI + 360) % 360;
  }
  
  /**
   * Calcula ponto a uma distância e direção específicas
   */
  private calculatePointAtDistance(
    center: { lat: number; lng: number }, 
    distance: number, 
    bearing: number
  ): { lat: number; lng: number } {
    const R = 6371000; // Raio da Terra em metros
    const lat1 = center.lat * Math.PI / 180;
    const lng1 = center.lng * Math.PI / 180;
    const bearingRad = bearing * Math.PI / 180;
    
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(distance / R) +
      Math.cos(lat1) * Math.sin(distance / R) * Math.cos(bearingRad)
    );
    
    const lng2 = lng1 + Math.atan2(
      Math.sin(bearingRad) * Math.sin(distance / R) * Math.cos(lat1),
      Math.cos(distance / R) - Math.sin(lat1) * Math.sin(lat2)
    );
    
    return {
      lat: lat2 * 180 / Math.PI,
      lng: lng2 * 180 / Math.PI
    };
  }
  
  /**
   * Aplica opções de filtro aos trigger points
   */
  private applyOptions(triggerPoints: TriggerPoint[], options: TriggerPointGenerationOptions): TriggerPoint[] {
    let filtered = [...triggerPoints];
    
    // Filtrar por qualidade mínima
    if (options.minQuality !== undefined) {
      filtered = filtered.filter(tp => tp.quality >= options.minQuality!);
    }
    
    // Limitar número máximo de trigger points
    if (options.maxTriggerPoints !== undefined) {
      filtered = filtered.slice(0, options.maxTriggerPoints);
    }
    
    return filtered;
  }
  
  /**
   * Valida dados de entrada do POI
   */
  private validatePOIData(poiData: POIData): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!poiData.id || typeof poiData.id !== 'string') {
      errors.push('POI ID is required and must be a string');
    }
    
    if (!poiData.name || typeof poiData.name !== 'string') {
      errors.push('POI name is required and must be a string');
    }
    
    if (!poiData.location || typeof poiData.location !== 'object') {
      errors.push('POI location is required and must be an object');
    } else {
      if (typeof poiData.location.lat !== 'number' || poiData.location.lat < -90 || poiData.location.lat > 90) {
        errors.push('POI latitude must be a number between -90 and 90');
      }
      
      if (typeof poiData.location.lng !== 'number' || poiData.location.lng < -180 || poiData.location.lng > 180) {
        errors.push('POI longitude must be a number between -180 and 180');
      }
    }
    
    if (!poiData.type || typeof poiData.type !== 'string') {
      errors.push('POI type is required and must be a string');
    }
    
    if (!poiData.country || typeof poiData.country !== 'string') {
      errors.push('POI country is required and must be a string');
    }
    
    if (!poiData.city || typeof poiData.city !== 'string') {
      errors.push('POI city is required and must be a string');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
  
  /**
   * Gera estatísticas dos trigger points
   */
  generateStatistics(triggerPoints: TriggerPoint[]): {
    total: number;
    byType: Record<string, number>;
    averageQuality: number;
    averageConfidence: number;
    qualityDistribution: Record<string, number>;
  } {
    const stats = {
      total: triggerPoints.length,
      byType: {} as Record<string, number>,
      averageQuality: 0,
      averageConfidence: 0,
      qualityDistribution: {
        high: 0,    // > 0.7
        medium: 0,  // 0.4 - 0.7
        low: 0      // < 0.4
      }
    };
    
    if (triggerPoints.length === 0) {
      return stats;
    }
    
    let totalQuality = 0;
    let totalConfidence = 0;
    
    for (const tp of triggerPoints) {
      // Contar por tipo
      stats.byType[tp.type] = (stats.byType[tp.type] || 0) + 1;
      
      // Acumular qualidade e confiança
      totalQuality += tp.quality;
      totalConfidence += tp.confidence;
      
      // Distribuição de qualidade
      if (tp.quality > 0.7) {
        stats.qualityDistribution.high++;
      } else if (tp.quality >= 0.4) {
        stats.qualityDistribution.medium++;
      } else {
        stats.qualityDistribution.low++;
      }
    }
    
    stats.averageQuality = totalQuality / triggerPoints.length;
    stats.averageConfidence = totalConfidence / triggerPoints.length;
    
    return stats;
  }
  
  /**
   * Calcula distância mínima entre TPs baseado no contexto e tamanho do POI
   */
  private calculateMinDistance(context: GeographicContext, boundary: BoundaryData): number {
    let baseDistance = 50; // Base: 50m (otimizado para range de 20m por TP)
    
    console.log(`📏 Calculating minimum distance between TPs (20m range each)...`);
    
    // Ajustar baseado na densidade urbana
    switch (context.urbanDensity.level) {
      case 'very_dense':
        baseDistance = 40; // Mais próximos em áreas muito densas
        break;
      case 'dense':
        baseDistance = 45;
        break;
      case 'medium':
        baseDistance = 50;
        break;
      case 'low':
        baseDistance = 60;
        break;
      case 'rural':
        baseDistance = 70; // Mais distantes em áreas rurais
        break;
    }
    
    // Ajustar baseado no tamanho do POI
    if (boundary.area > 500000) { // POIs muito grandes (>50 hectares)
      baseDistance *= 1.3; // Reduzido de 1.5 para 1.3
      console.log(`🏞️ Large POI adjustment: +30% distance`);
    } else if (boundary.area > 100000) { // POIs grandes (>10 hectares)
      baseDistance *= 1.1; // Reduzido de 1.2 para 1.1
      console.log(`🏛️ Medium POI adjustment: +10% distance`);
    }
    
    // Ajustar baseado na elevação (POIs altos = TPs mais distantes)
    if (boundary.elevation) {
      const elevationDiff = boundary.elevation.center - boundary.elevation.average;
      if (elevationDiff > 50) {
        baseDistance *= 1.2; // Reduzido de 1.3 para 1.2
        console.log(`⛰️ High elevation adjustment: +20% distance`);
      }
    }
    
    // Ajustar baseado na altura do POI
    if (boundary.height && boundary.height > 50) {
      baseDistance *= 1.1; // Reduzido de 1.2 para 1.1
      console.log(`🏢 Tall POI adjustment: +10% distance`);
    }
    
    // Limites de segurança otimizados para range de 20m
    const minDistance = Math.max(30, Math.min(baseDistance, 100)); // 30m - 100m
    
    console.log(`✅ Minimum distance calculated: ${minDistance}m (base: ${baseDistance.toFixed(0)}m) - TP range: 20m`);
    return Math.round(minDistance);
  }
}

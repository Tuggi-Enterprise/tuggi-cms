// Core Trigger Point Predictor - Orquestrador principal do sistema

import { GeographicContextAnalyzer } from './geographic-analyzer';
import { BoundaryDetector } from './boundary-detector';
import { StreetAnalyzer } from '../analyzers/street-analyzer';
import { OptimalPointCalculator } from '../analyzers/point-calculator';
import { TriggerPointValidator } from '../analyzers/validator';
import { GoogleAPIsService } from '../services/google-apis.service';
import { POIData, TriggerPoint, TriggerPointGenerationOptions, TriggerPointPredictionResult, BoundaryData, GeographicContext } from '../types/interfaces';
import { calculateBearing, calculateDistance } from '../utils/calculations';
import { loadTriggerPointsConfig, TriggerPointsConfig } from '../config/trigger-points-config';

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
      
      // 2.1. Re-analisar contexto geográfico com boundary (para usar boundary.center)
      console.log('📊 Step 2.1: Re-analyzing geographic context with boundary...');
      const contextWithBoundary = await this.geographicAnalyzer.analyzeGeographicContext(poiData, boundary);
      
      // NOVA LÓGICA: Se boundary é estimado (POI não encontrado), usar fallback SUPER SIMPLES
      if (boundary.source === 'estimated') {
        console.log('🎯 POI NOT FOUND (estimated boundary) - using SUPER SIMPLE fallback');
        console.log(`📏 Estimated boundary: ${boundary.area.toFixed(0)}m² - POI likely small/irrelevant`);
        console.log('🚀 Skipping complex street analysis - using direct lat/lng approach');
        
        const simpleFallbackPoints = await this.generateSuperSimpleFallbackTriggerPoints(poiData, context, boundary);
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
      const maxTPs = options.maxTriggerPoints || this.calculateDynamicTPLimit(boundary, context);
      const minDistance = this.calculateMinDistance(context, boundary);
      
      const validatedPoints = await this.validator.validateAndRankPoints(
        optimalPoints, 
        poiData, 
        contextWithBoundary,
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
   * NOVO: Gera trigger points de fallback INTELIGENTE - usa dados reais do OSM
   */
  private async generateSuperSimpleFallbackTriggerPoints(
    poiData: POIData,
    context: GeographicContext,
    boundary?: BoundaryData
  ): Promise<TriggerPoint[]> {
    console.log('🎯 INTELLIGENT fallback for unfound POI - using real OSM data');
    
    // USAR BOUNDARY.CENTER em vez de poiData.location
    const centerPoint = boundary?.center || poiData.location;
    console.log(`📍 POI: ${poiData.name} at ${centerPoint.lat.toFixed(6)}, ${centerPoint.lng.toFixed(6)} (${boundary ? 'boundary.center' : 'poiData.location'})`);
    
    try {
      // ESTRATÉGIA INTELIGENTE: Usar funções existentes para buscar ruas reais no OSM
      console.log('🔍 Finding real streets using OSM data (intelligent approach)...');
      
      // 1. USAR função existente para buscar ruas no OSM (50m radius para fallback)
      const streets = await this.streetAnalyzer.getStreetsFromOSMOptimized(centerPoint, 50);
      
      if (streets && streets.length > 0) {
        // 2. USAR função existente para filtrar ruas acessíveis
        const accessibleStreets = streets.filter(street => 
          this.streetAnalyzer.isStreetAccessiblePublic(street, context)
        );
        
        if (accessibleStreets.length > 0) {
          // 3. Encontrar a melhor rua (mais próxima e com melhor direção)
          const bestStreet = this.findBestStreetForFallback(accessibleStreets, centerPoint);
          
          if (bestStreet) {
            const streetPoint = bestStreet.coordinates[0];
            const distance = calculateDistance(centerPoint, streetPoint);
            
            console.log(`✅ Found best street: ${bestStreet.name || bestStreet.id} at ${distance.toFixed(0)}m from POI`);
            
            // 4. Criar TP na rua real com direção assertiva
            const triggerPoint: TriggerPoint = {
              id: 'intelligent_fallback_1',
              location: streetPoint,
              radius: 25, // Raio otimizado para rua real
              expectedBearing: calculateBearing(streetPoint, centerPoint),
              bearingThreshold: 60, // Mais assertivo para rua real
              type: 'primary',
              priority: 1,
              confidence: 0.8, // Alta confiança - rua real do OSM
              quality: 0.8,
              street: {
                id: bestStreet.id,
                type: bestStreet.type,
                coordinates: bestStreet.coordinates,
                accessibility: bestStreet.accessibility,
                confidence: bestStreet.confidence
              },
              distance,
              generationMethod: 'google_apis',
              contextData: context,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            
            console.log(`✅ Created 1 INTELLIGENT TP at ${streetPoint.lat.toFixed(6)}, ${streetPoint.lng.toFixed(6)} (${distance.toFixed(0)}m from POI)`);
            return [triggerPoint];
          }
        }
      }
      
      // Fallback: Google Roads se OSM não encontrar ruas
      console.log('🔄 OSM found no streets, trying Google Roads fallback...');
      return this.createGoogleRoadsFallback(poiData, context, boundary);
      
    } catch (error) {
      console.warn('Intelligent fallback failed:', error);
      return this.createGoogleRoadsFallback(poiData, context, boundary);
    }
  }

  /**
   * NOVO: Encontra a melhor rua para fallback baseada em proximidade e direção
   */
  private findBestStreetForFallback(streets: any[], centerPoint: { lat: number; lng: number }): any | null {
    if (streets.length === 0) return null;
    
    let bestStreet = streets[0];
    let bestScore = -1;
    
    for (const street of streets) {
      if (street.coordinates.length === 0) continue;
      
      const streetPoint = street.coordinates[0];
      const distance = calculateDistance(centerPoint, streetPoint);
      
      // Score baseado em: proximidade (menor = melhor) + tipo de rua (primary = melhor)
      let score = 1000 / (distance + 1); // Inverter distância (mais próximo = score maior)
      
      // Bonus por tipo de rua
      if (street.type === 'primary') score *= 1.5;
      else if (street.type === 'secondary') score *= 1.2;
      else if (street.type === 'tertiary') score *= 1.0;
      else score *= 0.8;
      
      // Bonus por confiança
      score *= (street.confidence || 0.5);
      
      if (score > bestScore) {
        bestScore = score;
        bestStreet = street;
      }
    }
    
    return bestStreet;
  }
  
  /**
   * NOVO: Fallback usando Google Roads quando OSM falha
   */
  private async createGoogleRoadsFallback(poiData: POIData, context: GeographicContext, boundary?: BoundaryData): Promise<TriggerPoint[]> {
    console.log('🔍 Finding nearest street using Google Roads API (fallback approach)...');
    
    const centerPoint = boundary?.center || poiData.location;
    
    try {
      const roadsResponse = await this.googleAPIs.getNearestRoads([centerPoint]);
      
      if (roadsResponse.success && roadsResponse.data?.snappedPoints && roadsResponse.data.snappedPoints.length > 0) {
        const snappedPoint = roadsResponse.data.snappedPoints[0];
        const streetLocation = {
          lat: snappedPoint.location.latitude,
          lng: snappedPoint.location.longitude
        };
        
        const distance = calculateDistance(centerPoint, streetLocation);
        console.log(`✅ Found nearest street at ${distance.toFixed(0)}m from POI (using ${boundary ? 'boundary.center' : 'poiData.location'})`);
        
        // Criar APENAS 1 TP simples
        const triggerPoint: TriggerPoint = {
          id: 'google_fallback_1',
          location: streetLocation,
          radius: 30, // Raio generoso para compensar imprecisão
          expectedBearing: calculateBearing(streetLocation, centerPoint),
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
        
        console.log(`✅ Created 1 GOOGLE FALLBACK TP at ${streetLocation.lat.toFixed(6)}, ${streetLocation.lng.toFixed(6)} (${distance.toFixed(0)}m from POI)`);
        return [triggerPoint];
        
      } else {
        console.warn('⚠️ Google Roads failed, creating minimal directional TP');
        return this.createMinimalDirectionalTP(poiData, context, boundary);
      }
      
    } catch (error) {
      console.warn('Google Roads fallback failed:', error);
      return this.createMinimalDirectionalTP(poiData, context, boundary);
    }
  }

  /**
   * Cria 1 TP mínimo quando nem Google Roads funciona
   */
  private createMinimalDirectionalTP(poiData: POIData, context: GeographicContext, boundary?: BoundaryData): TriggerPoint[] {
    console.log('🎯 Creating minimal directional TP (last resort)');
    
    // USAR BOUNDARY.CENTER em vez de poiData.location
    const centerPoint = boundary?.center || poiData.location;
    console.log(`📍 Using ${boundary ? 'boundary.center' : 'poiData.location'} for TP calculation`);
    
    const direction = 180; // Sul (direção comum de aproximação)
    const distance = 30; // Muito próximo
    const point = this.calculatePointAtDistance(centerPoint, distance, direction);
    
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
    
    // USAR BOUNDARY.CENTER em vez de poiData.location
    const centerPoint = boundary?.center || poiData.location;
    console.log(`📍 POI location: ${poiData.name} at ${centerPoint.lat.toFixed(6)}, ${centerPoint.lng.toFixed(6)} (${boundary ? 'boundary.center' : 'poiData.location'})`);
    
    try {
      // Estratégia 1: Encontrar a rua mais próxima do POI
      const nearestStreet = await this.findNearestStreetToPOI(centerPoint);
      
      if (nearestStreet && nearestStreet.coordinates.length > 0) {
        console.log(`🛣️ Found nearest street: ${nearestStreet.id || 'unnamed'}`);
        return this.createMinimalStreetTriggerPoints(poiData, nearestStreet, context, boundary);
      }
      
      // Estratégia 2: Se não encontrou rua, criar apenas 1 TP na direção da rua principal
      console.log('⚠️ No nearby street found, creating single directional TP');
      return this.createSingleDirectionalTP(poiData, context, boundary);
      
    } catch (error) {
      console.warn('Smart fallback failed, using minimal fallback:', error);
      return this.createSingleDirectionalTP(poiData, context, boundary);
    }
  }

  /**
   * Cria 1 TP direcional simples (fallback)
   */
  private createSingleDirectionalTP(poiData: POIData, context: any, boundary?: BoundaryData): TriggerPoint[] {
    console.log('🎯 Creating single directional TP (fallback)');
    
    // USAR BOUNDARY.CENTER em vez de poiData.location
    const centerPoint = boundary?.center || poiData.location;
    console.log(`📍 Using ${boundary ? 'boundary.center' : 'poiData.location'} for TP calculation`);
    
    // Criar 1 TP a 50m na direção mais provável (sul - direção de aproximação comum)
    const direction = 180; // Sul
    const distance = 50; // metros
    const point = this.calculatePointAtDistance(centerPoint, distance, direction);
    
    const triggerPoint: TriggerPoint = {
      id: 'minimal_fallback_1',
      location: point,
      radius: 30,
      expectedBearing: direction,
      bearingThreshold: 90,
      type: 'primary',
      priority: 1,
      confidence: 0.5,
      quality: 0.5,
      street: {
        id: 'estimated_directional',
        type: 'estimated',
        coordinates: [point],
        accessibility: 'public',
        confidence: 0.3
      },
      distance: distance,
      generationMethod: 'google_apis',
      contextData: context,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    console.log(`✅ Created 1 DIRECTIONAL TP at ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)} (${distance}m from ${boundary ? 'boundary.center' : 'POI'})`);
    return [triggerPoint];
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
    context: any,
    boundary?: BoundaryData
  ): TriggerPoint[] {
    console.log('🎯 Creating 1-2 minimal trigger points on nearest street');
    
    // USAR BOUNDARY.CENTER em vez de poiData.location
    const centerPoint = boundary?.center || poiData.location;
    
    const streetPoint = street.coordinates[0];
    const distanceToPOI = this.calculateDistance(centerPoint, streetPoint);
    
    console.log(`📏 Distance from POI to street: ${distanceToPOI.toFixed(0)}m (using ${boundary ? 'boundary.center' : 'poiData.location'})`);
    
    // Criar apenas 1 TP principal na rua mais próxima
    const triggerPoint: TriggerPoint = {
      id: 'smart_fallback_1',
      location: streetPoint,
      radius: 25, // Raio pequeno para POI pequeno
      expectedBearing: calculateBearing(streetPoint, centerPoint),
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
  // Método removido - duplicado com versão atualizada que usa boundary.center

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

  // Usar função existente do utils/calculations.ts (DRY)
  
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
   * Calcula limite dinâmico de TPs baseado em características matemáticas do POI
   * Substitui o limite fixo de 50 por cálculo baseado em área, elevação e altura
   */
  private calculateDynamicTPLimit(boundary: BoundaryData, context: GeographicContext): number {
    console.log(`🎯 Calculating dynamic TP limit for POI...`);
    
    // Esta função será chamada ANTES de ter os candidatos, então usamos estimativa baseada em área
    // A lógica real será aplicada no validator quando tivermos os candidatos reais
    
    // Estimativa baseada em área (fallback para quando não temos candidatos ainda)
    const areaBasedEstimate = Math.min(Math.max(Math.floor(boundary.area / 5000), 10), 100);
    
    console.log(`📐 Area-based estimate: ${boundary.area.toFixed(0)}m² → ${areaBasedEstimate} TPs`);
    console.log(`🎯 Dynamic TP limit calculated: ${areaBasedEstimate} (area-based estimate)`);
    
    return Math.max(3, areaBasedEstimate); // Mínimo garantido de 3 TPs
  }
  
  /**
   * Calcula distância mínima entre TPs baseado no contexto e tamanho do POI
   */
  private calculateMinDistance(context: GeographicContext, boundary: BoundaryData, config?: TriggerPointsConfig): number {
    // Carregar configuração
    const cfg = config || loadTriggerPointsConfig();
    
    let baseDistance = cfg.minDistance.baseDistance[context.urbanDensity.level];
    
    console.log(`📏 Calculating minimum distance between TPs (20m range each)...`);
    
    // Ajustar baseado no tamanho do POI
    if (boundary.area > 500000) { // POIs muito grandes (>50 hectares)
      baseDistance *= cfg.minDistance.areaMultipliers.very_large;
      console.log(`🏞️ Large POI adjustment: +${((cfg.minDistance.areaMultipliers.very_large - 1) * 100).toFixed(0)}% distance`);
    } else if (boundary.area > 100000) { // POIs grandes (>10 hectares)
      baseDistance *= cfg.minDistance.areaMultipliers.large;
      console.log(`🏛️ Medium POI adjustment: +${((cfg.minDistance.areaMultipliers.large - 1) * 100).toFixed(0)}% distance`);
    }
    
    // Ajustar baseado na elevação (POIs altos = TPs mais distantes)
    if (boundary.elevation) {
      const elevationDiff = boundary.elevation.center - boundary.elevation.average;
      if (elevationDiff > 50) {
        baseDistance *= cfg.minDistance.elevationMultipliers.high;
        console.log(`⛰️ High elevation adjustment: +${((cfg.minDistance.elevationMultipliers.high - 1) * 100).toFixed(0)}% distance`);
      }
    }
    
    // Ajustar baseado na altura do POI
    if (boundary.height && boundary.height > 50) {
      baseDistance *= cfg.minDistance.heightMultipliers.tall;
      console.log(`🏢 Tall POI adjustment: +${((cfg.minDistance.heightMultipliers.tall - 1) * 100).toFixed(0)}% distance`);
    }
    
    // Limites de segurança otimizados para range de 20m
    const minDistance = Math.max(cfg.minDistance.limits.min, Math.min(baseDistance, cfg.minDistance.limits.max));
    
    console.log(`✅ Minimum distance calculated: ${minDistance}m (base: ${baseDistance.toFixed(0)}m) - TP range: 20m`);
    return Math.round(minDistance);
  }
}

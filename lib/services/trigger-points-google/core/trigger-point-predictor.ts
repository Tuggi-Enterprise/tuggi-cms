// Core Trigger Point Predictor - Orquestrador principal do sistema

import { GeographicContextAnalyzer } from './geographic-analyzer';
import { BoundaryDetector } from './boundary-detector';
import { StreetAnalyzer } from '../analyzers/street-analyzer';
import { OptimalPointCalculator } from '../analyzers/point-calculator';
import { TriggerPointValidator } from '../analyzers/validator';
import { GoogleAPIsService } from '../services/google-apis.service';
import { POIData, TriggerPoint, TriggerPointGenerationOptions, TriggerPointPredictionResult, BoundaryData, GeographicContext, TriggerPointCandidate, StreetData } from '../types/interfaces';
import { calculateBearing, calculateDistance, findClosestPointOnBoundary } from '../utils/calculations';
import { loadTriggerPointsConfig, TriggerPointsConfig, TRIGGER_POINTS_CONSTANTS } from '../config/trigger-points-config';

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
      
      // ✅ REFATORADO: Buscar dados OSM primeiro, depois calcular densidade e classificar
      // Não fazer cálculo inicial de contexto sem dados - isso causa redundância
      // 1. Detecção de boundary (busca dados OSM com raio padrão 500m, calcula densidade, classifica)
      console.log('🔍 Step 1: Detecting boundary and collecting OSM data...');
      const boundaryResult = await this.boundaryDetector.detectBoundary(poiData);
      if (!boundaryResult.success || !boundaryResult.data) {
        throw new Error(`Boundary detection failed: ${boundaryResult.error}`);
      }
      const boundary = boundaryResult.data;
      
      // 2. Criar contexto geográfico a partir do boundary (já tem densidade calculada corretamente)
      // ✅ NOTA: Densidade urbana e classificação já foram calculadas dentro de detectBoundary
      //    usando dados OSM reais. Aqui apenas criamos o contexto completo para etapas posteriores.
      console.log('📊 Step 2: Creating geographic context from boundary data...');
      const context = await this.geographicAnalyzer.analyzeGeographicContext(poiData, boundary);
      
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
            boundarySource: boundary.source, // ✅ Agora aceita 'manual' | 'nominatim' além dos tipos originais
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
      // ✅ Context já tem densidade calculada corretamente a partir dos dados OSM
      console.log('🛣️ Step 3: Finding accessible streets...');
      const streetAnalysisResult = await this.streetAnalyzer.findAccessibleStreetsWithMetadata(poiData, boundary, context);
      const accessibleStreets = streetAnalysisResult.streets;
      
      if (accessibleStreets.length === 0) {
        console.warn('⚠️ No accessible streets found, using fallback strategy');
        const fallbackPoints = await this.generateFallbackTriggerPoints(poiData, boundary, context, streetAnalysisResult.streets);
        const processingTime = Date.now() - startTime;
        
        return {
          triggerPoints: fallbackPoints,
          boundary,
          context,
          processingTime,
          metadata: {
            boundarySource: boundary.source, // ✅ Agora aceita 'manual' | 'nominatim' além dos tipos originais
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
      
      // 3.5. NOVO: Analisar estrutura do quarteirão para filtrar ruas bloqueadas por buildings
      // Isso evita gerar candidatos em ruas onde há casas/residências bloqueando a visão do POI
      let streetsForOptimalPoints = accessibleStreets;
      if (boundary.buildings && boundary.buildings.length > 0) {
        console.log('🏘️ Step 3.5: Analyzing block structure to filter streets blocked by buildings...');
        const blockAnalysis = this.streetAnalyzer.analyzeBlockStructure(
          boundary.center,
          accessibleStreets,
          boundary.buildings,
          boundary
        );
        
        // Filtrar apenas front/side streets (sem buildings bloqueando)
        // Ruas classificadas como 'back' têm buildings bloqueando e não devem gerar candidatos
        const validStreets = blockAnalysis
          .filter(result => result.classification === 'front' || result.classification === 'side')
          .map(result => result.street);
        
        if (validStreets.length > 0) {
          const blockedCount = accessibleStreets.length - validStreets.length;
          console.log(`✅ Block structure analysis: ${validStreets.length} front/side streets (${blockedCount} blocked by buildings - excluded)`);
          streetsForOptimalPoints = validStreets;
        } else {
          console.log(`⚠️ Block structure analysis: All streets blocked by buildings, but continuing anyway (may have visibility issues)`);
          // Continuar com todas as ruas, mas a validação de visibilidade depois vai filtrar
        }
      }
      
      // 4. Cálculo de pontos ótimos
      // ✅ Context já tem densidade calculada corretamente a partir dos dados OSM
      // ✅ Usar apenas ruas front/side (sem buildings bloqueando)
      console.log('🎯 Step 4: Calculating optimal points...');
      const optimalPoints = await this.pointCalculator.calculateOptimalPoints(poiData, streetsForOptimalPoints, boundary, context);
      
      if (optimalPoints.length === 0) {
        console.warn('⚠️ No optimal points calculated, using fallback strategy');
        const fallbackPoints = await this.generateFallbackTriggerPoints(poiData, boundary, context, accessibleStreets);
        const processingTime = Date.now() - startTime;
        
        return {
          triggerPoints: fallbackPoints,
          boundary,
          context,
          processingTime,
          metadata: {
            boundarySource: boundary.source, // ✅ Agora aceita 'manual' | 'nominatim' além dos tipos originais
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
      
      // 5. Validação de candidatos em ruas (NOVO PASSO)
      console.log('🛣️ Step 5: Validating candidates are on streets...');
      const streetValidatedCandidates = await this.validateCandidatesOnStreets(optimalPoints, accessibleStreets);
      
      if (streetValidatedCandidates.length === 0) {
        console.warn('⚠️ No candidates validated on streets, using fallback strategy');
        const fallbackPoints = await this.generateFallbackTriggerPoints(poiData, boundary, context, accessibleStreets);
        const processingTime = Date.now() - startTime;
        
        return {
          triggerPoints: fallbackPoints,
          boundary,
          context,
          processingTime,
          metadata: {
            boundarySource: boundary.source, // ✅ Agora aceita 'manual' | 'nominatim' além dos tipos originais
            boundaryConfidence: boundary.confidence,
            streetCount: accessibleStreets.length,
            optimalPointsFound: optimalPoints.length,
            streetValidatedCandidates: 0,
            validatedPoints: fallbackPoints.length,
            finalPoints: fallbackPoints.length,
            fallbackUsed: true,
            searchRadius: streetAnalysisResult.searchRadius,
            elevationAnalysis: streetAnalysisResult.elevationAnalysis
          }
        };
      }
      
      // 6. Validação e ranking com distância mínima
      console.log('✅ Step 6: Validating and ranking points with optimal spacing...');
      const maxTPs = options.maxTriggerPoints || this.calculateDynamicTPLimit(boundary, context, streetAnalysisResult.searchRadius);
      
      // 🎯 NOVO: Usar configuração do grupo se disponível, senão calcular
      let minDistance: number;
      if (boundary.classification?.minDistanceBetweenTPs) {
        minDistance = boundary.classification.minDistanceBetweenTPs;
        console.log(`🎯 Using group configuration: ${minDistance}m (${boundary.classification.group.toUpperCase()})`);
      } else {
        minDistance = this.calculateMinDistance(context, boundary);
        console.log(`🎯 Using calculated distance: ${minDistance}m (no group config)`);
      }
      
      const validatedPoints = await this.validator.validateAndRankPoints(
        streetValidatedCandidates, 
        poiData, 
        context,
        boundary,
        maxTPs,
        minDistance
      );
      
      // 7. Aplicar opções de filtro adicionais (se houver)
      const filteredPoints = this.applyOptions(validatedPoints, options);
      
      // 8. Otimização já foi feita em selectTriggerPointsWithMinDistance
      const processingTime = Date.now() - startTime;
      console.log(`🎉 Generated ${filteredPoints.length} trigger points in ${processingTime}ms`);
      
      // NOVO: Documentar motivo quando 0 TPs são gerados
      const metadata: any = {
        boundarySource: boundary.source,
        boundaryConfidence: boundary.confidence,
        streetCount: accessibleStreets.length,
        optimalPointsFound: optimalPoints.length,
        streetValidatedCandidates: streetValidatedCandidates.length,
        validatedPoints: validatedPoints.length,
        finalPoints: filteredPoints.length,
        fallbackUsed: false,
        searchRadius: streetAnalysisResult.searchRadius,
        elevationAnalysis: streetAnalysisResult.elevationAnalysis
      };
      
      if (filteredPoints.length === 0) {
        // Coletar motivos de rejeição
        const rejectionReasons: string[] = [];
        const suggestions: string[] = [];
        
        if (accessibleStreets.length === 0) {
          rejectionReasons.push('No accessible streets found within search radius');
          suggestions.push('Check if POI has accessible streets nearby');
        } else if (optimalPoints.length === 0) {
          rejectionReasons.push('No optimal points calculated from streets');
          suggestions.push('Check if streets are suitable for trigger point placement');
        } else if (streetValidatedCandidates.length === 0) {
          rejectionReasons.push('No candidates validated on streets');
          suggestions.push('Check if candidate points are actually on accessible streets');
        } else if (validatedPoints.length === 0) {
          rejectionReasons.push('All candidates failed visibility validation');
          suggestions.push('Check if POI is visible from nearby streets (may be blocked by buildings/vegetation)');
        } else {
          rejectionReasons.push('All validated points were filtered out by options');
          suggestions.push('Check filter options (minQuality, maxDistance, etc.)');
        }
        
        metadata.noTPsReason = {
          candidatesFound: optimalPoints.length,
          candidatesAfterStreetValidation: streetValidatedCandidates.length,
          candidatesAfterVisibility: validatedPoints.length,
          candidatesAfterFiltering: filteredPoints.length,
          rejectionReasons,
          suggestions
        };
        
        console.log(`⚠️ No trigger points generated. Reasons: ${rejectionReasons.join('; ')}`);
      }
      
      return {
        triggerPoints: filteredPoints,
        boundary,
        context,
        processingTime,
        metadata
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
    
    try {
      // ESTRATÉGIA INTELIGENTE: Usar funções existentes para buscar ruas reais no OSM
      
      // 1. USAR função existente para buscar ruas no OSM (50m radius para fallback)
      let streets: any[] = [];
      
      // Verificar se temos dados consolidados do boundary
      if (boundary?.streets && boundary.streets.length > 0) {
        console.log(`✅ Using consolidated streets from boundary: ${boundary.streets.length} streets`);
        console.log(`🚀 CONSOLIDATION BENEFIT: Avoided OSM request for ${boundary.streets.length} streets`);
        streets = boundary.streets;
      } else {
        try {
          streets = await this.streetAnalyzer.getStreetsFromOSMOptimized(centerPoint, 50, boundary);
        } catch (error) {
          console.warn('⚠️ OSM query failed in intelligent fallback, using fallback without street validation:', error);
          streets = []; // Usar array vazio para evitar nova tentativa
        }
      }
      
      if (streets && streets.length > 0) {
        // 2. USAR função existente para filtrar ruas acessíveis
        const accessibleStreets = streets.filter(street => 
          this.streetAnalyzer.isStreetAccessiblePublic(street, context)
        );
        
        if (accessibleStreets.length > 0) {
          // 3. NOVO: Analisar estrutura do quarteirão para identificar front/side/back streets
          const buildings = boundary?.buildings || [];
          const blockAnalysis = this.streetAnalyzer.analyzeBlockStructure(
            centerPoint,
            accessibleStreets,
            buildings,
            boundary
          );
          
          // 4. Filtrar apenas front/side streets (sem buildings bloqueando)
          const validStreets = blockAnalysis
            .filter(result => result.classification === 'front' || result.classification === 'side')
            .map(result => result.street);
          
          if (validStreets.length === 0) {
            console.log('⚠️ No front/side streets found (all blocked by buildings), using closest street anyway');
            // Fallback: usar a rua mais próxima mesmo que seja back
            const closestResult = blockAnalysis[0];
            if (closestResult) {
              return this.createTPFromStreet(closestResult.street, centerPoint, context, boundary);
            }
          }
          
          // 5. Encontrar a melhor rua entre front/side streets
          const bestStreet = this.findBestStreetForFallback(validStreets, centerPoint);
          
          if (bestStreet) {
            return this.createTPFromStreet(bestStreet, centerPoint, context, boundary);
          }
        }
      }
      
      // 🔴 REMOVED: Google Roads fallback (M0 - economia $10/1000 POIs)
      // console.log('🔄 OSM found no streets, trying Google Roads fallback...');
      // return this.createGoogleRoadsFallback(poiData, context, boundary);

      // ✅ NEW: Fallback direto para TP direcional estimado
      console.log('🔄 OSM found no streets, using directional TP fallback...');
      return this.createMinimalDirectionalTP(poiData, context, boundary);
      
    } catch (error) {
      console.warn('Intelligent fallback failed:', error);
      return this.createMinimalDirectionalTP(poiData, context, boundary);
    }
  }

  /**
   * Cria trigger point a partir de uma rua
   */
  private createTPFromStreet(
    street: StreetData,
    centerPoint: { lat: number; lng: number },
    context: GeographicContext,
    boundary?: BoundaryData
  ): TriggerPoint[] {
    const streetPoint = street.coordinates[0];
    const distance = calculateDistance(centerPoint, streetPoint);
    
    // Usar boundary mais próximo para bearing, não centro
    const closestBoundaryPoint = boundary?.coordinates 
      ? findClosestPointOnBoundary(streetPoint, boundary.coordinates)
      : { lat: centerPoint.lat, lng: centerPoint.lng };
    
    const triggerPoint: TriggerPoint = {
      id: 'intelligent_fallback_1',
      location: streetPoint,
      radius: 20, // Range fixo de 20m
      expectedBearing: calculateBearing(streetPoint, { lat: closestBoundaryPoint.lat, lng: closestBoundaryPoint.lng }),
      bearingThreshold: 60,
      type: 'primary',
      priority: 1,
      confidence: 0.8,
      quality: 0.8,
      street: {
        id: street.id,
        type: street.type,
        coordinates: street.coordinates,
        accessibility: street.accessibility,
        confidence: street.confidence
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
   * 🔴 REMOVED: createGoogleRoadsFallback() - M0
   * Manter código comentado para possível re-ativação manual futura
   */
  // private async createGoogleRoadsFallback(poiData: POIData, context: GeographicContext, boundary?: BoundaryData): Promise<TriggerPoint[]> {
  //   console.log('🔍 Finding nearest street using Google Roads API (fallback approach)...');
  //   
  //   const centerPoint = boundary?.center || poiData.location;
  //   
  //   try {
  //     const roadsResponse = await this.googleAPIs.getNearestRoads([centerPoint]);
  //     
  //     if (roadsResponse.success && roadsResponse.data?.snappedPoints && roadsResponse.data.snappedPoints.length > 0) {
  //       const snappedPoint = roadsResponse.data.snappedPoints[0];
  //       const streetLocation = {
  //         lat: snappedPoint.location.latitude,
  //         lng: snappedPoint.location.longitude
  //       };
  //       
  //       const distance = calculateDistance(centerPoint, streetLocation);
  //       console.log(`✅ Found nearest street at ${distance.toFixed(0)}m from POI (using ${boundary ? 'boundary.center' : 'poiData.location'})`);
  //       
  //       // Criar APENAS 1 TP simples
  //       const triggerPoint: TriggerPoint = {
  //         id: 'google_fallback_1',
  //         location: streetLocation,
  //         radius: 30, // Raio generoso para compensar imprecisão
  //         expectedBearing: calculateBearing(streetLocation, centerPoint),
  //         bearingThreshold: 90, // Muito tolerante
  //         type: 'primary',
  //         priority: 1,
  //         confidence: 0.7, // Boa confiança - Google Roads é preciso
  //         quality: 0.7,
  //         street: {
  //           id: snappedPoint.placeId || 'google_road',
  //           type: 'primary',
  //           coordinates: [streetLocation],
  //           accessibility: 'public',
  //           confidence: 0.8
  //         },
  //         distance,
  //         generationMethod: 'google_apis',
  //         contextData: context,
  //         createdAt: new Date().toISOString(),
  //         updatedAt: new Date().toISOString()
  //       };
  //       
  //       console.log(`✅ Created 1 GOOGLE FALLBACK TP at ${streetLocation.lat.toFixed(6)}, ${streetLocation.lng.toFixed(6)} (${distance.toFixed(0)}m from POI)`);
  //       return [triggerPoint];
  //       
  //     } else {
  //       console.warn('⚠️ Google Roads failed, creating minimal directional TP');
  //       return this.createMinimalDirectionalTP(poiData, context, boundary);
  //     }
  //     
  //   } catch (error) {
  //     console.warn('Google Roads fallback failed:', error);
  //     return this.createMinimalDirectionalTP(poiData, context, boundary);
  //   }
  // }

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
   * Gera trigger points de fallback INTELIGENTE - apenas 1-2 TPs na rua mais próxima (OTIMIZADO)
   */
  private async generateFallbackTriggerPoints(
    poiData: POIData, 
    boundary: any, 
    context: any,
    existingStreets?: any[]
  ): Promise<TriggerPoint[]> {
    console.log('🎯 Generating SMART fallback trigger points for small/unfound POI...');
    
    // USAR BOUNDARY.CENTER em vez de poiData.location
    const centerPoint = boundary?.center || poiData.location;
    console.log(`📍 POI location: ${poiData.name} at ${centerPoint.lat.toFixed(6)}, ${centerPoint.lng.toFixed(6)} (${boundary ? 'boundary.center' : 'poiData.location'})`);
    
    try {
      // OTIMIZADO: Usar dados já obtidos do boundary detection
      let streets = existingStreets;
      if (!streets || streets.length === 0) {
        // Verificar se temos dados consolidados do boundary
        if (boundary?.streets && boundary.streets.length > 0) {
          console.log(`✅ Using consolidated streets from boundary: ${boundary.streets.length} streets`);
          console.log(`🚀 CONSOLIDATION BENEFIT: Avoided OSM request in fallback for ${boundary.streets.length} streets`);
          streets = boundary.streets;
        } else {
          console.log('🔍 No existing streets data, using boundary data instead of OSM query...');
          // Usar dados do boundary já obtidos em vez de fazer nova consulta OSM
          streets = this.createStreetsFromBoundaryData(boundary, centerPoint);
        }
      }
      
      // Estratégia 1: Encontrar a rua mais próxima do POI usando dados já obtidos
      const nearestStreet = this.findNearestStreetToPOIFromData(centerPoint, streets || []);
      
      if (nearestStreet && nearestStreet.coordinates.length > 0) {
        console.log(`🛣️ Found nearest street: ${nearestStreet.id || 'unnamed'}`);
        return this.createMinimalStreetTriggerPoints(poiData, nearestStreet, context, boundary);
      }
      
      // Estratégia 2: Se não encontrou rua, criar apenas 1 TP na direção da rua principal
      console.log('⚠️ No nearby street found, creating single directional TP');
      return await this.createSingleDirectionalTP(poiData, context, boundary, streets || []);
      
    } catch (error) {
      console.warn('Smart fallback failed, using minimal fallback:', error);
      return await this.createSingleDirectionalTP(poiData, context, boundary);
    }
  }

  /**
   * Cria 1 TP direcional simples (fallback) - OTIMIZADO: usa dados OSM já obtidos
   */
  private async createSingleDirectionalTP(poiData: POIData, context: any, boundary?: BoundaryData, existingStreets?: any[]): Promise<TriggerPoint[]> {
    console.log('🎯 Creating single directional TP (fallback) - USING EXISTING OSM DATA');
    
    // USAR BOUNDARY.CENTER em vez de poiData.location
    const centerPoint = boundary?.center || poiData.location;
    console.log(`📍 Using ${boundary ? 'boundary.center' : 'poiData.location'} for TP calculation`);
    
    // OTIMIZADO: Usar dados de ruas já obtidos se disponíveis
    let streets = existingStreets;
    if (!streets || streets.length === 0) {
      // Verificar se temos dados consolidados do boundary
      if (boundary?.streets && boundary.streets.length > 0) {
        console.log(`✅ Using consolidated streets from boundary: ${boundary.streets.length} streets`);
        console.log(`🚀 CONSOLIDATION BENEFIT: Avoided OSM request for ${boundary.streets.length} streets`);
        streets = boundary.streets;
      } else {
        console.log('🔍 No existing streets data, using fallback without street validation...');
        streets = []; // Não fazer nova consulta OSM para evitar rate limiting
      }
    } else {
      console.log(`✅ Using existing streets data: ${streets.length} streets available`);
    }
    
    // Tentar múltiplas direções até encontrar uma rua
    const directions = [0, 45, 90, 135, 180, 225, 270, 315]; // 8 direções
    const distance = 50; // metros
    
    for (const direction of directions) {
      const point = this.calculatePointAtDistance(centerPoint, distance, direction);
      
      // OTIMIZADO: Validar usando dados já obtidos
      const isOnStreet = this.validatePointOnStreetFromData(point, streets);
      const isOutsideBoundary = boundary ? this.isPointOutsideBoundary(point, boundary) : true;
      
      if (isOnStreet && isOutsideBoundary) {
        console.log(`✅ Found valid street location at direction ${direction}° (outside boundary)`);
        return this.createTPAtPoint(point, direction, distance, poiData, context, boundary);
      } else {
        if (!isOnStreet) {
          console.log(`❌ Direction ${direction}° not on street, trying next...`);
        } else if (!isOutsideBoundary) {
          console.log(`❌ Direction ${direction}° inside boundary, trying next...`);
        }
      }
    }
    
    // Se nenhuma direção funcionou, usar a direção original mas com aviso
    console.warn('⚠️ No street found in any direction, using original fallback with WARNING');
    const point = this.calculatePointAtDistance(centerPoint, distance, 180);
    return this.createTPAtPoint(point, 180, distance, poiData, context, boundary);
  }
  
  /**
   * NOVA: Valida se um ponto está em uma rua usando dados já obtidos (OTIMIZADO)
   */
  private validatePointOnStreetFromData(point: { lat: number; lng: number }, streets: any[]): boolean {
    if (!streets || streets.length === 0) {
      return false;
    }
    
    // Verificar se o ponto está próximo a alguma rua (20m radius)
    const radius = 20; // metros
    
    for (const street of streets) {
      if (!street.coordinates || street.coordinates.length === 0) continue;
      
      // Verificar se o ponto está próximo a qualquer coordenada da rua
      for (const coord of street.coordinates) {
        const distance = calculateDistance(point, coord);
        if (distance <= radius) {
          // Verificar se é uma rua válida
          const tags = street.tags || {};
          const highway = (tags as any).highway;
          
          const validHighwayTypes = [
            'primary', 'secondary', 'tertiary', 'residential', 'unclassified',
            'trunk', 'motorway', 'primary_link', 'secondary_link', 'tertiary_link',
            'living_street', 'pedestrian', 'service', 'track'
          ];
          
          if (validHighwayTypes.includes(highway)) {
            return true;
          }
        }
      }
    }
    
    return false;
  }
  
  /**
   * Valida se um ponto está em uma rua real (CORRIGIDO: validação mais rigorosa)
   */
  private async validatePointOnStreet(point: { lat: number; lng: number }, boundary?: BoundaryData): Promise<boolean> {
    try {
      // Buscar ruas próximas ao ponto
      const streets = await this.streetAnalyzer.getStreetsFromOSMOptimized(point, 20, boundary); // 20m radius
      
      if (!streets || streets.length === 0) {
        console.log(`❌ No streets found near point ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`);
        return false;
      }
      
      // CORRIGIDO: Validar se são ruas reais (highway tags)
      const realStreets = streets.filter(street => {
        const tags = street.tags || {};
        const highway = (tags as any).highway;
        
        // Aceitar apenas tipos de rua válidos
        const validHighwayTypes = [
          'primary', 'secondary', 'tertiary', 'residential', 'unclassified',
          'trunk', 'motorway', 'primary_link', 'secondary_link', 'tertiary_link',
          'living_street', 'pedestrian', 'service', 'track'
        ];
        
        const isValidHighway = validHighwayTypes.includes(highway);
        
        if (!isValidHighway) {
          console.log(`❌ Invalid street type: ${highway} (${(tags as any).name || 'unnamed'})`);
        } else {
          console.log(`✅ Valid street: ${highway} (${(tags as any).name || 'unnamed'})`);
        }
        
        return isValidHighway;
      });
      
      const hasValidStreets = realStreets.length > 0;
      console.log(`🛣️ Street validation: ${realStreets.length}/${streets.length} valid streets found`);
      
      return hasValidStreets;
    } catch (error) {
      console.warn('Error validating point on street:', error);
      return false;
    }
  }
  
  /**
   * Verifica se um ponto está fora do boundary
   */
  private isPointOutsideBoundary(point: { lat: number; lng: number }, boundary: BoundaryData): boolean {
    // Usar a função existente de cálculos
    const { isPointInPolygon } = require('../utils/calculations');
    const isInside = isPointInPolygon(point, boundary.coordinates);
    return !isInside;
  }

  /**
   * Cria TP em um ponto específico
   */
  private createTPAtPoint(point: { lat: number; lng: number }, direction: number, distance: number, poiData: POIData, context: any, boundary?: BoundaryData): TriggerPoint[] {
    
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
    
    console.log(`✅ Created 1 VALIDATED DIRECTIONAL TP at ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)} (${distance}m from ${boundary ? 'boundary.center' : 'POI'}, direction: ${direction}°)`);
    return [triggerPoint];
  }

  /**
   * NOVA: Criar dados de ruas usando informações já obtidas do boundary
   */
  private createStreetsFromBoundaryData(boundary: any, centerPoint: { lat: number; lng: number }): any[] {
    // Verificar se temos dados de rua no boundary
    const streetName = boundary?.street || boundary?.primaryStreet;
    
    if (!boundary || !streetName) {
      console.log('🔍 No boundary street data available, creating minimal street data...');
      return [];
    }

    console.log(`✅ Using street from boundary: ${streetName}`);
    
    // Criar dados de rua baseados no boundary e rua principal
    const streetData = {
      id: `boundary_street_${streetName.toLowerCase().replace(/\s+/g, '_')}`,
      name: streetName,
      type: 'primary', // Assumir que é uma rua principal
      coordinates: boundary.coordinates ? boundary.coordinates.slice(0, 2) : [centerPoint], // Usar primeiras coordenadas do boundary
      accessibility: 'public',
      confidence: 0.8,
      tags: {
        highway: 'primary',
        name: streetName
      }
    };

    console.log(`✅ Created street data from boundary: ${streetData.name} (${streetData.coordinates.length} coordinates)`);
    return [streetData];
  }

  /**
   * NOVA: Encontrar a rua mais próxima do POI usando dados já obtidos (OTIMIZADO)
   */
  private findNearestStreetToPOIFromData(poiLocation: { lat: number; lng: number }, streets: any[]): any | null {
    if (!streets || streets.length === 0) {
      return null;
    }
    
    console.log(`🔍 Analyzing ${streets.length} streets found by OSM...`);
    
    let nearestStreet = null;
    let minDistance = Infinity;
    const streetDistances: Array<{name: string, distance: number, type: string, visibility: string}> = [];
    
    for (const street of streets) {
      if (!street.coordinates || street.coordinates.length === 0) continue;
      
      // Calcular distância do POI para a rua (usar primeira coordenada como referência)
      const streetPoint = street.coordinates[0];
      const distance = calculateDistance(poiLocation, streetPoint);
      
      const streetName = street.name || street.id || 'unnamed';
      const streetType = (street.tags as any)?.highway || 'unknown';
      
      // Analisar visibilidade básica
      let visibility = '✅ Good';
      
      // Verificar se está em túnel ou coberto
      if ((street.tags as any)?.tunnel === 'yes' || (street.tags as any)?.covered === 'yes') {
        visibility = '🚫 Blocked (tunnel/covered)';
      }
      // Verificar se está em viaduto elevado
      else if ((street.tags as any)?.bridge === 'yes' || ((street.tags as any)?.layer && parseInt((street.tags as any).layer) > 0)) {
        visibility = '⚠️ Elevated (bridge/viaduct)';
      }
      // Verificar se é rua muito estreita
      else if ((street.tags as any)?.width && parseInt((street.tags as any).width) < 3) {
        visibility = '⚠️ Narrow street';
      }
      // Verificar se tem obstruções
      else if ((street.tags as any)?.barrier === 'yes' || (street.tags as any)?.access === 'no') {
        visibility = '🚫 Blocked (barrier/no access)';
      }
      
      streetDistances.push({
        name: streetName,
        distance: distance,
        type: streetType,
        visibility: visibility
      });
      
      if (distance < minDistance) {
        minDistance = distance;
        nearestStreet = street;
      }
    }
    
    // Mostrar todas as ruas encontradas ordenadas por distância
    streetDistances.sort((a, b) => a.distance - b.distance);
    console.log(`📍 All streets found (sorted by distance):`);
    streetDistances.forEach((street, index) => {
      const marker = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '📍';
      console.log(`  ${marker} ${street.name} (${street.type}) - ${street.distance.toFixed(0)}m - ${street.visibility}`);
    });
    
    if (nearestStreet) {
      console.log(`✅ Selected nearest road: ${nearestStreet.name || nearestStreet.id} (${(nearestStreet.tags as any)?.highway}) at ${minDistance.toFixed(0)}m`);
    }
    
    return nearestStreet;
  }

  /**
   * NOVA: Encontrar a rua mais próxima do POI usando OSM (sem Google Roads API)
   */
  private async findNearestStreetToPOI(poiLocation: { lat: number; lng: number }): Promise<any | null> {
    try {
      console.log('🔍 Searching for nearest street using OSM...');
      
      // Query OSM para buscar ruas próximas ao POI
      const query = `
[out:json][timeout:15];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$"](around:200,${poiLocation.lat},${poiLocation.lng});
);
out geom tags;
`;
      
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query,
        headers: { 'Content-Type': 'text/plain' }
      });
      
      if (response.ok) {
        const data = await response.json();
        const roads = data.elements || [];
        
        if (roads.length > 0) {
          // Pegar a rua mais próxima
          const nearestRoad = roads[0];
          
          // Converter geometria OSM para formato esperado
          const coordinates = nearestRoad.geometry ? nearestRoad.geometry.map((point: any) => ({
            lat: point.lat,
            lng: point.lon
          })) : [];
          
          console.log(`✅ Found nearest road: ${nearestRoad.tags?.name || 'unnamed'} (${nearestRoad.tags?.highway})`);
          
          return {
            id: nearestRoad.id.toString(),
            type: nearestRoad.tags?.highway || 'road',
            coordinates,
            accessibility: 'public',
            confidence: 0.8
          };
        }
      }
      
      console.warn('No roads found near POI via OSM');
      return null;
      
    } catch (error) {
      console.warn('Error finding nearest street via OSM:', error);
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
    const distanceToPOI = calculateDistance(centerPoint, streetPoint); // ✅ DRY: usar função importada
    
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

  // ✅ DRY: calculateDistance removido - usar função importada de utils/calculations.ts
  
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
   * Valida se os candidatos estão realmente em ruas (NOVO PASSO 5)
   */
  private async validateCandidatesOnStreets(
    candidates: TriggerPointCandidate[], 
    accessibleStreets: StreetData[]
  ): Promise<TriggerPointCandidate[]> {
    console.log(`🛣️ Validating ${candidates.length} candidates are on ${accessibleStreets.length} streets...`);
    
    const validatedCandidates: TriggerPointCandidate[] = [];
    
    for (const candidate of candidates) {
      const isValidOnStreet = this.isCandidateOnStreet(candidate, accessibleStreets);
      
      if (isValidOnStreet) {
        validatedCandidates.push(candidate);
        // console.log(`✅ Candidate validated on street: ${candidate.street.name || candidate.street.id}`);
      } else {
        //console.log(`❌ Candidate rejected: not on any street (${candidate.location.lat.toFixed(6)}, ${candidate.location.lng.toFixed(6)})`);
      }
    }
    
    console.log(`🛣️ Street validation complete: ${validatedCandidates.length}/${candidates.length} candidates on streets`);
    return validatedCandidates;
  }
  
  /**
   * Verifica se um candidato está em uma das ruas acessíveis
   */
  private isCandidateOnStreet(candidate: TriggerPointCandidate, accessibleStreets: StreetData[]): boolean {
    const candidateLocation = candidate.location;
    const maxDistanceFromStreet = TRIGGER_POINTS_CONSTANTS.distances.maxDistanceFromStreet;
    
    for (const street of accessibleStreets) {
      // Verificar se o candidato está próximo a qualquer ponto da rua
      for (const streetPoint of street.coordinates) {
        const distance = calculateDistance(candidateLocation, streetPoint);
        
        if (distance <= maxDistanceFromStreet) {
          return true;
        }
      }
    }
    
    return false;
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
  private calculateDynamicTPLimit(boundary: BoundaryData, context: GeographicContext, searchRadius?: number): number {
    // NOVO: Calcular baseado em área de cobertura real
    const radius = searchRadius || boundary.classification?.searchRadius || 300;
    const coverageArea = Math.PI * radius * radius; // Área em m²
    
    // Calcular limites dinâmicos baseados em área
    // 1 TP por 0.5km² (mínimo) a 1 TP por 0.1km² (máximo)
    const minTPs = Math.max(3, Math.floor(coverageArea / 500000)); // 1 TP por 0.5km²
    const maxTPs = Math.min(200, Math.floor(coverageArea / 100000)); // 1 TP por 0.1km²
    
    // Usar configuração do grupo se disponível, senão usar cálculo dinâmico
    if (boundary.classification?.maxTriggerPoints) {
      const groupMax = boundary.classification.maxTriggerPoints;
      // Combinar: usar o menor entre grupo e cálculo dinâmico
      const finalMax = Math.min(groupMax, maxTPs);
      const finalMin = Math.min(3, minTPs);
      
      console.log(`📊 Dynamic TP limit: ${finalMin}-${finalMax} (coverage: ${(coverageArea / 1000000).toFixed(2)}km², group max: ${groupMax})`);
      return Math.max(finalMin, Math.min(finalMax, groupMax));
    }
    
    console.log(`📊 Dynamic TP limit: ${minTPs}-${maxTPs} (coverage: ${(coverageArea / 1000000).toFixed(2)}km²)`);
    return Math.max(minTPs, Math.min(maxTPs, 200)); // Limitar máximo a 200
  }
  
  private calculateDynamicTPLimitOld(boundary: BoundaryData, context: GeographicContext): number {
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

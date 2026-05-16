// Core Trigger Point Predictor - Orquestrador principal do sistema

import { GeographicContextAnalyzer } from './geographic-analyzer';
import { BoundaryDetector } from './boundary-detector';
import { StreetAnalyzer } from '../analyzers/street-analyzer';
import { OptimalPointCalculator } from '../analyzers/point-calculator';
import { TriggerPointValidator } from '../analyzers/validator';
import { GoogleAPIsService } from '../services/google-apis.service';
import { POIData, TriggerPoint, TriggerPointGenerationOptions, TriggerPointPredictionResult, BoundaryData, GeographicContext, TriggerPointCandidate, StreetData } from '../types/interfaces';
import { calculateBearing, calculateDistance, findClosestPointOnBoundary } from '../utils/calculations';
import { loadTriggerPointsConfig, TriggerPointsConfig, TRIGGER_POINTS_CONSTANTS, POIGroup } from '../config/trigger-points-config';

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
      const boundaryResult = await this.boundaryDetector.detectBoundary(poiData);
      if (!boundaryResult.success || !boundaryResult.data) {
        throw new Error(`Boundary detection failed: ${boundaryResult.error}`);
      }
      const boundary = boundaryResult.data;

      // Enriquecer boundary com pontos de entrada OSM (entrance=main/yes) do banco local.
      // Usado como bearing target prioritário em point-calculator.ts.
      this.attachEntrancesFromLocalOSM(boundary);

      // ✅ REGRA: Se boundary é manual (ou manual_drawing), ignorar e não processar
      // POIs manuais não devem ter TPs recalculados automaticamente
      if (boundary.source === 'manual' || boundary.source === 'manual_drawing') {
        
        const processingTime = Date.now() - startTime;
        return {
          triggerPoints: [],
          boundary,
          context: await this.geographicAnalyzer.analyzeGeographicContext(poiData, boundary),
          processingTime,
          metadata: {
            boundarySource: boundary.source,
            boundaryConfidence: boundary.confidence,
            streetCount: 0,
            optimalPointsFound: 0,
            validatedPoints: 0,
            finalPoints: 0,
            fallbackUsed: false,
            searchRadius: 0,
            elevationAnalysis: null,
            skipped: true,
            skipReason: 'manual_boundary'
          }
        };
      }
      
      // 2. Criar contexto geográfico a partir do boundary (já tem densidade calculada corretamente)
      // ✅ NOTA: Densidade urbana e classificação já foram calculadas dentro de detectBoundary
      //    usando dados OSM reais. Aqui apenas criamos o contexto completo para etapas posteriores.
      const context = await this.geographicAnalyzer.analyzeGeographicContext(poiData, boundary);

      // 2.5 Visibility-driven mode — default ON.
      // Computa o "fan" de visibilidade real (ray-cast 2.5D) e o anexa ao
      // boundary. Substitui o searchRadius categórico nas etapas seguintes:
      // TPs ficam onde o POI é fisicamente visível.
      //
      // Opt-out: passar `options.useVisibilityMap === false` explicitamente.
      // Fallback: se attachVisibilityFan falhar internamente, o pipeline volta
      // ao caminho categórico (boundary.visibilityFan permanece undefined).
      if (options.useVisibilityMap !== false) {
        // Camada 1 — Building lookup. Pra POIs storefront (museus, lojas,
        // restaurantes dentro de prédios), o OSM frequentemente põe height=0
        // no POI semântico. Detecta o prédio que CONTÉM o POI e usa sua altura
        // como altura efetiva pro ray-cast. Sem isso o fan colapsa.
        this.useContainingBuildingHeight(boundary);
        await this.attachVisibilityFan(poiData, boundary, options.visibilityMaxHorizonM);
      }
      
      // NOVA LÓGICA: Se boundary é estimado (POI não encontrado), usar fallback SUPER SIMPLES
      if (boundary.source === 'estimated') {
        
        const simpleFallbackPoints = await this.generateRecoveryFallbackTriggerPoints(poiData, context, boundary);
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
      const streetAnalysisResult = await this.streetAnalyzer.findAccessibleStreetsWithMetadata(poiData, boundary, context);
      const accessibleStreets = streetAnalysisResult.streets;
      
      if (accessibleStreets.length === 0) {
        console.error('❌ ========================================');
        console.error('❌ [CRITICAL] No accessible streets found, using fallback strategy');
        console.error(`   → boundary.streets: ${boundary.streets?.length || 0} consolidated streets`);
        console.error(`   → searchRadius: ${streetAnalysisResult.searchRadius}m`);
        console.error('❌ ========================================');
        // ✅ Use the robust fallback strategy that guarantees at least one point
        const fallbackPoints = await this.generateRecoveryFallbackTriggerPoints(poiData, context, boundary);

        // Issue 2.4 — Mesmo sem ruas acessíveis, se temos boundary válido,
        // emite o geofence TP (cobre o caso do usuário caminhando que entra
        // pelo polígono sem passar por nenhum TP arrival na rua).
        const geofenceTP = this.buildGeofenceTriggerPoint(poiData, boundary, context);
        if (geofenceTP) fallbackPoints.unshift(geofenceTP);

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
      
      // 3.5. Analisar estrutura do quarteirão (front/side/back) para filtrar
      // ruas bloqueadas por buildings.
      //
      // ⚠️ PULAR quando o visibility fan está presente: o fan já avaliou
      // visibilidade físicamente via ray-cast 2.5D (alturas dos prédios +
      // SRTM). Reaplicar a heurística categórica de "distância < 50m = front"
      // descartaria ruas distantes mas visíveis (caso da Queensboro Bridge).
      let streetsForOptimalPoints = accessibleStreets;
      const fanIsActive = !!boundary.visibilityFan?.polygons?.length;
      if (fanIsActive) {
        console.log(`👁️ Skipping block structure analysis: visibility fan is the source of truth`);
      } else if (boundary.buildings && boundary.buildings.length > 0) {
        const blockAnalysis = this.streetAnalyzer.analyzeBlockStructure(
          boundary.center,
          accessibleStreets,
          boundary.buildings,
          boundary
        );
        
        // ✅ LÓGICA CORRIGIDA: Para POIs HIGH, filtrar apenas por buildings bloqueando (não por classificação)
        // Para outros POIs, usar classificação front/side
        const isHighElevationPOI = boundary.classification?.group === POIGroup.HIGH;
        
        let validStreets: StreetData[];
        if (isHighElevationPOI) {
          // 🏔️ POI HIGH: Filtrar apenas ruas SEM buildings bloqueando (independente da distância)
          // Para POIs altos, a visibilidade não depende de estar "na frente", apenas de não ter obstruções
          validStreets = blockAnalysis
            .filter(result => !result.hasBuildingsBlocking) // Apenas ruas sem buildings bloqueando
            .map(result => result.street);
        } else {
          // 🏙️ POIs normais: Filtrar front/side streets (sem buildings bloqueando)
          validStreets = blockAnalysis
            .filter(result => result.classification === 'front' || result.classification === 'side')
            .map(result => result.street);
        }
        
        if (validStreets.length > 0) {
          const blockedCount = accessibleStreets.length - validStreets.length;
          if (isHighElevationPOI) {
          } else {
          }
          streetsForOptimalPoints = validStreets;
        } else {
          // Continuar com todas as ruas, mas a validação de visibilidade depois vai filtrar
        }
      }
      
      // 4. Cálculo de pontos ótimos
      // ✅ Context já tem densidade calculada corretamente a partir dos dados OSM
      // ✅ Usar apenas ruas front/side (sem buildings bloqueando)
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
      const maxTPs = options.maxTriggerPoints || this.calculateDynamicTPLimit(boundary, context, streetAnalysisResult.searchRadius);
      
      // 🎯 NOVO: Usar configuração do grupo se disponível, senão calcular
      let minDistance: number;
      if (boundary.classification?.minDistanceBetweenTPs) {
        minDistance = boundary.classification.minDistanceBetweenTPs;
      } else {
        minDistance = this.calculateMinDistance(context, boundary);
      }
      
      const validatedPoints = await this.validator.validateAndRankPoints(
        streetValidatedCandidates,
        poiData,
        context,
        boundary,
        maxTPs,
        minDistance,
        [],
        {
          simulateApproach: options.simulateApproach,
          validateCorridor: options.validateCorridor,
        }
      );
      
      // 7. Aplicar opções de filtro adicionais (se houver)
      const filteredPoints = this.applyOptions(validatedPoints, options);
      
      // 8. Otimização já foi feita em selectTriggerPointsWithMinDistance

      // 8.5. KISS: garantir 1 TP "frontal" na rua de endereço do POI quando ele
      // está populado no OSM. Crítico pra storefront POIs (lojas, museus,
      // restaurantes) cujo fan de visibilidade colapsa por estarem dentro de
      // prédios grandes.
      const frontalTP = this.buildFrontalArrivalTP(poiData, boundary, context, accessibleStreets, filteredPoints);
      if (frontalTP) {
        filteredPoints.push(frontalTP);
      }

      // 9. Geofence TP (issue 2.4): se o POI tem boundary válido, gera 1 TP
      //    de cobertura por polígono. Usuários andando que entram pela porta
      //    do museu / lateral do parque disparam por aqui, sem depender de
      //    passar por um TP arrival na rua.
      const geofenceTP = this.buildGeofenceTriggerPoint(poiData, boundary, context);
      if (geofenceTP) {
        filteredPoints.unshift(geofenceTP); // prioridade 1 (cobertura primária)
      }

      const processingTime = Date.now() - startTime;

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
  private async generateRecoveryFallbackTriggerPoints(
    poiData: POIData,
    context: GeographicContext,
    boundary?: BoundaryData
  ): Promise<TriggerPoint[]> {
    
    // USAR BOUNDARY.CENTER em vez de poiData.location
    const centerPoint = boundary?.center || poiData.location;
    
    try {
      // ESTRATÉGIA INTELIGENTE: Usar funções existentes para buscar ruas reais no OSM
      
      // 1. USAR função existente para buscar ruas no OSM (50m radius para fallback)
      let streets: any[] = [];
      console.log(`🔍 [FALLBACK] Starting intelligent fallback for POI: ${poiData.name}`);
      
      // Verificar se temos dados consolidados do boundary
      if (boundary?.streets && boundary.streets.length > 0) {
        streets = boundary.streets;
        console.log(`✅ [FALLBACK] Using ${streets.length} consolidated streets from boundary`);
      } else {
        try {
          console.log(`🌐 [FALLBACK] Querying OSM for streets around center point...`);
          streets = await this.streetAnalyzer.getStreetsFromOSMOptimized(centerPoint, 50, boundary);
          console.log(`✅ [FALLBACK] Found ${streets.length} streets from OSM`);
        } catch (error) {
          console.warn('⚠️ [FALLBACK] OSM query failed in intelligent fallback, using minimal fallback:', error);
          streets = []; // Usar array vazio para evitar nova tentativa
        }
      }
      
      if (streets && streets.length > 0) {
        // 2. USAR função existente para filtrar ruas acessíveis
        const accessibleStreets = streets.filter(street => 
          this.streetAnalyzer.isStreetAccessiblePublic(street, context)
        );
        console.log(`✅ [FALLBACK] ${accessibleStreets.length}/${streets.length} streets are accessible`);
        
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
          
          console.log(`✅ [FALLBACK] Block analysis: ${validStreets.length} front/side streets found`);
          
          if (validStreets.length === 0) {
            // Fallback: usar a rua mais próxima mesmo que seja back
            const closestResult = blockAnalysis[0];
            if (closestResult) {
              console.log(`📍 [FALLBACK] Using closest street (even if back)`);
              return this.createTPFromStreet(closestResult.street, centerPoint, context, boundary);
            }
          }
          
          // 5. Encontrar a melhor rua entre front/side streets
          const bestStreet = this.findBestStreetForFallback(validStreets, centerPoint);
          
          if (bestStreet) {
            console.log(`📍 [FALLBACK] Using best identified street: ${bestStreet.name}`);
            return this.createTPFromStreet(bestStreet, centerPoint, context, boundary);
          }
        }
      }
      
      // 🔴 REMOVED: Google Roads fallback (M0 - economia $10/1000 POIs)
      // console.log('🔄 OSM found no streets, trying Google Roads fallback...');
      // return this.createGoogleRoadsFallback(poiData, context, boundary);

      // ✅ NEW: Fallback direto para TP direcional estimado
      console.log('⚠️ [FALLBACK] No suitable streets found, using minimal directional fallback');
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
      bearingThreshold: TRIGGER_POINTS_CONSTANTS.triggerPoint.fallbackBearingThreshold,
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
      generationMethod: 'fallback_recovery',
      contextData: context,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
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
   * Cria 1 TP mínimo quando nem Google Roads funciona
   */
  private createMinimalDirectionalTP(poiData: POIData, context: GeographicContext, boundary?: BoundaryData): TriggerPoint[] {
    
    // USAR BOUNDARY.CENTER em vez de poiData.location
    const centerPoint = boundary?.center || poiData.location;
    
    const direction = 180; // Sul (direção comum de aproximação)
    const distance = 30; // Muito próximo
    const point = this.calculatePointAtDistance(centerPoint, distance, direction);
    
    const triggerPoint: TriggerPoint = {
      id: 'minimal_fallback_1',
      location: point,
      radius: 35,
      expectedBearing: 0, // Norte (olhando para o POI)
      bearingThreshold: TRIGGER_POINTS_CONSTANTS.triggerPoint.fallbackBearingThreshold,
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
      generationMethod: 'fallback_recovery',
      contextData: context,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

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
    
    // USAR BOUNDARY.CENTER em vez de poiData.location
    const centerPoint = boundary?.center || poiData.location;
    
    try {
      // OTIMIZADO: Usar dados já obtidos do boundary detection
      let streets = existingStreets;
      if (!streets || streets.length === 0) {
        // Verificar se temos dados consolidados do boundary
        if (boundary?.streets && boundary.streets.length > 0) {
          streets = boundary.streets;
        } else {
          // Usar dados do boundary já obtidos em vez de fazer nova consulta OSM
          streets = this.createStreetsFromBoundaryData(boundary, centerPoint);
        }
      }
      
      // Estratégia 1: Encontrar a rua mais próxima do POI usando dados já obtidos
      const nearestStreet = this.findNearestStreetToPOIFromData(centerPoint, streets || []);
      
      if (nearestStreet && nearestStreet.coordinates.length > 0) {
        return this.createMinimalStreetTriggerPoints(poiData, nearestStreet, context, boundary);
      }
      
      // Estratégia 2: Se não encontrou rua, criar apenas 1 TP na direção da rua principal
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
    
    // USAR BOUNDARY.CENTER em vez de poiData.location
    const centerPoint = boundary?.center || poiData.location;
    
    // OTIMIZADO: Usar dados de ruas já obtidos se disponíveis
    let streets = existingStreets;
    if (!streets || streets.length === 0) {
      // Verificar se temos dados consolidados do boundary
      if (boundary?.streets && boundary.streets.length > 0) {
        streets = boundary.streets;
      } else {
        console.log('🔍 No existing streets data, using fallback without street validation...');
        streets = []; // Não fazer nova consulta OSM para evitar rate limiting
      }
    } else {
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
        }
        
        return isValidHighway;
      });
      
      const hasValidStreets = realStreets.length > 0;
      
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
      bearingThreshold: TRIGGER_POINTS_CONSTANTS.triggerPoint.fallbackBearingThreshold,
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
      generationMethod: 'fallback_recovery',
      contextData: context,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
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

    return [streetData];
  }

  /**
   * NOVA: Encontrar a rua mais próxima do POI usando dados já obtidos (OTIMIZADO)
   */
  private findNearestStreetToPOIFromData(poiLocation: { lat: number; lng: number }, streets: any[]): any | null {
    if (!streets || streets.length === 0) {
      return null;
    }
    
    
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
    // ✅ COMENTADO: Logs individuais de cada rua poluem muito o console
    // console.log(`📍 All streets found (sorted by distance):`);
    // streetDistances.forEach((street, index) => {
    //   const marker = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '📍';
    //   console.log(`  ${marker} ${street.name} (${street.type}) - ${street.distance.toFixed(0)}m - ${street.visibility}`);
    // });
    
    // Log resumido apenas
    if (streetDistances.length > 0) {
    }
    
    if (nearestStreet) {
    }
    
    return nearestStreet;
  }

  /**
   * NOVA: Encontrar a rua mais próxima do POI usando OSM (sem Google Roads API)
   */
  private async findNearestStreetToPOI(poiLocation: { lat: number; lng: number }): Promise<any | null> {
    try {
      console.log('🔍 Searching for nearest street using OSM...');
      
      // 🌍 ESTRATÉGIA 1: LOCAL OSM DB
      const { LocalOSMFetcher } = await import('../services/local-osm-fetcher');
      const localData = LocalOSMFetcher.getInstance().fetchAsOverpassData(
        poiLocation, 200, { includeBuildings: false }
      );
      
      let roads: any[] = [];
      
      if (localData && localData.elements.length > 0) {
        roads = localData.elements;
      } else {
        // 🔄 ESTRATÉGIA 2: OVERPASS API (Fallback)
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
          headers: { 
            'Content-Type': 'text/plain',
            'User-Agent': 'TuggiCMS/1.0 (trigger-points-generation)'
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          roads = data.elements || [];
        }
      }
      
      if (roads.length > 0) {
        // Pegar a rua mais próxima
        const nearestRoad = roads[0];
        
        // Converter geometria OSM para formato esperado
        const coordinates = nearestRoad.geometry ? nearestRoad.geometry.map((point: any) => ({
          lat: point.lat,
          lng: point.lon
        })) : [];
        
        
        return {
          id: nearestRoad.id.toString(),
          type: nearestRoad.tags?.highway || 'road',
          coordinates,
          accessibility: 'public',
          confidence: 0.8
        };
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
    
    
    // Criar apenas 1 TP principal na rua mais próxima
    const triggerPoint: TriggerPoint = {
      id: 'smart_fallback_1',
      location: streetPoint,
      radius: 25, // Raio pequeno para POI pequeno
      expectedBearing: calculateBearing(streetPoint, centerPoint),
      bearingThreshold: TRIGGER_POINTS_CONSTANTS.triggerPoint.fallbackBearingThreshold,
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
        generationMethod: 'fallback_recovery',
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
   * Camada 1 — Detecta o prédio que CONTÉM o POI e usa sua altura como altura
   * efetiva (`boundary.height`) para o ray-cast 2.5D.
   *
   * Por que: storefront POIs (museus, lojas, restaurantes em prédios) costumam
   * ter `height=0` no OSM, indicando a altura semântica do POI (zero, é uma
   * loja). Mas pra visibilidade FÍSICA, o que conta é a altura do PRÉDIO que
   * abriga o POI — afinal, é a fachada desse prédio que o usuário vê da rua.
   *
   * Algoritmo: procurar entre `boundary.buildings` quem contém o centroide
   * do POI. Usar sua altura (com fallbacks: tag height, building:levels × 3.5,
   * defaultHouseHeight). Só substitui se a altura encontrada for maior que a
   * altura semântica original.
   */
  private useContainingBuildingHeight(boundary: BoundaryData): void {
    const buildings = boundary.buildings || [];
    if (buildings.length === 0) return;

    // Já tem altura significativa? Não mexer.
    const currentHeight = boundary.height || 0;
    if (currentHeight >= 10) return;

    const { isPointInPolygon, extractBuildingHeight } = require('../utils/calculations');
    const defaultHouseHeight = TRIGGER_POINTS_CONSTANTS.obstructions.defaultHouseHeight;

    for (const b of buildings) {
      const geom = b.geometry;
      if (!Array.isArray(geom) || geom.length < 3) continue;
      // Geometria OSM vem como [{lat, lon}] ou [{lat, lng}]; normalizar
      const coords = geom.map((c: any) => ({ lat: c.lat, lng: c.lng ?? c.lon }));
      if (!isPointInPolygon(boundary.center, coords)) continue;

      // Achou o prédio container — extrair altura
      let h = Number(b.height) || 0;
      if (!h && b.tags) {
        h = extractBuildingHeight(b.tags) || 0;
      }
      if (!h) h = defaultHouseHeight; // 6m fallback

      if (h > currentHeight) {
        console.log(`🏢 Containing building detected: using height ${h}m (was ${currentHeight}m semantic)`);
        boundary.height = h;
      }
      return;
    }

    console.log(`🏢 No containing building found for POI (or all checked, none contain centroid)`);
  }

  /**
   * Constrói o visibility fan (mapa de visibilidade física) e anexa ao boundary.
   * Esse fan substitui o searchRadius categórico no resto do pipeline.
   *
   * Estratégia: ray-cast 2.5D em 72 direções, usando alturas dos buildings do
   * banco local + SRTM terreno. Distância máxima visível por direção forma um
   * polígono. Streets dentro do polígono viram candidatos a TP.
   */
  private async attachVisibilityFan(
    poiData: POIData,
    boundary: BoundaryData,
    maxHorizonM?: number
  ): Promise<void> {
    try {
      const { VisibilityMapBuilder } = require('../analyzers/visibility-map-builder');
      const { LocalOSMFetcher } = require('../services/local-osm-fetcher');
      const { calculateDistance } = require('../utils/calculations');

      // Horizonte do fan SCALA com a altura/elevação do POI (poi top altitude).
      //
      // POIs altos enxergam mais longe — Cristo Redentor (~730m) tem visibilidade
      // teórica de ~95km, mas pra fins de produto, ~10-12km é mais que suficiente
      // pra dar relevância. Para um pier de 3m, 2km é o teto.
      //
      // Fórmula: poiTop × 15, clampado a [2km, 15km].
      // Override explícito via options.visibilityMaxHorizonM.
      const poiGroundForHorizon = boundary.elevation?.center ?? 0;
      const poiHeightForHorizon = boundary.height ?? 0;
      const poiTopForHorizon = poiGroundForHorizon + Math.max(poiHeightForHorizon, 1.7);
      const horizonDefault = Math.max(2_000, Math.min(15_000, Math.round(poiTopForHorizon * 15)));
      const horizon = maxHorizonM ?? horizonDefault;
      console.log(`🔭 Horizon: ${horizon}m (POI top ${poiTopForHorizon.toFixed(0)}m, ${maxHorizonM ? 'user-override' : 'auto'})`);

      const fetcher = LocalOSMFetcher.getInstance();
      const overpassLike = fetcher.fetchAsOverpassData(poiData.location, horizon, {
        includeBuildings: true,
      });

      const buildings: any[] = [];
      if (overpassLike?.elements) {
        for (const el of overpassLike.elements) {
          if (el.tags?.building && el.geometry && Array.isArray(el.geometry)) {
            const geometry = el.geometry.map((g: any) => ({ lat: g.lat, lng: g.lon ?? g.lng }));
            const heightTag = el.tags['height'];
            const levelsTag = el.tags['building:levels'];
            let height = 0;
            if (heightTag) {
              const m = String(heightTag).match(/(\d+(?:\.\d+)?)/);
              if (m) height = parseFloat(m[1]);
            }
            if (!height && levelsTag) {
              const lv = parseFloat(levelsTag);
              if (!isNaN(lv) && lv > 0) height = lv * 3.5;
            }
            buildings.push({ id: String(el.id), geometry, height, tags: el.tags });
          }
        }
      }

      // Performance cap: para POIs em áreas hiper-densas (Manhattan tem 600k+
      // buildings em 10km), processar todos é proibitivo. Ordenamos por
      // distância ao POI e mantemos só os mais próximos. Os longe-e-pequenos
      // não bloqueiam visibilidade na maioria dos casos.
      const MAX_BUILDINGS = 8000;
      if (buildings.length > MAX_BUILDINGS) {
        const poiCenter = boundary.center;
        const centroidOf = (g: any[]) => {
          let lat = 0, lng = 0;
          for (const p of g) { lat += p.lat; lng += p.lng; }
          return { lat: lat / g.length, lng: lng / g.length };
        };
        buildings.sort((a, b) => {
          const ca = centroidOf(a.geometry), cb = centroidOf(b.geometry);
          return calculateDistance(poiCenter, ca) - calculateDistance(poiCenter, cb);
        });
        const originalCount = buildings.length;
        buildings.length = MAX_BUILDINGS;
        console.log(`👁️ Building cap applied: kept closest ${MAX_BUILDINGS}/${originalCount} buildings to POI center`);
      }

      // POI top altitude (já computado acima como poiTopForHorizon)
      const poiGround = poiGroundForHorizon;
      const poiTop = poiTopForHorizon;

      console.log(`👁️ Building visibility fan: POI top=${poiTop.toFixed(1)}m (ground ${poiGround} + height ${poiHeightForHorizon}), buildings considered=${buildings.length}, horizon=${horizon}m`);

      // Passa o boundary inteiro — o builder amostra ao longo do perímetro (n
      // pontos proporcional ao tamanho), em vez de só usar o centroide.
      // Crítico para POIs longos (pontes, avenidas, parques).
      const fan = await VisibilityMapBuilder.buildFan(
        boundary.coordinates,
        poiTop,
        poiGround,
        buildings,
        { maxHorizonM: horizon }
      );

      boundary.visibilityFan = {
        polygons: fan.polygons,
        samplePoints: fan.samplePoints,
        maxDistanceM: fan.stats.maxDistanceM,
        meanDistanceM: fan.stats.meanDistanceM,
        minDistanceM: fan.stats.minDistanceM,
        coverageAreaM2: fan.stats.coverageAreaM2,
        elapsedMs: fan.diagnostics.elapsedMs,
      };

      console.log(`👁️ Visibility fan: ${fan.diagnostics.samplePointCount} sample points along boundary, max=${fan.stats.maxDistanceM}m, mean=${fan.stats.meanDistanceM}m, min=${fan.stats.minDistanceM}m, area=${(fan.stats.coverageAreaM2 / 1e6).toFixed(2)}km², elapsed=${fan.diagnostics.elapsedMs}ms`);
    } catch (err) {
      console.warn(`⚠️ attachVisibilityFan failed — falling back to categorical search radius:`, err);
    }
  }

  /**
   * Garantia KISS: pelo menos 1 TP "frontal" na rua de endereço do POI.
   *
   * Caso: storefront POIs (lojas, museus, restaurantes) cujo OSM boundary é só
   * o footprint do prédio (height=0). O fan de visibilidade colapsa porque
   * os prédios adjacentes bloqueiam a linha de visão "ao chão" do POI. Mas o
   * POI é VISÍVEL DA RUA — você passa em frente e vê a fachada.
   *
   * Solução: se `boundary.address.street` está populado, achamos a rua
   * correspondente nas streets acessíveis e geramos 1 TP no ponto mais
   * próximo da rua ao POI. Esse TP tem alta confiança porque o `addr:street`
   * do OSM é a fonte canônica de "qual rua o POI faz fachada".
   *
   * Para POIs de esquina (raros com addr:street duplo), futuramente podemos
   * gerar TPs em todas as ruas adjacentes não-obstruídas.
   */
  private buildFrontalArrivalTP(
    poiData: POIData,
    boundary: BoundaryData,
    context: GeographicContext,
    accessibleStreets: StreetData[],
    existingTPs: TriggerPoint[]
  ): TriggerPoint | null {
    if (!accessibleStreets.length) return null;

    const { calculateBearing, calculateDistance, calculateDistanceToBoundary } = require('../utils/calculations');
    const { resolveStreetSpeedKmh, calculateGpsAwareRadius } = require('../../../geometry');

    // Estratégia 1: usar OSM addr:street (mais preciso semanticamente)
    let matching: StreetData | undefined;
    let strategyUsed = '';

    const addrStreet = boundary.address?.street;
    if (addrStreet) {
      const addrLower = addrStreet.toLowerCase().trim();
      matching = accessibleStreets.find(s => {
        const sName = (s.name || '').toLowerCase().trim();
        if (!sName) return false;
        return sName.includes(addrLower) || addrLower.includes(sName);
      });
      if (matching) strategyUsed = `addr:street="${addrStreet}"`;
    }

    // Estratégia 2 (Camada 3): se addr:street ausente ou sem match, achar a
    // rua acessível MAIS PRÓXIMA do boundary. Pura física — qualquer rua a
    // ≤50m do POI tem grande chance de ter line-of-sight direto pra fachada.
    if (!matching) {
      let bestStreet: StreetData | undefined;
      let bestDistance = Infinity;
      for (const s of accessibleStreets) {
        if (!s.coordinates?.length) continue;
        // Distância mínima da rua até a aresta do boundary
        let streetMin = Infinity;
        for (const p of s.coordinates) {
          const d = calculateDistanceToBoundary(p, boundary.coordinates);
          if (d < streetMin) streetMin = d;
        }
        if (streetMin < bestDistance) {
          bestDistance = streetMin;
          bestStreet = s;
        }
      }
      // Aceita apenas se a rua mais próxima estiver MUITO perto (≤50m)
      // do boundary — sinal forte de "rua de frente da fachada".
      if (bestStreet && bestDistance <= 50) {
        matching = bestStreet;
        strategyUsed = `closest-street (${bestStreet.name || bestStreet.id}, ${bestDistance.toFixed(0)}m from boundary)`;
      }
    }

    if (!matching || !matching.coordinates?.length) {
      if (addrStreet) {
        console.log(`🏠 Frontal TP skipped: addr:street="${addrStreet}" não encontrada + nenhuma rua ≤50m do boundary`);
      }
      return null;
    }

    // Acha o ponto da rua mais próximo do centro do POI
    let closestPoint = matching.coordinates[0];
    let minDist = calculateDistance(closestPoint, boundary.center);
    for (const p of matching.coordinates) {
      const d = calculateDistance(p, boundary.center);
      if (d < minDist) {
        minDist = d;
        closestPoint = p;
      }
    }

    // Já existe um TP perto? Não duplicar.
    const tooClose = existingTPs.some(tp =>
      calculateDistance(tp.location, closestPoint) < 30
    );
    if (tooClose) {
      console.log(`🏠 Frontal TP skipped: existing TP within 30m of "${matching.name || matching.id}"`);
      return null;
    }

    // Bearing target: usa entrance se disponível, senão centroid
    let bearingTarget: { lat: number; lng: number };
    if (boundary.entrances && boundary.entrances.length > 0) {
      const priority = { main: 0, yes: 1, other: 2 } as const;
      const best = [...boundary.entrances].sort((a, b) => priority[a.kind] - priority[b.kind])[0];
      bearingTarget = { lat: best.lat, lng: best.lng };
    } else {
      bearingTarget = { lat: boundary.center.lat, lng: boundary.center.lng };
    }

    // Radius GPS-aware baseado na velocidade da rua
    const cfg = TRIGGER_POINTS_CONSTANTS.triggerPoint;
    const tags: any = (matching as any).tags || {};
    const speedKmh = resolveStreetSpeedKmh(tags.maxspeed, matching.type);
    const groupCap = boundary.classification?.maxTPRadiusM ?? cfg.maxRadiusM;
    const radius = calculateGpsAwareRadius(
      speedKmh,
      cfg.gpsPingWindowSec,
      cfg.gpsPingSafetyFactor,
      { min: cfg.minRadiusM, max: groupCap }
    );

    console.log(`🏠 Frontal TP: on "${matching.name || 'unnamed'}" (${matching.id}) at ${minDist.toFixed(0)}m from POI center, radius=${radius}m [strategy: ${strategyUsed}]`);

    return {
      id: `frontal_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      location: closestPoint,
      radius,
      expectedBearing: calculateBearing(closestPoint, bearingTarget),
      bearingThreshold: cfg.defaultBearingThreshold,
      type: 'primary',
      priority: 1,
      confidence: 0.95,
      quality: 0.95,
      street: matching,
      distance: minDist,
      generationMethod: 'local_osm',
      contextData: context,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Issue 2.4 — Geofence TP para qualquer POI com boundary válido.
   *
   * O app `tuggi-drive-v2` suporta TPs do tipo `geofence` que disparam quando o
   * usuário entra no polígono — sem checagem de bearing. Geramos um por POI
   * com boundary válido (qualquer tamanho) para cobrir o caso do usuário
   * andando que entra pela porta sem passar próximo aos TPs arrival na rua.
   */
  private buildGeofenceTriggerPoint(
    poiData: POIData,
    boundary: BoundaryData,
    context: GeographicContext
  ): TriggerPoint | null {
    // Não emitir para boundaries estimados/manuais (não representam o polígono real)
    if (!boundary || !boundary.coordinates || boundary.coordinates.length < 3) {
      console.log(`🚫 Geofence TP skipped: invalid boundary (coords=${boundary?.coordinates?.length})`);
      return null;
    }
    if (boundary.source === 'estimated' || boundary.source === 'manual' || boundary.source === 'manual_drawing') {
      console.log(`🚫 Geofence TP skipped: boundary.source=${boundary.source}`);
      return null;
    }
    console.log(`🟦 Geofence TP: emitting for boundary.source=${boundary.source}, coords=${boundary.coordinates.length}, area=${boundary.area_m2?.toFixed(0)}m²`);

    // GeoJSON Polygon: anel de coordenadas [lng, lat] (fechado).
    const ring = boundary.coordinates.map(c => [c.lng, c.lat]);
    if (ring.length > 0) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        ring.push([first[0], first[1]]); // fechar o polígono
      }
    }
    const geojson = JSON.stringify({ type: 'Polygon', coordinates: [ring] });

    // Pre-filter radius (o app usa pra fast-reject antes do point-in-polygon).
    // Prefere o fan máximo (físico) quando disponível; senão usa sqrt(area)*2.
    const fanMax = boundary.visibilityFan?.maxDistanceM;
    const safetyRadius = fanMax
      ? Math.max(500, Math.round(fanMax))
      : Math.max(500, Math.round(Math.sqrt(boundary.area_m2 || 250000) * 2));

    return {
      id: `geofence_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      location: { lat: boundary.center.lat, lng: boundary.center.lng },
      radius: safetyRadius,
      expectedBearing: 0,
      bearingThreshold: 180, // não usado para geofence; valor neutro
      type: 'geofence',
      priority: 1,
      confidence: boundary.confidence ?? 0.9,
      quality: 1.0,
      street: {
        id: 'geofence_boundary',
        type: 'boundary',
        coordinates: boundary.coordinates,
        accessibility: 'public',
        confidence: 0.9,
      } as StreetData,
      distance: 0,
      generationMethod: 'local_osm',
      contextData: context,
      geometryGeoJson: geojson,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Anexa entradas OSM (entrance=main / yes) ao boundary usando o banco local.
   * Filtra apenas os nós que caem dentro do polígono do boundary.
   */
  private attachEntrancesFromLocalOSM(boundary: BoundaryData): void {
    if (!boundary || !boundary.coordinates || boundary.coordinates.length < 3) return;
    try {
      // import local — evita ciclo de import no topo do arquivo
      const { LocalOSMFetcher } = require('../services/local-osm-fetcher');
      const { isPointInPolygon } = require('../utils/calculations');

      const fetcher = LocalOSMFetcher.getInstance();
      // bbox do próprio boundary
      let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
      for (const c of boundary.coordinates) {
        if (c.lat < minLat) minLat = c.lat;
        if (c.lat > maxLat) maxLat = c.lat;
        if (c.lng < minLng) minLng = c.lng;
        if (c.lng > maxLng) maxLng = c.lng;
      }

      const candidates = fetcher.fetchEntrances({ minLat, maxLat, minLng, maxLng });
      if (!candidates || candidates.length === 0) return;

      const inside = candidates.filter((p: any) =>
        isPointInPolygon({ lat: p.lat, lng: p.lng }, boundary.coordinates)
      );
      if (inside.length > 0) {
        boundary.entrances = inside;
        console.log(`🚪 Found ${inside.length} OSM entrance(s) inside boundary (main=${inside.filter((e: any) => e.kind === 'main').length})`);
      }
    } catch (err) {
      // não falhamos a pipeline — só não enriquecemos com entradas
      console.warn(`⚠️ attachEntrancesFromLocalOSM failed:`, err);
    }
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
  /**
   * Issue 2.4b — Cobertura completa.
   *
   * Premissa: não perder usuário vindo de qualquer lado. O controle real de
   * sobreposição é `minDistanceBetweenTPs`. O limite por grupo no config é
   * apenas um teto de segurança (200-500); aqui apenas o respeitamos.
   *
   * Antes: a função impunha um segundo teto por "área de cobertura" (1 TP
   * por 0.1km²) que entrava em conflito com a meta de 1 TP por rua perimetral.
   */
  private calculateDynamicTPLimit(boundary: BoundaryData, context: GeographicContext, searchRadius?: number): number {
    const groupMax = boundary.classification?.maxTriggerPoints ?? 200;
    console.log(`📊 TP limit: ${groupMax} (group ceiling — real control is minDistanceBetweenTPs)`);
    return groupMax;
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
    if (boundary.area_m2 > 500000) { // POIs muito grandes (>50 hectares)
      baseDistance *= cfg.minDistance.areaMultipliers.very_large;
      console.log(`🏞️ Large POI adjustment: +${((cfg.minDistance.areaMultipliers.very_large - 1) * 100).toFixed(0)}% distance`);
    } else if (boundary.area_m2 > 100000) { // POIs grandes (>10 hectares)
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

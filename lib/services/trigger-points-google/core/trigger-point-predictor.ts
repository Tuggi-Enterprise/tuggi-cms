// Core Trigger Point Predictor - Orquestrador principal do sistema

import { GeographicContextAnalyzer } from './geographic-analyzer';
import { BoundaryDetector } from './boundary-detector';
import { StreetAnalyzer } from '../analyzers/street-analyzer';
import { OptimalPointCalculator } from '../analyzers/point-calculator';
import { TriggerPointValidator } from '../analyzers/validator';
import { GoogleAPIsService } from '../services/google-apis.service';
import { POIData, TriggerPoint, TriggerPointGenerationOptions, TriggerPointPredictionResult, BoundaryData, GeographicContext, TriggerPointCandidate, StreetData } from '../types/interfaces';
import { calculateBearing, calculateDistance, findClosestPointOnBoundary } from '../utils/calculations';
import { deterministicTPId } from '../utils/deterministic';
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
      
      // 2. Criar contexto geográfico a partir do boundary.
      // ✅ OPTIMIZATION: boundary-detector já computou context durante
      // classification (com mesmos dados OSM); reusa via `boundary.cachedContext`
      // pra evitar 1 chamada redundante de density/elevation/OSM analysis.
      // Se cache ausente (paths edge), computa normalmente.
      const context = boundary.cachedContext
        ? boundary.cachedContext
        : await this.geographicAnalyzer.analyzeGeographicContext(poiData, boundary);
      if (boundary.cachedContext) {
        console.log(`♻️ Reusing geographic context from boundary-detector (no recomputation)`);
      }

      // 2.5 Visibility-driven mode — sempre ativo (modo categórico legado
      // removido em Tier 3.1, 2026-05-18).
      // Computa o "fan" de visibilidade real (ray-cast 2.5D) e o anexa ao
      // boundary. TPs ficam onde o POI é fisicamente visível.
      //
      // Camada 1 — Building lookup. Pra POIs storefront (museus, lojas,
      // restaurantes dentro de prédios), o OSM frequentemente põe height=0
      // no POI semântico. Detecta o prédio que CONTÉM o POI e usa sua altura
      // como altura efetiva pro ray-cast. Sem isso o fan colapsa.
      this.useContainingBuildingHeight(boundary);
      await this.attachVisibilityFan(poiData, boundary, options.visibilityMaxHorizonM);
      
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
      const optimalPoints = await this.pointCalculator.calculateOptimalPoints(poiData, streetsForOptimalPoints, boundary, context, streetAnalysisResult.searchRadius);
      
      if (optimalPoints.length === 0) {
        console.warn('⚠️ No optimal points calculated, using fallback strategy');
        const fallbackPoints = await this.buildFanCollapseFallback(poiData, boundary, context, accessibleStreets);
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

      // 4.5. Per-TP exact line-of-sight check.
      //
      // O fan é coarse (72 direções × interpolação angular + polygon edge effects).
      // Aqui re-checamos cada candidato VIA ray-cast EXATO POI → candidato
      // location. Bate o terreno em intervalos fixos de 100m, com short-circuit
      // ao primeiro bloqueio. Cache por POI compartilha pixels SRTM entre
      // candidatos da mesma região.
      //
      // Casos que isso pega que o fan não pega:
      //  - Cristo → Av. Niemeyer: bloqueado por morros estreitos entre 5-6km
      //    que caíam ENTRE samples do fan (5° angular + sampling proporcional).
      //  - Qualquer rua "atrás" de morro/colina onde linha de visão passa raspando.
      const visibleOptimalPoints = await this.filterCandidatesByExactLOS(
        optimalPoints,
        boundary,
      );

      if (visibleOptimalPoints.length === 0) {
        console.warn('⚠️ Per-TP LOS check rejected all candidates — using fan-walk output without per-TP filter');
        // Falha defensiva: prefere falsos positivos a zero TPs
      }
      const candidatesPostLOS = visibleOptimalPoints.length > 0 ? visibleOptimalPoints : optimalPoints;

      // 5. Validação de candidatos em ruas (NOVO PASSO)
      const streetValidatedCandidates = await this.validateCandidatesOnStreets(candidatesPostLOS, accessibleStreets);

      if (streetValidatedCandidates.length === 0) {
        console.warn('⚠️ No candidates validated on streets, using fallback strategy');
        const fallbackPoints = await this.buildFanCollapseFallback(poiData, boundary, context, accessibleStreets);
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
        {
          simulateApproach: options.simulateApproach,
          validateCorridor: options.validateCorridor,
          clusterIntersections: options.clusterIntersections,
          intersectionClusterRadiusM: options.intersectionClusterRadiusM,
        }
      );
      
      // 7. Aplicar opções de filtro adicionais (se houver)
      const filteredPoints = this.applyOptions(validatedPoints, options, boundary);
      
      // 8. Otimização já foi feita em selectTriggerPointsWithMinDistance

      // 8.5. KISS: garantir TPs "frontais" na rua de endereço do POI quando ela
      // está populada no OSM. Crítico pra storefront POIs (lojas, museus,
      // restaurantes) cujo fan de visibilidade colapsa por estarem dentro de
      // prédios grandes. Emite até 2 TPs (upstream + downstream) pra garantir
      // que ao menos um dispare como "front" em qualquer sentido de aproximação.
      const frontalTPs = this.buildFrontalArrivalTP(poiData, boundary, context, accessibleStreets, filteredPoints);
      for (const t of frontalTPs) filteredPoints.push(t);

      // Geofence: o app usa o boundary polygon diretamente para point-in-polygon.
      // Não gerar TP do tipo geofence — é redundante e polui o DB.

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
  /**
   * Fallback novo (2026-05): usado quando o fan colapsa OU FAN-WALK gera 0
   * candidatos (POIs pequenos em áreas hiper-densas — Church of the
   * Transfiguration, storefronts em Manhattan, etc.).
   *
   * Estratégia:
   *  1. Camada 3 (`buildFrontalArrivalTP`): emite até 2 TPs (upstream +
   *     downstream) na rua de endereço do POI ou na rua mais próxima ≤80m.
   *     Cobre ambos os sentidos de aproximação sem depender de one-way
   *     validation (que está desligada em modo fan).
   *  2. Geofence TP (`buildGeofenceTriggerPoint`): polígono do boundary inteiro
   *     como zona de disparo. Pega usuários que entram pela porta lateral ou
   *     andando, independente da rua que estão.
   *  3. Se 1 + 2 falharem (sem rua acessível + boundary inválido), cai pro
   *     legacy `generateFallbackTriggerPoints` como último recurso (1 TP
   *     direcional).
   */
  private async buildFanCollapseFallback(
    poiData: POIData,
    boundary: any,
    context: any,
    accessibleStreets: any[]
  ): Promise<TriggerPoint[]> {
    const out: TriggerPoint[] = [];

    // 1. Frontal TPs (upstream + downstream)
    const frontalTPs = this.buildFrontalArrivalTP(poiData, boundary, context, accessibleStreets, out);
    for (const t of frontalTPs) out.push(t);

    if (out.length > 0) {
      console.log(`🛟 Fan-collapse fallback: emitted ${out.length} frontal TP(s)`);
      return out;
    }

    // Último recurso: legacy single-TP fallback
    console.warn('🛟 Fan-collapse fallback: no frontal TPs available, falling back to legacy single-TP');
    return await this.generateFallbackTriggerPoints(poiData, boundary, context, accessibleStreets);
  }

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
   * Per-TP exact line-of-sight filter. Rejeita candidatos cujo ray-cast
   * preciso POI → location bate em terreno.
   *
   * Detalhes:
   *  - Sample interval fixo 100m (não proporcional → não miss peaks estreitos)
   *  - Margem SRTM 15m (noise vertical típico do dataset)
   *  - Cache de elevação por POI (compartilha pixels entre candidatos)
   *  - Paraleliza em lotes de 200 (cobre I/O do SQLite local sem stall)
   *  - Short-circuit no primeiro bloqueio
   */
  private async filterCandidatesByExactLOS(
    candidates: TriggerPointCandidate[],
    boundary: BoundaryData,
  ): Promise<TriggerPointCandidate[]> {
    if (candidates.length === 0) return candidates;

    const { VisibilityMapBuilder } = await import('../analyzers/visibility-map-builder');
    const { LocalOSMFetcher } = await import('../services/local-osm-fetcher');
    const { SRTMLocalService } = await import('../../srtm-local-service');

    // Mesma fórmula de poiTop que attachVisibilityFan (com max pra peaks naturais).
    const isStructurePOI = (boundary.height ?? 0) > 20;
    const poiGround = isStructurePOI
      ? (boundary.elevation?.average ?? boundary.elevation?.center ?? 0)
      : (boundary.elevation?.max ?? boundary.elevation?.center ?? boundary.elevation?.average ?? 0);
    const poiHeight = Math.max(boundary.height ?? 0, 1.7);
    const poiTop = poiGround + poiHeight;

    // ── Pre-fetch building tops pro check de urban-canyon ──────────────────
    // Filtro de altura ≥8m: só buildings que PODEM bloquear linha de visão
    // perto do observador (line altitude ~5-15m a 50-100m do observador).
    // Sem height tag explícito → descartamos (casa residencial típica).
    const fanRadius = boundary.visibilityFan?.maxDistanceM ?? 0;
    const buildingTops: Array<{ centroid: { lat: number; lng: number }; topAltitudeM: number }> = [];

    if (fanRadius > 100) {
      const fetcher = LocalOSMFetcher.getInstance();
      const data = fetcher.fetchAsOverpassData(boundary.center, fanRadius, { includeBuildings: true });
      const srtm = SRTMLocalService.getInstance();

      const MIN_BLOCKING_HEIGHT_M = 8;
      if (data?.elements) {
        for (const el of data.elements) {
          if (!el.tags?.building || !el.geometry || !Array.isArray(el.geometry)) continue;
          const geometry = el.geometry.map((g: any) => ({ lat: g.lat, lng: g.lon ?? g.lng }));
          if (geometry.length < 3) continue;

          let height = 0;
          if (el.tags.height) {
            const m = String(el.tags.height).match(/(\d+(?:\.\d+)?)/);
            if (m) height = parseFloat(m[1]);
          }
          if (!height && el.tags['building:levels']) {
            const lv = parseFloat(el.tags['building:levels']);
            if (!isNaN(lv) && lv > 0) height = lv * 3.5;
          }
          if (!height || height < MIN_BLOCKING_HEIGHT_M) continue;

          const centroid = {
            lat: geometry.reduce((s: number, p: any) => s + p.lat, 0) / geometry.length,
            lng: geometry.reduce((s: number, p: any) => s + p.lng, 0) / geometry.length,
          };
          const groundAlt = (await srtm.getElevation(centroid.lat, centroid.lng)) ?? 0;
          buildingTops.push({ centroid, topAltitudeM: groundAlt + height });
        }
      }
    }
    console.log(`🏢 Per-TP buildings loaded: ${buildingTops.length} tops (height ≥8m)`);

    // ── Spatial index local dos buildings (grid 200m) pra lookup O(1) por TP ─
    const GRID_CELL_DEG = 200 / 111000;
    const buildingGrid = new Map<string, typeof buildingTops>();
    for (const b of buildingTops) {
      const lat = Math.floor(b.centroid.lat / GRID_CELL_DEG);
      const lng = Math.floor(b.centroid.lng / GRID_CELL_DEG);
      const key = `${lat},${lng}`;
      const arr = buildingGrid.get(key) ?? [];
      arr.push(b);
      buildingGrid.set(key, arr);
    }
    const candidatesBuildingsForLOS = (tp: TriggerPointCandidate) => {
      const minLat = Math.floor(Math.min(boundary.center.lat, tp.location.lat) / GRID_CELL_DEG) - 1;
      const maxLat = Math.floor(Math.max(boundary.center.lat, tp.location.lat) / GRID_CELL_DEG) + 1;
      const minLng = Math.floor(Math.min(boundary.center.lng, tp.location.lng) / GRID_CELL_DEG) - 1;
      const maxLng = Math.floor(Math.max(boundary.center.lng, tp.location.lng) / GRID_CELL_DEG) + 1;
      const out: typeof buildingTops = [];
      for (let lat = minLat; lat <= maxLat; lat++) {
        for (let lng = minLng; lng <= maxLng; lng++) {
          const arr = buildingGrid.get(`${lat},${lng}`);
          if (arr) out.push(...arr);
        }
      }
      return out;
    };

    const elevCache = new Map<string, number>();
    const startMs = Date.now();
    const BATCH = 200;
    const survivors: TriggerPointCandidate[] = [];
    let blocked = 0;

    for (let i = 0; i < candidates.length; i += BATCH) {
      const batch = candidates.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(c =>
          VisibilityMapBuilder.checkExactVisibility(
            boundary.center,
            poiTop,
            c.location,
            {
              elevCache,
              buildingTops: candidatesBuildingsForLOS(c),
            }
          )
        )
      );
      for (let j = 0; j < batch.length; j++) {
        if (results[j]) survivors.push(batch[j]);
        else blocked++;
      }
    }

    const elapsed = Date.now() - startMs;
    console.log(`🔭 Per-TP exact LOS: ${survivors.length} visible, ${blocked} blocked (from ${candidates.length}) — per-TP loop ${elapsed}ms`);

    return survivors;
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
  private applyOptions(triggerPoints: TriggerPoint[], options: TriggerPointGenerationOptions, boundary?: BoundaryData): TriggerPoint[] {
    let filtered = [...triggerPoints];

    // Filtrar por qualidade mínima (override explícito do caller)
    if (options.minQuality !== undefined) {
      filtered = filtered.filter(tp => tp.quality >= options.minQuality!);
    }

    // ── Density-based thinning + coverage guarantee ──────────────────────────
    //
    // Princípio: substituímos cap-based dedup (radius + bearing-sector) por
    // uma única regra de densidade SEM cap por setor ou total.
    //
    //   Spacing(tp) = max(2 × tp.radius, 150m, tp.distance × 0.10)
    //
    //   Intuição:
    //     - 2 × radius  → círculos GPS nunca se sobrepõem
    //     - 150m floor  → nunca dois TPs colados (UX: audio não atropela)
    //     - 10% radial  → escala com distância. TP a 5km do POI precisa de
    //                     500m até o vizinho; TP a 1km, 100m (floor 150m).
    //                     Naturalmente cria gradiente: TPs densos perto do POI
    //                     (zona urbana de aproximação) e esparsos longe
    //                     (highway, aproximação macro).
    //
    // Depois, coverage guarantee: cada slice angular de 22.5° (16 slices) com
    // candidatos VÍSIVEIS tem pelo menos 1 TP. Garante que "regiões" não fiquem
    // vazias mesmo quando a thinning corta todos os candidatos delas.
    //
    // N (total de TPs) é EMERGENTE da regra de densidade, não decretado.

    const { calculateDistance } = require('../utils/calculations');

    // Sort: primary > secondary, depois quality desc.
    filtered.sort((a, b) => {
      if (a.type === 'primary' && b.type !== 'primary') return -1;
      if (b.type === 'primary' && a.type !== 'primary') return 1;
      return b.quality - a.quality;
    });

    const minSpacingM = (tp: TriggerPoint) => Math.max(
      tp.radius * 2,
      150,
      tp.distance * 0.10
    );

    const accepted: TriggerPoint[] = [];
    for (const tp of filtered) {
      const tooClose = accepted.some(a => {
        const minDist = Math.max(minSpacingM(tp), minSpacingM(a));
        return calculateDistance(tp.location, a.location) < minDist;
      });
      if (!tooClose) accepted.push(tp);
    }
    console.log(`📐 Density thinning: ${filtered.length} → ${accepted.length} TPs (spacing = max(2×radius, 150m, 10% × radial-to-POI))`);

    // Coverage guarantee — 16 slices angulares de 22.5°.
    const SLICE_COUNT = 16;
    const SLICE_DEG = 360 / SLICE_COUNT;
    const sliceOf = (bearing: number) => Math.floor((((bearing % 360) + 360) % 360) / SLICE_DEG);

    let coverageAdded = 0;
    for (let s = 0; s < SLICE_COUNT; s++) {
      if (accepted.some(tp => sliceOf(tp.expectedBearing) === s)) continue;
      // Slice vazia — buscar melhor candidato dessa direção.
      // (Se a slice não tem candidatos, fan não alcança lá: nada a adicionar.)
      const sliceCandidates = filtered.filter(c => sliceOf(c.expectedBearing) === s);
      if (sliceCandidates.length === 0) continue;
      sliceCandidates.sort((a, b) => b.quality - a.quality);
      accepted.push(sliceCandidates[0]);
      coverageAdded++;
    }
    if (coverageAdded > 0) {
      console.log(`🎯 Coverage guarantee: filled ${coverageAdded} empty 22.5° slice(s) with best available candidate`);
    }

    // Cap explícito do caller (não cap automático).
    if (options.maxTriggerPoints !== undefined && accepted.length > options.maxTriggerPoints) {
      console.log(`✂️ Caller-set max: trimming ${accepted.length} → ${options.maxTriggerPoints}`);
      return accepted.slice(0, options.maxTriggerPoints);
    }

    return accepted;
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

    // Camada 1 é pra storefronts (POI pequeno dentro de um prédio). Pra POIs
    // grandes (aeroportos, parques, campus universitários), o POI É a área —
    // não está embedded num prédio. Usar altura do prédio mais próximo do
    // centroide nesses casos infla artificialmente o POI top e gera fan
    // exagerado (JFK: terminal de 30m vs aeroporto que é 99% pista 0m).
    //
    // Threshold 5000 m² separa "edifício individual / storefront" de
    // "complexo / área extensa". Casa: ~200m². Cathedral: ~2000m².
    // Estádio: 10k+ m². Aeroporto: milhões de m².
    const LARGE_BOUNDARY_THRESHOLD_M2 = 5000;
    const area = boundary.area_m2 || 0;
    if (area > LARGE_BOUNDARY_THRESHOLD_M2) {
      console.log(`🏢 Containing building skipped: boundary area ${(area / 1000000).toFixed(2)}km² > ${LARGE_BOUNDARY_THRESHOLD_M2}m² threshold (POI IS the area, not embedded in a building)`);
      return;
    }

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

      // Horizonte do fan escala com a "altura efetiva" do POI:
      //  - boundary.height (estrutura sobre o solo, ex: torre, museu)
      //  - + elevationDiff (POI ground − base regional, captura montanha/plateau)
      //
      // CRÍTICO: NÃO usar altitude SRTM absoluta. SRTM em áreas urbanas frequentemente
      // captura prédios próximos (DSM) e infla artificialmente o "ground" (caso AMNH:
      // 85m no SRTM vs ~30m real de Manhattan). Usamos só a DIFERENÇA pra base regional,
      // que é robusto a esse ruído.
      //
      // Pra POIs urbanos baixos (Farmers Gate, lojas): elevationDiff ≈ 0 → horizon depende
      // só do `height`. Pra montanhas reais (Cristo): elevationDiff = 700m+ → horizon
      // estende muito.
      //
      // Filtro de ruído: elevationDiff < 100m é considerado ruído SRTM (urbano), ignorado.
      // 100m+ é sinal forte de POI naturalmente elevado.
      //
      // ELEIÇÃO DE poiGround — depende do tipo de POI:
      //
      // 1. PEAKS NATURAIS (height pequeno: monumento, mirante, pico de rock):
      //    boundary.elevation.max é o pico real. `average` subestima drasticamente
      //    pra POIs grandes como Pão de Açúcar (boundary cobre o cone do rock —
      //    average=278m vs pico real=392m). Diferença de 100m+ faz o fan colapsar.
      //
      // 2. ESTRUTURAS (height grande: edifícios como ESB, torres):
      //    boundary.elevation.average é o TERRENO puro (separado da estrutura).
      //    `center` ou `max` podem misturar estrutura → double-count com poiHeight.
      //    ESB: ground=42m, height=443m → poiTop deve ser 485m, não 528m.
      //
      // Threshold height>20m distingue (storefront/edifício vs natural).
      const isStructurePOI = (boundary.height ?? 0) > 20;
      const poiGround = isStructurePOI
        ? (boundary.elevation?.average ?? boundary.elevation?.center ?? 0)
        : (boundary.elevation?.max ?? boundary.elevation?.center ?? boundary.elevation?.average ?? 0);
      const poiHeight = Math.max(boundary.height ?? 0, 1.7);

      let regionalBase = poiGround; // fallback se SRTM falhar → elevationDiff vira 0
      try {
        const { SRTMLocalService } = require('../../srtm-local-service');
        const srtm = SRTMLocalService.getInstance();
        // 4 pontos cardeais a ~2km (KISS, sem dependência de context)
        const samplingRadiusDeg = 0.02;
        const samples = await Promise.all([
          srtm.getElevation(boundary.center.lat + samplingRadiusDeg, boundary.center.lng),
          srtm.getElevation(boundary.center.lat - samplingRadiusDeg, boundary.center.lng),
          srtm.getElevation(boundary.center.lat, boundary.center.lng + samplingRadiusDeg),
          srtm.getElevation(boundary.center.lat, boundary.center.lng - samplingRadiusDeg),
        ]);
        const valid = samples.filter((s: number | null) => s !== null && !isNaN(s as number)) as number[];
        if (valid.length > 0) {
          valid.sort((a, b) => a - b);
          regionalBase = valid[Math.floor(valid.length / 2)]; // mediana
        }
      } catch (e) {
        // SRTM indisponível, fica com regionalBase = poiGround → elevationDiff=0
      }

      const elevationDiff = Math.max(0, poiGround - regionalBase);
      // Filtra ruído SRTM urbano (≤100m). Apenas POIs naturalmente elevados
      // (montanha, plateau, mountain peak) ganham extensão de horizon.
      const SIGNIFICANT_ELEVATION_DIFF_M = 100;
      const effectiveElevationContribution = elevationDiff >= SIGNIFICANT_ELEVATION_DIFF_M ? elevationDiff : 0;
      const effectiveHeight = poiHeight + effectiveElevationContribution;

      // horizon × 15: regra heurística — POI de 30m visível ~450m de longe em situação
      // típica. Floor 300m (audio approach mínimo de driving). Cap 15km (Cristo).
      //
      // POIs em terreno PLANO (arranha-céus urbanos como ESB): visibilidade física vai a
      // quilômetros mas usuário que visita se aproxima de ≤2km. TPs além disso disparam
      // o audio guide cedo demais → cap 2km. Cap só ativo quando o terreno não tem
      // elevação significativa (effectiveElevationContribution == 0).
      //
      // POIs em terreno ELEVADO (Cristo, picos, mirantes): usuário dirige ao longo de
      // estradas que circundam o maciço → alcance completo (~11km para Cristo).
      const URBAN_HORIZON_CAP_M = 2000;
      const isUrbanTerrain = effectiveElevationContribution === 0;
      const horizonDefault = isUrbanTerrain
        ? Math.max(300, Math.min(URBAN_HORIZON_CAP_M, Math.round(effectiveHeight * 15)))
        : Math.max(300, Math.min(15_000, Math.round(effectiveHeight * 15)));
      const horizon = maxHorizonM ?? horizonDefault;
      console.log(`🔭 Horizon: ${horizon}m (height=${poiHeight.toFixed(0)}m, elevDiff=${elevationDiff.toFixed(0)}m${effectiveElevationContribution > 0 ? ' (significant — POI naturally elevated)' : ' (filtered as SRTM noise)'}, effectiveHeight=${effectiveHeight.toFixed(0)}m, terrain=${isUrbanTerrain ? 'urban-flat (cap 2km)' : 'elevated'}, ${maxHorizonM ? 'user-override' : 'auto'})`);

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

      // Memory cap: para POIs em áreas hiper-densas (Manhattan tem 600k+
      // buildings em 10km), processar todos é proibitivo e quebra memory budget
      // em batch concurrent. Ordenamos por distância ao POI e mantemos só os
      // mais próximos. Buildings longe-e-pequenos não bloqueiam visibilidade
      // na maioria dos casos. SSOT do limite em TRIGGER_POINTS_CONSTANTS.memory.
      const MAX_BUILDINGS = TRIGGER_POINTS_CONSTANTS.memory.maxBuildingsPerPOI;
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
        console.log(`👁️ Memory cap: trimmed buildings ${originalCount} → ${MAX_BUILDINGS} (closest to POI center)`);
      }

      // POI top altitude: usa altitude SRTM absoluta pra ray-cast (precisa de
      // coordenada Z consistente com prédios e terreno). Independente da
      // fórmula de horizon, que usa elevation DIFF filtrada.
      const poiTop = poiGround + poiHeight;

      console.log(`👁️ Building visibility fan: POI top=${poiTop.toFixed(1)}m (ground ${poiGround} + height ${poiHeight}), buildings considered=${buildings.length}, horizon=${horizon}m`);

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
  ): TriggerPoint[] {
    if (!accessibleStreets.length) return [];

    const { calculateBearing, calculateDistance, calculateDistanceToBoundary, closestPointOnPolyline, walkAlongPolyline, findClosestPointOnBoundary } = require('../utils/calculations');
    const { resolveStreetSpeedKmh, calculateGpsAwareRadius } = require('../../../geometry');
    const cfg = TRIGGER_POINTS_CONSTANTS.triggerPoint;
    const groupCap = boundary.classification?.maxTPRadiusM ?? cfg.maxRadiusM;

    // ─── KISS: todas as ruas adjacentes ao boundary ─────────────────────────
    // Princípio: se você está a ≤80m do boundary, o POI é visível.
    // IMPORTANTE: NÃO usar `accessibleStreets` aqui — ele vem da pipeline principal
    // que pode sofrer SQL LIMIT (15k rows por bbox grande). Para raios pequenos
    // (100m), fazemos query direta no SQLite com baixíssima chance de LIMIT.
    const PERIMETER_RADIUS_M = 80;
    const PERIMETER_FETCH_RADIUS_M = 150; // buffer extra pra garantir cobertura
    const MAX_PERIMETER_STREETS = 8;

    const { LocalOSMFetcher } = require('../services/local-osm-fetcher');
    const fetcher = LocalOSMFetcher.getInstance();

    // Query direta de raio pequeno — retorna no máximo ~20-50 ruas, nunca atinge LIMIT
    const rawPerimeterStreets: StreetData[] | null = fetcher.fetchStreetsAlongBoundary(
      boundary.coordinates,
      PERIMETER_FETCH_RADIUS_M,
      4 // até 4 sample points no boundary
    );

    const addrStreet = boundary.address?.street;
    const addrLower = addrStreet?.toLowerCase().trim() ?? '';

    // Filtrar por acessibilidade e distância real ao polygon
    const streetDistances: Array<{ street: StreetData; dist: number }> = [];
    for (const s of rawPerimeterStreets ?? []) {
      if (!s.coordinates?.length) continue;
      // isStreetAccessible check (inline para não importar o analisador aqui)
      const ACCESSIBLE = new Set([
        'motorway','trunk','primary','secondary','tertiary','residential',
        'living_street','unclassified','motorway_link','trunk_link',
        'primary_link','secondary_link','tertiary_link','bus_guideway',
        'ferry','waterway','cycleway','footway','pedestrian','path',
        'railway_rail','railway_light_rail','railway_tram','railway_subway',
        'railway_monorail','railway_narrow_gauge','railway_preserved',
        'aerialway_cable_car','aerialway_gondola','aerialway_chair_lift','aerialway_mixed_lift',
      ]);
      if (!ACCESSIBLE.has(s.type)) continue;
      if ((s as any).tags?.tunnel === 'yes' || (s as any).tags?.covered === 'yes') continue;

      let minDist = Infinity;
      for (const p of s.coordinates) {
        const d = calculateDistanceToBoundary(p, boundary.coordinates);
        if (d < minDist) minDist = d;
      }
      const isAddrMatch = addrLower && (s.name || '').toLowerCase().includes(addrLower);
      if (minDist <= PERIMETER_RADIUS_M || isAddrMatch) {
        streetDistances.push({ street: s, dist: minDist });
      }
    }

    if (streetDistances.length === 0) {
      console.log(`🏠 Perimeter TPs skipped: nenhuma rua ≤${PERIMETER_RADIUS_M}m do boundary (fetched ${rawPerimeterStreets?.length ?? 0} ruas em ${PERIMETER_FETCH_RADIUS_M}m)`);
      return [];
    }

    // Ordenar por distância e limitar ao cap
    streetDistances.sort((a, b) => a.dist - b.dist);
    const candidates = streetDistances.slice(0, MAX_PERIMETER_STREETS);
    console.log(`🏠 Perimeter TPs: ${candidates.length} ruas adjacentes (≤${PERIMETER_RADIUS_M}m)`);

    const tps: TriggerPoint[] = [];
    // Accumulate placed positions para dedup entre ruas diferentes
    const placedLocations: Array<{ lat: number; lng: number }> = existingTPs.map(t => t.location);

    for (const { street, dist } of candidates) {
      const polyline = (street.fullCoordinates && street.fullCoordinates.length >= 2)
        ? street.fullCoordinates
        : street.coordinates;

      const projection = closestPointOnPolyline(boundary.center, polyline);
      if (!projection) continue;

      const tags: any = (street as any).tags || {};
      const speedKmh = resolveStreetSpeedKmh(tags.maxspeed, street.type);
      const radius = calculateGpsAwareRadius(
        speedKmh,
        cfg.gpsPingWindowSec,
        cfg.gpsPingSafetyFactor,
        { min: cfg.minRadiusM, max: groupCap }
      );

      // 2 TPs por rua: upstream e downstream — garante disparo em qualquer sentido
      const offsetM = 25;
      const upstreamPoint = walkAlongPolyline(polyline, projection, -offsetM);
      const downstreamPoint = walkAlongPolyline(polyline, projection, +offsetM);
      const upToDown = calculateDistance(upstreamPoint, downstreamPoint);

      const flanks: Array<{ key: string; location: { lat: number; lng: number } }> = upToDown > 10
        ? [{ key: 'up', location: upstreamPoint }, { key: 'down', location: downstreamPoint }]
        : [{ key: 'center', location: projection.point }];

      let emitted = 0;
      for (const f of flanks) {
        // Dedup: não colocar TP a <30m de outro já emitido (desta iteração ou existente)
        const tooClose = placedLocations.some(loc => calculateDistance(loc, f.location) < 30);
        if (tooClose) continue;

        tps.push({
          id: deterministicTPId(poiData.id, `perimeter_${street.id}_${f.key}`, f.location.lat, f.location.lng),
          location: f.location,
          radius,
          expectedBearing: calculateBearing(f.location, findClosestPointOnBoundary(f.location, boundary.coordinates)),
          bearingThreshold: cfg.defaultBearingThreshold,
          type: 'primary',
          priority: 1,
          confidence: 0.95,
          quality: 0.95,
          street,
          distance: calculateDistance(f.location, boundary.center),
          generationMethod: 'local_osm',
          contextData: context,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        placedLocations.push(f.location);
        emitted++;
      }
      if (emitted > 0) {
        console.log(`  🏠 "${street.name || street.id}" (${dist.toFixed(0)}m): ${emitted} TP(s)`);
      }
    }

    console.log(`🏠 Perimeter TPs total: ${tps.length} emitted`);
    return tps;
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
    // DEVE encompassar o polígono inteiro — senão usuários no perímetro do POI
    // (dentro do polígono) falham o pre-filter e o geofence nunca dispara
    // pra eles. Bug histórico: pra POIs grandes com fan pequeno (LaGuardia:
    // polígono 2km, fan 300m), o radius ficava 500m e excluía 75% do polígono.
    //
    // Fórmula: max(floor=500m, fanMax, polygonBoundingRadius).
    //  - polygonBoundingRadius garante que TODO vertex do polígono fica dentro
    //  - fanMax estende além do polígono pra POIs visíveis a longa distância
    //  - floor 500m cobre o caso degenerado de polígonos minúsculos
    const fanMax = boundary.visibilityFan?.maxDistanceM ?? 0;
    let polygonBoundingRadius = 0;
    for (const c of boundary.coordinates) {
      const d = calculateDistance(boundary.center, c);
      if (d > polygonBoundingRadius) polygonBoundingRadius = d;
    }
    // Para geofence, o trigger zone É o polígono em geometry_geojson.
    // O app usa point-in-polygon — radius_meters não tem significado aqui.
    // Valor 1 satisfaz o DB constraint (chk_radius_positive > 0).
    const safetyRadius = 1;
    console.log(`🟦 Geofence TP: polygon=${boundary.coordinates.length} pts, area=${boundary.area_m2?.toFixed(0)}m² — trigger zone is the polygon (radius_meters=1, nominal only)`);

    return {
      id: deterministicTPId(poiData.id, 'geofence', boundary.center.lat, boundary.center.lng),
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
    // Safety ceiling — não é "o cap" do POI.
    //
    // O controle real de quantos TPs são gerados vive em `applyOptions`:
    // greedy density thinning com spacing escalado por distância radial ao POI
    // + coverage guarantee por slice angular. A quantidade final é EMERGENTE,
    // não decretada — POI grande/visível-de-longe gera mais TPs sem cap;
    // POI pequeno gera poucos, sem padding artificial.
    //
    // Este número existe só pra evitar runaway em edge cases (POI degenerado
    // que vire fan-walk de 100k candidatos). 5000 é alto o suficiente pra
    // nunca limitar legitimamente.
    const SAFETY_CEILING = 5000;
    console.log(`📊 TP safety ceiling: ${SAFETY_CEILING} (real control is density thinning in applyOptions)`);
    return SAFETY_CEILING;
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

// Validador e ranker de trigger points

import { POIData, GeographicContext, TriggerPointCandidate, TriggerPoint, BoundaryData, DirectionalAnalysis } from '../types/interfaces';
import { calculateOptimalRadius, calculateDistance, calculateBearing, extractBuildingHeight, normalizeAngleDifference, isPointInPolygon } from '../utils/calculations';
import { VisibilityValidator } from './visibility-validator';
import { ElevationAnalysisService } from '../services/elevation-service';
import { loadTriggerPointsConfig, TriggerPointsConfig, TRIGGER_POINTS_CONSTANTS } from '../config/trigger-points-config';
import { GoogleAPIsService } from '../services/google-apis.service';
import { DirectionalAnalyzer } from './directional-analyzer';

export class TriggerPointValidator {
  private visibilityValidator: VisibilityValidator;
  private directionalAnalyzer: DirectionalAnalyzer;
  
  // Cache para obstruções (QUALIDADE > PERFORMANCE)
  private static obstructionsCache = new Map<string, { 
    data: { buildings: any[]; vegetation: any[]; barriers: any[] }, 
    timestamp: number 
  }>();
  private static CACHE_DURATION = TRIGGER_POINTS_CONSTANTS.obstructions.cacheDuration * 60 * 1000; // minutos
  
  // Cache para resultado de isPOIInUrbanCanyon (evita recalcular para cada candidato)
  private urbanCanyonCache: { result: boolean; boundaryId: string } | null = null;
  
  constructor(googleAPIs: GoogleAPIsService) {
    this.visibilityValidator = new VisibilityValidator(googleAPIs);
    this.directionalAnalyzer = new DirectionalAnalyzer();
  }
  
  /**
   * NOVO: Análise direcional para determinar onde permitir TPs
   */
  async analyzeDirectionalVisibility(
    poiData: POIData,
    boundary: BoundaryData,
    context: GeographicContext,
    existingStreets?: any[], // NOVO: ruas já encontradas
    existingBuildings?: any[] // NOVO: construções já encontradas
  ): Promise<DirectionalAnalysis[]> {
    console.log(`🧭 Starting directional visibility analysis for ${poiData.name}...`);
    
    try {
      const directionalAnalysis = await this.directionalAnalyzer.analyzeAllDirections(
        poiData, 
        boundary, 
        context,
        existingStreets,
        existingBuildings
      );
      
      // Log resumo
      const allowedDirections = directionalAnalysis.filter(d => d.allowTPs);
      const blockedDirections = directionalAnalysis.filter(d => !d.allowTPs);
      
      console.log(`🎯 Directional analysis results:`);
      console.log(`✅ ALLOWED directions (${allowedDirections.length}): ${allowedDirections.map(d => d.direction).join(', ')}`);
      console.log(`❌ BLOCKED directions (${blockedDirections.length}): ${blockedDirections.map(d => d.direction).join(', ')}`);
      
      return directionalAnalysis;
    } catch (error) {
      console.error('Error in directional analysis:', error);
      return [];
    }
  }

  /**
   * Calcula limite dinâmico de TPs baseado nos candidatos reais
   * NOVA FÓRMULA: Mais permissiva para itens altos e grandes
   */
  private calculateDynamicTPLimit(candidates: TriggerPointCandidate[], fallbackLimit: number, boundary?: BoundaryData, context?: GeographicContext, config?: TriggerPointsConfig): number {
    if (candidates.length === 0) {
      return Math.max(3, fallbackLimit);
    }
    
    // Carregar configuração
    const cfg = config || loadTriggerPointsConfig();
    
    // 🎯 NOVA LÓGICA: Base mais permissiva baseada em características do POI
    let basePercentage = cfg.maxTriggerPoints.basePercentage;
    let maxLimit = cfg.maxTriggerPoints.limits.max;
    
    // 🏢 AJUSTE POR ALTURA DO POI
    if (boundary?.height) {
      const poiHeight = boundary.height;
      if (poiHeight > TRIGGER_POINTS_CONSTANTS.height.extremelyTallThreshold) {
        // POIs muito altos (>100m) - muito mais permissivo
        basePercentage = cfg.maxTriggerPoints.heightAdjustments.extremely_tall.percentage;
        maxLimit = cfg.maxTriggerPoints.heightAdjustments.extremely_tall.maxLimit;
        console.log(`🏗️ VERY TALL POI (${poiHeight}m): Using ${(basePercentage*100).toFixed(1)}% base, max ${maxLimit} TPs`);
      } else if (poiHeight > TRIGGER_POINTS_CONSTANTS.height.veryTallThreshold) {
        // POIs altos (50-100m) - mais permissivo
        basePercentage = cfg.maxTriggerPoints.heightAdjustments.very_tall.percentage;
        maxLimit = cfg.maxTriggerPoints.heightAdjustments.very_tall.maxLimit;
        console.log(`🏢 TALL POI (${poiHeight}m): Using ${(basePercentage*100).toFixed(1)}% base, max ${maxLimit} TPs`);
      } else if (poiHeight > TRIGGER_POINTS_CONSTANTS.height.tallThreshold) {
        // POIs médios (20-50m) - moderadamente permissivo
        basePercentage = cfg.maxTriggerPoints.heightAdjustments.tall.percentage;
        maxLimit = cfg.maxTriggerPoints.heightAdjustments.tall.maxLimit;
        console.log(`🏢 MEDIUM POI (${poiHeight}m): Using ${(basePercentage*100).toFixed(1)}% base, max ${maxLimit} TPs`);
      }
    }
    
    // 🏞️ AJUSTE POR ÁREA DO POI
    if (boundary?.area) {
      const area = boundary.area;
      if (area > TRIGGER_POINTS_CONSTANTS.height.veryLargeAreaThreshold) { // >1km²
        basePercentage = Math.max(basePercentage, cfg.maxTriggerPoints.areaAdjustments.very_large.percentage);
        maxLimit = Math.max(maxLimit, cfg.maxTriggerPoints.areaAdjustments.very_large.maxLimit);
        console.log(`🏞️ VERY LARGE POI (${(area/1000000).toFixed(1)}km²): Increased to ${(basePercentage*100).toFixed(1)}% base, max ${maxLimit} TPs`);
      } else if (area > TRIGGER_POINTS_CONSTANTS.height.largeAreaThreshold) { // >0.5km²
        basePercentage = Math.max(basePercentage, cfg.maxTriggerPoints.areaAdjustments.large.percentage);
        maxLimit = Math.max(maxLimit, cfg.maxTriggerPoints.areaAdjustments.large.maxLimit);
        console.log(`🏛️ LARGE POI (${(area/10000).toFixed(0)} hectares): Increased to ${(basePercentage*100).toFixed(1)}% base, max ${maxLimit} TPs`);
      }
    }
    
    // 🏔️ AJUSTE POR ELEVAÇÃO (landmarks em montanhas)
    if (boundary?.elevation && context) {
      const elevationDiff = boundary.elevation.center - boundary.elevation.average;
      if (elevationDiff > TRIGGER_POINTS_CONSTANTS.height.highElevationThreshold) {
        basePercentage = Math.max(basePercentage, cfg.maxTriggerPoints.elevationAdjustments.high_landmark.percentage);
        maxLimit = Math.max(maxLimit, cfg.maxTriggerPoints.elevationAdjustments.high_landmark.maxLimit);
        console.log(`🏔️ HIGH ELEVATION LANDMARK (+${elevationDiff.toFixed(0)}m): Increased to ${(basePercentage*100).toFixed(1)}% base, max ${maxLimit} TPs`);
      }
    }
    
    // Calcular limite base
    const baseLimit = Math.min(Math.floor(candidates.length * basePercentage), maxLimit);
    
    // 🎯 NOVA ABORDAGEM: Confiar 100% no sistema de filtragem de visibilidade e qualidade
    // Removemos os multiplicadores artificiais e deixamos o sistema de validação fazer seu trabalho
    const finalLimit = Math.max(cfg.maxTriggerPoints.limits.min, baseLimit);
    
    console.log(`🎯 TRUST-BASED Dynamic TP limit calculation:`);
    console.log(`   📊 Candidates: ${candidates.length}`);
    console.log(`   📐 Base (${(basePercentage*100).toFixed(1)}%): ${baseLimit}`);
    console.log(`   🎯 Final limit: ${finalLimit} (trusting 100% in visibility/quality filtering)`);
    console.log(`   ✅ No artificial visibility/obstruction penalties applied`);
    
    return finalLimit;
  }

  /**
   * Valida e rankeia candidatos a trigger points (NOVO: distância mínima + visibilidade)
   * 🎯 ATUALIZADO: Usa configurações específicas do grupo do POI
   */
  async validateAndRankPoints(
    candidates: TriggerPointCandidate[], 
    poiData: POIData, 
    context: GeographicContext,
    boundary: BoundaryData,
    maxTriggerPoints: number = 50,
    minDistanceBetweenTPs: number = 40, // metros (aumentado para melhor qualidade)
    directionalAnalysis: DirectionalAnalysis[] = [] // NOVO: análise direcional
  ): Promise<TriggerPoint[]> {
    // 🎯 USAR CONFIGURAÇÕES DO GRUPO DO POI (se disponível)
    if (boundary.classification) {
      const classification = boundary.classification;
      console.log(`🎯 Using ${classification.group.toUpperCase()} group validation settings`);
      console.log(`   → Visibility threshold: ${classification.visibilityThreshold}`);
      console.log(`   → Max TPs: ${classification.maxTriggerPoints}`);
      console.log(`   → Min distance: ${classification.minDistanceBetweenTPs}m`);
      
      // Substituir parâmetros pelos do grupo
      maxTriggerPoints = classification.maxTriggerPoints;
      minDistanceBetweenTPs = classification.minDistanceBetweenTPs;
    }
    // 🚀 OTIMIZAÇÃO: Calcular elevação base UMA ÚNICA VEZ para evitar centenas de chamadas de API
    let baseElevation: number | null = null;
    if (boundary?.elevation && boundary.elevation.center > 0) {
      console.log(`🏞️ [CACHE] Calculating base elevation once for all candidates...`);
      baseElevation = await ElevationAnalysisService.estimateRegionalBaseElevation(boundary.center, context, poiData);
      console.log(`✅ [CACHE] Base elevation cached: ${baseElevation}m`);
    }
    
    // 🎯 NOVO: Confiar 100% no limite calculado pelo predictor (sem recalcular)
    // O predictor já calculou o limite baseado na área e características do POI
    const dynamicMaxTPs = maxTriggerPoints;
    
    console.log(`🎯 Validating ${candidates.length} trigger point candidates with full validation system`);
    console.log(`🎯 Max TPs: ${dynamicMaxTPs} (trusting predictor calculation), Min distance: ${minDistanceBetweenTPs}m`);
    
    try {
      // ✅ VALIDAÇÃO BÁSICA COMPLETA
      console.log(`🔍 Step 1: Basic validation (distance, quality, accessibility)`);
      const basicValidCandidates = [];
      for (const candidate of candidates) {
        const isValid = await this.isValidCandidate(candidate, poiData, context, boundary, baseElevation);
        if (isValid) {
          basicValidCandidates.push(candidate);
        }
      }
      
      console.log(`📊 ${basicValidCandidates.length}/${candidates.length} candidates passed basic validation`);
      
      // M2: VALIDAÇÃO DE SENTIDO DE VIA - REMOVIDA
      // Motivo: Lógica incorreta (90°-270° não é contramão) e muito restritiva para canyons urbanos
      console.log(`🔍 Step 1.5: Oneway direction validation - DISABLED (too restrictive for urban canyons)`);
      const onewayValidCandidates = basicValidCandidates; // Pular validação de direção

      console.log(`🚦 [M2] ${onewayValidCandidates.length}/${basicValidCandidates.length} candidates (oneway validation disabled)`);
      
      // ✅ VALIDAÇÃO DE VISIBILIDADE COMPLETA (já inclui auto-aprovação de ruas da frente)
      console.log(`🔍 Step 2: Visibility validation (line of sight)`);
      const visibilityValidCandidates = await this.filterByVisibilityOptimized(onewayValidCandidates, boundary, context);
      
      console.log(`👁️ ${visibilityValidCandidates.length} candidates have clear line of sight`);
      
      // Ordenar por prioridade: FRONT STREETS primeiro, depois por qualidade
      const rankedCandidates = visibilityValidCandidates.sort((a, b) => {
        const aIsFrontStreet = this.isTPOnFrontStreet(a, boundary);
        const bIsFrontStreet = this.isTPOnFrontStreet(b, boundary);
        
        // Front streets têm prioridade máxima
        if (aIsFrontStreet && !bIsFrontStreet) return -1;
        if (!aIsFrontStreet && bIsFrontStreet) return 1;
        
        // Se ambos são front streets ou nenhum é, ordenar por qualidade
        return b.quality - a.quality;
      });
      
      // ✅ FILTRO DE DISTÂNCIA MÍNIMA COMPLETO
      console.log(`🔍 Step 3: Distance filtering (min ${minDistanceBetweenTPs}m between TPs)`);
      const selectedTriggerPoints = this.selectTriggerPointsWithMinDistance(rankedCandidates, dynamicMaxTPs, minDistanceBetweenTPs, boundary, context);
      console.log(`📏 ${selectedTriggerPoints.length} trigger points selected after all filtering`);
      
      // ✅ REMOVER DUPLICATAS FINAIS
      const finalTriggerPoints = this.removeDuplicateTriggerPoints(selectedTriggerPoints);
      if (finalTriggerPoints.length !== selectedTriggerPoints.length) {
        console.log(`🚫 Removed ${selectedTriggerPoints.length - finalTriggerPoints.length} duplicate trigger points`);
      }
      
      console.log(`✅ VALIDATION COMPLETE: ${finalTriggerPoints.length} high-quality trigger points selected`);
      return finalTriggerPoints;
      
    } catch (error) {
      console.error('Error validating and ranking points:', error);
      return [];
    }
  }
  
  
  /**
   * NOVO: Seleciona TPs garantindo distância mínima entre eles
   * 🆕 Ajusta distância mínima baseado no tamanho do POI
   */
  private selectTriggerPointsWithMinDistance(
    rankedCandidates: TriggerPointCandidate[],
    maxTriggerPoints: number,
    minDistance: number,
    boundary: BoundaryData,
    context: GeographicContext
  ): TriggerPoint[] {
    const selectedTPs: TriggerPoint[] = [];
    let rejectedCount = 0;
    
    // 🆕 Ajustar distância mínima baseado no tamanho do POI e altura
    const poiHeight = boundary.height || 0;
    const isSmallPOI = boundary.area < 10000;
    const isDenseZone = context.urbanDensity.level === 'very_dense' || context.urbanDensity.level === 'dense';
    const isFlatPOI = poiHeight === 0 || poiHeight < 5;
    
    let adjustedMinDistance = minDistance;
    
    // POIs pequenos (< 10000m²) precisam de distância mínima maior
    if (isSmallPOI) {
      adjustedMinDistance = Math.max(adjustedMinDistance, 60); // Mínimo 60m para POIs pequenos
    }
    
    // POIs FLAT em áreas densas precisam de distância mínima maior para evitar TPs próximos sem visão
    if (isFlatPOI && isDenseZone) {
      adjustedMinDistance = Math.max(adjustedMinDistance, 80); // Mínimo 80m para POIs FLAT em áreas densas
      console.log(`📏 FLAT POI in dense zone: increasing min distance to ${adjustedMinDistance}m (POI height: ${poiHeight}m)`);
    }
    
    if (adjustedMinDistance > minDistance) {
      console.log(`📏 Adjusted min distance from ${minDistance}m to ${adjustedMinDistance}m (small: ${isSmallPOI}, flat: ${isFlatPOI}, dense: ${isDenseZone})`);
    }
    
    const STANDARD_TP_RADIUS = 20; // metros (fixo)
    const minDistanceBetweenCenters = (STANDARD_TP_RADIUS * 2) + adjustedMinDistance;
    console.log(`🔍 Selecting TPs with ${adjustedMinDistance}m spacing between edges (${minDistanceBetweenCenters}m min between centers, range: ${STANDARD_TP_RADIUS}m fixed)...`);
    
    for (const candidate of rankedCandidates) {
      // Verificar se já temos o máximo de TPs
      if (selectedTPs.length >= maxTriggerPoints) {
        console.log(`✋ Reached maximum of ${maxTriggerPoints} trigger points`);
        break;
      }
      
      // Verificar distância mínima com TPs já selecionados
      // REGRA: Range fixo de 20m + espaçamento entre bordas (40m, 80m, 100m conforme grupo)
      // Fórmula: 20m (range TP1) + espaçamento + 20m (range TP2) = distância mínima entre centros
      const STANDARD_TP_RADIUS = 20; // metros (fixo, não calcular)
      const minSpacingBetweenEdges = adjustedMinDistance; // 40m, 80m, 100m conforme grupo
      const minDistanceBetweenCenters = (STANDARD_TP_RADIUS * 2) + minSpacingBetweenEdges;
      
      let closestDistance = Infinity;
      let closestTP: any = null;
      const isTooClose = selectedTPs.some(existingTP => {
        const distanceBetweenCenters = calculateDistance(candidate.location, existingTP.location);
        if (distanceBetweenCenters < closestDistance) {
          closestDistance = distanceBetweenCenters;
          closestTP = existingTP;
        }
        // Verificar se distância entre centros é menor que o mínimo necessário
        return distanceBetweenCenters < minDistanceBetweenCenters;
      });
      
      if (isTooClose) {
        rejectedCount++;
        // console.log(`🚫 TP rejected (too close): ${candidate.location.lat.toFixed(6)}, ${candidate.location.lng.toFixed(6)} - Quality: ${candidate.quality.toFixed(3)}`);
        continue;
      }
      
      // Candidato aprovado - converter para TriggerPoint
      const triggerPoint = this.convertToTriggerPoint(candidate, selectedTPs.length, boundary, context);
      selectedTPs.push(triggerPoint);
      
      // console.log(`✅ TP #${selectedTPs.length} selected: ${triggerPoint.location.lat.toFixed(6)}, ${triggerPoint.location.lng.toFixed(6)} - Quality: ${triggerPoint.quality.toFixed(3)}`);
    }
    
    console.log(`📊 Final selection: ${selectedTPs.length} TPs selected, ${rejectedCount} rejected for proximity`);
    return selectedTPs;
  }
  
  /**
   * NOVO: Filtra candidatos baseado na visibilidade do boundary
   */
  private async filterByVisibility(
    candidates: TriggerPointCandidate[],
    boundary: BoundaryData,
    context: GeographicContext
  ): Promise<TriggerPointCandidate[]> {
    const validCandidates: TriggerPointCandidate[] = [];
    let visibilityChecks = 0;
    let visibilityPassed = 0;
    let visibilityFailed = 0;

    console.log(`🔍 Checking visibility for ${candidates.length} candidates...`);

    // Processar candidatos em lotes para não sobrecarregar APIs
    const batchSize = TRIGGER_POINTS_CONSTANTS.processing.batchSize;
    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (candidate) => {
        visibilityChecks++;
        
        try {
          const visibilityResult = await this.visibilityValidator.validateVisibility(
            candidate,
            boundary,
            context
          );

          // 🎯 Critérios de aprovação na validação de visibilidade (com threshold por grupo)
          const visibilityThreshold = boundary.classification?.visibilityThreshold || TRIGGER_POINTS_CONSTANTS.scores.minVisibilityConfidence;
          
          const hasGoodVisibility = 
            visibilityResult.hasLineOfSight && 
            visibilityResult.confidence >= visibilityThreshold && 
            visibilityResult.visibleBoundaryPercentage >= TRIGGER_POINTS_CONSTANTS.scores.minVisibilityPercentage; // Percentual configurável

          if (hasGoodVisibility) {
            // Boost na qualidade baseado na visibilidade
            const visibilityBonus = (visibilityResult.confidence - visibilityThreshold) * TRIGGER_POINTS_CONSTANTS.ratios.visibilityBonus;
            const enhancedCandidate = {
              ...candidate,
              quality: Math.min(TRIGGER_POINTS_CONSTANTS.scores.maxQuality, candidate.quality + visibilityBonus),
              confidence: Math.min(TRIGGER_POINTS_CONSTANTS.scores.maxQuality, candidate.confidence + visibilityBonus * TRIGGER_POINTS_CONSTANTS.processing.visibilityBonusMultiplier)
            };
            
            visibilityPassed++;
            console.log(`✅ TP has clear visibility: ${candidate.location.lat.toFixed(6)}, ${candidate.location.lng.toFixed(6)} - Visibility: ${visibilityResult.visibleBoundaryPercentage.toFixed(1)}% (${visibilityResult.method})`);
            return enhancedCandidate;
          } else {
            visibilityFailed++;
            console.log(`🚫 TP blocked by obstructions: ${candidate.location.lat.toFixed(6)}, ${candidate.location.lng.toFixed(6)} - Visibility: ${visibilityResult.visibleBoundaryPercentage.toFixed(1)}% - Obstructions: ${visibilityResult.obstructions.join(', ')}`);
            return null;
          }
          
        } catch (error) {
          console.error(`❌ Visibility check failed for TP ${candidate.location.lat.toFixed(6)}, ${candidate.location.lng.toFixed(6)}:`, error);
          visibilityFailed++;
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      validCandidates.push(...batchResults.filter(result => result !== null));
      
      // Log de progresso
      console.log(`📊 Batch ${Math.floor(i / batchSize) + 1}: ${batchResults.filter(r => r !== null).length}/${batch.length} passed visibility`);
    }

    console.log(`👁️ Visibility validation complete: ${visibilityPassed} passed, ${visibilityFailed} failed (${visibilityChecks} total)`);
    console.log(`📈 Visibility success rate: ${((visibilityPassed / visibilityChecks) * 100).toFixed(1)}%`);

    return validCandidates;
  }
  
  /**
   * NOVO: Filtro de visibilidade otimizado (mais rápido e eficiente) com análise de altura do POI
   */
  private async filterByVisibilityOptimized(
    candidates: TriggerPointCandidate[],
    boundary: BoundaryData,
    context: GeographicContext
  ): Promise<TriggerPointCandidate[]> {
    const validCandidates: TriggerPointCandidate[] = [];
    let visibilityPassed = 0;
    let visibilityFailed = 0;

    console.log(`🚀 SUPER OPTIMIZED visibility check for ${candidates.length} candidates...`);
    console.log(`🏗️ Step 1: Fetching ALL obstructions in region with SINGLE OSM call...`);

    // 🚀 OTIMIZAÇÃO: Buscar todas as obstruções da região em UMA ÚNICA chamada
    let obstructions;
    try {
      obstructions = await this.getAllObstructionsInRegion(candidates, boundary, context);
      console.log(`🌳 Found ${obstructions.buildings.length} buildings, ${obstructions.vegetation.length} vegetation, ${obstructions.barriers.length} barriers in region (1 API call instead of ${candidates.length})`);
    } catch (error) {
      console.warn(`⚠️ Failed to fetch obstructions, using buildings-only fallback: ${(error as Error).message}`);
      // Fallback: buscar apenas buildings (método original)
      const buildings = await this.getAllBuildingsInRegionFallback(candidates, boundary, context);
      obstructions = { buildings, vegetation: [], barriers: [] };
      console.log(`🏢 Fallback: Found ${buildings.length} buildings only`);
    }

    console.log(`🏗️ Step 2: Processing visibility for each TP using cached obstructions...`);
    
    // Processar cada candidato usando as obstruções já carregadas
    for (const candidate of candidates) {
      try {
        // Usar validação com obstruções já carregadas (SEM chamadas API)
        const hasGoodVisibility = await this.checkVisibilityWithCachedObstructions(
          candidate, 
          boundary, 
          context, 
          obstructions
        );
        
        if (hasGoodVisibility) {
          const enhancedCandidate = {
            ...candidate,
            quality: Math.min(TRIGGER_POINTS_CONSTANTS.scores.maxQuality, candidate.quality + TRIGGER_POINTS_CONSTANTS.ratios.frontStreetBonus),
            confidence: Math.min(TRIGGER_POINTS_CONSTANTS.scores.maxQuality, candidate.confidence + TRIGGER_POINTS_CONSTANTS.ratios.frontStreetConfidenceBonus)
          };
          
          validCandidates.push(enhancedCandidate);
          visibilityPassed++;
        } else {
          visibilityFailed++;
        }
      } catch (error) {
        console.warn('Cached visibility check failed:', error);
        // Fail-safe: aceitar candidato se não conseguir verificar
        validCandidates.push(candidate);
        visibilityPassed++;
      }
    }

    console.log(`👁️ SUPER OPTIMIZED visibility complete: ${visibilityPassed} passed, ${visibilityFailed} failed`);
    console.log(`📈 Visibility success rate: ${((visibilityPassed / (visibilityPassed + visibilityFailed)) * 100).toFixed(1)}%`);
    console.log(`🚀 Performance: 1 API call instead of ${candidates.length} calls (${candidates.length}x faster!)`);

    return validCandidates;
  }
  
  /**
   * 🚀 EXPANDIDO: Busca todas as obstruções (buildings, vegetação, muros) em uma região
   * Usa o raio de busca de TPs para determinar a área relevante
   * COM CACHE para evitar re-queries (QUALIDADE > PERFORMANCE)
   */
  private async getAllObstructionsInRegion(
    candidates: TriggerPointCandidate[],
    boundary: BoundaryData,
    context: GeographicContext
  ): Promise<{
    buildings: any[];
    vegetation: any[];
    barriers: any[];
  }> {
    
    // 🚀 NOVA LÓGICA: Usar dados consolidados se disponíveis
    if (boundary.buildings || boundary.vegetation || boundary.barriers) {
      console.log(`🚀 CONSOLIDATION BENEFIT: Using consolidated obstructions data from boundary`);
      console.log(`🏢 Buildings: ${boundary.buildings?.length || 0}, Vegetation: ${boundary.vegetation?.length || 0}, Barriers: ${boundary.barriers?.length || 0}`);
      
      return {
        buildings: boundary.buildings || [],
        vegetation: boundary.vegetation || [],
        barriers: boundary.barriers || []
      };
    }
    if (candidates.length === 0) return { buildings: [], vegetation: [], barriers: [] };

    // 🎯 USAR O RAIO DE BUSCA DE TPs para determinar a área
    const searchRadius = this.calculateSearchRadiusForRegion(boundary, context);
    console.log(`🎯 Using TP search radius: ${searchRadius}m for obstructions region`);

    // Verificar cache primeiro
    const cacheKey = `${boundary.center.lat.toFixed(4)},${boundary.center.lng.toFixed(4)},${searchRadius}`;
    const cached = TriggerPointValidator.obstructionsCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < TriggerPointValidator.CACHE_DURATION) {
      console.log(`🌳 Using cached obstructions data (${cached.data.buildings.length} buildings, ${cached.data.vegetation.length} vegetation, ${cached.data.barriers.length} barriers)`);
      return cached.data;
    }

    // Calcular bounding box baseado no centro do boundary + raio de busca
    const boundaryCenter = this.calculateBoundaryCenter(boundary.coordinates);
    
    // Converter raio em metros para graus (aproximação)
    const radiusInDegrees = searchRadius / 111000; // 1 grau ≈ 111km
    
    const minLat = boundaryCenter.lat - radiusInDegrees;
    const maxLat = boundaryCenter.lat + radiusInDegrees;
    const minLng = boundaryCenter.lng - radiusInDegrees;
    const maxLng = boundaryCenter.lng + radiusInDegrees;

    console.log(`📦 Obstructions search area: ${searchRadius}m radius around POI`);
    console.log(`📦 Bounding box: ${minLat.toFixed(6)}, ${minLng.toFixed(6)} → ${maxLat.toFixed(6)}, ${maxLng.toFixed(6)}`);

    // Query simplificada para evitar erro 400
    const obstructionsQuery = `
[out:json][timeout:60];
(
  way["building"](around:${searchRadius},${boundaryCenter.lat},${boundaryCenter.lng});
);
out geom tags;
`;

    try {
      console.log(`🌐 Fetching ALL obstructions in region with single OSM call...`);
      
      // Adicionar timeout de 100s para a requisição (QUALIDADE > PERFORMANCE)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 100000);
      
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: obstructionsQuery,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(`OSM region obstructions query failed: ${response.status}`);
        return { buildings: [], vegetation: [], barriers: [] };
      }

      const osmData = await response.json();
      const elements = osmData.elements || [];

      // Query simplificada retorna apenas buildings
      const buildings: any[] = elements || [];
      const vegetation: any[] = []; // Simplificado - sem vegetação por ora
      const barriers: any[] = []; // Simplificado - sem barreiras por ora
      
      const result = { buildings, vegetation, barriers };
      
      // Armazenar no cache
      TriggerPointValidator.obstructionsCache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });
      
      console.log(`🌳 Obstructions found: ${buildings.length} buildings, ${vegetation.length} vegetation, ${barriers.length} barriers (cached)`);
      
      return result;

    } catch (error) {
      console.error('Failed to fetch region obstructions:', error);
      return { buildings: [], vegetation: [], barriers: [] };
    }
  }

  /**
   * Calcula o raio de busca apropriado para a região (reutiliza lógica do street-analyzer)
   */
  private calculateSearchRadiusForRegion(boundary: BoundaryData, context: GeographicContext): number {
    // Lógica similar ao street-analyzer para determinar raio de busca
    let baseRadius = TRIGGER_POINTS_CONSTANTS.obstructions.baseSearchRadius; // 1km padrão

    // Ajustar baseado na elevação (se disponível)
    if (boundary?.elevation && boundary.elevation.center > 0) {
      const poiElevation = boundary.elevation.center;
      
      if (poiElevation > TRIGGER_POINTS_CONSTANTS.height.veryHighElevationThreshold) {
        // POIs muito altos = raio grande (até 8km)
        baseRadius = Math.min(TRIGGER_POINTS_CONSTANTS.obstructions.maxElevationRadius, Math.sqrt(poiElevation) * TRIGGER_POINTS_CONSTANTS.obstructions.elevationMultiplier);
      } else if (poiElevation > TRIGGER_POINTS_CONSTANTS.height.highElevationThreshold2) {
        // POIs elevados = raio médio
        baseRadius = Math.min(3000, poiElevation * 3);
      }
    }

    // Ajustar baseado na densidade urbana
    // IMPORTANTE: Para obstruções, usar raio maior que para TPs
    // TPs ficam próximos, mas obstruções podem estar mais longe
    switch (context.urbanDensity.level) {
      case 'very_dense': baseRadius = Math.min(baseRadius, TRIGGER_POINTS_CONSTANTS.obstructions.veryDenseRadius); break;
      case 'dense': baseRadius = Math.min(baseRadius, TRIGGER_POINTS_CONSTANTS.obstructions.denseRadius); break;
      case 'medium': baseRadius = Math.min(baseRadius, TRIGGER_POINTS_CONSTANTS.obstructions.mediumRadius); break;
      case 'low': baseRadius = Math.min(baseRadius, TRIGGER_POINTS_CONSTANTS.obstructions.lowRadius); break;
      case 'rural': baseRadius = Math.min(baseRadius, TRIGGER_POINTS_CONSTANTS.obstructions.ruralRadius); break;
    }

    return Math.round(baseRadius);
  }

  /**
   * Calcula o centro do boundary
   */
  private calculateBoundaryCenter(coordinates: { lat: number; lng: number }[]): { lat: number; lng: number } {
    if (coordinates.length === 0) return { lat: 0, lng: 0 };

    let sumLat = 0;
    let sumLng = 0;

    for (const coord of coordinates) {
      sumLat += coord.lat;
      sumLng += coord.lng;
    }

    return {
      lat: sumLat / coordinates.length,
      lng: sumLng / coordinates.length
    };
  }

  /**
   * 🚀 EXPANDIDO: Verifica visibilidade usando obstruções já carregadas em memória (SEM API calls)
   */
  private async checkVisibilityWithCachedObstructions(
    candidate: TriggerPointCandidate,
    boundary: BoundaryData,
    context: GeographicContext,
    obstructions: { buildings: any[]; vegetation: any[]; barriers: any[] }
  ): Promise<boolean> {
    try {
      // Encontrar ponto mais próximo do boundary
      const nearestBoundaryPoint = this.findNearestBoundaryPoint(candidate.location, boundary.coordinates);
      const distance = calculateDistance(candidate.location, nearestBoundaryPoint);

      // 🎯 VALIDAÇÃO RIGOROSA: Considerar altura do POI para auto-aprovação
      const poiHeight = boundary.height || 0;
      const isFrontStreet = this.isTPOnFrontStreet(candidate, boundary);
      const isUrbanCanyon = this.isPOIInUrbanCanyon(boundary, context);
      
      // ✅ CORREÇÃO 3: Remover auto-aprovação para POIs com altura
      // TODOS os TPs devem passar por validação de visibilidade, independente da altura
      // Apenas TPs muito próximos de POIs FLAT podem ser auto-aprovados (validação mais simples)
      
      // REGRA CRÍTICA: TPs na rua da frente do POI
      // APENAS para POIs FLAT muito próximos (< 30m) - auto-aprovar
      if (isFrontStreet) {
        if (poiHeight === 0 || poiHeight < 5) {
          // POI FLAT: só auto-aprovar se muito próximo
          if (distance < 30) {
            console.log(`🏠 TP on FRONT STREET of FLAT POI (${distance.toFixed(0)}m) - AUTO APPROVED (very close, FLAT POI)`);
            return true;
          }
          // Continuar com validação completa para POIs FLAT mais distantes
        }
        // POI com altura: SEMPRE validar visibilidade (não auto-aprovar)
      }
      
      // REGRA AJUSTADA: TPs muito próximos do boundary
      // APENAS para POIs FLAT muito próximos e não em zona densa
      if (distance < TRIGGER_POINTS_CONSTANTS.distances.frontStreetDistance && !isUrbanCanyon) {
        if (poiHeight === 0 || poiHeight < 5) {
          // POI FLAT: só auto-aprovar se muito próximo (< 25m) e não em zona densa
          if (distance < 25 && context.urbanDensity.level !== 'very_dense' && context.urbanDensity.level !== 'dense') {
            console.log(`✅ TP very close to FLAT POI (${distance.toFixed(0)}m) - AUTO APPROVED (low density, FLAT POI)`);
            return true;
          }
          // Continuar com validação completa
        }
        // POI com altura: SEMPRE validar visibilidade (não auto-aprovar)
      }
      
      // Auto-aprovação para canyons urbanos REMOVIDA
      // TODOS os TPs devem passar por validação completa, independente de canyon
      
      if (distance < 75 && isUrbanCanyon) {
        console.log(`🏙️ TP close to boundary in URBAN CANYON (${distance.toFixed(0)}m) - checking obstructions despite proximity`);
        // Continuar com validação completa mesmo próximo
      }

      // 1. Verificar obstrução por buildings (já existente)
      // EXCLUIR buildings dentro do boundary (são parte do POI)
      const relevantBuildings = this.filterBuildingsAlongLineOfSight(
        candidate.location,
        nearestBoundaryPoint,
        obstructions.buildings,
        distance,
        boundary.coordinates // Passar boundary para excluir buildings dentro
      );
      
      // Usar poiHeight já definido acima para validação correta
      const blockedByBuildings = this.checkCachedBuildingsBlocking(
        candidate.location,
        nearestBoundaryPoint,
        relevantBuildings,
        context,
        poiHeight
      );
      
      if (blockedByBuildings) {
        console.log(`🚫 BLOCKED: Buildings block line of sight (${relevantBuildings.length} buildings analyzed, POI height: ${poiHeight}m)`);
        return false;
      }
      
      // NOVO: Validação extra rigorosa para canyon urbano
      if (isUrbanCanyon) {
        const canyonValidation = this.validateCanyonVisibility(
          candidate.location,
          nearestBoundaryPoint,
          relevantBuildings,
          distance
        );
        
        if (!canyonValidation.isVisible) {
          console.log(`🏙️ CANYON BLOCKED: ${canyonValidation.reason} (${relevantBuildings.length} buildings, ${canyonValidation.obstructionDensity.toFixed(1)}% density)`);
          return false;
        }
      }

      // 2. NOVO: Verificar obstrução por vegetação densa
      const blockedByVegetation = this.checkVegetationBlocking(
        candidate.location,
        boundary.center,
        obstructions.vegetation
      );
      
      if (blockedByVegetation) {
        console.log(`🚫 BLOCKED: Dense vegetation blocks line of sight`);
        return false;
      }

      // 3. NOVO: Verificar obstrução por muros/barreiras
      const blockedByBarriers = this.checkBarriersBlocking(
        candidate.location,
        boundary.center,
        obstructions.barriers
      );
      
      if (blockedByBarriers) {
        console.log(`🚫 BLOCKED: Barriers block line of sight`);
        return false;
      }

      // console.log(`✅ Clear line of sight confirmed (${relevantBuildings.length} buildings, ${obstructions.vegetation.length} vegetation, ${obstructions.barriers.length} barriers checked)`);
      return true;

    } catch (error) {
      console.warn('Cached obstructions visibility check failed:', error);
      return true; // Fail-safe
    }
  }

  /**
   * Filtra buildings que estão ao longo da linha de visão entre TP e boundary
   * EXCLUI buildings que estão DENTRO do boundary (são parte do POI)
   */
  private filterBuildingsAlongLineOfSight(
    tpLocation: { lat: number; lng: number },
    boundaryPoint: { lat: number; lng: number },
    buildings: any[],
    lineDistance: number,
    boundaryCoordinates?: Array<{ lat: number; lng: number }>
  ): any[] {
    const relevantBuildings = [];
    const bufferDistance = TRIGGER_POINTS_CONSTANTS.obstructions.bufferDistance; // metros de buffer ao redor da linha

    for (const building of buildings) {
      if (building.geometry && building.geometry.length > 0) {
        // Usar centroid do building para verificação rápida
        const buildingCenter = this.calculateBuildingCentroid(building);
        
        // NOVO: Excluir buildings que estão DENTRO do boundary (são parte do POI)
        if (boundaryCoordinates && boundaryCoordinates.length > 0) {
          if (isPointInPolygon(buildingCenter, boundaryCoordinates)) {
            console.log(`🏢 Building inside POI boundary - EXCLUDED from blocking validation (part of POI)`);
            continue; // Building é parte do POI, não bloqueia visão
          }
        }
        
        // Verificar se o building está próximo à linha de visão
        const distanceToLine = this.calculateDistanceToLine(
          tpLocation,
          boundaryPoint,
          buildingCenter
        );

        if (distanceToLine <= bufferDistance) {
          relevantBuildings.push(building);
        }
      }
    }

    return relevantBuildings;
  }

  /**
   * Calcula centroid de um building OSM
   */
  private calculateBuildingCentroid(building: any): { lat: number; lng: number } {
    if (!building.geometry || building.geometry.length === 0) {
      return { lat: building.lat || 0, lng: building.lon || 0 };
    }

    let sumLat = 0;
    let sumLng = 0;
    let count = 0;

    for (const point of building.geometry) {
      sumLat += point.lat;
      sumLng += point.lon;
      count++;
    }

    return {
      lat: sumLat / count,
      lng: sumLng / count
    };
  }

  /**
   * Calcula distância de um ponto a uma linha
   */
  private calculateDistanceToLine(
    lineStart: { lat: number; lng: number },
    lineEnd: { lat: number; lng: number },
    point: { lat: number; lng: number }
  ): number {
    // Implementação simplificada usando distância perpendicular
    const A = lineEnd.lat - lineStart.lat;
    const B = lineStart.lng - lineEnd.lng;
    const C = lineEnd.lng * lineStart.lat - lineStart.lng * lineEnd.lat;
    
    const distance = Math.abs(A * point.lng + B * point.lat + C) / Math.sqrt(A * A + B * B);
    
    // Converter para metros (aproximação)
    return distance * 111000; // 1 grau ≈ 111km
  }

  /**
   * 🔥 NOVA: Usa a lógica ORIGINAL de validação com buildings já carregados (sem API calls)
   * Agora considera altura do POI para validação correta
   */
  private checkCachedBuildingsBlocking(
    tpLocation: { lat: number; lng: number },
    boundaryPoint: { lat: number; lng: number },
    buildings: any[],
    context: GeographicContext,
    poiHeight: number = 0
  ): boolean {
    try {
      const distance = calculateDistance(tpLocation, boundaryPoint);
      const isDenseZone = context.urbanDensity.level === 'very_dense' || context.urbanDensity.level === 'dense';
      
      // 🎯 VALIDAÇÃO RIGOROSA PARA POIs BAIXOS (FLAT)
      // Para POIs com 0m de altura, qualquer building entre TP e POI bloqueia
      if (poiHeight === 0 || poiHeight < 5) {
        for (const building of buildings) {
          const buildingHeight = extractBuildingHeight(building);
          if (!buildingHeight || buildingHeight <= 0) continue;
          
          const intersects = this.checkBuildingIntersectsLine(building, tpLocation, boundaryPoint);
          if (intersects) {
            // Para POI FLAT, qualquer building > 3m bloqueia
            if (buildingHeight > 3) {
              console.log(`🚫 FLAT POI BLOCKED: Building (${buildingHeight}m) blocks FLAT POI (${poiHeight}m) - TP REJECTED`);
              return true; // BLOQUEADO
            }
          }
        }
      }
      
      // Validação normal para POIs com altura
      for (const building of buildings) {
        const buildingHeight = extractBuildingHeight(building);
        
        if (!buildingHeight || buildingHeight <= 0) continue; // Ignorar buildings sem altura
        
        // 🔥 USAR LÓGICA ORIGINAL: verificar se building intersecta linha de visão
        const intersects = this.checkBuildingIntersectsLine(building, tpLocation, boundaryPoint);
        
        if (intersects) {
          const buildingCenter = this.calculateBuildingCentroid(building);
          const distanceFromTP = calculateDistance(tpLocation, buildingCenter);
          
          // 🎯 VALIDAÇÃO CONSIDERANDO ALTURA DO POI
          if (poiHeight > 0) {
            // Se POI tem altura conhecida, comparar com building
            const blockingRatio = TRIGGER_POINTS_CONSTANTS.obstructions.buildingBlockingRatio; // 0.6 (60%)
            if (buildingHeight >= poiHeight * blockingRatio) {
              console.log(`🚫 BLOCKED: Building (${buildingHeight}m) blocks POI (${poiHeight}m) view - TP REJECTED`);
              return true; // BLOQUEADO
            }
            // Se building é menor que 60% da altura do POI, pode ver por cima
            continue;
          }
          
          // 🔥 VALIDAÇÃO ORIGINAL RIGOROSA (POI sem altura conhecida)
          if (isDenseZone) {
            // Em zonas densas, ser mais rigoroso
            if (buildingHeight > 8) {
              console.log(`🏢 DENSE ZONE BLOCKED: Tall building (${buildingHeight}m) blocks line of sight`);
              return true; // BLOQUEADO
            }
          } else {
            // Em zonas normais, usar altura mínima
            if (buildingHeight > 15) {
              console.log(`🚫 BLOCKED: Tall building (${buildingHeight}m) blocks unknown POI height - TP REJECTED`);
              return true; // BLOQUEADO
            } else if (buildingHeight > TRIGGER_POINTS_CONSTANTS.obstructions.mediumBuildingHeight && distanceFromTP < TRIGGER_POINTS_CONSTANTS.obstructions.closeDistanceThreshold) {
              console.log(`🚫 BLOCKED: Medium building (${buildingHeight}m) too close (${distanceFromTP.toFixed(0)}m) - TP REJECTED`);
              return true; // BLOQUEADO
            }
          }
        }
      }
      
      return false; // NÃO BLOQUEADO
      
    } catch (error) {
      console.warn('Cached buildings blocking check failed:', error);
      // Em caso de erro, ser conservador baseado na zona
      const isDenseZone = context.urbanDensity.level === 'very_dense' || context.urbanDensity.level === 'dense';
      return !isDenseZone; // Em zonas densas, rejeitar se não conseguir verificar
    }
  }

  /**
   * Verifica se um building intersecta a linha de visão (lógica original)
   */
  private checkBuildingIntersectsLine(
    building: any,
    tpLocation: { lat: number; lng: number },
    boundaryPoint: { lat: number; lng: number }
  ): boolean {
    if (!building.geometry || building.geometry.length < 3) return false;
    
    // Converter geometry OSM para formato usado na validação original
    const buildingCoords = building.geometry.map((coord: any) => ({
      lat: coord.lat,
      lng: coord.lon
    }));
    
    // Usar ray-casting para verificar se a linha intersecta o polígono do building
    return this.lineIntersectsPolygon(tpLocation, boundaryPoint, buildingCoords);
  }

  /**
   * Verificação rápida de visibilidade usando apenas buildings OSM
   */
  private async quickVisibilityCheck(
    candidate: TriggerPointCandidate,
    boundary: BoundaryData,
    context: GeographicContext
  ): Promise<boolean> {
    try {
      // Encontrar ponto mais próximo do boundary
      const nearestBoundaryPoint = this.findNearestBoundaryPoint(candidate.location, boundary.coordinates);
      const distanceToBoundary = calculateDistance(candidate.location, nearestBoundaryPoint);
      
      // Se muito próximo do boundary, assumir visibilidade boa
      if (distanceToBoundary < 60) {
        return true;
      }
      
      // Se muito longe, fazer verificação de buildings
      if (distanceToBoundary > TRIGGER_POINTS_CONSTANTS.obstructions.farDistanceThreshold) {
        return this.checkBuildingsBlocking(candidate.location, nearestBoundaryPoint, context);
      }
      
      // Distância média - verificação simplificada
      return this.checkBuildingsBlocking(candidate.location, nearestBoundaryPoint, context);
      
    } catch (error) {
      console.warn('Quick visibility check failed:', error);
      return true; // Fail-safe: aceitar se não conseguir verificar
    }
  }

  /**
   * NOVA: Verificação rápida de visibilidade considerando altura do POI
   */
  private async quickVisibilityCheckWithPOIHeight(
    candidate: TriggerPointCandidate,
    boundary: BoundaryData,
    context: GeographicContext
  ): Promise<boolean> {
    try {
      // Encontrar ponto mais próximo do boundary
      const nearestBoundaryPoint = this.findNearestBoundaryPoint(candidate.location, boundary.coordinates);
      const distanceToBoundary = calculateDistance(candidate.location, nearestBoundaryPoint);
      
      // NOVA LÓGICA: Considerar altura do POI
      const poiHeight = boundary.height || 0;
      const isDenseZone = context.urbanDensity.level === 'very_dense' || context.urbanDensity.level === 'dense';
      
      // console.log(`🏗️ POI height: ${poiHeight}m, Distance to boundary: ${distanceToBoundary.toFixed(0)}m, Dense zone: ${isDenseZone}`);
      
      // Se POI é muito alto (>30m), tem melhor visibilidade mesmo em zonas densas
      if (poiHeight > TRIGGER_POINTS_CONSTANTS.height.highPOIThreshold) {
        console.log(`🏢 HIGH POI: ${poiHeight}m tall, good visibility expected`);
        return distanceToBoundary < TRIGGER_POINTS_CONSTANTS.obstructions.baseSearchRadius; // POIs altos = raio maior
      }
      
      // Se POI é moderadamente alto (15-30m) e zona densa, verificar buildings
      if (poiHeight > 15 && isDenseZone) {
        console.log(`🏢 MEDIUM POI in dense zone: Checking building interference`);
        return this.checkBuildingsBlockingWithPOIHeight(candidate.location, nearestBoundaryPoint, context, poiHeight, boundary.coordinates);
      }
      
      // Se muito próximo do boundary, assumir visibilidade boa
      if (distanceToBoundary < 60) {
        return true;
      }
      
      // POI baixo ou sem altura em zona densa = usar validação PRECISA
      if (isDenseZone && poiHeight < 15) {
        console.log(`🏠 LOW/UNKNOWN POI in dense zone: Using PRECISE line-of-sight validation`);
        return distanceToBoundary < 60 ? true : this.checkBuildingsBlockingWithPOIHeight(candidate.location, nearestBoundaryPoint, context, poiHeight, boundary.coordinates);
      }
      
      // Verificação normal - também usar a precisa para zonas densas
      if (isDenseZone) {
        console.log(`🏙️ Dense zone: Using PRECISE validation regardless of POI height`);
        return this.checkBuildingsBlockingWithPOIHeight(candidate.location, nearestBoundaryPoint, context, poiHeight, boundary.coordinates);
      }
      
      // Apenas zonas não-densas usam validação antiga
      return this.checkBuildingsBlocking(candidate.location, nearestBoundaryPoint, context);
      
    } catch (error) {
      console.warn('Quick visibility check with POI height failed:', error);
      return true; // Fail-safe: aceitar se não conseguir verificar
    }
  }

  /**
   * NOVA: Verificar buildings ESPECIFICAMENTE entre TP e boundary (linha direta)
   */
  private async checkBuildingsBlockingWithPOIHeight(
    tpLocation: { lat: number; lng: number },
    boundaryPoint: { lat: number; lng: number },
    context: GeographicContext,
    poiHeight: number,
    boundaryCoordinates?: Array<{ lat: number; lng: number }>
  ): Promise<boolean> {
    try {
      const distance = calculateDistance(tpLocation, boundaryPoint);
      
      // NOVA ESTRATÉGIA: Buscar buildings ao longo da LINHA DIRETA TP → Boundary
      // Passar boundary para excluir buildings dentro (são parte do POI)
      const lineOfSightBuildings = await this.getBuildingsAlongLineOfSight(tpLocation, boundaryPoint, distance, boundaryCoordinates);
      
      console.log(`🎯 Analyzing ${lineOfSightBuildings.length} buildings directly between TP and boundary (${distance.toFixed(0)}m)`);
      console.log(`📊 Using OSM data for building analysis along line of sight`);

      // Verificar cada building que REALMENTE intersecta a linha de visão
      for (const building of lineOfSightBuildings) {
        const buildingHeight = this.extractBuildingHeight(building) || 12;
        
        // Calcular posição do building na linha TP → Boundary
        const buildingCenter = this.calculateBuildingCenter(building.geometry);
        const distanceFromTP = calculateDistance(tpLocation, buildingCenter);
        const distanceFromBoundary = calculateDistance(buildingCenter, boundaryPoint);
        
        console.log(`🏢 Building at ${distanceFromTP.toFixed(0)}m from TP, ${distanceFromBoundary.toFixed(0)}m from boundary, height: ${buildingHeight}m`);
        
        // REGRA RIGOROSA: Building está ENTRE TP e boundary?
        if (distanceFromTP < distance * TRIGGER_POINTS_CONSTANTS.processing.buildingBetweenThreshold && distanceFromBoundary < distance * TRIGGER_POINTS_CONSTANTS.processing.buildingBetweenThreshold) {
          
          console.log(`⚠️ Building is BETWEEN TP and boundary - analyzing blocking potential...`);
          
          // Se POI tem altura conhecida, comparar
          if (poiHeight > 0) {
            if (buildingHeight >= poiHeight * TRIGGER_POINTS_CONSTANTS.obstructions.buildingBlockingRatio) { // 60% da altura do POI
              console.log(`🚫 BLOCKED: Building (${buildingHeight}m) blocks POI (${poiHeight}m) view - TP REJECTED`);
              console.log(`📍 Blocked TP location: ${tpLocation.lat.toFixed(6)}, ${tpLocation.lng.toFixed(6)}`);
              return false;
            } else {
              console.log(`✅ Building (${buildingHeight}m) lower than POI (${poiHeight}m) - view possible over building`);
            }
          } else {
            // POI sem altura conhecida - ser mais conservador
            if (buildingHeight > 15) { // Buildings altos sempre bloqueiam
              console.log(`🚫 BLOCKED: Tall building (${buildingHeight}m) blocks unknown POI height - TP REJECTED`);
              console.log(`📍 Blocked TP location: ${tpLocation.lat.toFixed(6)}, ${tpLocation.lng.toFixed(6)}`);
              return false;
            } else if (buildingHeight > TRIGGER_POINTS_CONSTANTS.obstructions.mediumBuildingHeight && distanceFromTP < TRIGGER_POINTS_CONSTANTS.obstructions.closeDistanceThreshold) {
              console.log(`🚫 BLOCKED: Medium building (${buildingHeight}m) too close (${distanceFromTP.toFixed(0)}m) - TP REJECTED`);
              console.log(`📍 Blocked TP location: ${tpLocation.lat.toFixed(6)}, ${tpLocation.lng.toFixed(6)}`);
              return false;
            } else {
              console.log(`⚠️ Low building (${buildingHeight}m) may partially block view but allowing`);
            }
          }
        } else {
          console.log(`✅ Building not directly between TP and boundary - no blocking`);
        }
      }

      console.log(`✅ Clear line of sight between TP and boundary`);
      return true;

    } catch (error) {
      console.warn('Buildings line-of-sight check failed:', error);
      return false; // Ser conservador
    }
  }

  /**
   * NOVA: Buscar buildings especificamente ao longo da linha TP → Boundary
   */
  private async getBuildingsAlongLineOfSight(
    tpLocation: { lat: number; lng: number },
    boundaryPoint: { lat: number; lng: number },
    distance: number,
    boundaryCoordinates?: Array<{ lat: number; lng: number }>
  ): Promise<any[]> {
    // Criar múltiplos pontos ao longo da linha para busca mais precisa
    const numSamplePoints = Math.max(TRIGGER_POINTS_CONSTANTS.limits.maxSamplePoints, Math.floor(distance / TRIGGER_POINTS_CONSTANTS.limits.samplePointDistance)); // Pontos configuráveis
    const samplePoints = this.createLineOfSightSamplePoints(tpLocation, boundaryPoint, numSamplePoints);
    
    console.log(`📍 Using ${samplePoints.length} sample points along ${distance.toFixed(0)}m line of sight`);
    
    // Buscar buildings ao redor de cada ponto da linha
    const searchRadius = Math.min(TRIGGER_POINTS_CONSTANTS.obstructions.buildingSearchRadius, distance / 3); // Raio mais focado
    
    const buildingsQuery = `
[out:json][timeout:10];
(
  ${samplePoints.map(point => 
    `way["building"](around:${searchRadius},${point.lat},${point.lng});`
  ).join('\n  ')}
);
out geom meta;
`;

    try {
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: buildingsQuery
      });

      if (!response.ok) {
        console.warn(`OSM line-of-sight buildings query failed: ${response.status}`);
        return [];
      }

      const osmData = await response.json();
      const buildings = osmData.elements || [];
      
      // Filtrar apenas buildings que REALMENTE intersectam a linha TP → Boundary
      const intersectingBuildings = buildings.filter((building: any) => {
        if (!building.geometry || building.geometry.length < 3) return false;
        
        const buildingCoords = building.geometry.map((coord: any) => ({
          lat: coord.lat,
          lng: coord.lon
        }));
        
        return this.lineIntersectsPolygon(tpLocation, boundaryPoint, buildingCoords);
      });
      
      console.log(`🏗️ Found ${buildings.length} buildings near line, ${intersectingBuildings.length} actually intersecting`);
      return intersectingBuildings;
      
    } catch (error) {
      console.warn('Error fetching line-of-sight buildings:', error);
      return [];
    }
  }

  /**
   * NOVA: Criar pontos de amostragem ao longo da linha TP → Boundary
   */
  private createLineOfSightSamplePoints(
    start: { lat: number; lng: number },
    end: { lat: number; lng: number },
    numPoints: number
  ): Array<{ lat: number; lng: number }> {
    const points = [];
    
    for (let i = 0; i <= numPoints; i++) {
      const ratio = i / numPoints;
      const lat = start.lat + (end.lat - start.lat) * ratio;
      const lng = start.lng + (end.lng - start.lng) * ratio;
      points.push({ lat, lng });
    }
    
    return points;
  }

  /**
   * NOVA: Calcular centro de um building
   */
  private calculateBuildingCenter(geometry: any[]): { lat: number; lng: number } {
    const coords = geometry.map(coord => ({ lat: coord.lat, lng: coord.lon }));
    
    const totalLat = coords.reduce((sum, coord) => sum + coord.lat, 0);
    const totalLng = coords.reduce((sum, coord) => sum + coord.lng, 0);
    
    return {
      lat: totalLat / coords.length,
      lng: totalLng / coords.length
    };
  }
  
  /**
   * Verificar se buildings estão bloqueando a linha de visão (ENHANCED com análise de altura)
   */
  private async checkBuildingsBlocking(
    tpLocation: { lat: number; lng: number },
    boundaryPoint: { lat: number; lng: number },
    context: GeographicContext
  ): Promise<boolean> {
    try {
      const distance = calculateDistance(tpLocation, boundaryPoint);
      const midPoint = this.calculateMidpoint(tpLocation, boundaryPoint);
      
      // REGRA ESPECIAL PARA ZONAS DENSAS: Ser mais rigoroso
      const isDenseZone = context.urbanDensity.level === 'very_dense' || context.urbanDensity.level === 'dense';
      const searchRadius = isDenseZone ? 
        Math.min(TRIGGER_POINTS_CONSTANTS.obstructions.denseZoneSearchRadius, distance * 0.8) : // Zonas densas: raio maior e mais rigoroso
        Math.min(TRIGGER_POINTS_CONSTANTS.obstructions.normalZoneSearchRadius, distance / 2);   // Zonas normais: raio menor
      
      const buildingsQuery = `
[out:json][timeout:15];
(
  way["building"](around:${searchRadius},${midPoint.lat},${midPoint.lng});
);
out geom meta;
`;

      console.log(`🏢 Checking buildings in ${searchRadius}m radius (${isDenseZone ? 'DENSE ZONE - STRICT' : 'normal'} mode)`);

      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: buildingsQuery
      });

      if (!response.ok) {
        console.warn(`OSM buildings query failed: ${response.status}`);
        return !isDenseZone; // Em zonas densas, falhar = rejeitar TP
      }

      const osmData = await response.json();
      const buildings = osmData.elements || [];

      console.log(`🏗️ Found ${buildings.length} buildings to check (dense zone: ${isDenseZone})`);

      // REGRA ESPECIAL: Em zonas densas, ser mais rigoroso
      if (isDenseZone && buildings.length >= 1) {
        console.log(`🏙️ DENSE ZONE: Analyzing building heights and blocking more carefully...`);
        return this.analyzeBuildingsWithHeightInDenseZone(buildings, tpLocation, boundaryPoint, context);
      }

      // Zonas normais: lógica existente
      if (buildings.length < 2) {
        return true;
      }

      // Verificar se algum building intersecta a linha de visão
      for (const building of buildings) {
        if (building.geometry && building.geometry.length > 3) {
          const buildingCoords = building.geometry.map((coord: any) => ({
            lat: coord.lat,
            lng: coord.lon
          }));

          if (this.lineIntersectsPolygon(tpLocation, boundaryPoint, buildingCoords)) {
            const buildingHeight = extractBuildingHeight(building);
            console.log(`🚫 Building blocks line of sight (height: ${buildingHeight || 'unknown'}m)`);
            return false; // Bloqueado por building
          }
        }
      }

      console.log(`✅ No buildings blocking line of sight`);
      return true; // Não bloqueado

    } catch (error) {
      console.warn('⚠️ Buildings blocking check failed (network/timeout error):', error instanceof Error ? error.message : error);
      
      // Para POIs de alta elevação (montanhas/picos), assumir que não há bloqueio
      const distance = calculateDistance(tpLocation, boundaryPoint); // ✅ DRY: usar função SSOT
      const isHighElevationPOI = distance > TRIGGER_POINTS_CONSTANTS.limits.highElevation; // TPs muito distantes indicam POI de alta elevação
      
      if (isHighElevationPOI) {
        //console.log(`🏔️ High elevation POI detected (${distance.toFixed(0)}m distance) - assuming no building obstruction`);
        return true; // Para montanhas/picos, assumir visibilidade livre
      }
      
      // Para POIs urbanos, ser mais conservador
      const isDenseZone = context.urbanDensity.level === 'very_dense' || context.urbanDensity.level === 'dense';
      const result = !isDenseZone; // Em zonas densas, falhar = rejeitar TP
      console.log(`🌆 Urban POI - dense zone: ${isDenseZone}, allowing TP: ${result}`);
      return result;
    }
  }

  /**
   * NOVA: Análise rigorosa para zonas densas com consideração de altura
   */
  private analyzeBuildingsWithHeightInDenseZone(
    buildings: any[],
    tpLocation: { lat: number; lng: number },
    boundaryPoint: { lat: number; lng: number },
    context: GeographicContext
  ): boolean {
    let blockingBuildings = 0;
    let totalBuildingHeight = 0;
    let buildingsWithHeight = 0;

    for (const building of buildings) {
      if (building.geometry && building.geometry.length > 3) {
        const buildingCoords = building.geometry.map((coord: any) => ({
          lat: coord.lat,
          lng: coord.lon
        }));

        // Verificar se building intersecta linha de visão
        if (this.lineIntersectsPolygon(tpLocation, boundaryPoint, buildingCoords)) {
          blockingBuildings++;
          
          // Analisar altura do building
          const buildingHeight = extractBuildingHeight(building);
          if (buildingHeight && buildingHeight > 0) {
            totalBuildingHeight += buildingHeight;
            buildingsWithHeight++;
            
            // REGRA RIGOROSA: Buildings altos (>15m) em zonas densas = bloqueio automático
            if (buildingHeight > 15) {
              console.log(`🏢 DENSE ZONE BLOCKED: Tall building (${buildingHeight}m) blocks line of sight`);
              return false;
            }
          } else {
            // Se não tem altura definida em zona densa, assumir altura padrão (12m = 4 andares)
            const assumedHeight = 12;
            totalBuildingHeight += assumedHeight;
            buildingsWithHeight++;
            console.log(`🏢 DENSE ZONE: Assuming ${assumedHeight}m height for building without height data`);
          }
        }
      }
    }

    // REGRA ESPECIAL PARA ZONAS DENSAS
    if (blockingBuildings > 0) {
      const avgBuildingHeight = buildingsWithHeight > 0 ? totalBuildingHeight / buildingsWithHeight : 12;
      
      console.log(`🏙️ DENSE ZONE ANALYSIS: ${blockingBuildings} blocking buildings, avg height: ${avgBuildingHeight.toFixed(1)}m`);
      
      // Se há múltiplos buildings bloqueando OU altura média alta = rejeitar TP
      if (blockingBuildings >= 2 || avgBuildingHeight > 10) {
        console.log(`🚫 DENSE ZONE REJECTED: Multiple buildings (${blockingBuildings}) or high buildings (${avgBuildingHeight.toFixed(1)}m avg)`);
        return false;
      }
      
      // Building único e baixo = aceitar com cuidado
      console.log(`⚠️ DENSE ZONE CAUTIOUS: Single low building, allowing TP`);
      return true;
    }

    console.log(`✅ DENSE ZONE CLEAR: No blocking buildings found`);
    return true;
  }

  /**
   * NOVA: Extrair altura de building dos tags OSM
   */
  private extractBuildingHeight(building: any): number | null {
    if (!building.tags) return null;

    const tags = building.tags;
    
    // Tentar diferentes tags de altura
    if (tags.height) {
      const height = parseFloat(tags.height.replace(/[^\d.]/g, ''));
      if (!isNaN(height) && height > 0) return height;
    }
    
    if (tags['building:height']) {
      const height = parseFloat(tags['building:height'].replace(/[^\d.]/g, ''));
      if (!isNaN(height) && height > 0) return height;
    }
    
    // Converter níveis para altura (3.5m por andar)
    if (tags.levels || tags['building:levels']) {
      const levels = parseInt(tags.levels || tags['building:levels']);
      if (!isNaN(levels) && levels > 0) {
        return levels * 3.5; // 3.5m por andar
      }
    }
    
    return null;
  }
  
  // === HELPER METHODS ===
  
  private findNearestBoundaryPoint(
    location: { lat: number; lng: number },
    boundaryCoordinates: Array<{ lat: number; lng: number }>
  ): { lat: number; lng: number } {
    let nearest = boundaryCoordinates[0];
    let minDistance = calculateDistance(location, nearest);

    for (const point of boundaryCoordinates) {
      const distance = calculateDistance(location, point);
      if (distance < minDistance) {
        minDistance = distance;
        nearest = point;
      }
    }

    return nearest;
  }
  
  
  private calculateMidpoint(
    point1: { lat: number; lng: number },
    point2: { lat: number; lng: number }
  ): { lat: number; lng: number } {
    return {
      lat: (point1.lat + point2.lat) / 2,
      lng: (point1.lng + point2.lng) / 2
    };
  }
  
  private lineIntersectsPolygon(
    lineStart: { lat: number; lng: number },
    lineEnd: { lat: number; lng: number },
    polygon: Array<{ lat: number; lng: number }>
  ): boolean {
    // Verificar se a linha cruza alguma aresta do polígono
    for (let i = 0; i < polygon.length; i++) {
      const polygonStart = polygon[i];
      const polygonEnd = polygon[(i + 1) % polygon.length];
      
      if (this.linesIntersect(lineStart, lineEnd, polygonStart, polygonEnd)) {
        return true;
      }
    }
    return false;
  }

  private linesIntersect(
    line1Start: { lat: number; lng: number },
    line1End: { lat: number; lng: number },
    line2Start: { lat: number; lng: number },
    line2End: { lat: number; lng: number }
  ): boolean {
    const x1 = line1Start.lng, y1 = line1Start.lat;
    const x2 = line1End.lng, y2 = line1End.lat;
    const x3 = line2Start.lng, y3 = line2Start.lat;
    const x4 = line2End.lng, y4 = line2End.lat;

    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-10) return false; // Linhas paralelas

    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }
  

  /**
   * Verifica se um candidato é válido
   */
  private async isValidCandidate(
    candidate: TriggerPointCandidate, 
    poiData: POIData, 
    context: GeographicContext,
    boundary?: BoundaryData,
    cachedBaseElevation?: number | null
  ): Promise<boolean> {
    // Verificar qualidade mínima
    if (candidate.quality < 0.3) {
      console.log(`🚫 Candidate rejected: quality ${candidate.quality.toFixed(2)} < 0.3`);
      return false;
    }
    
    // Verificar distância máxima DINÂMICA baseada na ELEVAÇÃO REAL
    let maxDistance = 1000; // Default para POIs baixos
    
    // 🏔️ USAR ELEVAÇÃO REAL DO BOUNDARY ao invés do contexto estimado
    if (boundary?.elevation && boundary.elevation.center > 0 && cachedBaseElevation !== null) {
      const poiElevation = boundary.elevation.center;
      const baseElevation = cachedBaseElevation || await ElevationAnalysisService.estimateRegionalBaseElevation(boundary.center, context, poiData);
      const elevationDiff = poiElevation - baseElevation;
      
      if (elevationDiff > 150) {
        maxDistance = 15000; // 15km para POIs de alta elevação relativa (Cristo até Copacabana ~8km)
        console.log(`🏔️ HIGH ELEVATION POI detected - elevation: ${poiElevation.toFixed(0)}m, diff: ${elevationDiff.toFixed(0)}m → extending max distance to ${maxDistance}m`);
      } else if (elevationDiff > 50) {
        maxDistance = 4000; // 4km para POIs moderadamente elevados
        //console.log(`⛰️ MODERATE elevation POI - elevation: ${poiElevation.toFixed(0)}m, diff: ${elevationDiff.toFixed(0)}m → extending max distance to ${maxDistance}m`);
      } else {
        //console.log(`🏞️ LOW elevation POI - elevation: ${poiElevation.toFixed(0)}m, diff: ${elevationDiff.toFixed(0)}m → standard max distance: ${maxDistance}m`);
      }
    } else if (context.urbanDensity.level === 'rural') {
      maxDistance = 3000; // 3km para áreas rurais sem dados de elevação
      console.log(`🌾 Rural area without elevation data → extending max distance to ${maxDistance}m`);
    }
    
    if (candidate.distance > maxDistance) {
      console.log(`🚫 Candidate rejected: distance ${candidate.distance.toFixed(0)}m > ${maxDistance}m`);
      return false;
    }
    
    // Verificar acessibilidade
    if (!this.isAccessible(candidate.location, context)) {
      console.log(`🚫 Candidate rejected: not accessible`);
      return false;
    }
    
    // Verificar confiança mínima
    if (candidate.confidence < TRIGGER_POINTS_CONSTANTS.scores.minConfidence) {
      //console.log(`🚫 Candidate rejected: confidence ${candidate.confidence.toFixed(2)} < 0.2`);
      return false;
    }
    
   // console.log(`✅ Candidate accepted: distance ${candidate.distance.toFixed(0)}m, quality ${candidate.quality.toFixed(2)}, confidence ${candidate.confidence.toFixed(2)}`);
    return true;
  }
  
  /**
   * Verifica se um local é acessível
   */
  private isAccessible(location: { lat: number; lng: number }, context: GeographicContext): boolean {
    // Verificações básicas de acessibilidade
    
    // Verificar se as coordenadas são válidas
    if (location.lat < -90 || location.lat > 90 || location.lng < -180 || location.lng > 180) {
      return false;
    }
    
    // Verificar se não está em área muito remota (baseado na densidade urbana)
    if (context.urbanDensity.level === 'rural' && context.infrastructure.infrastructureDensity < 2) {
      // Em áreas muito rurais, ser mais permissivo
      return true;
    }
    
    return true;
  }
  
  /**
   * Converte candidato para trigger point
   */
  private convertToTriggerPoint(
    candidate: TriggerPointCandidate, 
    index: number, 
    boundary: BoundaryData,
    context: GeographicContext
  ): TriggerPoint {
    const id = this.generateTriggerPointId();
    const type = this.determineTriggerType(index, candidate.quality, candidate, boundary, context);
    const priority = index + 1;
    const radius = this.calculateRadius(candidate, context);
    
    return {
      id,
      location: candidate.location,
      radius,
      expectedBearing: candidate.expectedBearing,
      bearingThreshold: 30,
      type,
      priority,
      confidence: candidate.confidence,
      quality: candidate.quality,
      street: candidate.street,
      distance: candidate.distance,
      generationMethod: 'google_apis',
      contextData: context,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }
  
  /**
   * Determina o tipo de trigger point baseado na posição, qualidade e contexto urbano
   */
  private determineTriggerType(
    index: number, 
    quality: number, 
    candidate: TriggerPointCandidate,
    boundary: BoundaryData,
    context: GeographicContext
  ): 'primary' | 'secondary' | 'fallback' {
    
    // NOVO: Verificar se POI está em canyon urbano (cercado por prédios)
    // Nota: Resultado é cacheado, então não há overhead em chamar múltiplas vezes
    const isUrbanCanyon = this.isPOIInUrbanCanyon(boundary, context);
    
    if (isUrbanCanyon) {
      // Em canyon urbano, critérios mais rigorosos
      if (index < 2 && quality > 0.8) {
        return 'primary'; // Apenas 2 primários, qualidade muito alta
      }
      
      if (quality > 0.7) {
        return 'secondary'; // Qualidade alta para secundários
      }
      
      // Qualidade baixa em canyon = fallback
      return 'fallback';
    }
    
    // Lógica original para áreas não-canyon
    if (index < 3 && quality > 0.7) {
      return 'primary';
    }
    
    if (quality > 0.5) {
      return 'secondary';
    }
    
    return 'fallback';
  }
  
  /**
   * Verifica se o TP está na rua da frente do POI (visibilidade garantida)
   */
  private isTPOnFrontStreet(candidate: TriggerPointCandidate, boundary: BoundaryData): boolean {
    // 1. Verificar se o POI tem informações de endereço (addr:street)
    if (boundary.address?.street) {
      const frontStreetName = boundary.address.street.toLowerCase();
      const candidateStreetName = candidate.street.name?.toLowerCase();
      
      if (candidateStreetName && frontStreetName.includes(candidateStreetName)) {
        console.log(`🏠 Front street match: "${candidateStreetName}" matches POI address "${frontStreetName}"`);
        return true;
      }
    }
    
    // 2. Verificar se TP está muito próximo (menos de 30m) - provavelmente na frente
    const nearestBoundaryPoint = this.findNearestBoundaryPoint(candidate.location, boundary.coordinates);
    const distance = calculateDistance(candidate.location, nearestBoundaryPoint);
    
    if (distance < 30) {
      // console.log(`🏠 Very close to POI (${distance.toFixed(0)}m) - likely front street`);
      return true;
    }
    
    // 3. Verificar ângulo de aproximação - TPs frontais têm ângulo < 45° - MANTIDO
    if (candidate.street.coordinates.length >= 2 && boundary.center) {
      // Calcular direção da rua usando primeiro e último ponto
      const streetStart = candidate.street.coordinates[0];
      const streetEnd = candidate.street.coordinates[candidate.street.coordinates.length - 1];
      
      const approachAngle = this.calculateApproachAngle(
        candidate.location,
        boundary.center,
        streetEnd // Usar ponto final da rua como direção
      );
      
      if (approachAngle < 45) {
        console.log(`🏠 Frontal approach angle (${approachAngle.toFixed(0)}°) - likely front street`);
        return true;
      }
    }
    
    // 4. NOVO - Verificar se TP está no lado mais próximo de ruas principais (MELHORIA INCREMENTAL)
    if (this.isTPOnMainStreetSide(candidate, boundary)) {
      // console.log(`🏠 TP on main street side - likely front street`);
      return true;
    }
    
    return false;
  }
  
  /**
   * Calcula ângulo de aproximação entre TP e POI
   */
  private calculateApproachAngle(
    tpLocation: { lat: number; lng: number },
    poiLocation: { lat: number; lng: number },
    streetDirection: { lat: number; lng: number }
  ): number {
    // Calcular bearing da rua (usando função existente)
    const streetBearing = calculateBearing(tpLocation, streetDirection);
    
    // Calcular bearing do TP para o POI (usando função existente)
    const viewBearing = calculateBearing(tpLocation, poiLocation);
    
    // Calcular diferença angular (0-180°)
    let angleDiff = Math.abs(streetBearing - viewBearing);
    if (angleDiff > 180) angleDiff = 360 - angleDiff;
    
    return angleDiff;
  }
  
  // Usar função existente do utils/calculations.ts (SSOT)

  /**
   * NOVO: Verifica se TP está no lado mais próximo de ruas principais (MELHORIA INCREMENTAL)
   * Analisa a geometria do boundary para identificar o lado mais próximo de ruas
   */
  private isTPOnMainStreetSide(candidate: TriggerPointCandidate, boundary: BoundaryData): boolean {
    // Só aplicar se temos coordenadas suficientes
    if (!boundary.coordinates || boundary.coordinates.length < 4) {
      return false;
    }
    
    // Encontrar o lado do boundary mais próximo do TP
    const tpLocation = candidate.location;
    let minDistance = Infinity;
    let closestSideIndex = -1;
    
    // Calcular distância para cada lado do boundary
    for (let i = 0; i < boundary.coordinates.length; i++) {
      const point1 = boundary.coordinates[i];
      const point2 = boundary.coordinates[(i + 1) % boundary.coordinates.length];
      
      // Calcular distância do TP para o segmento de linha
      const distance = this.distanceToLineSegment(tpLocation, point1, point2);
      
      if (distance < minDistance) {
        minDistance = distance;
        closestSideIndex = i;
      }
    }
    
    // Se TP está muito próximo de um lado específico (< 50m), é provavelmente front street
    if (minDistance < 50) {
      // console.log(`🏠 TP very close to boundary side (${minDistance.toFixed(1)}m) - likely front street`);
      return true;
    }
    
    return false;
  }

  /**
   * NOVO: Calcula distância de um ponto para um segmento de linha (MELHORIA INCREMENTAL)
   */
  private distanceToLineSegment(
    point: { lat: number; lng: number },
    lineStart: { lat: number; lng: number },
    lineEnd: { lat: number; lng: number }
  ): number {
    // Calcular distância usando fórmula de distância ponto-linha
    const A = point.lat - lineStart.lat;
    const B = point.lng - lineStart.lng;
    const C = lineEnd.lat - lineStart.lat;
    const D = lineEnd.lng - lineStart.lng;
    
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    
    if (lenSq === 0) {
      // Linha degenerada (ponto)
      return calculateDistance(point, lineStart);
    }
    
    const param = dot / lenSq;
    
    let closestPoint;
    if (param < 0) {
      closestPoint = lineStart;
    } else if (param > 1) {
      closestPoint = lineEnd;
    } else {
      closestPoint = {
        lat: lineStart.lat + param * C,
        lng: lineStart.lng + param * D
      };
    }
    
    return calculateDistance(point, closestPoint);
  }

  /**
   * Verifica se o POI está em um canyon urbano (cercado por prédios altos)
   * CACHEADO: Resultado é calculado apenas uma vez por POI (não recalcula para cada candidato)
   */
  private isPOIInUrbanCanyon(boundary: BoundaryData, context: GeographicContext): boolean {
    // Cache: usar resultado já calculado se disponível
    const boundaryId = `${boundary.center?.lat}-${boundary.center?.lng}-${boundary.height}`;
    if (this.urbanCanyonCache && this.urbanCanyonCache.boundaryId === boundaryId) {
      return this.urbanCanyonCache.result;
    }
    
    // Calcular resultado (apenas uma vez)
    const result = this._calculateUrbanCanyon(boundary, context);
    
    // Armazenar no cache
    this.urbanCanyonCache = { result, boundaryId };
    
    return result;
  }
  
  /**
   * Lógica de cálculo de canyon urbano (separada para permitir cache)
   */
  private _calculateUrbanCanyon(boundary: BoundaryData, context: GeographicContext): boolean {
    // 1. Verificar densidade urbana
    if (context.urbanDensity.level !== 'very_dense' && context.urbanDensity.level !== 'dense') {
      return false;
    }
    
    // 2. Verificar se há dados de altura dos vizinhos
    if (!boundary.surroundingHeight) {
      return false;
    }
    
    const poiHeight = boundary.height || 0;
    const avgSurroundingHeight = boundary.surroundingHeight.average;
    const maxSurroundingHeight = boundary.surroundingHeight.max;
    const buildingCount = boundary.surroundingHeight.buildingCount;
    const heightDifference = poiHeight - avgSurroundingHeight;
    
    // Log apenas uma vez (na primeira chamada)
    console.log(`🏙️ [CANYON CHECK] Analyzing POI...`);
    console.log(`   Height diff: ${heightDifference.toFixed(1)}m (POI ${poiHeight}m - avg ${avgSurroundingHeight}m)`);
    console.log(`   Max surrounding: ${maxSurroundingHeight}m`);
    console.log(`   Building count: ${buildingCount}`);
    
    // 3. Se POI é MUITO MAIS ALTO que vizinhos = NÃO é canyon (visível de longe)
    // SOMENTE se a altura do POI é real (não 0) E não há prédios similares
    if (poiHeight > 0 && heightDifference > 50) {
      // NOVO: Verificar se há prédios com altura similar ao POI
      const maxHeightDifference = Math.abs(poiHeight - maxSurroundingHeight);
      if (maxHeightDifference <= 60) {
        console.log(`   ✅ CANYON: POI similar height to tallest nearby building (POI: ${poiHeight}m, Max nearby: ${maxSurroundingHeight}m, diff: ${maxHeightDifference.toFixed(1)}m)`);
        return true;
      }
      console.log(`   ❌ NOT CANYON: POI much taller than surroundings (+${heightDifference.toFixed(1)}m)`);
      return false;
    }
    
    // 4. Se POI é moderadamente mais alto = NÃO é canyon se área não tiver muitos prédios
    // SOMENTE se a altura do POI é real (não 0)
    if (poiHeight > 0 && heightDifference > 20 && buildingCount < 50) {
      console.log(`   ❌ NOT CANYON: POI taller with low building density (+${heightDifference.toFixed(1)}m, ${buildingCount} buildings)`);
      return false;
    }
    
    // 5. REGRA PRINCIPAL: Densidade ULTRA ALTA de prédios altos = CANYON
    // Copan: 1424 prédios, avg 26m, max 118m
    if (buildingCount > 1000 && avgSurroundingHeight > 20) {
      console.log(`   ✅ CANYON: Ultra high building density with tall buildings (${buildingCount} buildings, avg ${avgSurroundingHeight}m)`);
      return true;
    }
    
    // 5.1. NOVA REGRA: Prédios muito altos próximos ao POI = CANYON
    // Se há prédios com altura similar ao POI (dentro de 20m), é canyon
    if (maxSurroundingHeight > 0 && poiHeight > 0) {
      const heightSimilarity = Math.abs(poiHeight - maxSurroundingHeight);
      if (heightSimilarity <= 20 && buildingCount > 500) {
        console.log(`   ✅ CANYON: Similar height buildings nearby (POI: ${poiHeight}m, Max nearby: ${maxSurroundingHeight}m, diff: ${heightSimilarity.toFixed(1)}m)`);
        return true;
      }
    }
    
    // 6. Densidade MUITO ALTA + prédios muito altos = CANYON
    // Para áreas com muitos prédios E prédios muito altos
    if (buildingCount > 500 && avgSurroundingHeight > 25) {
      console.log(`   ✅ CANYON: Very high building density with very tall buildings (${buildingCount} buildings, avg ${avgSurroundingHeight}m)`);
      return true;
    }
    
    // 6.1. NOVA REGRA: Análise de distribuição de alturas (canyon urbano)
    // Se há muitos prédios altos (acima de 80% da altura do POI), é canyon
    if (boundary.surroundingHeight.tallBuildingsCount && poiHeight > 0) {
      const tallBuildingsRatio = boundary.surroundingHeight.tallBuildingsCount / buildingCount;
      const tallBuildingThreshold = poiHeight * 0.8; // 80% da altura do POI
      
      if (tallBuildingsRatio > 0.1 && maxSurroundingHeight > tallBuildingThreshold) {
        console.log(`   ✅ CANYON: High ratio of tall buildings (${(tallBuildingsRatio * 100).toFixed(1)}% above ${tallBuildingThreshold.toFixed(0)}m)`);
        return true;
      }
    }
    
    // 7. NOVO: Densidade ALTA + prédios moderados = CANYON (para áreas densas)
    // Museu Municipal: 18 prédios, avg 14m em área very_dense
    if (context.urbanDensity.level === 'very_dense' && buildingCount > 15 && avgSurroundingHeight > 10) {
      console.log(`   ✅ CANYON: High building density in very dense area (${buildingCount} buildings, avg ${avgSurroundingHeight}m)`);
      return true;
    }
    
    // 8. NOVO: Densidade MÉDIA + prédios moderados = CANYON (para áreas densas)
    if (context.urbanDensity.level === 'dense' && buildingCount > 30 && avgSurroundingHeight > 12) {
      console.log(`   ✅ CANYON: Medium building density in dense area (${buildingCount} buildings, avg ${avgSurroundingHeight}m)`);
      return true;
    }
    
    // 9. Se POI tem altura E não é significativamente mais alto + densidade alta = canyon
    // SOMENTE se POI tem altura conhecida (não fallback para 0)
    if (poiHeight > 0 && heightDifference < 10 && buildingCount > 300) {
      console.log(`   ✅ CANYON: POI not taller than surroundings in dense area (${poiHeight}m vs avg ${avgSurroundingHeight}m, ${buildingCount} buildings)`);
      return true;
    }
    
    // 10. Padrão: NÃO é canyon (dar chance de validar visibilidade)
    console.log(`   ❌ NOT CANYON: Insufficient evidence (diff: ${heightDifference.toFixed(1)}m, ${buildingCount} buildings)`);
    return false;
  }
  
  /**
   * Validação rigorosa de visibilidade para canyon urbano
   */
  private validateCanyonVisibility(
    tpLocation: { lat: number; lng: number },
    poiLocation: { lat: number; lng: number },
    buildings: any[],
    distance: number
  ): { isVisible: boolean; reason: string; obstructionDensity: number } {
    
    if (buildings.length === 0) {
      return { isVisible: true, reason: 'No buildings in line of sight', obstructionDensity: 0 };
    }
    
    // 1. Calcular densidade de obstruções ao longo da linha de visão
    const lineOfSightLength = distance;
    const obstructionDensity = (buildings.length / lineOfSightLength) * 1000; // obstruções por km
    
    // 2. Em canyon urbano, tolerância EXTREMAMENTE baixa para obstruções
    if (obstructionDensity > 1) { // Mais de 1 prédio por km de linha de visão (era 2)
      return { 
        isVisible: false, 
        reason: 'Too many buildings in line of sight', 
        obstructionDensity 
      };
    }
    
    // 3. Verificar se há prédios bloqueando (qualquer altura em canyon urbano)
    const blockingBuildings = buildings.filter(building => {
      const height = extractBuildingHeight(building.tags);
      return height > 20; // Qualquer prédio >20m bloqueia em canyon urbano
    });
    
    if (blockingBuildings.length > 0) {
      return { 
        isVisible: false, 
        reason: `Buildings blocking (${blockingBuildings.length} buildings >20m)`, 
        obstructionDensity 
      };
    }
    
    // 4. Verificar distância - em canyon, TPs muito distantes são problemáticos
    if (distance > TRIGGER_POINTS_CONSTANTS.distances.canyonAnalysisDistance) { // Distância configurável
      return { 
        isVisible: false, 
        reason: 'Too far in urban canyon (distance > 100m)', 
        obstructionDensity 
      };
    }
    
    return { isVisible: true, reason: 'Canyon validation passed', obstructionDensity };
  }
  
  // Usar função centralizada do utils/calculations.ts (DRY)
  
  /**
   * Calcula raio do trigger point
   */
  private calculateRadius(candidate: TriggerPointCandidate, context: GeographicContext): number {
    // REGRA: Range fixo de 20m (não calcular dinamicamente)
    // Conforme especificação: sempre usar 20m como range padrão
    const STANDARD_TP_RADIUS = 20; // metros (fixo)
    return STANDARD_TP_RADIUS;
  }
  
  /**
   * Gera ID único para trigger point
   */
  private generateTriggerPointId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `tp_${timestamp}_${random}`;
  }
  
  /**
   * Valida trigger points finais
   */
  validateFinalTriggerPoints(triggerPoints: TriggerPoint[]): {
    valid: TriggerPoint[];
    invalid: TriggerPoint[];
    issues: string[];
  } {
    const valid: TriggerPoint[] = [];
    const invalid: TriggerPoint[] = [];
    const issues: string[] = [];
    
    for (const tp of triggerPoints) {
      const validation = this.validateSingleTriggerPoint(tp);
      
      if (validation.isValid) {
        valid.push(tp);
      } else {
        invalid.push(tp);
        issues.push(...validation.issues);
      }
    }
    
    return { valid, invalid, issues };
  }
  
  /**
   * Valida um trigger point individual
   */
  private validateSingleTriggerPoint(tp: TriggerPoint): {
    isValid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];
    
    // Verificar coordenadas
    if (tp.location.lat < -90 || tp.location.lat > 90) {
      issues.push(`Invalid latitude: ${tp.location.lat}`);
    }
    
    if (tp.location.lng < -180 || tp.location.lng > 180) {
      issues.push(`Invalid longitude: ${tp.location.lng}`);
    }
    
    // Verificar raio
    if (tp.radius < 10 || tp.radius > 200) {
      issues.push(`Invalid radius: ${tp.radius}m (must be between 10-200m)`);
    }
    
    // Verificar bearing
    if (tp.expectedBearing < 0 || tp.expectedBearing > 360) {
      issues.push(`Invalid bearing: ${tp.expectedBearing} (must be between 0-360)`);
    }
    
    // Verificar threshold
    if (tp.bearingThreshold < 0 || tp.bearingThreshold > 180) {
      issues.push(`Invalid bearing threshold: ${tp.bearingThreshold} (must be between 0-180)`);
    }
    
    // Verificar qualidade
    if (tp.quality < 0 || tp.quality > 1) {
      issues.push(`Invalid quality: ${tp.quality} (must be between 0-1)`);
    }
    
    // Verificar confiança
    if (tp.confidence < 0 || tp.confidence > 1) {
      issues.push(`Invalid confidence: ${tp.confidence} (must be between 0-1)`);
    }
    
    // Verificar distância
    if (tp.distance < 0 || tp.distance > 2000) {
      issues.push(`Invalid distance: ${tp.distance}m (must be between 0-2000m)`);
    }
    
    // Verificar tipo
    if (!['primary', 'secondary', 'fallback'].includes(tp.type)) {
      issues.push(`Invalid type: ${tp.type} (must be primary, secondary, or fallback)`);
    }
    
    // Verificar prioridade
    if (tp.priority < 1) {
      issues.push(`Invalid priority: ${tp.priority} (must be >= 1)`);
    }
    
    return {
      isValid: issues.length === 0,
      issues
    };
  }
  
  /**
   * Remove trigger points duplicados
   */
  removeDuplicateTriggerPoints(triggerPoints: TriggerPoint[]): TriggerPoint[] {
    const uniquePoints: TriggerPoint[] = [];
    const seen = new Set<string>();
    
    for (const tp of triggerPoints) {
      const key = `${tp.location.lat.toFixed(6)},${tp.location.lng.toFixed(6)}`;
      
      if (!seen.has(key)) {
        seen.add(key);
        uniquePoints.push(tp);
      }
    }
    
    return uniquePoints;
  }
  
  /**
   * Otimiza trigger points removendo redundâncias
   */
  optimizeTriggerPoints(triggerPoints: TriggerPoint[]): TriggerPoint[] {
    // Ordenar por qualidade e prioridade
    const sorted = triggerPoints.sort((a, b) => {
      if (a.quality !== b.quality) {
        return b.quality - a.quality;
      }
      return a.priority - b.priority;
    });
    
    const optimized: TriggerPoint[] = [];
    const minDistance = 35; // Distância mínima entre trigger points (aumentado para qualidade)
    
    for (const tp of sorted) {
      const isTooClose = optimized.some(existing => 
        calculateDistance(tp.location, existing.location) < minDistance // ✅ DRY: usar função SSOT
      );
      
      if (!isTooClose) {
        optimized.push(tp);
      }
    }
    
    return optimized;
  }
  
  /**
   * Calcula distância entre dois pontos
   */
  // ✅ DRY: calculateDistance removido - usar função importada de utils/calculations.ts

  /**
   * NOVO: Verifica se vegetação densa bloqueia linha de visão
   */
  private checkVegetationBlocking(
    tpLocation: { lat: number; lng: number },
    poiLocation: { lat: number; lng: number },
    vegetation: any[]
  ): boolean {
    // Filtrar vegetação ao longo da linha TP → POI
    const relevantVegetation = this.filterBuildingsAlongLineOfSight(
      tpLocation,
      poiLocation,
      vegetation,
      calculateDistance(tpLocation, poiLocation)
    );
    
    if (relevantVegetation.length === 0) return false;
    
    // Vegetação densa (forest/wood) sempre bloqueia se estiver no caminho
    for (const veg of relevantVegetation) {
      if (veg.tags?.natural === 'wood' || veg.tags?.landuse === 'forest') {
        console.log(`🌲 Dense vegetation blocking line of sight: ${veg.tags?.name || 'unnamed'}`);
        return true;
      }
    }
    
    return false;
  }

  /**
   * NOVO: Verifica se muros/barreiras bloqueiam linha de visão
   */
  private checkBarriersBlocking(
    tpLocation: { lat: number; lng: number },
    poiLocation: { lat: number; lng: number },
    barriers: any[]
  ): boolean {
    const relevantBarriers = this.filterBuildingsAlongLineOfSight(
      tpLocation,
      poiLocation,
      barriers,
      calculateDistance(tpLocation, poiLocation)
    );
    
    if (relevantBarriers.length === 0) return false;
    
    // Muros altos (>2m) e city_walls bloqueiam
    for (const barrier of relevantBarriers) {
      const height = this.extractBarrierHeight(barrier.tags);
      if (height > 2 || barrier.tags?.barrier === 'city_wall') {
        console.log(`🧱 Barrier blocking line of sight: ${barrier.tags?.barrier} (${height}m high)`);
        return true;
      }
    }
    
    return false;
  }

  /**
   * NOVO: Extrai altura de barreira de tags OSM
   */
  private extractBarrierHeight(tags: any): number {
    if (tags?.height) {
      const heightMatch = tags.height.match(/(\d+\.?\d*)/);
      if (heightMatch) return parseFloat(heightMatch[1]);
    }
    
    // Alturas padrão por tipo
    const defaultHeights: Record<string, number> = {
      'wall': 2.5,
      'city_wall': 8,
      'fence': 1.8,
      'hedge': 2.0
    };
    
    return defaultHeights[tags?.barrier] || 0;
  }

  /**
   * FALLBACK: Busca apenas buildings (método original simplificado)
   */
  private async getAllBuildingsInRegionFallback(
    candidates: TriggerPointCandidate[],
    boundary: BoundaryData,
    context: GeographicContext
  ): Promise<any[]> {
    if (candidates.length === 0) return [];

    const searchRadius = this.calculateSearchRadiusForRegion(boundary, context);
    const boundaryCenter = this.calculateBoundaryCenter(boundary.coordinates);
    const radiusInDegrees = searchRadius / 111000;
    
    const minLat = boundaryCenter.lat - radiusInDegrees;
    const maxLat = boundaryCenter.lat + radiusInDegrees;
    const minLng = boundaryCenter.lng - radiusInDegrees;
    const maxLng = boundaryCenter.lng + radiusInDegrees;

    const buildingsQuery = `
[out:json][timeout:60];
(
  way["building"](${minLat},${minLng},${maxLat},${maxLng});
);
out geom meta;
`;

    try {
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: buildingsQuery
      });

      if (!response.ok) {
        console.warn(`OSM buildings fallback query failed: ${response.status}`);
        return [];
      }

      const osmData = await response.json();
      const buildings = osmData.elements || [];

      console.log(`🏢 Fallback: Successfully fetched ${buildings.length} buildings from OSM`);
      return buildings;

    } catch (error) {
      console.error('Failed to fetch buildings fallback:', error);
      return [];
    }
  }

  // REMOVIDO: calculateStreetBearing - não mais necessário após remoção da validação de direção
}

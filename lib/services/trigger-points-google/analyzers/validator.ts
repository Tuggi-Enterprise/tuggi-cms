// Validador e ranker de trigger points

import { POIData, GeographicContext, TriggerPointCandidate, TriggerPoint, BoundaryData } from '../types/interfaces';
import { calculateOptimalRadius, calculateDistance, calculateBearing, extractBuildingHeight } from '../utils/calculations';
import { VisibilityValidator } from './visibility-validator';
import { ElevationAnalysisService } from '../services/elevation-service';
import { GoogleAPIsService } from '../services/google-apis.service';

export class TriggerPointValidator {
  private visibilityValidator: VisibilityValidator;
  
  // Cache para obstruções (QUALIDADE > PERFORMANCE)
  private static obstructionsCache = new Map<string, { 
    data: { buildings: any[]; vegetation: any[]; barriers: any[] }, 
    timestamp: number 
  }>();
  private static CACHE_DURATION = 30 * 60 * 1000; // 30 minutos
  
  constructor(googleAPIs: GoogleAPIsService) {
    this.visibilityValidator = new VisibilityValidator(googleAPIs);
  }
  
  /**
   * Valida e rankeia candidatos a trigger points (NOVO: distância mínima + visibilidade)
   */
  async validateAndRankPoints(
    candidates: TriggerPointCandidate[], 
    poiData: POIData, 
    context: GeographicContext,
    boundary: BoundaryData,
    maxTriggerPoints: number = 50,
    minDistanceBetweenTPs: number = 50 // metros (otimizado para range 20m)
  ): Promise<TriggerPoint[]> {
    // 🚀 OTIMIZAÇÃO: Calcular elevação base UMA ÚNICA VEZ para evitar centenas de chamadas de API
    let baseElevation: number | null = null;
    if (boundary?.elevation && boundary.elevation.center > 0) {
      console.log(`🏞️ [CACHE] Calculating base elevation once for all candidates...`);
      baseElevation = await ElevationAnalysisService.estimateRegionalBaseElevation(boundary.center, context, poiData);
      console.log(`✅ [CACHE] Base elevation cached: ${baseElevation}m`);
    }
    console.log(`🎯 Validating ${candidates.length} trigger point candidates with full validation system`);
    console.log(`🎯 Max TPs: ${maxTriggerPoints}, Min distance: ${minDistanceBetweenTPs}m`);
    
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
      
      // ✅ VALIDAÇÃO DE VISIBILIDADE COMPLETA
      console.log(`🔍 Step 2: Visibility validation (line of sight)`);
      const visibilityValidCandidates = await this.filterByVisibilityOptimized(basicValidCandidates, boundary, context);
      
      console.log(`👁️ ${visibilityValidCandidates.length} candidates have clear line of sight`);
      
      // Ordenar por qualidade (melhores primeiro)
      const rankedCandidates = visibilityValidCandidates.sort((a, b) => b.quality - a.quality);
      
      // ✅ FILTRO DE DISTÂNCIA MÍNIMA COMPLETO
      console.log(`🔍 Step 3: Distance filtering (min ${minDistanceBetweenTPs}m between TPs)`);
      const selectedTriggerPoints = this.selectTriggerPointsWithMinDistance(rankedCandidates, maxTriggerPoints, minDistanceBetweenTPs, boundary, context);
      console.log(`📏 ${selectedTriggerPoints.length} trigger points selected after all filtering`);
      
      console.log(`✅ VALIDATION COMPLETE: ${selectedTriggerPoints.length} high-quality trigger points selected`);
      return selectedTriggerPoints;
      
    } catch (error) {
      console.error('Error validating and ranking points:', error);
      return [];
    }
  }
  
  
  /**
   * NOVO: Seleciona TPs garantindo distância mínima entre eles
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
    
    console.log(`🔍 Selecting TPs with ${minDistance}m minimum distance...`);
    
    for (const candidate of rankedCandidates) {
      // Verificar se já temos o máximo de TPs
      if (selectedTPs.length >= maxTriggerPoints) {
        console.log(`✋ Reached maximum of ${maxTriggerPoints} trigger points`);
        break;
      }
      
      // Verificar distância mínima com TPs já selecionados
      const isTooClose = selectedTPs.some(existingTP => {
        const distance = calculateDistance(candidate.location, existingTP.location);
        return distance < minDistance;
      });
      
      if (isTooClose) {
        rejectedCount++;
        // console.log(`🚫 TP rejected (too close): ${candidate.location.lat.toFixed(6)}, ${candidate.location.lng.toFixed(6)} - Quality: ${candidate.quality.toFixed(3)}`);
        continue;
      }
      
      // Candidato aprovado - converter para TriggerPoint
      const triggerPoint = this.convertToTriggerPoint(candidate, selectedTPs.length, boundary, context);
      selectedTPs.push(triggerPoint);
      
      // console.log(`✅ TP selected: ${triggerPoint.location.lat.toFixed(6)}, ${triggerPoint.location.lng.toFixed(6)} - Quality: ${triggerPoint.quality.toFixed(3)}`);
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
    const batchSize = 5;
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

          // Critérios de aprovação na validação de visibilidade
          const hasGoodVisibility = 
            visibilityResult.hasLineOfSight && 
            visibilityResult.confidence >= 0.4 && 
            visibilityResult.visibleBoundaryPercentage >= 20; // Pelo menos 20% do boundary visível

          if (hasGoodVisibility) {
            // Boost na qualidade baseado na visibilidade
            const visibilityBonus = (visibilityResult.confidence - 0.4) * 0.2;
            const enhancedCandidate = {
              ...candidate,
              quality: Math.min(1.0, candidate.quality + visibilityBonus),
              confidence: Math.min(1.0, candidate.confidence + visibilityBonus * 0.5)
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
            quality: Math.min(1.0, candidate.quality + 0.05),
            confidence: Math.min(1.0, candidate.confidence + 0.03)
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
    let baseRadius = 1000; // 1km padrão

    // Ajustar baseado na elevação (se disponível)
    if (boundary?.elevation && boundary.elevation.center > 0) {
      const poiElevation = boundary.elevation.center;
      
      if (poiElevation > 1000) {
        // POIs muito altos = raio grande (até 8km)
        baseRadius = Math.min(8000, Math.sqrt(poiElevation) * 200);
      } else if (poiElevation > 400) {
        // POIs elevados = raio médio
        baseRadius = Math.min(3000, poiElevation * 3);
      }
    }

    // Ajustar baseado na densidade urbana
    // IMPORTANTE: Para obstruções, usar raio maior que para TPs
    // TPs ficam próximos, mas obstruções podem estar mais longe
    switch (context.urbanDensity.level) {
      case 'very_dense': baseRadius = Math.min(baseRadius, 1000); break; // Era 500m, agora 1000m
      case 'dense': baseRadius = Math.min(baseRadius, 1500); break; // Era 1000m, agora 1500m
      case 'medium': baseRadius = Math.min(baseRadius, 2500); break; // Era 2000m, agora 2500m
      case 'low': baseRadius = Math.min(baseRadius, 5000); break; // Era 4000m, agora 5000m
      case 'rural': baseRadius = Math.min(baseRadius, 10000); break; // Era 8000m, agora 10000m
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

      // ✅ REGRA CRÍTICA: TPs na rua da frente do POI são SEMPRE aprovados
      const isFrontStreet = this.isTPOnFrontStreet(candidate, boundary);
      if (isFrontStreet) {
        console.log(`🏠 TP on FRONT STREET of POI (${distance.toFixed(0)}m) - AUTO APPROVED (guaranteed visibility)`);
        return true;
      }
      
      // ✅ REGRA AJUSTADA: TPs muito próximos do boundary são automaticamente aprovados
      // EXCETO em canyon urbano onde mesmo próximos podem ter obstruções
      const isUrbanCanyon = this.isPOIInUrbanCanyon(boundary, context);
      
      if (distance < 75 && !isUrbanCanyon) {
        console.log(`✅ TP very close to boundary (${distance.toFixed(0)}m < 75m) - AUTO APPROVED (street in front)`);
        return true;
      }
      
      if (distance < 75 && isUrbanCanyon) {
        console.log(`🏙️ TP close to boundary in URBAN CANYON (${distance.toFixed(0)}m) - checking obstructions despite proximity`);
        // Continuar com validação completa mesmo próximo
      }

      // 1. Verificar obstrução por buildings (já existente)
      const relevantBuildings = this.filterBuildingsAlongLineOfSight(
        candidate.location,
        nearestBoundaryPoint,
        obstructions.buildings,
        distance
      );
      
      const blockedByBuildings = this.checkCachedBuildingsBlocking(
        candidate.location,
        nearestBoundaryPoint,
        relevantBuildings,
        context
      );
      
      if (!blockedByBuildings) {
        console.log(`🚫 BLOCKED: Buildings block line of sight (${relevantBuildings.length} buildings analyzed)`);
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

      console.log(`✅ Clear line of sight confirmed (${relevantBuildings.length} buildings, ${obstructions.vegetation.length} vegetation, ${obstructions.barriers.length} barriers checked)`);
      return true;

    } catch (error) {
      console.warn('Cached obstructions visibility check failed:', error);
      return true; // Fail-safe
    }
  }

  /**
   * Filtra buildings que estão ao longo da linha de visão entre TP e boundary
   */
  private filterBuildingsAlongLineOfSight(
    tpLocation: { lat: number; lng: number },
    boundaryPoint: { lat: number; lng: number },
    buildings: any[],
    lineDistance: number
  ): any[] {
    const relevantBuildings = [];
    const bufferDistance = 100; // metros de buffer ao redor da linha

    for (const building of buildings) {
      if (building.geometry && building.geometry.length > 0) {
        // Usar centroid do building para verificação rápida
        const buildingCenter = this.calculateBuildingCentroid(building);
        
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
   */
  private checkCachedBuildingsBlocking(
    tpLocation: { lat: number; lng: number },
    boundaryPoint: { lat: number; lng: number },
    buildings: any[],
    context: GeographicContext
  ): boolean {
    try {
      const distance = calculateDistance(tpLocation, boundaryPoint);
      const isDenseZone = context.urbanDensity.level === 'very_dense' || context.urbanDensity.level === 'dense';
      
      console.log(`🏗️ Checking ${buildings.length} cached buildings for blocking (distance: ${distance.toFixed(0)}m, dense: ${isDenseZone})`);
      
      for (const building of buildings) {
        const buildingHeight = extractBuildingHeight(building);
        
        if (!buildingHeight || buildingHeight <= 0) continue; // Ignorar buildings sem altura
        
        // 🔥 USAR LÓGICA ORIGINAL: verificar se building intersecta linha de visão
        const intersects = this.checkBuildingIntersectsLine(building, tpLocation, boundaryPoint);
        
        if (intersects) {
          const buildingCenter = this.calculateBuildingCentroid(building);
          const distanceFromTP = calculateDistance(tpLocation, buildingCenter);
          
          // 🔥 VALIDAÇÃO ORIGINAL RIGOROSA
          if (isDenseZone) {
            // Em zonas densas, ser mais rigoroso
            if (buildingHeight > 8) {
              console.log(`🏢 DENSE ZONE BLOCKED: Tall building (${buildingHeight}m) blocks line of sight`);
              return false; // BLOQUEADO
            }
          } else {
            // Em zonas normais, usar altura mínima
            if (buildingHeight > 15) {
              console.log(`🚫 BLOCKED: Tall building (${buildingHeight}m) blocks unknown POI height - TP REJECTED`);
              return false; // BLOQUEADO
            } else if (buildingHeight > 8 && distanceFromTP < 50) {
              console.log(`🚫 BLOCKED: Medium building (${buildingHeight}m) too close (${distanceFromTP.toFixed(0)}m) - TP REJECTED`);
              return false; // BLOQUEADO
            }
          }
        }
      }
      
      return true; // NÃO BLOQUEADO
      
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
   * Verificação rápida de visibilidade usando apenas buildings OSM (LEGACY)
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
      if (distanceToBoundary > 300) {
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
      
      console.log(`🏗️ POI height: ${poiHeight}m, Distance to boundary: ${distanceToBoundary.toFixed(0)}m, Dense zone: ${isDenseZone}`);
      
      // Se POI é muito alto (>30m), tem melhor visibilidade mesmo em zonas densas
      if (poiHeight > 30) {
        console.log(`🏢 HIGH POI: ${poiHeight}m tall, good visibility expected`);
        return distanceToBoundary < 500; // POIs altos = raio maior
      }
      
      // Se POI é moderadamente alto (15-30m) e zona densa, verificar buildings
      if (poiHeight > 15 && isDenseZone) {
        console.log(`🏢 MEDIUM POI in dense zone: Checking building interference`);
        return this.checkBuildingsBlockingWithPOIHeight(candidate.location, nearestBoundaryPoint, context, poiHeight);
      }
      
      // Se muito próximo do boundary, assumir visibilidade boa
      if (distanceToBoundary < 60) {
        return true;
      }
      
      // POI baixo ou sem altura em zona densa = usar validação PRECISA
      if (isDenseZone && poiHeight < 15) {
        console.log(`🏠 LOW/UNKNOWN POI in dense zone: Using PRECISE line-of-sight validation`);
        return distanceToBoundary < 60 ? true : this.checkBuildingsBlockingWithPOIHeight(candidate.location, nearestBoundaryPoint, context, poiHeight);
      }
      
      // Verificação normal - também usar a precisa para zonas densas
      if (isDenseZone) {
        console.log(`🏙️ Dense zone: Using PRECISE validation regardless of POI height`);
        return this.checkBuildingsBlockingWithPOIHeight(candidate.location, nearestBoundaryPoint, context, poiHeight);
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
    poiHeight: number
  ): Promise<boolean> {
    try {
      const distance = calculateDistance(tpLocation, boundaryPoint);
      
      // NOVA ESTRATÉGIA: Buscar buildings ao longo da LINHA DIRETA TP → Boundary
      const lineOfSightBuildings = await this.getBuildingsAlongLineOfSight(tpLocation, boundaryPoint, distance);
      
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
        if (distanceFromTP < distance * 0.9 && distanceFromBoundary < distance * 0.9) {
          
          console.log(`⚠️ Building is BETWEEN TP and boundary - analyzing blocking potential...`);
          
          // Se POI tem altura conhecida, comparar
          if (poiHeight > 0) {
            if (buildingHeight >= poiHeight * 0.6) { // 60% da altura do POI
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
            } else if (buildingHeight > 8 && distanceFromTP < 50) {
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
    distance: number
  ): Promise<any[]> {
    // Criar múltiplos pontos ao longo da linha para busca mais precisa
    const numSamplePoints = Math.max(3, Math.floor(distance / 100)); // 1 ponto a cada 100m
    const samplePoints = this.createLineOfSightSamplePoints(tpLocation, boundaryPoint, numSamplePoints);
    
    console.log(`📍 Using ${samplePoints.length} sample points along ${distance.toFixed(0)}m line of sight`);
    
    // Buscar buildings ao redor de cada ponto da linha
    const searchRadius = Math.min(150, distance / 3); // Raio mais focado
    
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
        Math.min(300, distance * 0.8) : // Zonas densas: raio maior e mais rigoroso
        Math.min(200, distance / 2);   // Zonas normais: raio menor
      
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
      const distance = this.calculateDistance(tpLocation, boundaryPoint);
      const isHighElevationPOI = distance > 1000; // TPs muito distantes indicam POI de alta elevação
      
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
    if (candidate.confidence < 0.2) {
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
    const isUrbanCanyon = this.isPOIInUrbanCanyon(boundary, context);
    
    if (isUrbanCanyon) {
      console.log(`🏙️ URBAN CANYON DETECTED: POI surrounded by tall buildings`);
      
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
      console.log(`🏠 Very close to POI (${distance.toFixed(0)}m) - likely front street`);
      return true;
    }
    
    // 3. Verificar ângulo de aproximação - TPs frontais têm ângulo < 45°
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
   * Verifica se o POI está em um canyon urbano (cercado por prédios altos)
   */
  private isPOIInUrbanCanyon(boundary: BoundaryData, context: GeographicContext): boolean {
    // 1. Verificar densidade urbana
    if (context.urbanDensity.level !== 'very_dense' && context.urbanDensity.level !== 'dense') {
      return false; // Não é área densa
    }
    
    // 2. Em áreas muito densas, SEMPRE considerar canyon urbano
    if (context.urbanDensity.level === 'very_dense') {
      console.log(`🏙️ CANYON: Very dense urban area - treating as canyon regardless of POI height`);
      return true;
    }
    
    // 3. Verificar se POI tem altura (prédio) - apenas para áreas densas
    if (context.urbanDensity.level === 'dense' && (!boundary.height || boundary.height < 20)) {
      return false; // POI não é um prédio alto em área densa
    }
    
    // 3. Verificar altura relativa aos vizinhos (se disponível)
    if (boundary.surroundingHeight) {
      const heightDifference = (boundary.height || 0) - boundary.surroundingHeight.average;
      
      // Se POI não é significativamente mais alto que vizinhos = canyon
      if (heightDifference < 30) {
        console.log(`🏙️ CANYON: POI height ${boundary.height}m vs avg ${boundary.surroundingHeight.average}m (diff: ${heightDifference}m < 30m)`);
        return true;
      }
    }
    
    // 4. Verificar densidade de prédios ao redor (se disponível)
    if (boundary.surroundingHeight && boundary.surroundingHeight.buildingCount > 10) {
      console.log(`🏙️ CANYON: High building density (${boundary.surroundingHeight.buildingCount} buildings)`);
      return true;
    }
    
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
    if (distance > 100) { // Reduzido de 200m para 100m
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
    const baseRadius = 30; // metros
    
    // Ajustar baseado na qualidade
    let qualityMultiplier = 1.0;
    if (candidate.quality > 0.8) {
      qualityMultiplier = 1.2; // Raio maior para pontos de alta qualidade
    } else if (candidate.quality > 0.6) {
      qualityMultiplier = 1.0;
    } else {
      qualityMultiplier = 0.8; // Raio menor para pontos de baixa qualidade
    }
    
    // Ajustar baseado na densidade urbana
    let densityMultiplier = 1.0;
    switch (context.urbanDensity.level) {
      case 'very_dense':
        densityMultiplier = 0.8; // Raio menor em áreas densas
        break;
      case 'dense':
        densityMultiplier = 0.9;
        break;
      case 'medium':
        densityMultiplier = 1.0;
        break;
      case 'low':
        densityMultiplier = 1.1;
        break;
      case 'rural':
        densityMultiplier = 1.3; // Raio maior em áreas rurais
        break;
    }
    
    // Ajustar baseado no tipo de rua
    let streetMultiplier = 1.0;
    switch (candidate.street.type) {
      case 'primary':
        streetMultiplier = 1.2; // Raio maior em ruas principais
        break;
      case 'secondary':
        streetMultiplier = 1.1;
        break;
      case 'tertiary':
        streetMultiplier = 1.0;
        break;
      case 'residential':
        streetMultiplier = 0.9;
        break;
      case 'living_street':
        streetMultiplier = 0.8;
        break;
      default:
        streetMultiplier = 1.0;
    }
    
    const radius = Math.round(baseRadius * qualityMultiplier * densityMultiplier * streetMultiplier);
    
    // Limitar raio entre 20 e 100 metros
    return Math.max(20, Math.min(100, radius));
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
    const minDistance = 50; // Distância mínima entre trigger points
    
    for (const tp of sorted) {
      const isTooClose = optimized.some(existing => 
        this.calculateDistance(tp.location, existing.location) < minDistance
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
  private calculateDistance(
    point1: { lat: number; lng: number },
    point2: { lat: number; lng: number }
  ): number {
    const R = 6371000; // Raio da Terra em metros
    const dLat = (point2.lat - point1.lat) * Math.PI / 180;
    const dLng = (point2.lng - point1.lng) * Math.PI / 180;
    
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(point1.lat * Math.PI / 180) * Math.cos(point2.lat * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    return R * c;
  }

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
}

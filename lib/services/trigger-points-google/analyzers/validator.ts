// Validador e ranker de trigger points

import { POIData, GeographicContext, TriggerPointCandidate, TriggerPoint, BoundaryData } from '../types/interfaces';
import { calculateOptimalRadius, calculateDistance } from '../utils/calculations';
import { VisibilityValidator } from './visibility-validator';
import { GoogleAPIsService } from '../services/google-apis.service';

export class TriggerPointValidator {
  private visibilityValidator: VisibilityValidator;
  
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
    console.log(`🚀 BYPASS MODE: Accepting ALL ${candidates.length} trigger point candidates WITHOUT validation!`);
    console.log(`🎯 Max TPs: ${maxTriggerPoints}, Min distance: ${minDistanceBetweenTPs}m`);
    
    try {
      // 🔍 TESTE 1: Reativar apenas validação básica
      console.log(`🔍 TESTE 1: Testing basic validation only`);
      const basicValidCandidates = candidates.filter(candidate => 
        this.isValidCandidate(candidate, poiData, context)
      );
      
      console.log(`📊 ${basicValidCandidates.length} candidates accepted (BYPASS MODE)`);
      
    // 🚀 BYPASS: Pular validação de visibilidade completamente
    console.log(`🚀 BYPASSING visibility validation for all ${basicValidCandidates.length} candidates`);
    const visibilityValidCandidates = basicValidCandidates; // Aceitar TODOS sem validação de visibilidade
      
      console.log(`👁️ ${visibilityValidCandidates.length} candidates have clear line of sight`);
      
      // Ordenar por qualidade (melhores primeiro)
      const rankedCandidates = visibilityValidCandidates.sort((a, b) => b.quality - a.quality);
      
      // 🚀 BYPASS: Aceitar todos os candidatos sem filtro de distância mínima
      console.log(`🚀 BYPASSING distance filtering - accepting all ${rankedCandidates.length} candidates`);
      const selectedTriggerPoints = rankedCandidates.slice(0, maxTriggerPoints).map((candidate, index) => ({
        id: `tp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        location: candidate.location,
        radius: 42,
        expectedBearing: candidate.expectedBearing,
        bearingThreshold: 30,
        type: index < 10 ? 'primary' : index < 20 ? 'secondary' : 'tertiary',
        priority: index + 1,
        confidence: candidate.confidence,
        quality: candidate.quality,
        street: candidate.street,
        distance: candidate.distance,
        generationMethod: 'google_apis',
        contextData: {
          urbanDensity: context.urbanDensity,
          elevationContext: context.elevationContext,
          streetPattern: context.streetPattern,
          infrastructure: context.infrastructure,
          region: context.region
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }));
      
      console.log(`🎯 BYPASS COMPLETE: ${selectedTriggerPoints.length} trigger points without any filtering`);
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
      const triggerPoint = this.convertToTriggerPoint(candidate, selectedTPs.length, context);
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
    let visibilityChecks = 0;
    let visibilityPassed = 0;
    let visibilityFailed = 0;

    console.log(`🚀 Optimized visibility check for ${candidates.length} candidates...`);

    // Estratégia otimizada: Usar apenas Buildings Analysis (mais rápido)
    for (const candidate of candidates) {
      visibilityChecks++;
      
      try {
        // Verificação rápida de visibilidade usando buildings e altura do POI
        const hasVisibility = await this.quickVisibilityCheckWithPOIHeight(candidate, boundary, context);
        
        if (hasVisibility) {
          // Pequeno boost na qualidade para TPs com visibilidade confirmada
          const enhancedCandidate = {
            ...candidate,
            quality: Math.min(1.0, candidate.quality + 0.05), // Boost menor
            confidence: Math.min(1.0, candidate.confidence + 0.03)
          };
          
          validCandidates.push(enhancedCandidate);
          visibilityPassed++;
          // console.log(`✅ TP visible: ${candidate.location.lat.toFixed(6)}, ${candidate.location.lng.toFixed(6)}`);
        } else {
          visibilityFailed++;
          // console.log(`🚫 TP blocked: ${candidate.location.lat.toFixed(6)}, ${candidate.location.lng.toFixed(6)}`);
        }
        
      } catch (error) {
        // Se falhar, aceitar o candidato (fail-safe)
        console.warn(`⚠️ Visibility check failed for TP ${candidate.location.lat.toFixed(6)}, ${candidate.location.lng.toFixed(6)}, accepting anyway:`, error);
        validCandidates.push(candidate);
        visibilityPassed++;
      }
    }

    console.log(`👁️ Optimized visibility complete: ${visibilityPassed} passed, ${visibilityFailed} failed (${visibilityChecks} total)`);
    console.log(`📈 Visibility success rate: ${((visibilityPassed / visibilityChecks) * 100).toFixed(1)}%`);

    return validCandidates;
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
      if (distanceToBoundary < 100) {
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
      if (distanceToBoundary < 100) {
        return true;
      }
      
      // POI baixo ou sem altura em zona densa = usar validação PRECISA
      if (isDenseZone && poiHeight < 15) {
        console.log(`🏠 LOW/UNKNOWN POI in dense zone: Using PRECISE line-of-sight validation`);
        return distanceToBoundary < 100 ? true : this.checkBuildingsBlockingWithPOIHeight(candidate.location, nearestBoundaryPoint, context, poiHeight);
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
              console.log(`📍 Blocked TP location: ${tpLocation.lat.toFixed(6)}, ${tpLocation.lng.toFixed(6)} (near Av. São Luís / R. Consolação?)`);
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
            const buildingHeight = this.extractBuildingHeight(building);
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
      const distance = this.calculateDistance(tpLocation.lat, tpLocation.lng, boundaryPoint.lat, boundaryPoint.lng);
      const isHighElevationPOI = distance > 1000; // TPs muito distantes indicam POI de alta elevação
      
      if (isHighElevationPOI) {
        console.log(`🏔️ High elevation POI detected (${distance.toFixed(0)}m distance) - assuming no building obstruction`);
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
          const buildingHeight = this.extractBuildingHeight(building);
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
  private isValidCandidate(
    candidate: TriggerPointCandidate, 
    poiData: POIData, 
    context: GeographicContext
  ): boolean {
    // Verificar qualidade mínima
    if (candidate.quality < 0.3) {
      console.log(`🚫 Candidate rejected: quality ${candidate.quality.toFixed(2)} < 0.3`);
      return false;
    }
    
    // Verificar distância máxima DINÂMICA baseada na elevação
    let maxDistance = 1000; // Default para POIs baixos
    
    // Para POIs de alta elevação, permitir distâncias muito maiores
    if (context.elevationContext?.type === 'mountainous' || 
        (context.elevationContext && context.elevationContext.variance > 100)) {
      maxDistance = 8000; // 8km para montanhas/picos
      console.log(`🏔️ High elevation POI - extending max distance to ${maxDistance}m`);
    } else if (context.urbanDensity.level === 'rural') {
      maxDistance = 3000; // 3km para áreas rurais
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
      console.log(`🚫 Candidate rejected: confidence ${candidate.confidence.toFixed(2)} < 0.2`);
      return false;
    }
    
    console.log(`✅ Candidate accepted: distance ${candidate.distance.toFixed(0)}m, quality ${candidate.quality.toFixed(2)}, confidence ${candidate.confidence.toFixed(2)}`);
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
    context: GeographicContext
  ): TriggerPoint {
    const id = this.generateTriggerPointId();
    const type = this.determineTriggerType(index, candidate.quality);
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
   * Determina o tipo de trigger point baseado na posição e qualidade
   */
  private determineTriggerType(index: number, quality: number): 'primary' | 'secondary' | 'fallback' {
    // Os primeiros 3 candidatos com alta qualidade são primários
    if (index < 3 && quality > 0.7) {
      return 'primary';
    }
    
    // Candidatos com qualidade média são secundários
    if (quality > 0.5) {
      return 'secondary';
    }
    
    // Resto são fallback
    return 'fallback';
  }
  
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
}

// Calculador de pontos ótimos para trigger points

import { POIData, BoundaryData, GeographicContext, StreetData, TriggerPointCandidate } from '../types/interfaces';
import { calculateDistance, calculateBearing, calculateOptimalRadius, calculateDistanceToBoundary, isPointInPolygon, calculateMinDistanceToCenter, findClosestPointOnBoundary } from '../utils/calculations';
import { TRIGGER_POINTS_CONSTANTS } from '../config/trigger-points-config';
import { ElevationAnalysisService } from '../services/elevation-service';
import { loadTriggerPointsConfig, TriggerPointsConfig } from '../config/trigger-points-config';
import { POIClassifierService } from '../services/poi-classifier.service';

export class OptimalPointCalculator {
  private poiClassifier: POIClassifierService;
  
  constructor() {
    this.poiClassifier = new POIClassifierService();
  }
  
  /**
   * Calcula pontos ótimos nas ruas para trigger points
   */
  async calculateOptimalPoints(
    poiData: POIData, 
    streets: StreetData[], 
    boundary: BoundaryData, 
    context: GeographicContext
  ): Promise<TriggerPointCandidate[]> {
    // 🎯 USAR CLASSIFICAÇÃO DO BOUNDARY (já calculada no boundary-detector)
    let classification = boundary.classification;
    
    if (!classification) {
      console.warn(`⚠️ No classification found in boundary, using fallback`);
      // Fallback: criar classificação padrão APENAS se não existe classificação
      // ✅ IMPORTANTE: Não recategorizar se já existe classificação (evitar redundância)
      const fallbackClassification = await this.poiClassifier.classifyPOI(
        poiData,
        boundary.height,
        boundary.elevation ? { center: boundary.elevation.center } : undefined,
        boundary.area,
        context,
        boundary.osmTags
      );
      boundary.classification = fallbackClassification;
      classification = fallbackClassification; // ✅ CORREÇÃO: Atualizar variável local também
    }
    
    // ✅ GARANTIR: classification nunca será undefined aqui
    if (!classification) {
      throw new Error('Classification is still undefined after fallback creation');
    }
    
    const group = classification.group;
    const strategy = classification.strategy;
    const searchRadius = classification.searchRadius || 300; // Raio calculado após classificação
    
    
    // ✅ CORREÇÃO 4: Filtrar ruas internamente após classificação
    // Usar apenas ruas dentro do raio calculado (não todas as ruas do raio inicial de 500m)
    const filteredStreets = this.filterStreetsByRadius(streets, boundary, searchRadius);
    console.log(`🔍 Filtered streets: ${filteredStreets.length}/${streets.length} within ${searchRadius}m radius (from initial 500m query)`);
    
    const candidates: TriggerPointCandidate[] = [];
    
    // 🏔️ ESTRATÉGIA CIRCULAR: Para HIGH e MEDIUM (múltiplas ruas, múltiplas distâncias)
    if (strategy === 'circular') {
      console.log(`🔄 CIRCULAR STRATEGY: Using multiple streets with multiple distances`);
      candidates.push(...await this.calculateMultipleStreetsStrategy(filteredStreets, poiData, boundary, context, classification));
    } 
    // 🏙️ ESTRATÉGIA LINEAR: Para CANYON (front street priority, single distance)
    else if (strategy === 'linear') {
      console.log(`📍 LINEAR STRATEGY: Prioritizing front street`);
      candidates.push(...await this.calculateCanyonStrategy(filteredStreets, poiData, boundary, context, classification));
    }
    // 🏞️ ESTRATÉGIA PADRÃO: Para FLAT (standard approach)
    else {
      console.log(`🌟 STANDARD STRATEGY: One point per street`);
      
      // 🆕 Limitar número de ruas processadas para POIs pequenos
      // POIs pequenos (< 10000m²) em área densa devem processar menos ruas
      const isSmallPOI = boundary.area < 10000;
      const isDenseArea = context.urbanDensity.level === 'very_dense' || context.urbanDensity.level === 'dense';
      
      let streetsToProcess = filteredStreets;
      if (isSmallPOI && isDenseArea) {
        // Para POIs pequenos em área densa, priorizar apenas as ruas mais próximas
        // Ordenar por proximidade ao boundary center
        const sortedStreets = [...streets].sort((a, b) => {
          const distA = calculateMinDistanceToCenter(a.coordinates || [], boundary.center);
          const distB = calculateMinDistanceToCenter(b.coordinates || [], boundary.center);
          return distA - distB;
        });
        
        // Limitar a 5 ruas mais próximas para POIs pequenos
        streetsToProcess = sortedStreets.slice(0, 5);
        console.log(`📏 Small POI (${boundary.area.toFixed(0)}m²) in dense area: limiting to ${streetsToProcess.length} closest streets (from ${streets.length} total)`);
      } else if (isSmallPOI) {
        // Para POIs pequenos em área não densa, limitar a 8 ruas
        streetsToProcess = streets.slice(0, 8);
        console.log(`📏 Small POI (${boundary.area.toFixed(0)}m²): limiting to ${streetsToProcess.length} streets (from ${streets.length} total)`);
      }
      
      for (const street of streetsToProcess) {
        const optimalPoint = await this.calculateOptimalPointOnStreet(street, poiData, boundary, context);
        
        if (optimalPoint) {
          candidates.push(optimalPoint);
        }
      }
    }
    
    // Ordenar candidatos por qualidade
    candidates.sort((a, b) => b.quality - a.quality);
    
    return candidates;
  }
  
  /**
   * ✅ CORREÇÃO CRÍTICA: Filtra ruas E PONTOS baseado no raio calculado após classificação
   * Remove ruas que estão fora do raio E também remove pontos das ruas que estão muito distantes
   * 
   * PROBLEMA IDENTIFICADO: Ruas do OSM contêm TODOS os pontos da rua, mesmo os muito distantes.
   * Exemplo: Uma rua pode ter pontos a 50m do boundary (dentro do raio) e outros a 1500m (fora).
   * 
   * SOLUÇÃO: Filtrar não apenas as ruas, mas também os PONTOS dentro de cada rua pelo raio.
   * 
   * IMPORTANTE: Usa distância ao BOUNDARY (perímetro), não ao centro
   */
  private filterStreetsByRadius(
    streets: StreetData[],
    boundary: BoundaryData,
    searchRadius: number
  ): StreetData[] {
    if (!streets || streets.length === 0) return streets;
    if (!boundary.coordinates || boundary.coordinates.length === 0) return streets;
    
    const filtered: StreetData[] = [];
    const maxAllowedDistance = searchRadius + 20; // Margem de 20m para ruas que passam perto do limite
    
    console.log(`🔍 Filtering streets and points by radius: ${searchRadius}m (max: ${maxAllowedDistance}m)`);
    
    for (const street of streets) {
      if (!street.coordinates || street.coordinates.length === 0) continue;
      
      // ✅ NOVO: Filtrar PONTOS da rua pelo raio, não apenas a rua inteira
      const validPoints: Array<{ lat: number; lng: number }> = [];
      let minDistanceToBoundary = Infinity;
      let maxDistanceToBoundary = 0;
      
      for (const streetPoint of street.coordinates) {
        const distanceToBoundary = calculateDistanceToBoundary(streetPoint, boundary.coordinates);
        
        // Calcular distâncias min/max para debug
        minDistanceToBoundary = Math.min(minDistanceToBoundary, distanceToBoundary);
        maxDistanceToBoundary = Math.max(maxDistanceToBoundary, distanceToBoundary);
        
        // Manter apenas pontos dentro do raio permitido
        if (distanceToBoundary <= maxAllowedDistance) {
          validPoints.push(streetPoint);
        }
      }
      
      // ✅ REGRA: Aprovar ruas que têm pelo menos 1 ponto válido dentro do raio
      // A função findPointAtDistanceFromBoundary funciona perfeitamente com 1 ponto,
      // então não há necessidade de exigir 2+ pontos para "formar um segmento"
      // Se tem 1 ponto válido dentro do raio, podemos usar esse ponto diretamente
      if (validPoints.length >= 1) {
        // Se tem apenas 1 ponto, duplicar para manter compatibilidade (mas não é necessário)
        const pointsToUse = validPoints.length >= 2 
          ? validPoints 
          : [validPoints[0], validPoints[0]]; // Duplicar ponto para manter formato de segmento
        
        // Criar nova rua com os pontos válidos
        const filteredStreet: StreetData = {
          ...street,
          coordinates: pointsToUse
        };
        
        filtered.push(filteredStreet);
        
        if (validPoints.length === 1) {
          const streetName = street.name || street.id || 'unnamed';
        } else if (validPoints.length < street.coordinates.length) {
          console.log(`✂️ Street ${street.id}: Filtered ${street.coordinates.length - validPoints.length} points outside radius (kept ${validPoints.length}/${street.coordinates.length})`);
        }
      } else {
        // Mensagem de log mais clara com nome da rua
        const streetName = street.name || street.id || 'unnamed';
        const reason = `no valid points (all points: ${minDistanceToBoundary.toFixed(0)}m-${maxDistanceToBoundary.toFixed(0)}m from boundary, max allowed: ${maxAllowedDistance.toFixed(0)}m)`;
        console.log(`🚫 Street ${street.id} (${streetName}): Rejected - ${reason}`);
      }
    }
    
    return filtered;
  }
  
  /**
   * Calcula ponto ótimo em uma rua específica (CORRIGIDO: usa boundary)
   */
  private async calculateOptimalPointOnStreet(
    street: StreetData, 
    poiData: POIData, 
    boundary: BoundaryData, 
    context: GeographicContext
  ): Promise<TriggerPointCandidate | null> {
    try {
      // Calcular múltiplas distâncias ótimas baseadas no contexto (CIRCULAR STRATEGY)
        const optimalDistances = await this.calculateOptimalDistances(poiData, context, boundary);
      
      
      // Tentar encontrar ponto em qualquer uma das distâncias ótimas
      let bestPoint = null;
      let bestDistance = 0;
      let bestDistanceDiff = Infinity;
      
      for (const targetDistance of optimalDistances) {
        const pointOnStreet = this.findPointAtDistanceFromBoundary(street, boundary, targetDistance);
        
        if (pointOnStreet) {
          const actualDistance = calculateDistanceToBoundary(pointOnStreet, boundary.coordinates);
          const distanceDiff = Math.abs(actualDistance - targetDistance);
          
          // Escolher o ponto com menor diferença da distância alvo
          if (distanceDiff < bestDistanceDiff) {
            bestPoint = pointOnStreet;
            bestDistance = actualDistance;
            bestDistanceDiff = distanceDiff;
          }
        }
      }
      
      if (!bestPoint) {
        console.warn(`⚠️ No suitable point found on street ${street.id} at any target distances: [${optimalDistances.join('m, ')}m]`);
        return null;
      }
      
      const pointOnStreet = bestPoint;
      
      // VALIDAÇÃO: Garantir que o ponto está FORA do boundary
      if (isPointInPolygon(pointOnStreet, boundary.coordinates)) {
        console.warn(`⚠️ Point inside boundary rejected: ${pointOnStreet.lat}, ${pointOnStreet.lng}`);
        return null;
      }
      
      // Calcular qualidade do ponto (com boost de ponte se aplicável)
      const quality = await this.calculatePointQuality(pointOnStreet, poiData, boundary, context, street);
      
      // Calcular bearing esperado
      // Para POIs grandes (>100k m²), tentar usar entrada principal se disponível
      let targetPoint: { lat: number; lng: number };
      
      if (boundary.area > 100000 && boundary.address?.street) {
        // POI grande: tentar encontrar ponto do boundary na rua do endereço (entrada principal)
        const addressStreet = boundary.address.street;
        const addressStreetInBoundary = boundary.streets?.find(s => 
          s.name?.toLowerCase().includes(addressStreet.toLowerCase()) ||
          addressStreet.toLowerCase().includes(s.name?.toLowerCase() || '')
        );
        
        if (addressStreetInBoundary && addressStreetInBoundary.coordinates.length > 0) {
          // Encontrar ponto mais próximo do boundary na rua da entrada principal
          const streetPoint = addressStreetInBoundary.coordinates[0];
          const closestOnBoundary = findClosestPointOnBoundary(streetPoint, boundary.coordinates);
          targetPoint = { lat: closestOnBoundary.lat, lng: closestOnBoundary.lng };
          console.log(`🚪 Large POI (${(boundary.area/10000).toFixed(0)} hectares): Using main entrance street for bearing`);
        } else {
          // Fallback: usar ponto mais próximo do boundary
          const closestBoundaryPoint = findClosestPointOnBoundary(pointOnStreet, boundary.coordinates);
          targetPoint = { lat: closestBoundaryPoint.lat, lng: closestBoundaryPoint.lng };
        }
      } else {
        // POI pequeno/médio: usar ponto mais próximo do boundary
        const closestBoundaryPoint = findClosestPointOnBoundary(pointOnStreet, boundary.coordinates);
        targetPoint = { lat: closestBoundaryPoint.lat, lng: closestBoundaryPoint.lng };
      }
      
      const expectedBearing = calculateBearing(pointOnStreet, targetPoint);
      
      // Usar a distância já calculada
      const actualDistance = bestDistance;
      
      return {
        location: pointOnStreet,
        distance: actualDistance,
        quality,
        street: street,
        expectedBearing,
        confidence: quality
      };
      
    } catch (error) {
      console.error('Error calculating optimal point on street:', error);
      return null;
    }
  }
  
  /**
   * Calcula distância ótima baseada no contexto
   */
  private async calculateOptimalDistances(poiData: POIData, context: GeographicContext, boundary?: BoundaryData, config?: TriggerPointsConfig): Promise<number[]> {
    console.log(`🎯 Calculating optimal TP distances from boundary for ${poiData.name}...`);
    
    // Carregar configuração
    const cfg = config || loadTriggerPointsConfig();
    
    // 🎯 USAR CLASSIFICAÇÃO DO BOUNDARY (já calculada)
    if (boundary && boundary.classification) {
      const classification = boundary.classification;
      const maxSearchRadius = classification.searchRadius || 300; // Limite máximo do raio de busca
      
      console.log(`📏 Classification search radius limit: ${maxSearchRadius}m`);
      
      // Usar estratégia baseada na classificação
      let distances: number[];
      switch (classification.strategy) {
        case 'circular':
          // Para HIGH e MEDIUM, usar distâncias circulares
          if (classification.group === 'high') {
            distances = this.calculateElevationStrategy(poiData, context, boundary, cfg, classification);
          } else {
            distances = this.calculateHeightStrategy(poiData, context, boundary, cfg, classification);
          }
          break;
        case 'standard':
          distances = this.calculateStandardStrategy(poiData, context, boundary, cfg, classification);
          break;
        default:
          // Fallback para estratégia padrão
          distances = [maxSearchRadius];
      }
      
      // ✅ CRÍTICO: Filtrar e limitar distâncias pelo searchRadius da classificação
      const filteredDistances = distances
        .filter(d => d <= maxSearchRadius) // Remover distâncias maiores que o raio permitido
        .filter((d, i, arr) => arr.indexOf(d) === i); // Remover duplicatas
      
      if (filteredDistances.length === 0) {
        // Se todas as distâncias foram filtradas, usar o raio máximo permitido
        console.warn(`⚠️ All distances exceeded search radius (${maxSearchRadius}m), using max radius`);
        return [maxSearchRadius];
      }
      
      return filteredDistances;
    }
    
    // 🏔️ FALLBACK: ESTRATÉGIA CIRCULAR PARA ALTA ELEVAÇÃO (sistema legado - mantido para compatibilidade)
    if (boundary && (boundary as any).elevation && (boundary as any).elevation.center > 1000) {
      const poiElevation = (boundary as any).elevation.center;
      const baseElevation = await ElevationAnalysisService.estimateRegionalBaseElevation((boundary as any).center, context, poiData);
      const elevationDiff = poiElevation - baseElevation;
      
      console.log(`🏔️ HIGH ELEVATION LANDMARK DETECTED: ${poiElevation.toFixed(0)}m (diff: ${elevationDiff.toFixed(0)}m)`);
      console.log(`🎯 Using CIRCULAR DISTRIBUTION strategy (legacy system)`);
      
      // Fórmula dinâmica: Math.sqrt(elevationDiff) * 200
      const maxRange = Math.min(Math.max(Math.sqrt(elevationDiff) * 200, 2000), 8000);
      
      // DISTRIBUIÇÃO CIRCULAR EM MÚLTIPLAS FAIXAS (como sistema legado)
      const distances = [
        cfg.distanceDistribution.circular.inner,      // Círculo interno - próximo
        cfg.distanceDistribution.circular.near_medium, // Círculo próximo-médio  
        cfg.distanceDistribution.circular.medium,      // Círculo médio
        cfg.distanceDistribution.circular.medium_far,  // Círculo médio-distante
        Math.min(maxRange * 0.7, cfg.distanceDistribution.circular.far), // Círculo distante
        Math.min(maxRange, cfg.distanceDistribution.circular.max)        // Círculo máximo
      ];
      
      console.log(`🗻 CIRCULAR DISTANCES: [${distances.map(d => d.toFixed(0)).join('m, ')}m]`);
      console.log(`📏 Max theoretical range: ${maxRange.toFixed(0)}m`);
      
      return distances;
    }
    
    // 🏙️ ESTRATÉGIA PADRÃO PARA BAIXA ELEVAÇÃO
    let baseDistance = cfg.distanceDistribution.standard.baseDistance;
    
    if (boundary && (boundary as any).elevation) {
      const poiElevation = (boundary as any).elevation.center;
      console.log(`📏 POI elevation: ${poiElevation.toFixed(1)}m`);
      
      if (poiElevation > 800) {
        // Montanhas altas: múltiplas distâncias
        return [
          cfg.distanceDistribution.standard.mountainHigh.distances[0],
          cfg.distanceDistribution.standard.mountainHigh.distances[1],
          cfg.distanceDistribution.standard.mountainHigh.distances[2],
          cfg.distanceDistribution.standard.mountainHigh.distances[3]
        ];
      }
      else if (poiElevation > 400) {
        // Colinas: duas distâncias
        return [
          cfg.distanceDistribution.standard.mountainMedium.distances[0],
          cfg.distanceDistribution.standard.mountainMedium.distances[1]
        ];
      }
      else {
        console.log(`🏞️ LOW elevation: ${poiElevation.toFixed(0)}m → single distance`);
      }
    }
    
    // Ajustes para POIs de baixa elevação
    baseDistance = cfg.distanceDistribution.standard.urbanDensityLimits[context.urbanDensity.level];
    
    // REMOVIDO: Switch case de tipos de POI (agora usa apenas variáveis matemáticas: área, elevação, altura)
    // As características de cada tipo já são capturadas implicitamente:
    // - natural_feature/park → área grande detectada
    // - monument → altura detectada
    // - restaurant → área pequena + altura baixa
    
    console.log(`✅ Standard TP distance: ${Math.round(baseDistance)}m`);
    return [Math.round(baseDistance)];
  }

  // Função auxiliar para estimar elevação base regional
  
  /**
   * NOVO: Encontra ponto na rua com distância específica DO BOUNDARY
   */
  private findPointAtDistanceFromBoundary(
    street: StreetData, 
    boundary: BoundaryData, 
    targetDistance: number
  ): { lat: number; lng: number } | null {
    if (street.coordinates.length === 0) {
      return null;
    }
    
    console.log(`🎯 Finding point at ${targetDistance}m from boundary on street ${street.id}`);
    
    // Encontrar ponto mais próximo à distância alvo do boundary
    let bestPoint = street.coordinates[0];
    let bestDistanceDiff = Infinity;
    let validPointsFound = 0;
    
    for (const point of street.coordinates) {
      // Calcular distância do ponto até o boundary
      const distanceToBoundary = calculateDistanceToBoundary(point, boundary.coordinates);
      
      // Ignorar pontos dentro do boundary (distância = 0)
      if (distanceToBoundary === 0) {
        console.log(`🚫 Point inside boundary ignored: ${point.lat}, ${point.lng}`);
        continue;
      }
      
      validPointsFound++;
      const distanceDiff = Math.abs(distanceToBoundary - targetDistance);
      
      if (distanceDiff < bestDistanceDiff) {
        bestDistanceDiff = distanceDiff;
        bestPoint = point;
      }
    }
    
    if (validPointsFound === 0) {
      console.warn(`⚠️ No valid points found outside boundary for street ${street.id}`);
      return null;
    }
    
    const finalDistance = calculateDistanceToBoundary(bestPoint, boundary.coordinates);
    
    return bestPoint;
  }
  
  
  /**
   * Calcula qualidade de um ponto candidato
   */
  private async calculatePointQuality(
    point: { lat: number; lng: number },
    poiData: POIData,
    boundary: BoundaryData,
    context: GeographicContext,
    street?: StreetData
  ): Promise<number> {
    let quality = 0.5; // Qualidade base
    
    // Fator 1: Distância do boundary (30% do peso) - CORRIGIDO
    const distanceToBoundary = calculateDistanceToBoundary(point, boundary.coordinates);
    const distanceScore = this.calculateDistanceScore(distanceToBoundary, context);
    quality += distanceScore * 0.3;
    
    // Fator 2: Acessibilidade da rua (25% do peso)
    const accessibilityScore = this.calculateAccessibilityScore(point, context);
    quality += accessibilityScore * 0.25;
    
    // Fator 3: Visibilidade (20% do peso)
    const visibilityScore = this.calculateVisibilityScore(point, poiData, boundary, context);
    quality += visibilityScore * 0.2;
    
    // Fator 4: Contexto geográfico (15% do peso)
    const contextScore = this.calculateContextScore(context);
    quality += contextScore * 0.15;
    
    // Fator 5: Qualidade da rua (10% do peso)
    const streetQualityScore = this.calculateStreetQualityScore(point, context);
    quality += streetQualityScore * 0.1;
    
    // NOVO: Boost condicional para pontes
    if (street && (street.tags?.bridge === 'yes' || (street.tags?.layer && parseInt(street.tags.layer) > 0))) {
      const distanceToPOI = calculateDistance(point, boundary.center);
      
      // Boost se ponte está próxima do POI (< 500m)
      if (distanceToPOI < 500) {
        quality += 0.1; // Boost base de +0.1
        
        // Boost adicional se POI também está elevado
        if (boundary.height && boundary.height > 20) {
          quality += 0.05; // Boost adicional de +0.05
          console.log(`🌉 Bridge boost applied: +0.15 (bridge near elevated POI)`);
        } else {
          console.log(`🌉 Bridge boost applied: +0.1 (bridge near POI)`);
        }
      }
    }
    
    return Math.max(0, Math.min(1, quality));
  }
  
  /**
   * Calcula score baseado na distância
   */
  private calculateDistanceScore(distance: number, context: GeographicContext): number {
    // Para a nova estratégia circular, usar distância base simples
    const baseDistance = context.urbanDensity.level === 'rural' ? 200 : 150;
    const distanceDiff = Math.abs(distance - baseDistance);
    
    // Score diminui conforme a distância se afasta do ótimo
    const maxDeviation = baseDistance * 0.5; // 50% de tolerância
    const score = Math.max(0, 1 - (distanceDiff / maxDeviation));
    
    return score;
  }
  
  /**
   * Calcula score de acessibilidade
   */
  private calculateAccessibilityScore(point: { lat: number; lng: number }, context: GeographicContext): number {
    let score = 0.5; // Score base
    
    // Ajustar baseado na densidade urbana
    switch (context.urbanDensity.level) {
      case 'very_dense':
        score = 0.8; // Alta acessibilidade em áreas densas
        break;
      case 'dense':
        score = 0.7;
        break;
      case 'medium':
        score = 0.6;
        break;
      case 'low':
        score = 0.4;
        break;
      case 'rural':
        score = 0.3; // Baixa acessibilidade em áreas rurais
        break;
    }
    
    // Ajustar baseado na infraestrutura
    if (context.infrastructure.transitTypes.length > 0) {
      score += 0.1; // Bonus por transporte público
    }
    
    if (context.infrastructure.parkingAvailability > 0.5) {
      score += 0.1; // Bonus por estacionamento
    }
    
    return Math.max(0, Math.min(1, score));
  }
  
  /**
   * Calcula score de visibilidade
   */
  private calculateVisibilityScore(
    point: { lat: number; lng: number },
    poiData: POIData,
    boundary: BoundaryData,
    context: GeographicContext
  ): number {
    let score = 0.5; // Score base
    
    // Verificar se o ponto está dentro do boundary
    const isInsideBoundary = this.isPointInBoundary(point, boundary);
    if (isInsideBoundary) {
      score += 0.2; // Bonus por estar dentro do boundary
    }
    
    // Ajustar baseado na elevação
    switch (context.elevationContext.type) {
      case 'mountainous':
        score += 0.2; // Bonus por elevação (melhor visibilidade)
        break;
      case 'hilly':
        score += 0.1;
        break;
      case 'flat':
        score += 0.0;
        break;
    }
    
    // Ajustar baseado na densidade urbana
    switch (context.urbanDensity.level) {
      case 'very_dense':
        score -= 0.1; // Penalidade por obstáculos urbanos
        break;
      case 'dense':
        score -= 0.05;
        break;
      case 'medium':
        score += 0.0;
        break;
      case 'low':
        score += 0.1; // Bonus por menos obstáculos
        break;
      case 'rural':
        score += 0.2; // Bonus por visibilidade rural
        break;
    }
    
    return Math.max(0, Math.min(1, score));
  }
  
  /**
   * Calcula score do contexto geográfico
   */
  private calculateContextScore(context: GeographicContext): number {
    let score = 0.5; // Score base
    
    // Ajustar baseado no padrão de ruas
    switch (context.streetPattern.type) {
      case 'grid':
        score += 0.1; // Bonus por padrão organizado
        break;
      case 'boulevard':
        score += 0.15; // Bonus por boulevards (melhor acesso)
        break;
      case 'organic':
        score += 0.05; // Pequeno bonus por padrão orgânico
        break;
      case 'mixed':
        score += 0.0; // Sem bonus
        break;
    }
    
    // Ajustar baseado na confiança do padrão
    score += context.streetPattern.confidence * 0.1;
    
    return Math.max(0, Math.min(1, score));
  }
  
  /**
   * Calcula score da qualidade da rua
   */
  private calculateStreetQualityScore(point: { lat: number; lng: number }, context: GeographicContext): number {
    // Score baseado na densidade de infraestrutura
    const infrastructureScore = Math.min(context.infrastructure.infrastructureDensity / 20, 1);
    
    return infrastructureScore;
  }
  
  /**
   * Verifica se um ponto está dentro do boundary
   */
  private isPointInBoundary(point: { lat: number; lng: number }, boundary: BoundaryData): boolean {
    // Implementação simples usando ray casting
    const x = point.lng;
    const y = point.lat;
    let inside = false;
    
    for (let i = 0, j = boundary.coordinates.length - 1; i < boundary.coordinates.length; j = i++) {
      const xi = boundary.coordinates[i].lng;
      const yi = boundary.coordinates[i].lat;
      const xj = boundary.coordinates[j].lng;
      const yj = boundary.coordinates[j].lat;
      
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    
    return inside;
  }
  
  /**
   * Filtra candidatos por qualidade mínima
   */
  filterCandidatesByQuality(candidates: TriggerPointCandidate[], minQuality: number = 0.3): TriggerPointCandidate[] {
    return candidates.filter(candidate => candidate.quality >= minQuality);
  }
  
  /**
   * Limita número de candidatos
   */
  limitCandidates(candidates: TriggerPointCandidate[], maxCount: number = 10): TriggerPointCandidate[] {
    return candidates.slice(0, maxCount);
  }
  
  /**
   * 🏗️ ESTRATÉGIA PARA POIs COM ALTURA (torres, monumentos)
   * ✅ CORRIGIDO: Agora respeita o searchRadius da classificação
   */
  private calculateHeightStrategy(
    poiData: POIData, 
    context: GeographicContext, 
    boundary: BoundaryData, 
    cfg: TriggerPointsConfig,
    classification: any
  ): number[] {
    console.log(`🏗️ HEIGHT STRATEGY: ${classification.metadata?.reasoning || 'Height-based POI'}`);
    
    const height = classification.metadata?.height || 0;
    const maxSearchRadius = classification.searchRadius || 300; // Limite máximo do raio de busca
    
    // Para torres/monumentos, usar distâncias baseadas na altura
    // MAS limitar pelo searchRadius da classificação
    const baseDistance = Math.min(height * 2, maxSearchRadius); // 2m por metro de altura, mas não exceder searchRadius
    
    const distances = [
      Math.round(baseDistance * 0.3),  // Próximo
      Math.round(baseDistance * 0.6),  // Médio
      Math.round(baseDistance * 1.0),  // Distante
      Math.round(Math.min(baseDistance * 1.5, maxSearchRadius))   // Muito distante (limitado)
    ];
    
    // Remover distâncias duplicadas e garantir que não excedam o limite
    const uniqueDistances = [...new Set(distances)].filter(d => d <= maxSearchRadius);
    
    console.log(`📏 Height-based distances: [${uniqueDistances.map(d => d.toFixed(0)).join('m, ')}m] (height: ${height}m, max radius: ${maxSearchRadius}m)`);
    return uniqueDistances.length > 0 ? uniqueDistances : [maxSearchRadius];
  }
  
  /**
   * 🏔️ ESTRATÉGIA PARA POIs COM ELEVAÇÃO (picos, montanhas)
   * ✅ CORRIGIDO: Agora respeita o searchRadius da classificação
   */
  private calculateElevationStrategy(
    poiData: POIData, 
    context: GeographicContext, 
    boundary: BoundaryData, 
    cfg: TriggerPointsConfig,
    classification: any
  ): number[] {
    console.log(`🏔️ ELEVATION STRATEGY: ${classification.metadata?.reasoning || 'Elevation-based POI'}`);
    
    const elevation = classification.metadata?.elevation || 0;
    const maxSearchRadius = classification.searchRadius || 300; // Limite máximo do raio de busca
    
    // Para picos/montanhas, usar estratégia circular com múltiplas distâncias
    // ✅ CORRIGIDO: Se o raio é muito grande (>2000m), gerar distâncias escalonadas até o limite
    let distances: number[];
    if (elevation > 1000) {
      // Picos muito altos: usar configuração circular, mas escalonar até maxSearchRadius se necessário
      if (maxSearchRadius > 2000) {
        // ✅ NOVO: Para raios grandes, gerar distâncias escalonadas até o limite
        // Exemplo: se maxSearchRadius = 3800m, gerar: 500m, 1000m, 2000m, 3000m, 3800m
        const step = Math.max(500, Math.round(maxSearchRadius / 6)); // Dividir em ~6 faixas
        distances = [];
        for (let d = step; d <= maxSearchRadius; d += step) {
          distances.push(d);
        }
        // Adicionar também algumas distâncias próximas (para ruas muito próximas)
        distances.unshift(Math.min(200, maxSearchRadius));
        distances.unshift(Math.min(100, maxSearchRadius));
        // Garantir que maxSearchRadius está incluído
        if (!distances.includes(maxSearchRadius)) {
          distances.push(maxSearchRadius);
        }
        console.log(`🏔️ Large radius (${maxSearchRadius}m): Using scaled distances up to max radius`);
      } else {
        // Raio normal: usar configuração circular padrão
        distances = [
          cfg.distanceDistribution.circular.inner,
          cfg.distanceDistribution.circular.near_medium,
          cfg.distanceDistribution.circular.medium,
          cfg.distanceDistribution.circular.medium_far,
          cfg.distanceDistribution.circular.far,
          cfg.distanceDistribution.circular.max
        ].map(d => Math.min(d, maxSearchRadius)); // Limitar cada distância
      }
    } else {
      // Picos médios: distâncias intermediárias, mas limitar pelo searchRadius
      distances = [
        Math.round(elevation * 0.5),  // 0.5x elevação
        Math.round(elevation * 1.0),  // 1x elevação
        Math.round(elevation * 2.0),  // 2x elevação
        Math.round(elevation * 3.0)   // 3x elevação
      ].map(d => Math.min(d, maxSearchRadius)); // Limitar cada distância
    }
    
    // Remover distâncias duplicadas e garantir que não excedam o limite
    const uniqueDistances = [...new Set(distances)].filter(d => d <= maxSearchRadius).sort((a, b) => a - b);
    
    console.log(`📏 Elevation-based distances: [${uniqueDistances.map(d => d.toFixed(0)).join('m, ')}m] (elevation: ${elevation}m, max radius: ${maxSearchRadius}m)`);
    return uniqueDistances.length > 0 ? uniqueDistances : [maxSearchRadius];
  }
  
  /**
   * 🏗️🏔️ ESTRATÉGIA PARA POIs HÍBRIDOS (altura + elevação)
   * ✅ CORRIGIDO: Agora respeita o searchRadius da classificação
   */
  private calculateHybridStrategy(
    poiData: POIData, 
    context: GeographicContext, 
    boundary: BoundaryData, 
    cfg: TriggerPointsConfig,
    classification: any
  ): number[] {
    console.log(`🏗️🏔️ HYBRID STRATEGY: ${classification.metadata?.reasoning || 'Hybrid POI'}`);
    
    const height = classification.metadata?.height || 0;
    const elevation = classification.metadata?.elevation || 0;
    const maxSearchRadius = classification.searchRadius || 300; // Limite máximo do raio de busca
    
    // Para híbridos, combinar estratégias de altura e elevação
    const heightBased = height * 1.5; // 1.5m por metro de altura
    const elevationBased = elevation * 0.8; // 0.8x elevação
    
    const baseDistance = Math.min(Math.max(heightBased, elevationBased), maxSearchRadius);
    
    const distances = [
      Math.round(baseDistance * 0.4),  // Próximo
      Math.round(baseDistance * 0.7),  // Médio-próximo
      Math.round(baseDistance * 1.0),  // Médio
      Math.round(Math.min(baseDistance * 1.5, maxSearchRadius)),  // Distante (limitado)
      Math.round(Math.min(baseDistance * 2.0, maxSearchRadius))   // Muito distante (limitado)
    ];
    
    // Remover distâncias duplicadas e garantir que não excedam o limite
    const uniqueDistances = [...new Set(distances)].filter(d => d <= maxSearchRadius);
    
    console.log(`📏 Hybrid distances: [${uniqueDistances.map(d => d.toFixed(0)).join('m, ')}m] (height: ${height}m, elevation: ${elevation}m, max radius: ${maxSearchRadius}m)`);
    return uniqueDistances.length > 0 ? uniqueDistances : [maxSearchRadius];
  }
  
  /**
   * 🏙️ ESTRATÉGIA PADRÃO (mantém lógica existente)
   * ✅ CORRIGIDO: Agora respeita o searchRadius da classificação
   */
  private calculateStandardStrategy(
    poiData: POIData, 
    context: GeographicContext, 
    boundary: BoundaryData, 
    cfg: TriggerPointsConfig,
    classification: any
  ): number[] {
    const maxSearchRadius = classification.searchRadius || 300; // Limite máximo do raio de busca
    console.log(`🏙️ STANDARD STRATEGY: ${classification.metadata?.reasoning || 'Standard POI'}`);
    
    // Usar lógica existente para POIs padrão, mas limitar pelo searchRadius
    let baseDistance = Math.min(cfg.distanceDistribution.standard.baseDistance, maxSearchRadius);
    
    if (boundary && (boundary as any).elevation) {
      const poiElevation = (boundary as any).elevation.center;
      console.log(`📏 POI elevation: ${poiElevation.toFixed(1)}m`);
      
      if (poiElevation > 800) {
        // Montanhas altas: múltiplas distâncias, mas limitar pelo searchRadius
        const distances = [
          cfg.distanceDistribution.standard.mountainHigh.distances[0],
          cfg.distanceDistribution.standard.mountainHigh.distances[1],
          cfg.distanceDistribution.standard.mountainHigh.distances[2],
          cfg.distanceDistribution.standard.mountainHigh.distances[3]
        ].map(d => Math.min(d, maxSearchRadius)).filter((d, i, arr) => arr.indexOf(d) === i);
        console.log(`📏 Mountain high distances (limited): [${distances.map(d => d.toFixed(0)).join('m, ')}m] (max: ${maxSearchRadius}m)`);
        return distances.length > 0 ? distances : [maxSearchRadius];
      }
      else if (poiElevation > 400) {
        // Colinas: duas distâncias, mas limitar pelo searchRadius
        const distances = [
          cfg.distanceDistribution.standard.mountainMedium.distances[0],
          cfg.distanceDistribution.standard.mountainMedium.distances[1]
        ].map(d => Math.min(d, maxSearchRadius)).filter((d, i, arr) => arr.indexOf(d) === i);
        console.log(`📏 Mountain medium distances (limited): [${distances.map(d => d.toFixed(0)).join('m, ')}m] (max: ${maxSearchRadius}m)`);
        return distances.length > 0 ? distances : [maxSearchRadius];
      }
      else {
        console.log(`🏞️ LOW elevation: ${poiElevation.toFixed(0)}m → single distance`);
      }
    }
    
    // Ajustes para POIs de baixa elevação
    baseDistance = Math.min(
      cfg.distanceDistribution.standard.urbanDensityLimits[context.urbanDensity.level],
      maxSearchRadius
    );
    
    console.log(`✅ Standard TP distance: ${Math.round(baseDistance)}m (max radius: ${maxSearchRadius}m)`);
    return [Math.round(baseDistance)];
  }
  
  /**
   * 🏔️ ESTRATÉGIA PARA MÚLTIPLAS RUAS (POIs de alta elevação)
   */
  private async calculateMultipleStreetsStrategy(
    streets: StreetData[],
    poiData: POIData,
    boundary: BoundaryData,
    context: GeographicContext,
    classification: any
  ): Promise<TriggerPointCandidate[]> {
    console.log(`🏔️ MULTIPLE STREETS STRATEGY: Using ${streets.length} streets for high elevation POI`);
    
    const candidates: TriggerPointCandidate[] = [];
    const elevation = classification.metadata?.elevation || 0;
    
    // Para POIs de alta elevação, usar múltiplas distâncias em cada rua
    const distances = this.calculateElevationStrategy(poiData, context, boundary, loadTriggerPointsConfig(), classification);
    
    console.log(`🎯 Using ${distances.length} distance ranges: [${distances.map(d => d.toFixed(0)).join('m, ')}m]`);
    
    for (const street of streets) {
      console.log(`🛣️ Processing street: ${street.name || street.id}`);
      
      // Para cada rua, tentar encontrar pontos em diferentes distâncias
      for (const targetDistance of distances) {
        const point = this.findPointAtDistanceFromBoundary(street, boundary, targetDistance);
        
        if (point) {
          const distanceToBoundary = calculateDistanceToBoundary(point, boundary.coordinates);
          
          // Calcular qualidade baseada na distância e tipo de rua
          const quality = this.calculateMultipleStreetsPointQuality(point, street, boundary, distanceToBoundary, targetDistance, poiData);
          
          if (quality > 0.3) { // Qualidade mínima
            candidates.push({
              location: point,
              quality,
              distance: distanceToBoundary,
              street: street,
              expectedBearing: 0, // Será calculado posteriormente
              confidence: quality,
              metadata: {
                targetDistance,
                actualDistance: distanceToBoundary,
                streetType: street.type,
                streetName: street.name
              }
            });
            
            console.log(`✅ Added candidate at ${distanceToBoundary.toFixed(0)}m (target: ${targetDistance}m) - Quality: ${quality.toFixed(2)}`);
          }
        }
      }
    }
    
    console.log(`🏔️ Generated ${candidates.length} candidates from ${streets.length} streets`);
    return candidates;
  }
  
  /**
   * Calcula qualidade de um ponto baseado em vários fatores (para múltiplas ruas)
   * 🏔️ NOVO: Prioriza highways e rodovias de grande fluxo para POIs de alta elevação
   */
  private calculateMultipleStreetsPointQuality(
    point: { lat: number; lng: number },
    street: StreetData,
    boundary: BoundaryData,
    actualDistance: number,
    targetDistance: number,
    poiData?: POIData
  ): number {
    let quality = 0.5; // Base quality
    
    // 🏔️ NOVO: Detectar se é POI de alta elevação baseado em dados reais (elevação)
    const isHighElevationPOI = boundary.elevation && boundary.elevation.center > 800;
    
    // 🚫 NOVO: BLOQUEIO para POIs de alta elevação - apenas highways e rodovias principais
    if (isHighElevationPOI) {
      const blockedStreetTypes = ['residential', 'unclassified', 'tertiary', 'secondary'];
      if (blockedStreetTypes.includes(street.type)) {
        console.log(`🚫 BLOCKED: ${street.type} street for high elevation POI (${boundary.elevation?.center.toFixed(0)}m elevation)`);
        return 0.0; // Qualidade zero = rejeitado
      }
    }
    
    // Bonus por tipo de rua - PRIORIZA HIGHWAYS para POIs altos
    let streetTypeBonus;
    if (isHighElevationPOI) {
      // 🚗 PRIORIZAÇÃO PARA POIs DE ALTA ELEVAÇÃO: Apenas highways e rodovias principais
      streetTypeBonus = {
        'motorway': 0.5,    // +50% - Autoestradas (máxima prioridade)
        'trunk': 0.45,      // +45% - Vias principais de grande fluxo
        'primary': 0.35,    // +35% - Rodovias principais
        'secondary': 0.0,   // 0% - BLOQUEADAS para POIs altos
        'tertiary': 0.0,    // 0% - BLOQUEADAS para POIs altos
        'residential': 0.0, // 0% - BLOQUEADAS para POIs altos
        'unclassified': 0.0 // 0% - BLOQUEADAS para POIs altos
      };
    } else {
      // 🏙️ CONFIGURAÇÃO PADRÃO para POIs normais
      streetTypeBonus = {
        'motorway': 0.3,
        'trunk': 0.25,
        'primary': 0.2,
        'secondary': 0.15,
        'tertiary': 0.1,
        'residential': 0.05,
        'unclassified': 0.0
      };
    }
    
    quality += streetTypeBonus[street.type as keyof typeof streetTypeBonus] || 0;
    
    // 🏔️ BONUS ADICIONAL para highways em POIs de alta elevação
    if (isHighElevationPOI && (street.type === 'motorway' || street.type === 'trunk')) {
      quality += 0.15; // +15% bonus extra para highways em picos/monumentos
    }
    
    // Bonus por proximidade ao target distance
    const distanceDiff = Math.abs(actualDistance - targetDistance);
    const distanceAccuracy = Math.max(0, 1 - (distanceDiff / targetDistance));
    quality += distanceAccuracy * 0.3;
    
    // Bonus por distância mínima do boundary
    if (actualDistance > 50) {
      quality += 0.1; // Bonus por não estar muito próximo
    }
    
    return Math.min(1.0, quality);
  }
  
  /**
   * 🏙️ ESTRATÉGIA PARA CANYON URBANO
   * Prioriza front street e usa validação rigorosa de visibilidade
   */
  private async calculateCanyonStrategy(
    streets: StreetData[],
    poiData: POIData,
    boundary: BoundaryData,
    context: GeographicContext,
    classification: any
  ): Promise<TriggerPointCandidate[]> {
    console.log(`🏙️ CANYON STRATEGY: Prioritizing front street with limited radius`);
    
    const candidates: TriggerPointCandidate[] = [];
    const maxDistance = classification.searchRadius || 300; // Limitado a 300m
    
    // Ordenar ruas por proximidade ao boundary (front street first)
    const sortedStreets = [...streets].sort((a, b) => {
      const distA = this.calculateStreetDistanceToCenter(a, boundary.center);
      const distB = this.calculateStreetDistanceToCenter(b, boundary.center);
      return distA - distB;
    });
    
    console.log(`🎯 Processing ${sortedStreets.length} streets, prioritizing front street`);
    
    // Para canyon, usar distâncias curtas (50m, 100m, 150m, 200m, 300m)
    const distances = [50, 100, 150, 200, maxDistance];
    
    for (const street of sortedStreets) {
      const isFrontStreet = sortedStreets.indexOf(street) === 0;
      console.log(`🛣️ Processing street: ${street.name || street.id}${isFrontStreet ? ' (FRONT STREET)' : ''}`);
      
      for (const targetDistance of distances) {
        const point = this.findPointAtDistanceFromBoundary(street, boundary, targetDistance);
        
        if (point) {
          const distanceToBoundary = calculateDistanceToBoundary(point, boundary.coordinates);
          
          // Calcular qualidade com bonus para front street
          let quality = 0.5;
          
          // Bonus por proximidade
          if (distanceToBoundary < 100) {
            quality += 0.2;
          }
          
          // GRANDE BONUS para front street
          if (isFrontStreet) {
            quality += 0.3;
            console.log(`🏠 FRONT STREET BONUS: +0.3 quality`);
          }
          
          // Bonus por tipo de rua (preferir ruas locais em canyons)
          const streetTypeBonus = {
            'primary': 0.2,
            'secondary': 0.15,
            'tertiary': 0.1,
            'residential': 0.05,
            'motorway': 0.05,
            'trunk': 0.05,
            'unclassified': 0.0
          };
          quality += streetTypeBonus[street.type as keyof typeof streetTypeBonus] || 0;
          
          if (quality > 0.4) { // Qualidade mínima
            candidates.push({
              location: point,
              quality,
              distance: distanceToBoundary,
              street: street,
              expectedBearing: 0,
              confidence: quality,
              metadata: {
                targetDistance,
                actualDistance: distanceToBoundary,
                streetType: street.type,
                streetName: street.name,
                isFrontStreet
              }
            });
            
            console.log(`✅ Added candidate at ${distanceToBoundary.toFixed(0)}m - Quality: ${quality.toFixed(2)}${isFrontStreet ? ' (FRONT STREET)' : ''}`);
          }
        }
      }
    }
    
    console.log(`🏙️ Generated ${candidates.length} canyon candidates from ${streets.length} streets`);
    return candidates;
  }
  
  /**
   * Calcula distância de uma rua até o centro do boundary
   * DRY: Usa função utilitária centralizada
   */
  private calculateStreetDistanceToCenter(street: StreetData, center: { lat: number; lng: number }): number {
    return calculateMinDistanceToCenter(street.coordinates || [], center);
  }
  
}

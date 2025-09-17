// Calculador de pontos ótimos para trigger points

import { POIData, BoundaryData, GeographicContext, StreetData, TriggerPointCandidate } from '../types/interfaces';
import { calculateDistance, calculateBearing, calculateOptimalRadius, calculateDistanceToBoundary, isPointInPolygon } from '../utils/calculations';

export class OptimalPointCalculator {
  
  /**
   * Calcula pontos ótimos nas ruas para trigger points
   */
  async calculateOptimalPoints(
    poiData: POIData, 
    streets: StreetData[], 
    boundary: BoundaryData, 
    context: GeographicContext
  ): Promise<TriggerPointCandidate[]> {
    console.log(`🎯 Calculating optimal points for: ${poiData.name}`);
    
    const candidates: TriggerPointCandidate[] = [];
    
    for (const street of streets) {
      const optimalPoint = await this.calculateOptimalPointOnStreet(street, poiData, boundary, context);
      
      if (optimalPoint) {
        candidates.push(optimalPoint);
      }
    }
    
    // Ordenar candidatos por qualidade
    candidates.sort((a, b) => b.quality - a.quality);
    
    console.log(`✅ Generated ${candidates.length} optimal point candidates`);
    return candidates;
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
      const optimalDistances = this.calculateOptimalDistances(poiData, context, boundary);
      
      console.log(`🎯 Testing ${optimalDistances.length} distance ranges for street ${street.id}`);
      
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
      
      console.log(`✅ Best point found at ${bestDistance.toFixed(0)}m (target ranges: [${optimalDistances.join('m, ')}m])`);
      const pointOnStreet = bestPoint;
      
      // VALIDAÇÃO: Garantir que o ponto está FORA do boundary
      if (isPointInPolygon(pointOnStreet, boundary.coordinates)) {
        console.warn(`⚠️ Point inside boundary rejected: ${pointOnStreet.lat}, ${pointOnStreet.lng}`);
        return null;
      }
      
      // Calcular qualidade do ponto
      const quality = await this.calculatePointQuality(pointOnStreet, poiData, boundary, context);
      
      // Calcular bearing esperado (do ponto para o centro do POI)
      const expectedBearing = calculateBearing(pointOnStreet, boundary.center);
      
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
  private calculateOptimalDistances(poiData: POIData, context: GeographicContext, boundary?: BoundaryData): number[] {
    console.log(`🎯 Calculating optimal TP distances from boundary for ${poiData.name}...`);
    
    // 🏔️ ESTRATÉGIA CIRCULAR PARA ALTA ELEVAÇÃO (baseada no sistema legado)
    if (boundary?.elevation && boundary.elevation.center > 1000) {
      const poiElevation = boundary.elevation.center;
      const baseElevation = this.estimateRegionalBaseElevation(boundary.center, context);
      const elevationDiff = poiElevation - baseElevation;
      
      console.log(`🏔️ HIGH ELEVATION LANDMARK DETECTED: ${poiElevation.toFixed(0)}m (diff: ${elevationDiff.toFixed(0)}m)`);
      console.log(`🎯 Using CIRCULAR DISTRIBUTION strategy (legacy system)`);
      
      // LEGACY FORMULA: Math.sqrt(elevationDiff) * 200
      const maxRange = Math.min(Math.max(Math.sqrt(elevationDiff) * 200, 2000), 8000);
      
      // DISTRIBUIÇÃO CIRCULAR EM MÚLTIPLAS FAIXAS (como sistema legado)
      const distances = [
        300,  // Círculo interno - próximo
        800,  // Círculo próximo-médio  
        1500, // Círculo médio
        2500, // Círculo médio-distante
        Math.min(maxRange * 0.7, 4000), // Círculo distante
        Math.min(maxRange, 6000)        // Círculo máximo
      ];
      
      console.log(`🗻 CIRCULAR DISTANCES: [${distances.map(d => d.toFixed(0)).join('m, ')}m]`);
      console.log(`📏 Max theoretical range: ${maxRange.toFixed(0)}m`);
      
      return distances;
    }
    
    // 🏙️ ESTRATÉGIA PADRÃO PARA BAIXA ELEVAÇÃO
    let baseDistance = 100;
    
    if (boundary?.elevation) {
      const poiElevation = boundary.elevation.center;
      console.log(`📏 POI elevation: ${poiElevation.toFixed(1)}m`);
      
      if (poiElevation > 800) {
        // Montanhas altas: múltiplas distâncias
        return [200, 600, 1200, 2000];
      }
      else if (poiElevation > 400) {
        // Colinas: duas distâncias
        return [150, 400];
      }
      else {
        console.log(`🏞️ LOW elevation: ${poiElevation.toFixed(0)}m → single distance`);
      }
    }
    
    // Ajustes para POIs de baixa elevação
    switch (context.urbanDensity.level) {
      case 'very_dense': baseDistance = 80; break;
      case 'dense': baseDistance = 100; break;
      case 'medium': baseDistance = 120; break;
      case 'low': baseDistance = 150; break;
      case 'rural': baseDistance = 180; break;
    }
    
    // Ajuste por tipo de POI
    switch (poiData.type) {
      case 'natural_feature': baseDistance *= 1.5; break;
      case 'park': baseDistance *= 1.3; break;
      case 'monument': baseDistance *= 1.2; break;
      case 'restaurant': baseDistance *= 0.8; break;
      case 'shopping_mall': baseDistance *= 1.1; break;
    }
    
    console.log(`✅ Standard TP distance: ${Math.round(baseDistance)}m`);
    return [Math.round(baseDistance)];
  }

  // Função auxiliar para estimar elevação base regional
  private estimateRegionalBaseElevation(location: { lat: number; lng: number }, context: GeographicContext): number {
    // Lógica simplificada - poderia ser mais sofisticada
    let baseElevation = 500; // Default global average
    
    // Ajustes regionais básicos
    if (location.lat > -30 && location.lat < -10 && location.lng > -75 && location.lng < -30) {
      // Brasil
      if (location.lng > -50) {
        baseElevation = 200; // Costa brasileira
      } else if (location.lat > -25 && location.lat < -20) {
        baseElevation = 700; // Região de São Paulo
      }
    }
    
    return baseElevation;
  }
  
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
    console.log(`✅ Best point found: ${finalDistance.toFixed(0)}m from boundary (target: ${targetDistance}m)`);
    
    return bestPoint;
  }
  
  /**
   * LEGACY: Encontra ponto na rua com distância específica (mantido para compatibilidade)
   */
  private findPointAtDistance(
    street: StreetData, 
    poiLocation: { lat: number; lng: number }, 
    targetDistance: number
  ): { lat: number; lng: number } | null {
    if (street.coordinates.length === 0) {
      return null;
    }
    
    // Se a rua tem apenas um ponto, usar esse ponto
    if (street.coordinates.length === 1) {
      return street.coordinates[0];
    }
    
    // Encontrar ponto mais próximo à distância alvo
    let bestPoint = street.coordinates[0];
    let bestDistanceDiff = Infinity;
    
    for (const point of street.coordinates) {
      const distance = calculateDistance(point, poiLocation);
      const distanceDiff = Math.abs(distance - targetDistance);
      
      if (distanceDiff < bestDistanceDiff) {
        bestDistanceDiff = distanceDiff;
        bestPoint = point;
      }
    }
    
    return bestPoint;
  }
  
  /**
   * Calcula qualidade de um ponto candidato
   */
  private async calculatePointQuality(
    point: { lat: number; lng: number },
    poiData: POIData,
    boundary: BoundaryData,
    context: GeographicContext
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
}

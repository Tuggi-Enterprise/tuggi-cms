// Calculador de pontos ótimos para trigger points

import { POIData, BoundaryData, GeographicContext, StreetData, TriggerPointCandidate } from '../types/interfaces.ts';
import { calculateDistance, calculateBearing, calculateDistanceToBoundary, isPointInPolygon, calculateMinDistanceToCenter, findClosestPointOnBoundary } from '../utils/calculations.ts';
import { TRIGGER_POINTS_CONSTANTS } from '../config/trigger-points-config.ts';
import { ElevationAnalysisService } from '../services/elevation-service.ts';
import { loadTriggerPointsConfig, TriggerPointsConfig, POIGroup, GROUP_CONFIGS } from '../config/trigger-points-config.ts';
import { POIClassifierService } from '../services/poi-classifier.service.ts';

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
      const fallbackClassification = await this.poiClassifier.classifyPOI(
        poiData,
        boundary.height,
        boundary.elevation ? { center: boundary.elevation.center } : undefined,
        boundary.area,
        context,
        boundary.osmTags
      );
      boundary.classification = fallbackClassification;
      classification = fallbackClassification; 
    }
    
    if (!classification) {
      throw new Error('Classification is still undefined after fallback creation');
    }
    
    const group = classification.group;
    const strategy = classification.strategy;
    const searchRadius = classification.searchRadius || 300; 
    
    const filteredStreets = this.filterStreetsByRadius(streets, boundary, searchRadius);
    console.log(`🔍 Filtered streets: ${filteredStreets.length}/${streets.length} within ${searchRadius}m radius`);
    
    const candidates: TriggerPointCandidate[] = [];
    
    // 🏔️ ESTRATÉGIA CIRCULAR: Para HIGH e MEDIUM (múltiplas ruas, múltiplas distâncias)
    // 🆕 Melhoria: Validar se o bearing do TP para o POI faz sentido com a direção da rua
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
      
      const isSmallPOI = boundary.area < 10000;
      const isDenseArea = context.urbanDensity.level === 'very_dense' || context.urbanDensity.level === 'dense';
      
      let streetsToProcess = filteredStreets;
      if (isSmallPOI && isDenseArea) {
        const sortedStreets = [...streets].sort((a, b) => {
          const distA = calculateMinDistanceToCenter(a.coordinates || [], boundary.center);
          const distB = calculateMinDistanceToCenter(b.coordinates || [], boundary.center);
          return distA - distB;
        });
        
        streetsToProcess = sortedStreets.slice(0, 5);
      } else if (isSmallPOI) {
        streetsToProcess = streets.slice(0, 8);
      }
      
      for (const street of streetsToProcess) {
        const optimalPoint = await this.calculateOptimalPointOnStreet(street, poiData, boundary, context);
        
        if (optimalPoint) {
          candidates.push(optimalPoint);
        }
      }
    }
    
    candidates.sort((a, b) => b.quality - a.quality);
    
    return candidates;
  }
  
  private filterStreetsByRadius(
    streets: StreetData[],
    boundary: BoundaryData,
    searchRadius: number
  ): StreetData[] {
    if (!streets || streets.length === 0) return streets;
    if (!boundary.coordinates || boundary.coordinates.length === 0) return streets;
    
    const filtered: StreetData[] = [];
    const maxAllowedDistance = searchRadius + 20; 
    
    for (const street of streets) {
      if (!street.coordinates || street.coordinates.length === 0) continue;
      
      const validPoints: Array<{ lat: number; lng: number }> = [];
      let minDistanceToBoundary = Infinity;
      let maxDistanceToBoundary = 0;
      
      for (const streetPoint of street.coordinates) {
        const distanceToBoundary = calculateDistanceToBoundary(streetPoint, boundary.coordinates);
        
        minDistanceToBoundary = Math.min(minDistanceToBoundary, distanceToBoundary);
        maxDistanceToBoundary = Math.max(maxDistanceToBoundary, distanceToBoundary);
        
        if (distanceToBoundary <= maxAllowedDistance) {
          validPoints.push(streetPoint);
        }
      }
      
      if (validPoints.length >= 1) {
        const pointsToUse = validPoints.length >= 2 
          ? validPoints 
          : [validPoints[0], validPoints[0]]; 
        
        const filteredStreet: StreetData = {
          ...street,
          coordinates: pointsToUse
        };
        
        filtered.push(filteredStreet);
        
      } else {
        const streetName = street.name || street.id || 'unnamed';
        // log rejected
      }
    }
    
    return filtered;
  }
  
  private async calculateOptimalPointOnStreet(
    street: StreetData, 
    poiData: POIData, 
    boundary: BoundaryData, 
    context: GeographicContext
  ): Promise<TriggerPointCandidate | null> {
    try {
      const optimalDistances = await this.calculateOptimalDistances(poiData, context, boundary);
      
      let bestPoint = null;
      let bestDistance = 0;
      let bestDistanceDiff = Infinity;
      
      for (const targetDistance of optimalDistances) {
        const pointOnStreet = this.findPointAtDistanceFromBoundary(street, boundary, targetDistance);
        
        if (pointOnStreet) {
          const actualDistance = calculateDistanceToBoundary(pointOnStreet, boundary.coordinates);
          const distanceDiff = Math.abs(actualDistance - targetDistance);
          
          if (distanceDiff < bestDistanceDiff) {
            bestPoint = pointOnStreet;
            bestDistance = actualDistance;
            bestDistanceDiff = distanceDiff;
          }
        }
      }
      
      if (!bestPoint) {
        return null;
      }
      
      const pointOnStreet = bestPoint;
      
      if (isPointInPolygon(pointOnStreet, boundary.coordinates)) {
        return null;
      }
      
      const quality = await this.calculatePointQuality(pointOnStreet, poiData, boundary, context, street);
      
      const targetPoint = this.calculateTargetPoint(poiData, boundary, pointOnStreet);
      
      const expectedBearing = calculateBearing(pointOnStreet, targetPoint);
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
   * Calcula o ponto alvo ideal do POI (Entrada, Pico, ou Ponto mais próximo)
   */
  private calculateTargetPoint(
    poiData: POIData, 
    boundary: BoundaryData, 
    sourcePoint: { lat: number; lng: number }
  ): { lat: number; lng: number } {
    
    // 1. Caso Montanha/Pico: O alvo é sempre o ponto mais alto/centro, não a base
    // Verifica se é montanha por elevação ou categoria
    const isMountain = 
      (boundary.elevation?.center && boundary.elevation.center > 500 && boundary.area > 50000) ||
      poiData.type.toLowerCase().includes('mountain') || 
      poiData.type.toLowerCase().includes('peak') ||
      poiData.type.toLowerCase().includes('volcano');

    if (isMountain) {
      if (boundary.elevation?.highestPoint) {
         return boundary.elevation.highestPoint;
      }
      return boundary.center; // Fallback para o centro geométrico em montanhas
    }

    // 2. Caso Grande Área com Endereço (Entrada Provável)
    if (boundary.area > 50000 && boundary.address?.street) {
        const addressStreet = boundary.address.street;
        const addressStreetInBoundary = boundary.streets?.find(s => 
          s.name?.toLowerCase().includes(addressStreet.toLowerCase()) ||
          addressStreet.toLowerCase().includes(s.name?.toLowerCase() || '')
        );
        
        if (addressStreetInBoundary && addressStreetInBoundary.coordinates.length > 0) {
          // Tentar encontrar o ponto dessa rua que toca/está mais perto do boundary
          const streetPoint = addressStreetInBoundary.coordinates[0]; // Simplificação
          const closestOnBoundary = findClosestPointOnBoundary(streetPoint, boundary.coordinates);
          return { lat: closestOnBoundary.lat, lng: closestOnBoundary.lng };
        }
    }

    // 3. Padrão: Ponto mais próximo no perímetro ("Parede mais próxima")
    const closestBoundaryPoint = findClosestPointOnBoundary(sourcePoint, boundary.coordinates);
    
    // Ajuste fino: Se o ponto mais próximo é uma "quina" (ângulo agudo), tentar suavizar? 
    // Por enquanto, manter simples.
    return { lat: closestBoundaryPoint.lat, lng: closestBoundaryPoint.lng };
  }
  
  private async calculateOptimalDistances(poiData: POIData, context: GeographicContext, boundary?: BoundaryData, config?: TriggerPointsConfig): Promise<number[]> {
    const cfg = config || loadTriggerPointsConfig();
    
    if (boundary && boundary.classification) {
      const classification = boundary.classification;
      const maxSearchRadius = classification.searchRadius || 300; 
      
      let distances: number[];
      switch (classification.strategy) {
        case 'circular':
          if (classification.group === 'high') {
            distances = this.calculateElevationStrategy(poiData, context, boundary, cfg, classification);
          } else {
            distances = this.calculateHeightStrategy(poiData, context, boundary, cfg, classification);
          }
          break;
        case 'linear': // Assuming linear strategy also needs handled here or defaults to standard
            // Linear strategy usually handled separately in calculateCanyonStrategy, 
            // but if called here, default to standard logic
            distances = this.calculateStandardStrategy(poiData, context, boundary, cfg, classification);
            break;
        case 'standard':
          distances = this.calculateStandardStrategy(poiData, context, boundary, cfg, classification);
          break;
        default:
          distances = [maxSearchRadius];
      }
      
      const filteredDistances = distances
        .filter(d => d <= maxSearchRadius) 
        .filter((d, i, arr) => arr.indexOf(d) === i); 
      
      if (filteredDistances.length === 0) {
        return [maxSearchRadius];
      }
      
      return filteredDistances;
    }
    
    // Fallback logic
    if (boundary && (boundary as any).elevation && (boundary as any).elevation.center > 1000) {
      const poiElevation = (boundary as any).elevation.center;
      const baseElevation = await ElevationAnalysisService.estimateRegionalBaseElevation((boundary as any).center, context, poiData);
      const elevationDiff = poiElevation - baseElevation;
      
      const maxRange = Math.min(Math.max(Math.sqrt(elevationDiff) * 200, 2000), 8000);
      
      const distances = [
        cfg.distanceDistribution.circular.inner,      
        cfg.distanceDistribution.circular.near_medium, 
        cfg.distanceDistribution.circular.medium,      
        cfg.distanceDistribution.circular.medium_far,  
        Math.min(maxRange * 0.7, cfg.distanceDistribution.circular.far), 
        Math.min(maxRange, cfg.distanceDistribution.circular.max)        
      ];
      
      return distances;
    }
    
    let baseDistance = cfg.distanceDistribution.standard.baseDistance;
    
    if (boundary && (boundary as any).elevation) {
      const poiElevation = (boundary as any).elevation.center;
      
      if (poiElevation > 800) {
        return [
          cfg.distanceDistribution.standard.mountainHigh.distances[0],
          cfg.distanceDistribution.standard.mountainHigh.distances[1],
          cfg.distanceDistribution.standard.mountainHigh.distances[2],
          cfg.distanceDistribution.standard.mountainHigh.distances[3]
        ];
      }
      else if (poiElevation > 400) {
        return [
          cfg.distanceDistribution.standard.mountainMedium.distances[0],
          cfg.distanceDistribution.standard.mountainMedium.distances[1]
        ];
      }
    }
    
    baseDistance = cfg.distanceDistribution.standard.urbanDensityLimits[context.urbanDensity.level];
    
    return [Math.round(baseDistance)];
  }

  private findPointAtDistanceFromBoundary(
    street: StreetData, 
    boundary: BoundaryData, 
    targetDistance: number
  ): { lat: number; lng: number } | null {
    if (street.coordinates.length === 0) {
      return null;
    }
    
    let bestPoint = street.coordinates[0];
    let bestDistanceDiff = Infinity;
    let validPointsFound = 0;
    
    for (const point of street.coordinates) {
      const distanceToBoundary = calculateDistanceToBoundary(point, boundary.coordinates);
      
      if (distanceToBoundary === 0) {
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
      return null;
    }
    
    return bestPoint;
  }
  
  private async calculatePointQuality(
    point: { lat: number; lng: number },
    poiData: POIData,
    boundary: BoundaryData,
    context: GeographicContext,
    street?: StreetData
  ): Promise<number> {
    let quality = 0.5; 
    
    const distanceToBoundary = calculateDistanceToBoundary(point, boundary.coordinates);
    const distanceScore = this.calculateDistanceScore(distanceToBoundary, context);
    quality += distanceScore * 0.3;
    
    const accessibilityScore = this.calculateAccessibilityScore(point, context);
    quality += accessibilityScore * 0.25;
    
    const visibilityScore = this.calculateVisibilityScore(point, poiData, boundary, context);
    quality += visibilityScore * 0.2;
    
    const contextScore = this.calculateContextScore(context);
    quality += contextScore * 0.15;
    
    const streetQualityScore = this.calculateStreetQualityScore(point, context);
    quality += streetQualityScore * 0.1;
    
    if (street && (street.tags?.bridge === 'yes' || (street.tags?.layer && parseInt(street.tags.layer) > 0))) {
      const distanceToPOI = calculateDistance(point, boundary.center);
      
      if (distanceToPOI < 500) {
        quality += 0.1; 
        
        if (boundary.height && boundary.height > 20) {
          quality += 0.05; 
        } 
      }
    }
    
    return Math.max(0, Math.min(1, quality));
  }
  
  private calculateDistanceScore(distance: number, context: GeographicContext): number {
    const baseDistance = context.urbanDensity.level === 'rural' ? 200 : 150;
    const distanceDiff = Math.abs(distance - baseDistance);
    
    const maxDeviation = baseDistance * 0.5; 
    const score = Math.max(0, 1 - (distanceDiff / maxDeviation));
    
    return score;
  }
  
  private calculateAccessibilityScore(point: { lat: number; lng: number }, context: GeographicContext): number {
    let score = 0.5; 
    
    switch (context.urbanDensity.level) {
      case 'very_dense': score = 0.8; break;
      case 'dense': score = 0.7; break;
      case 'medium': score = 0.6; break;
      case 'low': score = 0.4; break;
      case 'rural': score = 0.3; break;
    }
    
    if (context.infrastructure.transitTypes.length > 0) score += 0.1; 
    if (context.infrastructure.parkingAvailability > 0.5) score += 0.1; 
    
    return Math.max(0, Math.min(1, score));
  }
  
  private calculateVisibilityScore(
    point: { lat: number; lng: number },
    poiData: POIData,
    boundary: BoundaryData,
    context: GeographicContext
  ): number {
    let score = 0.5; 
    
    const isInsideBoundary = this.isPointInBoundary(point, boundary);
    if (isInsideBoundary) score += 0.2; 
    
    switch (context.elevationContext.type) {
      case 'mountainous': score += 0.2; break;
      case 'hilly': score += 0.1; break;
      case 'flat': score += 0.0; break;
    }
    
    switch (context.urbanDensity.level) {
      case 'very_dense': score -= 0.1; break;
      case 'dense': score -= 0.05; break;
      case 'medium': score += 0.0; break;
      case 'low': score += 0.1; break;
      case 'rural': score += 0.2; break;
    }
    
    return Math.max(0, Math.min(1, score));
  }
  
  private calculateContextScore(context: GeographicContext): number {
    let score = 0.5; 
    
    switch (context.streetPattern.type) {
      case 'grid': score += 0.1; break;
      case 'boulevard': score += 0.15; break;
      case 'organic': score += 0.05; break;
      case 'mixed': score += 0.0; break;
    }
    
    score += context.streetPattern.confidence * 0.1;
    
    return Math.max(0, Math.min(1, score));
  }
  
  private calculateStreetQualityScore(point: { lat: number; lng: number }, context: GeographicContext): number {
    const infrastructureScore = Math.min(context.infrastructure.infrastructureDensity / 20, 1);
    return infrastructureScore;
  }
  
  private isPointInBoundary(point: { lat: number; lng: number }, boundary: BoundaryData): boolean {
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
  
  filterCandidatesByQuality(candidates: TriggerPointCandidate[], minQuality: number = 0.3): TriggerPointCandidate[] {
    return candidates.filter(candidate => candidate.quality >= minQuality);
  }
  
  limitCandidates(candidates: TriggerPointCandidate[], maxCount: number = 10): TriggerPointCandidate[] {
    return candidates.slice(0, maxCount);
  }
  
  private calculateHeightStrategy(
    poiData: POIData, 
    context: GeographicContext, 
    boundary: BoundaryData, 
    cfg: TriggerPointsConfig,
    classification: any
  ): number[] {
    
    const height = classification.metadata?.height || 0;
    const maxSearchRadius = classification.searchRadius || 300; 
    
    const baseDistance = Math.min(height * 2, maxSearchRadius); 
    
    const distances = [
      Math.round(baseDistance * 0.3),  
      Math.round(baseDistance * 0.6),  
      Math.round(baseDistance * 1.0),  
      Math.round(Math.min(baseDistance * 1.5, maxSearchRadius))   
    ];
    
    const uniqueDistances = [...new Set(distances)].filter(d => d <= maxSearchRadius);
    
    return uniqueDistances.length > 0 ? uniqueDistances : [maxSearchRadius];
  }
  
  private calculateElevationStrategy(
    poiData: POIData, 
    context: GeographicContext, 
    boundary: BoundaryData, 
    cfg: TriggerPointsConfig,
    classification: any
  ): number[] {
    
    const elevation = classification.metadata?.elevation || 0;
    const maxSearchRadius = classification.searchRadius || 300; 
    
    let distances: number[];
    if (elevation > 1000) {
      if (maxSearchRadius > 2000) {
        const step = Math.max(500, Math.round(maxSearchRadius / 6)); 
        distances = [];
        for (let d = step; d <= maxSearchRadius; d += step) {
          distances.push(d);
        }
        distances.unshift(Math.min(200, maxSearchRadius));
        distances.unshift(Math.min(100, maxSearchRadius));
        if (!distances.includes(maxSearchRadius)) {
          distances.push(maxSearchRadius);
        }
      } else {
        distances = [
          cfg.distanceDistribution.circular.inner,
          cfg.distanceDistribution.circular.near_medium,
          cfg.distanceDistribution.circular.medium,
          cfg.distanceDistribution.circular.medium_far,
          cfg.distanceDistribution.circular.far,
          cfg.distanceDistribution.circular.max
        ].map(d => Math.min(d, maxSearchRadius)); 
      }
    } else {
      distances = [
        Math.round(elevation * 0.5),  
        Math.round(elevation * 1.0),  
        Math.round(elevation * 2.0),  
        Math.round(elevation * 3.0)   
      ].map(d => Math.min(d, maxSearchRadius)); 
    }
    
    const uniqueDistances = [...new Set(distances)].filter(d => d <= maxSearchRadius).sort((a, b) => a - b);
    
    return uniqueDistances.length > 0 ? uniqueDistances : [maxSearchRadius];
  }
  
  private calculateStandardStrategy(
    poiData: POIData, 
    context: GeographicContext, 
    boundary: BoundaryData, 
    cfg: TriggerPointsConfig,
    classification: any
  ): number[] {
    const maxSearchRadius = classification.searchRadius || 300; 
    
    let baseDistance = Math.min(cfg.distanceDistribution.standard.baseDistance, maxSearchRadius);
    
    if (boundary && (boundary as any).elevation) {
      const poiElevation = (boundary as any).elevation.center;
      
      if (poiElevation > 800) {
        const distances = [
          cfg.distanceDistribution.standard.mountainHigh.distances[0],
          cfg.distanceDistribution.standard.mountainHigh.distances[1],
          cfg.distanceDistribution.standard.mountainHigh.distances[2],
          cfg.distanceDistribution.standard.mountainHigh.distances[3]
        ].map(d => Math.min(d, maxSearchRadius)).filter((d, i, arr) => arr.indexOf(d) === i);
        return distances.length > 0 ? distances : [maxSearchRadius];
      }
      else if (poiElevation > 400) {
        const distances = [
          cfg.distanceDistribution.standard.mountainMedium.distances[0],
          cfg.distanceDistribution.standard.mountainMedium.distances[1]
        ].map(d => Math.min(d, maxSearchRadius)).filter((d, i, arr) => arr.indexOf(d) === i);
        return distances.length > 0 ? distances : [maxSearchRadius];
      }
    }
    
    baseDistance = Math.min(
      cfg.distanceDistribution.standard.urbanDensityLimits[context.urbanDensity.level],
      maxSearchRadius
    );
    
    return [Math.round(baseDistance)];
  }
  
  private async calculateMultipleStreetsStrategy(
    streets: StreetData[],
    poiData: POIData,
    boundary: BoundaryData,
    context: GeographicContext,
    classification: any
  ): Promise<TriggerPointCandidate[]> {
    const candidates: TriggerPointCandidate[] = [];
    
    const distances = this.calculateElevationStrategy(poiData, context, boundary, loadTriggerPointsConfig(), classification);
    
    for (const street of streets) {
      for (const targetDistance of distances) {
        const point = this.findPointAtDistanceFromBoundary(street, boundary, targetDistance);
        
        if (point) {
          const distanceToBoundary = calculateDistanceToBoundary(point, boundary.coordinates);
          
          const quality = this.calculateMultipleStreetsPointQuality(point, street, boundary, distanceToBoundary, targetDistance, poiData);
          
          if (quality > 0.3) { 
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
                streetName: street.name
              }
            });
          }
        }
      }
    }
    
    return candidates;
  }
  
  private calculateMultipleStreetsPointQuality(
    point: { lat: number; lng: number },
    street: StreetData,
    boundary: BoundaryData,
    actualDistance: number,
    targetDistance: number,
    poiData?: POIData
  ): number {
    let quality = 0.5; 
    
    const isHighElevationPOI = boundary.elevation && boundary.elevation.center > 800;
    
    if (isHighElevationPOI) {
      const blockedStreetTypes = ['residential', 'unclassified', 'tertiary', 'secondary'];
      if (blockedStreetTypes.includes(street.type)) {
        return 0.0; 
      }
    }
    
    let streetTypeBonus;
    if (isHighElevationPOI) {
      streetTypeBonus = {
        'motorway': 0.5,    
        'trunk': 0.45,      
        'primary': 0.35,    
        'secondary': 0.0,   
        'tertiary': 0.0,    
        'residential': 0.0, 
        'unclassified': 0.0 
      };
    } else {
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
    
    if (isHighElevationPOI && (street.type === 'motorway' || street.type === 'trunk')) {
      quality += 0.15; 
    }
    
    const distanceDiff = Math.abs(actualDistance - targetDistance);
    const distanceAccuracy = Math.max(0, 1 - (distanceDiff / targetDistance));
    quality += distanceAccuracy * 0.3;
    
    if (actualDistance > 50) {
      quality += 0.1; 
    }
    
    return Math.min(1.0, quality);
  }
  
  private async calculateCanyonStrategy(
    streets: StreetData[],
    poiData: POIData,
    boundary: BoundaryData,
    context: GeographicContext,
    classification: any
  ): Promise<TriggerPointCandidate[]> {
    const candidates: TriggerPointCandidate[] = [];
    const maxDistance = classification.searchRadius || 300; 
    
    const sortedStreets = [...streets].sort((a, b) => {
      const distA = this.calculateStreetDistanceToCenter(a, boundary.center);
      const distB = this.calculateStreetDistanceToCenter(b, boundary.center);
      return distA - distB;
    });
    
    const distances = [50, 100, 150, 200, maxDistance];
    
    for (const street of sortedStreets) {
      const isFrontStreet = sortedStreets.indexOf(street) === 0;
      
      for (const targetDistance of distances) {
        const point = this.findPointAtDistanceFromBoundary(street, boundary, targetDistance);
        
        if (point) {
          const distanceToBoundary = calculateDistanceToBoundary(point, boundary.coordinates);
          
          let quality = 0.5;
          
          if (distanceToBoundary < 100) {
            quality += 0.2;
          }
          
          if (isFrontStreet) {
            quality += 0.3;
          }
          
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
          
          if (quality > 0.4) { 
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
          }
        }
      }
    }
    
    return candidates;
  }
  
  private calculateStreetDistanceToCenter(street: StreetData, center: { lat: number; lng: number }): number {
    return calculateMinDistanceToCenter(street.coordinates || [], center);
  }
  
}

// Validador e ranker de trigger points

import { POIData, GeographicContext, TriggerPointCandidate, TriggerPoint, BoundaryData, DirectionalAnalysis } from '../types/interfaces.ts';
import { calculateDistance, calculateBearing } from '../utils/calculations.ts';
import { VisibilityValidator } from './visibility-validator.ts';
import { ElevationAnalysisService } from '../services/elevation-service.ts';
import { loadTriggerPointsConfig, TriggerPointsConfig, TRIGGER_POINTS_CONSTANTS } from '../config/trigger-points-config.ts';
import { GoogleAPIsService } from '../services/google-apis.service.ts';
import { DirectionalAnalyzer } from './directional-analyzer.ts';
import { StreetAnalyzer } from './street-analyzer.ts'; // ✅ Importar StreetAnalyzer

export class TriggerPointValidator {
  private visibilityValidator: VisibilityValidator;
  private directionalAnalyzer: DirectionalAnalyzer;
  private streetAnalyzer: StreetAnalyzer; // ✅ Injetar StreetAnalyzer
  
  // Cache para obstruções (QUALIDADE > PERFORMANCE)
  private static obstructionsCache = new Map<string, { 
    data: { buildings: any[]; vegetation: any[]; barriers: any[]; peaks: any[] }, 
    timestamp: number 
  }>();
  private static CACHE_DURATION = TRIGGER_POINTS_CONSTANTS.obstructions.cacheDuration * 60 * 1000; // minutos
  
  constructor(googleAPIs: GoogleAPIsService) {
    this.visibilityValidator = new VisibilityValidator(googleAPIs);
    this.directionalAnalyzer = new DirectionalAnalyzer();
    this.streetAnalyzer = new StreetAnalyzer(); // ✅ Instanciar StreetAnalyzer
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
    
    try {
      const directionalAnalysis = await this.directionalAnalyzer.analyzeAllDirections(
        poiData, 
        boundary, 
        context,
        existingStreets,
        existingBuildings
      );
      
      return directionalAnalysis;
    } catch (error) {
      console.error('Error in directional analysis:', error);
      return [];
    }
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
    minDistanceBetweenTPs: number = 40, // metros
    directionalAnalysis: DirectionalAnalysis[] = [] // NOVO: análise direcional
  ): Promise<TriggerPoint[]> {
    // 🎯 USAR CONFIGURAÇÕES DO GRUPO DO POI (se disponível)
    if (boundary.classification) {
      const classification = boundary.classification;
      maxTriggerPoints = classification.maxTriggerPoints;
      minDistanceBetweenTPs = classification.minDistanceBetweenTPs;
    }
    
    // 🚀 OTIMIZAÇÃO: Calcular elevação base UMA ÚNICA VEZ
    let baseElevation: number | null = null;
    if (boundary?.elevation && boundary.elevation.center > 0) {
      baseElevation = await ElevationAnalysisService.estimateRegionalBaseElevation(boundary.center, context, poiData);
    }
    
    const dynamicMaxTPs = maxTriggerPoints;
    
    try {
      // ✅ VALIDAÇÃO BÁSICA COMPLETA
      const basicValidCandidates = [];
      for (const candidate of candidates) {
        const isValid = await this.isValidCandidate(candidate, poiData, context, boundary, baseElevation);
        if (isValid) {
          basicValidCandidates.push(candidate);
        }
      }
      
      // ✅ ORDENAR POR PRIORIDADE (RÁPIDO - sem verificação de visibilidade)
      const rankedCandidates = basicValidCandidates.sort((a, b) => {
        const aIsFrontStreet = this.isTPOnFrontStreet(a, boundary);
        const bIsFrontStreet = this.isTPOnFrontStreet(b, boundary);
        
        if (aIsFrontStreet && !bIsFrontStreet) return -1;
        if (!aIsFrontStreet && bIsFrontStreet) return 1;
        
        return b.quality - a.quality;
      });
      
      // ✅ FILTRO DE DISTÂNCIA MÍNIMA COMPLETO (RÁPIDO - mantém candidatos)
      const distanceFilteredCandidates = this.selectCandidatesWithMinDistance(rankedCandidates, dynamicMaxTPs, minDistanceBetweenTPs, boundary, context);
      
      // ✅ VALIDAÇÃO DE VISIBILIDADE (LENTO - ÚLTIMA LINHA DE DEFESA)
      const visibilityValidCandidates = await this.filterByVisibilityOptimized(distanceFilteredCandidates, boundary, context);
      
      // Converter candidatos validados para TriggerPoint[]
      const selectedTriggerPoints: TriggerPoint[] = [];
      for (let i = 0; i < visibilityValidCandidates.length; i++) {
        const candidate = visibilityValidCandidates[i];
        const triggerPoint = this.convertToTriggerPoint(candidate, i, boundary, context);
        selectedTriggerPoints.push(triggerPoint);
      }
      
      // ✅ REMOVER DUPLICATAS FINAIS
      const finalTriggerPoints = this.removeDuplicateTriggerPoints(selectedTriggerPoints);
      
      return finalTriggerPoints;
      
    } catch (error) {
      console.error('Error validating and ranking points:', error);
      return [];
    }
  }
  
  // Implementação simplificada de isValidCandidate (sem dependência de APIs externas além do que já temos)
  private async isValidCandidate(candidate: TriggerPointCandidate, poiData: POIData, context: GeographicContext, boundary: BoundaryData, baseElevation: number | null): Promise<boolean> {
     
     // 1. Validar se a rua é acessível (público) - Já filtrado no street-analyzer, mas bom garantir
     if (candidate.street && candidate.street.accessibility === 'private') {
         return false;
     }

     // 2. Validar direção da rua (se for One Way)
     if (candidate.street && candidate.expectedBearing) {
         const isValidDirection = this.streetAnalyzer.validateTravelDirection(
             candidate.street, 
             candidate.location, 
             candidate.expectedBearing
         );
         
         if (!isValidDirection) {
             console.log(`❌ Candidate rejected due to wrong travel direction (Street: ${candidate.street.name})`);
             return false;
         }
     }

     return true;
  }
  
  private isTPOnFrontStreet(candidate: TriggerPointCandidate, boundary: BoundaryData): boolean {
    if (boundary.address?.street && candidate.metadata?.streetName) {
      const addressStreet = boundary.address.street.toLowerCase();
      const candidateStreet = candidate.metadata.streetName.toLowerCase();
      return addressStreet.includes(candidateStreet) || candidateStreet.includes(addressStreet);
    }
    return !!candidate.metadata?.isFrontStreet;
  }
  
  private selectCandidatesWithMinDistance(
    rankedCandidates: TriggerPointCandidate[],
    maxTriggerPoints: number,
    minDistance: number,
    boundary: BoundaryData,
    context: GeographicContext
  ): TriggerPointCandidate[] {
    const selectedCandidates: TriggerPointCandidate[] = [];
    
    // 🆕 Ajustar distância mínima baseado no tamanho do POI e altura
    const poiHeight = boundary.height || 0;
    const isSmallPOI = boundary.area < 10000;
    const isDenseZone = context.urbanDensity.level === 'very_dense' || context.urbanDensity.level === 'dense';
    const isFlatPOI = poiHeight === 0 || poiHeight < 5;
    
    let adjustedMinDistance = minDistance;
    
    if (isSmallPOI) {
      adjustedMinDistance = Math.max(adjustedMinDistance, 60); 
    }
    
    if (isFlatPOI && isDenseZone) {
      adjustedMinDistance = Math.max(adjustedMinDistance, 80); 
    }
    
    const STANDARD_TP_RADIUS = 20; 
    const minDistanceBetweenCenters = (STANDARD_TP_RADIUS * 2) + adjustedMinDistance;
    
    for (const candidate of rankedCandidates) {
      if (selectedCandidates.length >= maxTriggerPoints) {
        break;
      }
      
      const isTooClose = selectedCandidates.some(existing => {
        const distanceBetweenCenters = calculateDistance(candidate.location, existing.location);
        return distanceBetweenCenters < minDistanceBetweenCenters;
      });
      
      if (isTooClose) {
        continue;
      }
      
      selectedCandidates.push(candidate);
    }
    
    return selectedCandidates;
  }

  private async filterByVisibilityOptimized(
    candidates: TriggerPointCandidate[],
    boundary: BoundaryData,
    context: GeographicContext
  ): Promise<TriggerPointCandidate[]> {
    const validCandidates: TriggerPointCandidate[] = [];

    // 🚀 OTIMIZAÇÃO: Buscar todas as obstruções da região em UMA ÚNICA chamada
    let obstructions;
    try {
      obstructions = await this.getAllObstructionsInRegion(candidates, boundary, context);
    } catch (error) {
      console.warn(`⚠️ Failed to fetch obstructions, using buildings-only fallback: ${(error as Error).message}`);
      obstructions = { buildings: [], vegetation: [], barriers: [], peaks: [] };
    }

    for (const candidate of candidates) {
      try {
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
        }
      } catch (error) {
        console.warn('Cached visibility check failed:', error);
        validCandidates.push(candidate);
      }
    }

    return validCandidates;
  }
  
  private async getAllObstructionsInRegion(
    candidates: TriggerPointCandidate[],
    boundary: BoundaryData,
    context: GeographicContext
  ): Promise<{
    buildings: any[];
    vegetation: any[];
    barriers: any[];
    peaks: any[];
  }> {
    
    if (boundary.buildings || boundary.vegetation || boundary.barriers || boundary.peaks) {
      return {
        buildings: boundary.buildings || [],
        vegetation: boundary.vegetation || [],
        barriers: boundary.barriers || [],
        peaks: boundary.peaks || [] 
      };
    }
    if (candidates.length === 0) return { buildings: [], vegetation: [], barriers: [], peaks: [] };

    const searchRadius = this.calculateSearchRadiusForRegion(boundary, context);
    const cacheKey = `${boundary.center.lat.toFixed(4)},${boundary.center.lng.toFixed(4)},${searchRadius}`;
    const cached = TriggerPointValidator.obstructionsCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < TriggerPointValidator.CACHE_DURATION) {
      return cached.data;
    }

    const boundaryCenter = this.calculateBoundaryCenter(boundary.coordinates);
    
    const obstructionsQuery = `
[out:json][timeout:60];
(
  way["building"](around:${searchRadius},${boundaryCenter.lat},${boundaryCenter.lng});
  node["natural"~"^(peak|volcano)$"](around:${searchRadius},${boundaryCenter.lat},${boundaryCenter.lng});
  way["natural"~"^(peak|volcano|mountain)$"](around:${searchRadius},${boundaryCenter.lat},${boundaryCenter.lng});
);
out geom tags;
`;

    try {
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: obstructionsQuery
      });
      
      if (!response.ok) {
        return { buildings: [], vegetation: [], barriers: [], peaks: [] };
      }

      const osmData = await response.json();
      const elements = osmData.elements || [];

      const buildings: any[] = elements.filter((el: any) => el.tags?.building);
      const peaks: any[] = elements.filter((el: any) => 
        el.tags?.natural === 'peak' || 
        el.tags?.natural === 'volcano' || 
        el.tags?.natural === 'mountain' ||
        (el.type === 'node' && (el.tags?.natural === 'peak' || el.tags?.natural === 'volcano'))
      );
      const vegetation: any[] = []; 
      const barriers: any[] = []; 
      
      const result = { buildings, vegetation, barriers, peaks };
      
      TriggerPointValidator.obstructionsCache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });
      
      return result;

    } catch (error) {
      console.error('Failed to fetch region obstructions:', error);
      return { buildings: [], vegetation: [], barriers: [], peaks: [] };
    }
  }

  private calculateSearchRadiusForRegion(boundary: BoundaryData, context: GeographicContext): number {
    let baseRadius = TRIGGER_POINTS_CONSTANTS.obstructions.baseSearchRadius; 

    if (boundary?.elevation && boundary.elevation.center > 0) {
      const poiElevation = boundary.elevation.center;
      
      if (poiElevation > TRIGGER_POINTS_CONSTANTS.height.veryHighElevationThreshold) {
        baseRadius = Math.min(TRIGGER_POINTS_CONSTANTS.obstructions.maxElevationRadius, Math.sqrt(poiElevation) * TRIGGER_POINTS_CONSTANTS.obstructions.elevationMultiplier);
      } else if (poiElevation > TRIGGER_POINTS_CONSTANTS.height.highElevationThreshold2) {
        baseRadius = Math.min(3000, poiElevation * 3);
      }
    }

    switch (context.urbanDensity.level) {
      case 'very_dense': baseRadius = Math.min(baseRadius, TRIGGER_POINTS_CONSTANTS.obstructions.veryDenseRadius); break;
      case 'dense': baseRadius = Math.min(baseRadius, TRIGGER_POINTS_CONSTANTS.obstructions.denseRadius); break;
      case 'medium': baseRadius = Math.min(baseRadius, TRIGGER_POINTS_CONSTANTS.obstructions.mediumRadius); break;
      case 'low': baseRadius = Math.min(baseRadius, TRIGGER_POINTS_CONSTANTS.obstructions.lowRadius); break;
      case 'rural': baseRadius = Math.min(baseRadius, TRIGGER_POINTS_CONSTANTS.obstructions.ruralRadius); break;
    }

    return Math.round(baseRadius);
  }

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

  private async checkVisibilityWithCachedObstructions(
    candidate: TriggerPointCandidate,
    boundary: BoundaryData,
    context: GeographicContext,
    obstructions: { buildings: any[]; vegetation: any[]; barriers: any[]; peaks: any[] }
  ): Promise<boolean> {
    try {
      const visibilityResult = await this.visibilityValidator.validateVisibility(candidate, boundary, context);
      return visibilityResult.hasLineOfSight;
    } catch (error) {
      console.warn('Cached visibility check failed:', error);
      return true; 
    }
  }

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

  private convertToTriggerPoint(candidate: TriggerPointCandidate, index: number, boundary: BoundaryData, context: GeographicContext): TriggerPoint {
    return {
      id: `tp_${index}_${Date.now()}`,
      location: candidate.location,
      radius: 30, // Default trigger radius
      expectedBearing: candidate.expectedBearing,
      bearingThreshold: 60,
      type: 'primary',
      priority: index + 1,
      confidence: candidate.confidence,
      quality: candidate.quality,
      street: candidate.street, // Direct assignment since it is required and matches
      distance: candidate.distance,
      generationMethod: 'google_apis',
      contextData: context,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }
  
  private removeDuplicateTriggerPoints(triggerPoints: TriggerPoint[]): TriggerPoint[] {
    const uniquePoints: TriggerPoint[] = [];
    const minD = 10; 
    
    for (const point of triggerPoints) {
      const isDuplicate = uniquePoints.some(existing => 
        calculateDistance(point.location, existing.location) < minD
      );
      
      if (!isDuplicate) {
        uniquePoints.push(point);
      }
    }
    
    return uniquePoints;
  }
}

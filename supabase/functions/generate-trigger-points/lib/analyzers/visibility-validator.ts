// Validador de visibilidade para trigger points
// Garante que TPs tenham linha de visão clara para o boundary do POI

import { BoundaryData, TriggerPointCandidate, GeographicContext } from '../types/interfaces.ts';
import { GoogleAPIsService } from '../services/google-apis.service.ts';
import { calculateDistance } from '../utils/calculations.ts';
import { TRIGGER_POINTS_CONSTANTS } from '../config/trigger-points-config.ts';

export interface VisibilityResult {
  hasLineOfSight: boolean;
  confidence: number;
  obstructions: string[];
  visibleBoundaryPercentage: number;
  method: 'street_view' | 'buildings_analysis' | 'elevation_analysis' | 'estimated';
  details: {
    checkedPoints: number;
    blockedPoints: number;
    averageDistance: number;
    nearestBoundaryPoint: { lat: number; lng: number };
  };
}

export class VisibilityValidator {
  private googleAPIs: GoogleAPIsService;

  constructor(googleAPIs: GoogleAPIsService) {
    this.googleAPIs = googleAPIs;
  }

  /**
   * Valida se um TP tem visibilidade clara do boundary
   */
  async validateVisibility(
    candidate: TriggerPointCandidate,
    boundary: BoundaryData,
    context: GeographicContext
  ): Promise<VisibilityResult> {
    
    try {
      // ✅ NEW: Usar APENAS Buildings Analysis (GRATUITA via OSM)
      const buildingsResult = await this.validateWithBuildingsAnalysis(candidate, boundary, context);
      if (buildingsResult.confidence > TRIGGER_POINTS_CONSTANTS.scores.buildingsConfidence) {
        return buildingsResult;
      }

      // Estratégia 3: Elevation Analysis
      const elevationResult = await this.validateWithElevationAnalysis(candidate, boundary);
      if (elevationResult.confidence > TRIGGER_POINTS_CONSTANTS.scores.elevationConfidence) {
        return elevationResult;
      }

      // Estratégia 4: Fallback Estimation
      return this.estimateVisibility(candidate, boundary, context);

    } catch (error) {
      console.error('Error validating visibility:', error);
      return this.createFailedResult(candidate, boundary);
    }
  }


  /**
   * Estratégia 2: Analisar buildings via OSM para detectar bloqueios
   */
  private async validateWithBuildingsAnalysis(
    candidate: TriggerPointCandidate,
    boundary: BoundaryData,
    context: GeographicContext
  ): Promise<VisibilityResult> {
    
    try {
      // Buscar buildings entre o TP e o boundary
      const nearestBoundaryPoint = this.findNearestBoundaryPoint(candidate.location, boundary.coordinates);
      const searchRadius = calculateDistance(candidate.location, nearestBoundaryPoint) + 100;

      // Query OSM para buildings na área
      const buildingsQuery = `
        [out:json][timeout:${TRIGGER_POINTS_CONSTANTS.timeouts.osmQueryLong}];
        (
          way["building"](around:${searchRadius},${candidate.location.lat},${candidate.location.lng});
          relation["building"](around:${searchRadius},${candidate.location.lat},${candidate.location.lng});
        );
        out geom meta;
      `;

      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(buildingsQuery)}`
      });

      if (!response.ok) {
        throw new Error(`OSM query failed: ${response.status}`);
      }

      const osmData = await response.json();
      const buildings = osmData.elements || [];

      // Analisar se buildings bloqueiam a visão
      const visibilityAnalysis = this.analyzeBuildingObstructions(
        candidate.location,
        boundary,
        buildings,
        boundary.height // Passar altura aproximada do POI para cálculo 3D
      );

      return {
        hasLineOfSight: visibilityAnalysis.visiblePercentage >= 40,
        confidence: 0.8,
        obstructions: visibilityAnalysis.obstructions,
        visibleBoundaryPercentage: visibilityAnalysis.visiblePercentage,
        method: 'buildings_analysis',
        details: {
          checkedPoints: visibilityAnalysis.totalRays,
          blockedPoints: visibilityAnalysis.blockedRays,
          averageDistance: visibilityAnalysis.averageDistance,
          nearestBoundaryPoint
        }
      };

    } catch (error) {
      console.error('Buildings analysis failed:', error);
      throw error;
    }
  }

  /**
   * Estratégia 3: Usar elevação para detectar obstruções topográficas
   */
  private async validateWithElevationAnalysis(
    candidate: TriggerPointCandidate,
    boundary: BoundaryData
  ): Promise<VisibilityResult> {
    
    try {
      const nearestBoundaryPoint = this.findNearestBoundaryPoint(candidate.location, boundary.coordinates);
      const distance = calculateDistance(candidate.location, nearestBoundaryPoint);

      // Criar pontos intermediários para análise de elevação
      const intermediatePoints = this.createIntermediatePoints(
        candidate.location,
        nearestBoundaryPoint,
        Math.max(TRIGGER_POINTS_CONSTANTS.limits.minSamplePoints, Math.floor(distance / TRIGGER_POINTS_CONSTANTS.distances.lineOfSightSampleDistance)) // Pontos configuráveis
      );

      // Obter elevações
      const elevationResponse = await this.googleAPIs.getElevation([
        candidate.location,
        ...intermediatePoints,
        nearestBoundaryPoint
      ]);

      if (!elevationResponse.success || !elevationResponse.data?.results) {
        throw new Error('Failed to get elevation data');
      }

      const elevations = elevationResponse.data.results.map((r: any) => r.elevation);
      
      // Analisar linha de visão baseada em elevação
      const hasTopographicObstruction = this.checkTopographicLineOfSight(elevations, distance);
      
      return {
        hasLineOfSight: !hasTopographicObstruction,
        confidence: 0.6,
        obstructions: hasTopographicObstruction ? ['topographic_obstruction'] : [],
        visibleBoundaryPercentage: hasTopographicObstruction ? 0 : 100,
        method: 'elevation_analysis',
        details: {
          checkedPoints: elevations.length,
          blockedPoints: hasTopographicObstruction ? 1 : 0,
          averageDistance: distance,
          nearestBoundaryPoint
        }
      };

    } catch (error) {
      console.error('Elevation analysis failed:', error);
      throw error;
    }
  }

  /**
   * Estratégia 4: Estimativa baseada em contexto urbano
   */
  private estimateVisibility(
    candidate: TriggerPointCandidate,
    boundary: BoundaryData,
    context: GeographicContext
  ): VisibilityResult {
    
    const nearestBoundaryPoint = this.findNearestBoundaryPoint(candidate.location, boundary.coordinates);
    const distance = calculateDistance(candidate.location, nearestBoundaryPoint);

    // Estimar visibilidade baseada em densidade urbana e distância
    let estimatedVisibility = 70; // Base: 70%

    // Ajustar por densidade urbana
    switch (context.urbanDensity.level) {
      case 'very_dense':
        estimatedVisibility -= 30; // Muitos prédios
        break;
      case 'dense':
        estimatedVisibility -= 20;
        break;
      case 'medium':
        estimatedVisibility -= 10;
        break;
      case 'low':
        estimatedVisibility += 10;
        break;
      case 'rural':
        estimatedVisibility += 20; // Poucas obstruções
        break;
    }

    // Ajustar por distância (mais longe = mais chance de obstrução)
    if (distance > 500) {
      estimatedVisibility -= 20;
    } else if (distance > 300) {
      estimatedVisibility -= 10;
    }

    // Ajustar por qualidade do candidato
    estimatedVisibility += (candidate.quality - 0.5) * 20;

    estimatedVisibility = Math.max(0, Math.min(100, estimatedVisibility));

    return {
      hasLineOfSight: estimatedVisibility >= 50,
      confidence: 0.4,
      obstructions: estimatedVisibility < 50 ? ['estimated_obstruction'] : [],
      visibleBoundaryPercentage: estimatedVisibility,
      method: 'estimated',
      details: {
        checkedPoints: 1,
        blockedPoints: estimatedVisibility < 50 ? 1 : 0,
        averageDistance: distance,
        nearestBoundaryPoint
      }
    };
  }

  // === HELPER METHODS ===

  private selectVisibilityCheckPoints(
    coordinates: Array<{ lat: number; lng: number }>,
    maxPoints: number
  ): Array<{ lat: number; lng: number }> {
    if (coordinates.length <= maxPoints) {
      return coordinates;
    }

    const step = Math.floor(coordinates.length / maxPoints);
    return coordinates.filter((_, index) => index % step === 0).slice(0, maxPoints);
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

  private createIntermediatePoints(
    start: { lat: number; lng: number },
    end: { lat: number; lng: number },
    numPoints: number
  ): Array<{ lat: number; lng: number }> {
    const points: Array<{ lat: number; lng: number }> = [];
    
    for (let i = 1; i < numPoints; i++) {
      const ratio = i / numPoints;
      const lat = start.lat + (end.lat - start.lat) * ratio;
      const lng = start.lng + (end.lng - start.lng) * ratio;
      points.push({ lat, lng });
    }

    return points;
  }

  private analyzeBuildingObstructions(
    tpLocation: { lat: number; lng: number },
    boundary: BoundaryData,
    buildings: any[],
    poiHeight: number = 0 // Altura estimada do POI (para cálculo 3D)
  ): {
    visiblePercentage: number;
    obstructions: string[];
    totalRays: number;
    blockedRays: number;
    averageDistance: number;
  } {
    const checkPoints = this.selectVisibilityCheckPoints(boundary.coordinates, 12);
    let blockedRays = 0;
    let totalDistance = 0;
    const obstructions: string[] = [];

    for (const boundaryPoint of checkPoints) {
      totalDistance += calculateDistance(tpLocation, boundaryPoint);
      
      // Verificar se algum building bloqueia a linha de visão (considerando altura 3D)
      const isBlocked = this.isLineOfSightBlocked(tpLocation, boundaryPoint, buildings, poiHeight); // Passar altura do POI
      if (isBlocked) {
        blockedRays++;
        obstructions.push(`building_obstruction`);
      }
    }

    const visibleRays = checkPoints.length - blockedRays;
    const visiblePercentage = (visibleRays / checkPoints.length) * 100;

    return {
      visiblePercentage,
      obstructions,
      totalRays: checkPoints.length,
      blockedRays,
      averageDistance: totalDistance / checkPoints.length
    };
  }

  private isLineOfSightBlocked(
    start: { lat: number; lng: number },
    end: { lat: number; lng: number },
    buildings: any[],
    targetHeight: number = 0 // Altura do alvo (POI)
  ): boolean {
    // Implementação de ray-casting com verificação de altura 3D
    // Verificar se algum building intersecta a linha E se a altura bloqueia a visão
    
    // Altura do observador (carro/pessoa) ~ 1.5m
    const observerHeight = 1.5;
    const distanceToTarget = calculateDistance(start, end);

    for (const building of buildings) {
      if (building.geometry && building.geometry.length > 0) {
        const buildingCoords = building.geometry.map((coord: any) => ({
          lat: coord.lat,
          lng: coord.lon
        }));

        // Verificar se a linha 2D intersecta o polígono do building
        if (this.lineIntersectsPolygon(start, end, buildingCoords)) {
          
          // 🆕 Verificação 3D: Se colidiu em 2D, verificar altura
          const buildingHeight = this.extractBuildingHeight(building.tags);
          
          // Se não há dados de altura, assumir obstrução padrão (ex: 4m - muro/casa térrea)
          // Mas se for muito baixo e o POI for alto, pode ser que não bloqueie
          if (buildingHeight > 0) {
            // Calcular distância até a obstrução
            const buildingCenter = buildingCoords[0]; // Simplificação
            const distanceToObstruction = calculateDistance(start, buildingCenter);
            
            // Calcular altura necessária da linha de visão na posição da obstrução
            // Regra de triângulos semelhantes
            // LineHeightAtObstruction = ObserverHeight + (TargetHeight - ObserverHeight) * (DistToObstruction / TotalDist)
            
            const sightLineHeightAtObstruction = observerHeight + (targetHeight - observerHeight) * (distanceToObstruction / distanceToTarget);
            
            // Se o prédio for mais baixo que a linha de visão, NÃO é obstrução
            if (buildingHeight < sightLineHeightAtObstruction) {
               // VISÍVEL POR CIMA
               continue; 
            }
          }
          
          // Se chegou aqui, é uma obstrução confirmada (2D + Altura insuficiente para passar por cima)
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Extrai altura do building a partir de tags OSM
   */
  private extractBuildingHeight(tags: any): number {
    if (!tags) return 4; // Default para casa térrea/muro

    // 1. Tentar tag 'height' direta
    if (tags.height) {
      const h = parseFloat(tags.height);
      if (!isNaN(h)) return h;
    }

    // 2. Tentar 'building:levels' (estimar 3m por andar)
    if (tags['building:levels']) {
      const levels = parseInt(tags['building:levels']);
      if (!isNaN(levels)) return levels * 3.5; // 3.5m pé direito médio comercial/com telhado
    }

    // Default baseado no tipo de building
    const type = tags.building;
    if (type === 'apartments' || type === 'office') return 15;
    if (type === 'retail' || type === 'commercial') return 6;
    if (type === 'house' || type === 'residential') return 4;
    if (type === 'church') return 12;
    
    return 4; // Default conservador
  }

  private lineIntersectsPolygon(
    lineStart: { lat: number; lng: number },
    lineEnd: { lat: number; lng: number },
    polygon: Array<{ lat: number; lng: number }>
  ): boolean {
    // Implementação simplificada - verificar se a linha cruza alguma aresta do polígono
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
    // Algoritmo de intersecção de linhas 2D
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

  private checkTopographicLineOfSight(elevations: number[], distance: number): boolean {
    if (elevations.length < 3) return false;

    const startElevation = elevations[0];
    const endElevation = elevations[elevations.length - 1];
    
    // Calcular linha de visão direta
    const sightLineSlope = (endElevation - startElevation) / distance;
    
    // Verificar se algum ponto intermediário bloqueia a visão
    for (let i = 1; i < elevations.length - 1; i++) {
      const expectedElevation = startElevation + (sightLineSlope * (distance * i / (elevations.length - 1)));
      const actualElevation = elevations[i];
      
      // Se o terreno está 5m+ acima da linha de visão, há obstrução
      if (actualElevation > expectedElevation + 5) {
        return true;
      }
    }

    return false;
  }

  private createFailedResult(
    candidate: TriggerPointCandidate,
    boundary: BoundaryData
  ): VisibilityResult {
    return {
      hasLineOfSight: false,
      confidence: 0.1,
      obstructions: ['validation_failed'],
      visibleBoundaryPercentage: 0,
      method: 'estimated',
      details: {
        checkedPoints: 0,
        blockedPoints: 1,
        averageDistance: 0,
        nearestBoundaryPoint: this.findNearestBoundaryPoint(candidate.location, boundary.coordinates)
      }
    };
  }
}

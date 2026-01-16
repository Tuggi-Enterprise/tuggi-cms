// Analisador de ruas acessíveis usando Google Roads API

import { GoogleAPIsService } from '../services/google-apis.service.ts';
import { POIData, BoundaryData, GeographicContext, StreetData } from '../types/interfaces.ts';
import { calculateDistance, isPointInPolygon, extractBuildingHeight, calculateBearing, calculateDistanceToLineSegment, calculateDistanceToPolygon, calculateDistanceToBoundary, findClosestPointOnBoundary } from '../utils/calculations.ts';
import { ElevationAnalysisService } from '../services/elevation-service.ts';
import { loadTriggerPointsConfig, TriggerPointsConfig, TRIGGER_POINTS_CONSTANTS, POIGroup } from '../config/trigger-points-config.ts';

export class StreetAnalyzer {
  private googleAPIs: GoogleAPIsService;

  /**
   * Valida se a direção de tráfego da rua permite visão do alvo
   */
  validateTravelDirection(
    street: StreetData,
    pointOnStreet: { lat: number; lng: number },
    targetBearing: number
  ): boolean {
    // Se não é mão única, assumir que é possível ver (motorista pode estar em qualquer sentido)
    // Mas note: se for mão dupla, um sentido vê, o outro não (se estiver atrás).
    // Idealmente, deveríamos saber o sentido do fluxo para garantir que o motorista VÊ o POI.
    
    // Simplificação: Se for mão dupla, OK (assumimos que o tagueamento de one-way está correto)
    const isOneWay = street.tags?.oneway === 'yes' || street.tags?.oneway === 'true' || street.tags?.junction === 'roundabout';
    
    if (!isOneWay) {
      return true; // Mão dupla: assumimos validade para não restringir demais
    }

    // Se é mão única, precisamos saber a direção da rua no ponto
    // A geometria da rua no OSM segue a direção do tráfego para one-way
    const streetBearing = this.calculateStreetBearingAtPoint(street, pointOnStreet);
    
    // Se não conseguir calcular, aceitar
    if (streetBearing === null) return true;

    // Verificar se o target está "na frente" (dentro de +/- 90 graus do sentido do tráfego)
    // Para visão ideal, +/- 45 ou 60 graus. Vamos usar +/- 75 graus para ser tolerante.
    const angleDiff = Math.abs(this.normalizeAngleDifference(streetBearing - targetBearing));
    
    return angleDiff <= 75;
  }

  private calculateStreetBearingAtPoint(street: StreetData, point: { lat: number; lng: number }): number | null {
    if (!street.coordinates || street.coordinates.length < 2) return null;

    // Encontrar os 2 pontos da rua mais próximos do ponto de análise
    // Assumir que point está "na linha". Encontrar segmento i -> i+1
    let bestSegmentIndex = -1;
    let minDistance = Infinity;

    for (let i = 0; i < street.coordinates.length - 1; i++) {
        const p1 = street.coordinates[i];
        const p2 = street.coordinates[i+1];
        
        // Distância do ponto ao segmento
        const dist = calculateDistanceToLineSegment(point, p1, p2);
        if (dist < minDistance) {
            minDistance = dist;
            bestSegmentIndex = i;
        }
    }

    if (bestSegmentIndex !== -1) {
        // Calcular bearing do segmento (p1 -> p2 segue do fluxo)
        const p1 = street.coordinates[bestSegmentIndex];
        const p2 = street.coordinates[bestSegmentIndex+1];
        return calculateBearing(p1, p2);
    }

    return null;
  }

  private normalizeAngleDifference(angle: number): number {
    while (angle > 180) angle -= 360;
    while (angle < -180) angle += 360;
    return angle;
  }
  
  // Cache para altura de prédios vizinhos (QUALIDADE > PERFORMANCE)
  private static surroundingHeightCache = new Map<string, { 
    data: { average: number; max: number; buildingCount: number }, 
    timestamp: number 
  }>();
  private static CACHE_DURATION = 30 * 60 * 1000; // 30 minutos
  
  constructor(googleAPIs?: GoogleAPIsService) {
    this.googleAPIs = googleAPIs || new GoogleAPIsService();
  }
  
  /**
   * Encontra ruas acessíveis ao redor do POI e retorna junto com metadados do raio
   */
  async findAccessibleStreets(
    poiData: POIData, 
    boundary: BoundaryData, 
    context: GeographicContext
  ): Promise<StreetData[]> {
    
    try {
      const searchRadius = await this.calculateIntelligentRadius(boundary, context, poiData);
      const roads = await this.getRoadsAroundBoundary(boundary, searchRadius, context);
      
      const accessibleStreets = roads.filter(road => 
        this.isStreetAccessible(road, context)
      );
      
      // NOVO: Para Urban Canyon, usar análise de quarteirão
      const isUrbanCanyon = this.isUrbanCanyon(boundary, context);
      if (isUrbanCanyon && boundary.buildings && boundary.buildings.length > 0) {
        const blockAnalysis = this.analyzeBlockStructure(
          boundary.center,
          accessibleStreets,
          boundary.buildings,
          boundary
        );
        
        const validStreets = blockAnalysis
          .filter(result => result.classification === 'front' || result.classification === 'side')
          .map(result => result.street);
        
        if (validStreets.length > 0) {
          const streetPoints = validStreets.map(street => 
            this.findClosestPointToBoundary(street, boundary)
          );
          return streetPoints;
        }
      }
      
      const streetPoints = accessibleStreets.map(street => 
        this.findClosestPointToBoundary(street, boundary)
      );
      
      return streetPoints;
      
    } catch (error) {
      console.error('Error finding accessible streets:', error);
      return [];
    }
  }

  /**
   * Encontra ruas acessíveis ao redor do POI e retorna junto com metadados do raio
   */
  async findAccessibleStreetsWithMetadata(
    poiData: POIData, 
    boundary: BoundaryData, 
    context: GeographicContext
  ): Promise<{ streets: StreetData[]; searchRadius: number; elevationAnalysis?: any }> {
    try {
      const searchRadius = await this.calculateIntelligentRadius(boundary, context, poiData);
      
      const roads = await this.getRoadsAroundBoundary(boundary, searchRadius, context);
      
      if (roads.length === 0) {
        console.error(`❌ [CRITICAL] getRoadsAroundBoundary returned 0 roads`);
      }
      
      const accessibleStreets = roads.filter(road => 
        this.isStreetAccessible(road, context)
      );
      
      const streetPoints = accessibleStreets.map(street => 
        this.findClosestPointToBoundary(street, boundary)
      );

      let elevationAnalysis;
      if (boundary.elevation) {
        elevationAnalysis = await ElevationAnalysisService.analyzeElevationDifference(
          boundary.elevation.center,
          boundary.center,
          context,
          poiData
        );
      }
      
      return { 
        streets: streetPoints, 
        searchRadius,
        elevationAnalysis
      };
      
    } catch (error) {
      console.error('❌ [ERROR] Finding accessible streets:', error);
      return { streets: [], searchRadius: 300 };
    }
  }
  
  private async calculateIntelligentRadius(boundary: BoundaryData, context: GeographicContext, poiData: POIData, config?: TriggerPointsConfig): Promise<number> {
    const hasElevationData = boundary.elevation && boundary.elevation.center > 0;
    const isManualBoundary = boundary.source === 'manual' || boundary.source === 'manual_drawing';
    const isUnknownPOI = isManualBoundary && boundary.osmIdentified === false;
    
    if (!hasElevationData || isUnknownPOI) {
      return 150;
    }
    
    if (boundary.classification && boundary.classification.searchRadius) {
      const classificationRadius = boundary.classification.searchRadius;
      const classificationGroup = boundary.classification.group;
      
      if (classificationGroup === 'canyon') {
        const baseCanyonRadius = classificationRadius;
        let canyonRadius = baseCanyonRadius;
        if (boundary.height && boundary.height > 100) {
          const heightAdjustment = Math.min((boundary.height - 100) * 0.3, 25);
          canyonRadius = Math.min(baseCanyonRadius + heightAdjustment, 100);
        }
        return canyonRadius;
      }
      return classificationRadius;
    }
    
    if (boundary.classification?.group === 'canyon') {
      const baseCanyonRadius = boundary.classification.searchRadius || 75;
      let canyonRadius = baseCanyonRadius;
      if (boundary.height && boundary.height > 100) {
        const heightAdjustment = Math.min((boundary.height - 100) * 0.3, 25);
        canyonRadius = Math.min(baseCanyonRadius + heightAdjustment, 100);
      }
      return canyonRadius;
    }
    
    if (boundary.elevation && boundary.elevation.center > 0) {
      const poiElevation = boundary.elevation.center;
      const baseElevation = await ElevationAnalysisService.estimateRegionalBaseElevation(boundary.center, context, poiData);
      const elevationDiff = poiElevation - baseElevation;
      
      if (elevationDiff > 150) {
        const theoreticalRange = Math.sqrt(elevationDiff) * 200;
        const calculatedRange = Math.max(theoreticalRange, 3000);
        const maxRange = Math.min(calculatedRange, 15000);
        return Math.round(maxRange);
      }
      
      if (elevationDiff <= 50 && boundary.classification?.group === 'flat') {
        const flatRadius = boundary.classification.searchRadius || 120;
        return flatRadius;
      }
    }
    
    const cfg = config || loadTriggerPointsConfig();
    let baseRadius = cfg.searchRadius.baseRadius[context.urbanDensity.level];
    
    if (boundary.elevation) {
      const poiElevation = boundary.elevation.center;
      const elevationDiff = boundary.elevation.center - boundary.elevation.average;
      
      if (poiElevation > 1000) {
        const extremeAltitudeBonus = Math.min((poiElevation - 1000) * 10 + 2000, 4000);
        baseRadius += extremeAltitudeBonus;
      } else if (poiElevation > 800) {
        const highAltitudeBonus = Math.min((poiElevation - 800) * 6 + 1200, 2500);
        baseRadius += highAltitudeBonus;
      } else if (poiElevation > 400) {
        const moderateAltitudeBonus = Math.min((poiElevation - 400) * 2, 800);
        baseRadius += moderateAltitudeBonus;
      }
      
      if (elevationDiff > 50) {
        const elevationBonus = Math.min(elevationDiff * 8, 400); 
        baseRadius += elevationBonus;
      } else if (elevationDiff > 20) {
        const elevationBonus = elevationDiff * 5;
        baseRadius += elevationBonus;
      } else if (elevationDiff < -20) {
        const elevationPenalty = Math.abs(elevationDiff) * TRIGGER_POINTS_CONSTANTS.ratios.elevationPenalty;
        baseRadius = Math.max(baseRadius - elevationPenalty, TRIGGER_POINTS_CONSTANTS.ratios.elevationPenaltyMin);
      }
      
      const elevationRange = boundary.elevation.max - boundary.elevation.min;
      if (elevationRange > 100) {
        const terrainBonus = Math.min(elevationRange * 2, 200);
        baseRadius += terrainBonus;
      }
    }
    
    if (boundary.height && boundary.height > 10) {
      const heightBonus = Math.min(boundary.height * TRIGGER_POINTS_CONSTANTS.ratios.heightMultiplier, TRIGGER_POINTS_CONSTANTS.ratios.heightMultiplierMax);
      baseRadius += heightBonus;
    }

    const isDenseArea = context.urbanDensity.level === 'very_dense' || context.urbanDensity.level === 'dense';
    const shouldAnalyzeRelativeHeight = isDenseArea || (boundary.height && boundary.height > 10);
    
    if (shouldAnalyzeRelativeHeight) {
      try {
        const poiHeight = boundary.height || 0;
        let analysisRadius = TRIGGER_POINTS_CONSTANTS.distances.surroundingHeightsRadius;
        
        if (poiHeight > 100) {
          analysisRadius = TRIGGER_POINTS_CONSTANTS.distances.surroundingHeightsRadiusMax;
        } else if (poiHeight > 50) {
          analysisRadius = Math.min(1200, TRIGGER_POINTS_CONSTANTS.distances.surroundingHeightsRadius * 1.5);
        }
        
        const surroundingHeights = await Promise.race([
          this.calculateSurroundingBuildingsHeight(boundary.center, analysisRadius),
          new Promise<{ average: number; max: number; buildingCount: number }>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), TRIGGER_POINTS_CONSTANTS.distances.heightAnalysisTimeout)
          )
        ]);
        
        boundary.surroundingHeight = surroundingHeights;
        
        if (surroundingHeights.buildingCount > 5) {
          const poiHeight = boundary.height || 0;
          const heightDifference = poiHeight - surroundingHeights.average;
          
          if (isDenseArea) {
            if (heightDifference > 100) {
              const relativeRadius = Math.min(heightDifference * cfg.searchRadius.heightMultipliers.extremely_tall.multiplier, cfg.searchRadius.heightMultipliers.extremely_tall.maxRadius);
              baseRadius = Math.max(relativeRadius, cfg.searchRadius.heightMultipliers.extremely_tall.minRadius);
            } else if (heightDifference > 50) {
              const relativeRadius = Math.min(heightDifference * cfg.searchRadius.heightMultipliers.very_tall.multiplier, cfg.searchRadius.heightMultipliers.very_tall.maxRadius);
              baseRadius = Math.max(relativeRadius, cfg.searchRadius.heightMultipliers.very_tall.minRadius);
            } else if (heightDifference > 20) {
              const relativeRadius = Math.min(heightDifference * cfg.searchRadius.heightMultipliers.tall.multiplier, cfg.searchRadius.heightMultipliers.tall.maxRadius);
              baseRadius = Math.max(relativeRadius, cfg.searchRadius.heightMultipliers.tall.minRadius);
            } else if (heightDifference > 0) {
              const relativeRadius = Math.min(heightDifference * cfg.searchRadius.heightMultipliers.medium.multiplier, cfg.searchRadius.heightMultipliers.medium.maxRadius);
              baseRadius = Math.max(relativeRadius, cfg.searchRadius.heightMultipliers.medium.minRadius);
            } else {
              baseRadius = Math.max(30, 20 + Math.abs(heightDifference) * 0.5);
            }
          } else {
            if (heightDifference > 50) {
              const relativeBonus = Math.min(heightDifference * 4, 600);
              baseRadius += relativeBonus;
            } else if (heightDifference > 20) {
              const relativeBonus = heightDifference * 2;
              baseRadius += relativeBonus;
            } else if (heightDifference < -20) {
              const penalty = Math.abs(heightDifference) * 2;
              baseRadius = Math.max(baseRadius - penalty, 150);
            }
          }
        } else {
          if (isDenseArea) {
            baseRadius = Math.min(baseRadius, 150);
          }
        }
      } catch (error) {
        if (isDenseArea) {
          baseRadius = Math.min(baseRadius, 150);
        }
      }
    }
    
    if (context.elevationContext.type === 'mountainous') {
      baseRadius *= 1.4;
    } else if (context.elevationContext.type === 'hilly') {
      baseRadius *= 1.2;
    }
    
    const minRadius = cfg.searchRadius.limits.min;
    const maxRadius = cfg.searchRadius.limits.max;
    const finalRadius = Math.max(minRadius, Math.min(baseRadius, maxRadius));
    
    console.log(`✅ Intelligent radius calculated: ${finalRadius.toFixed(0)}m (base: ${baseRadius.toFixed(0)}m)`);
    
    return Math.round(finalRadius);
  }

  private async getRoadsAroundBoundary(boundary: BoundaryData, searchRadius: number, context?: GeographicContext): Promise<StreetData[]> {
    try {
      if (boundary.streets && boundary.streets.length > 0) {
        const filtered = this.filterStreetPointsByRadius(boundary.streets, boundary, searchRadius);
        return filtered;
      }
      
      if (boundary.coordinates.length > 100) {
        const isUrbanCanyon = context ? this.isUrbanCanyon(boundary, context) : false;
        
        if (isUrbanCanyon && context) {
          try {
            const osmStreets = await this.getStreetsFromOSMOptimizedBoundary(boundary, searchRadius);
            if (osmStreets && osmStreets.length > 0) {
              return osmStreets;
            }
          } catch (error) {
            console.warn(`⚠️ [FALLBACK] OSM query failed, using Nominatim:`, error);
          }
        }
        
        const nominatimStreets = this.createRealStreetsFromNominatimData(boundary);
        return this.filterStreetPointsByRadius(nominatimStreets, boundary, searchRadius);
      }
      
      if (boundary.coordinates.length > 50) {
        const nominatimStreets = this.createRealStreetsFromNominatimData(boundary);
        
        if (nominatimStreets.length === 0) {
          try {
            const osmStreets = await this.getStreetsFromOSMOptimizedBoundary(boundary, searchRadius);
            if (osmStreets && osmStreets.length > 0) {
              return this.filterStreetPointsByRadius(osmStreets, boundary, searchRadius);
            }
          } catch (error) {
            console.warn(`⚠️ [FALLBACK] OSM query failed:`, error);
          }
        }
        
        return this.filterStreetPointsByRadius(nominatimStreets, boundary, searchRadius);
      }
      
      const nominatimStreets = this.createRealStreetsFromNominatimData(boundary);
      
      if (nominatimStreets.length === 0) {
        try {
          const osmStreets = await this.getStreetsFromOSMOptimizedBoundary(boundary, searchRadius);
          if (osmStreets && osmStreets.length > 0) {
            return this.filterStreetPointsByRadius(osmStreets, boundary, searchRadius);
          }
        } catch (error) {
          // Ignore
        }
      }
      
      return this.filterStreetPointsByRadius(nominatimStreets, boundary, searchRadius);
      
    } catch (error) {
      console.error('❌ [ERROR] Finding roads around boundary:', error);
      const nominatimStreets = this.createRealStreetsFromNominatimData(boundary);
      
      if (nominatimStreets.length === 0) {
        try {
          const osmStreets = await this.getStreetsFromOSMOptimizedBoundary(boundary, searchRadius);
          if (osmStreets && osmStreets.length > 0) {
            return this.filterStreetPointsByRadius(osmStreets, boundary, searchRadius);
          }
        } catch (osmError) {
          // Ignore
        }
      }
      
      return this.filterStreetPointsByRadius(nominatimStreets, boundary, searchRadius);
    }
  }
  
  private filterStreetPointsByRadius(
    streets: StreetData[],
    boundary: BoundaryData,
    searchRadius: number
  ): StreetData[] {
    if (!streets || streets.length === 0) return streets;
    if (!boundary.coordinates || boundary.coordinates.length === 0) return streets;
    
    const maxAllowedDistance = searchRadius + 20;
    const filtered: StreetData[] = [];
    
    for (const street of streets) {
      if (!street.coordinates || street.coordinates.length === 0) continue;
      
      const validPoints: Array<{ lat: number; lng: number }> = [];
      let minDistanceToBoundary = Infinity;
      
      for (const point of street.coordinates) {
        if (isPointInPolygon(point, boundary.coordinates)) continue;
        
        const distanceToBoundary = calculateDistanceToPolygon(point, boundary.coordinates);
        minDistanceToBoundary = Math.min(minDistanceToBoundary, distanceToBoundary);
        
        if (distanceToBoundary <= maxAllowedDistance) {
          validPoints.push(point);
        }
      }
      
      if (validPoints.length >= 1) {
        const pointsToUse = validPoints.length >= 2 
          ? validPoints 
          : [validPoints[0], validPoints[0]]; 
        
        filtered.push({
          ...street,
          coordinates: pointsToUse
        });
      }
    }
    
    return filtered;
  }
  
  private createRealStreetsFromNominatimData(boundary: BoundaryData): StreetData[] {
    const streets: StreetData[] = [];
    
    try {
      if (!boundary.address?.street) return streets;
      
      const allStreets = boundary.address.allStreets || [boundary.address.street];
      
      for (let i = 0; i < allStreets.length; i++) {
        const streetName = allStreets[i];
        const streetCoordinates = this.generateStreetCoordinatesFromBoundary(boundary, streetName);
        
        if (streetCoordinates.length >= 2) {
          streets.push({
            id: `nominatim_street_${streetName.toLowerCase().replace(/\s+/g, '_')}`,
            name: streetName,
            type: 'residential',
            coordinates: streetCoordinates,
            accessibility: 'public',
            confidence: 0.9 
          });
        }
      }
    } catch (error) {
      console.warn(`❌ Failed to create real streets from Nominatim data:`, error);
    }
    
    return streets;
  }
  
  private generateStreetCoordinatesFromBoundary(boundary: BoundaryData, streetName: string): Array<{ lat: number; lng: number }> {
    try {
      if (!boundary.coordinates || boundary.coordinates.length < 3) return [];
      
      const streetSide = this.findBestStreetSide(boundary);
      if (!streetSide) return [];
      
      const streetCoordinates = this.createParallelStreetSegment(streetSide, boundary.center, boundary);
      return streetCoordinates;
    } catch (error) {
      return [];
    }
  }
  
  private findBestStreetSide(boundary: BoundaryData): { start: { lat: number; lng: number }; end: { lat: number; lng: number } } | null {
    try {
      if (!boundary.coordinates || boundary.coordinates.length < 4) return null;
      
      let longestSide = null;
      let maxLength = 0;
      
      for (let i = 0; i < boundary.coordinates.length; i++) {
        const start = boundary.coordinates[i];
        const end = boundary.coordinates[(i + 1) % boundary.coordinates.length];
        
        const length = calculateDistance(start, end);
        
        if (length > maxLength) {
          maxLength = length;
          longestSide = { start, end };
        }
      }
      return longestSide;
    } catch (error) {
      return null;
    }
  }
  
  private createParallelStreetSegment(
    boundarySide: { start: { lat: number; lng: number }; end: { lat: number; lng: number } },
    center: { lat: number; lng: number },
    boundary: BoundaryData
  ): Array<{ lat: number; lng: number }> {
    try {
      const dx = boundarySide.end.lng - boundarySide.start.lng;
      const dy = boundarySide.end.lat - boundarySide.start.lat;
      const length = Math.sqrt(dx * dx + dy * dy);
      
      if (length === 0) return [];
      
      const offsetDistance = TRIGGER_POINTS_CONSTANTS.distances.realStreetBoundaryOffset;
      const offsetLat = (dx / length) * (offsetDistance / 111000);
      const offsetLng = (dy / length) * (offsetDistance / (111000 * Math.cos(center.lat * Math.PI / 180)));
      
      const streetStart = {
        lat: boundarySide.start.lat + offsetLat,
        lng: boundarySide.start.lng + offsetLng
      };
      
      const streetEnd = {
        lat: boundarySide.end.lat + offsetLat,
        lng: boundarySide.end.lng + offsetLng
      };
      
      const streetCoordinates = [streetStart, streetEnd];
      const validCoordinates = streetCoordinates.filter(coord => {
        const distanceToBoundary = calculateDistanceToBoundary(coord, boundary.coordinates);
        const isOutside = distanceToBoundary > TRIGGER_POINTS_CONSTANTS.distances.realStreetValidationMargin;
        return isOutside;
      });
      
      if (validCoordinates.length < 2) return [];
      
      return validCoordinates;
      
    } catch (error) {
      return [];
    }
  }
  
  private isUrbanCanyon(boundary: BoundaryData, context: GeographicContext): boolean {
    const isVeryDense = context.urbanDensity.level === 'very_dense';
    const hasSignificantHeight = boundary.height && boundary.height > 50;
    const hasSurroundingData = boundary.surroundingHeight && boundary.surroundingHeight.buildingCount > 10;
    
    const isTallLandmark = boundary.surroundingHeight && 
                           boundary.height && 
                           boundary.height > boundary.surroundingHeight.average * 2;
    
    return !!(isVeryDense && (hasSignificantHeight ? true : false) && (hasSurroundingData || isTallLandmark));
  }

  private async getStreetsFromOSMOptimizedBoundary(boundary: BoundaryData, searchRadius: number): Promise<StreetData[]> {
    try {
      const strategicPoints = this.selectStrategicBoundaryPoints(boundary.coordinates, 16);
      
      const pointQueries = strategicPoints.map(point => 
        `way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$"]["access"!~"^(no)$"](around:${searchRadius},${point.lat},${point.lng})`
      ).join(';\n  ');
      
      const query = `
[out:json][timeout:${TRIGGER_POINTS_CONSTANTS.timeouts.osmQueryVeryLong}];
(
  ${pointQueries};
);
out geom tags;
`;
      
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query,
        headers: { 'Content-Type': 'text/plain' }
      });
      
      if (!response.ok) throw new Error(`OSM API error: ${response.status}`);
      
      const data = await response.json();
      
      if (!data.elements || data.elements.length === 0) return [];
      
      const streets: StreetData[] = [];
      const maxAllowedDistance = searchRadius + 20;
      
      for (const element of data.elements) {
        if (element.type === 'way' && element.geometry && element.geometry.length > 1) {
          const allStreetCoordinates = element.geometry.map((point: any) => ({
            lat: point.lat,
            lng: point.lon
          }));
          
          const pointsOutsideBoundary = allStreetCoordinates.filter((coord: {lat: number, lng: number}) => 
            !isPointInPolygon(coord, boundary.coordinates)
          );
          
          if (pointsOutsideBoundary.length === 0) continue;
          
          const pointsWithinRadius: Array<{ lat: number; lng: number }> = [];
          
          for (const point of pointsOutsideBoundary) {
            const distanceToBoundary = calculateDistanceToPolygon(point, boundary.coordinates);
            
            if (distanceToBoundary <= maxAllowedDistance) {
              pointsWithinRadius.push(point);
            }
          }
          
          if (pointsWithinRadius.length >= 2 && pointsOutsideBoundary.length > allStreetCoordinates.length * 0.3) {
            const street: StreetData = {
              id: `osm_way_${element.id}`,
              type: this.classifyOSMHighway(element.tags?.highway || 'unknown'),
              name: element.tags?.name || element.tags?.ref || 'Unnamed Street',
              coordinates: pointsWithinRadius,
              accessibility: this.determineAccessibility(element.tags),
              confidence: 0.9,
              tags: {
                tunnel: element.tags?.tunnel,
                bridge: element.tags?.bridge,
                layer: element.tags?.layer,
                covered: element.tags?.covered,
                surface: element.tags?.surface,
                lit: element.tags?.lit,
                width: element.tags?.width,
                lanes: element.tags?.lanes,
                sidewalk: element.tags?.sidewalk,
                access: element.tags?.access,
                oneway: element.tags?.oneway,
                maxspeed: element.tags?.maxspeed
              }
            };
            streets.push(street);
          }
        }
      }
      return streets;
      
    } catch (error) {
      console.error('Error in optimized OSM street search:', error);
      return [];
    }
  }
  
  private classifyOSMHighway(highway: string): string {
    const highwayMap: Record<string, string> = {
      'motorway': 'primary',
      'trunk': 'primary',
      'primary': 'primary',
      'secondary': 'secondary',
      'tertiary': 'tertiary',
      'residential': 'residential',
      'service': 'service',
      'unclassified': 'residential'
    };
    return highwayMap[highway] || 'residential';
  }
  
  private determineAccessibility(tags: any): 'public' | 'restricted' | 'private' {
    if (!tags) return 'public';
    if (tags.access === 'private' || tags.access === 'no') return 'private';
    if (tags.access === 'permissive' || tags.access === 'destination') return 'restricted';
    return 'public';
  }
  
  private async getRoadsFromBoundaryPoints(boundary: BoundaryData, processedRoads: Set<string>): Promise<StreetData[]> {
    const streets: StreetData[] = [];
    
    if (boundary.coordinates.length > 100) {
      return this.createVirtualStreetsFromBoundary(boundary);
    }
    
    const strategicPoints = this.selectStrategicBoundaryPoints(boundary.coordinates);
    
    for (const point of strategicPoints) {
      try {
        const query = `
[out:json][timeout:${TRIGGER_POINTS_CONSTANTS.timeouts.osmQueryMedium}];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$"](around:50,${point.lat},${point.lng});
);
out geom tags;
`;
        
        const response = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST',
          body: query,
          headers: { 'Content-Type': 'text/plain' }
        });
        
        if (response.ok) {
          const data = await response.json();
          const roads = data.elements || [];
          
          for (const road of roads) {
            if (road.id && !processedRoads.has(road.id.toString())) {
              processedRoads.add(road.id.toString());
              
              const coordinates = road.geometry ? road.geometry.map((point: any) => ({
                lat: point.lat,
                lng: point.lon
              })) : [];
              
              streets.push({
                id: road.id.toString(),
                type: road.tags?.highway || 'road',
                coordinates,
                accessibility: this.determineAccessibility(road.tags),
                confidence: 0.9
              });
            }
          }
        }
      } catch (error) {
        // Ignore
      }
    }
    return streets;
  }
  
  private createVirtualStreetsFromBoundary(boundary: BoundaryData): StreetData[] {
    const streets: StreetData[] = [];
    const boundaryRadius = Math.sqrt(boundary.area / Math.PI);
    const minDistance = Math.max(boundaryRadius * TRIGGER_POINTS_CONSTANTS.distances.virtualStreetBoundaryOffset, TRIGGER_POINTS_CONSTANTS.distances.virtualStreetMinDistance);
    
    const center = boundary.center;
    const outerRadius = boundaryRadius + minDistance;
    
    const circlePoints = 16;
    const circleCoordinates = [];
    
    for (let i = 0; i < circlePoints; i++) {
      const angle = (i * 360) / circlePoints;
      const radians = (angle * Math.PI) / 180;
      const lat = center.lat + (outerRadius / 111000) * Math.cos(radians);
      const lng = center.lng + (outerRadius / (111000 * Math.cos(center.lat * Math.PI / 180))) * Math.sin(radians);
      circleCoordinates.push({ lat, lng });
    }
    
    for (let i = 0; i < circleCoordinates.length; i++) {
      const start = circleCoordinates[i];
      const end = circleCoordinates[(i + 1) % circleCoordinates.length];
      
      streets.push({
        id: `virtual_circle_${i}`,
        type: 'residential',
        coordinates: [start, end],
        accessibility: 'public',
        confidence: 0.8
      });
    }
    
    const radialStartRadius = outerRadius;
    const radialEndRadius = outerRadius * 2;
    
    for (let angle = 0; angle < 360; angle += 45) {
      const radians = (angle * Math.PI) / 180;
      const startLat = center.lat + (radialStartRadius / 111000) * Math.cos(radians);
      const startLng = center.lng + (radialStartRadius / (111000 * Math.cos(center.lat * Math.PI / 180))) * Math.sin(radians);
      
      const endLat = center.lat + (radialEndRadius / 111000) * Math.cos(radians);
      const endLng = center.lng + (radialEndRadius / (111000 * Math.cos(center.lat * Math.PI / 180))) * Math.sin(radians);
      
      streets.push({
        id: `virtual_radial_${angle}`,
        type: 'residential',
        coordinates: [{ lat: startLat, lng: startLng }, { lat: endLat, lng: endLng }],
        accessibility: 'public',
        confidence: 0.7
      });
    }
    
    return streets;
  }

  private selectStrategicBoundaryPoints(
    coordinates: Array<{lat: number, lng: number}>, 
    maxPoints: number = 8
  ): Array<{lat: number, lng: number}> {
    if (coordinates.length <= maxPoints) return coordinates;
    
    const center = this.calculateBoundaryCenter(coordinates);
    const strategicPoints: Array<{lat: number, lng: number}> = [];
    
    const pointsWithAngles = coordinates.map((coord, index) => ({
      coord,
      index,
      angle: this.calculateAngle(center, coord)
    }));
    
    pointsWithAngles.sort((a, b) => a.angle - b.angle);
    const angleStep = 360 / maxPoints;
    
    for (let i = 0; i < maxPoints; i++) {
      const targetAngle = i * angleStep;
      let bestPoint = pointsWithAngles[0];
      let bestAngleDiff = Infinity;
      
      for (const pointWithAngle of pointsWithAngles) {
        const angleDiff = Math.abs(this.normalizeAngle(pointWithAngle.angle - targetAngle));
        if (angleDiff < bestAngleDiff) {
          bestAngleDiff = angleDiff;
          bestPoint = pointWithAngle;
        }
      }
      strategicPoints.push(bestPoint.coord);
    }
    return strategicPoints;
  }
  
  private calculateBoundaryCenter(coordinates: Array<{lat: number, lng: number}>): {lat: number, lng: number} {
    const sumLat = coordinates.reduce((sum, coord) => sum + coord.lat, 0);
    const sumLng = coordinates.reduce((sum, coord) => sum + coord.lng, 0);
    return {
      lat: sumLat / coordinates.length,
      lng: sumLng / coordinates.length
    };
  }
  
  private calculateAngle(center: {lat: number, lng: number}, point: {lat: number, lng: number}): number {
    const deltaLng = point.lng - center.lng;
    const deltaLat = point.lat - center.lat;
    
    let angle = Math.atan2(deltaLng, deltaLat) * 180 / Math.PI;
    return angle < 0 ? angle + 360 : angle;
  }
  
  private normalizeAngle(angle: number): number {
    while (angle > 180) angle -= 360;
    while (angle < -180) angle += 360;
    return Math.abs(angle);
  }
  
  private isStreetAccessible(road: StreetData, context: GeographicContext): boolean {
    const accessibleRoadTypes = [
      'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential',
      'living_street', 'unclassified', 'motorway_link', 'trunk_link'
    ];
    
    if (!accessibleRoadTypes.includes(road.type)) return false;
    if (road.accessibility === 'private' || road.accessibility === 'no') return false;
    if (road.tags?.tunnel === 'yes' || road.tags?.covered === 'yes') return false;
    
    if (context.urbanDensity.level === 'very_dense') return true;
    
    return true;
  }
  
  private findClosestPointToBoundary(street: StreetData, boundary: BoundaryData): StreetData {
    if (street.coordinates.length === 0) return street;
    
    let closestPoint = street.coordinates[0];
    let minDistance = calculateDistance(street.coordinates[0], boundary.center);
    
    for (const point of street.coordinates) {
      const distance = calculateDistance(point, boundary.center);
      if (distance < minDistance) {
        minDistance = distance;
        closestPoint = point;
      }
    }
    
    return {
      ...street,
      coordinates: [closestPoint],
      distance: minDistance
    };
  }
  
  calculateStreetConfidence(street: StreetData, context: GeographicContext): number {
    let confidence = street.confidence || 0.5;
    
    const roadTypeConfidence: Record<string, number> = {
      'primary': 0.9, 'secondary': 0.8, 'tertiary': 0.7, 'residential': 0.6,
      'living_street': 0.5, 'pedestrian': 0.4, 'service': 0.3, 'footway': 0.2,
      'path': 0.1, 'track': 0.1
    };
    
    const typeConfidence = roadTypeConfidence[street.type] || 0.5;
    confidence = (confidence + typeConfidence) / 2;
    
    if (street.accessibility === 'public') confidence += 0.1;
    else if (street.accessibility === 'private' || street.accessibility === 'no') confidence -= 0.3;
    
    if (context.urbanDensity.level === 'very_dense' && street.type === 'residential') confidence += 0.1;
    
    return Math.max(0, Math.min(1, confidence));
  }

  private async calculateSurroundingBuildingsHeight(
    poiLocation: { lat: number; lng: number },
    radius: number = 500
  ): Promise<{ average: number; max: number; buildingCount: number }> {
    const cacheKey = `${poiLocation.lat.toFixed(4)},${poiLocation.lng.toFixed(4)},${radius}`;
    const cached = StreetAnalyzer.surroundingHeightCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < StreetAnalyzer.CACHE_DURATION) {
      return cached.data;
    }
    
    const query = `
[out:json][timeout:${TRIGGER_POINTS_CONSTANTS.timeouts.osmQueryVeryLong}];
(
  way["building"](around:${radius},${poiLocation.lat},${poiLocation.lng});
);
out tags;
`;

    try {
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: query
      });
      
      if (!response.ok) return { average: 0, max: 0, buildingCount: 0 };
      
      const data = await response.json();
      
      if (!data.elements || data.elements.length === 0) return { average: 0, max: 0, buildingCount: 0 };
      
      const heights: number[] = [];
      
      for (const element of data.elements || []) {
        const height = extractBuildingHeight(element.tags);
        if (height > 0) heights.push(height);
      }
      
      if (heights.length === 0) return { average: 0, max: 0, buildingCount: 0 };
      
      const averageHeight = heights.reduce((sum, h) => sum + h, 0) / heights.length;
      const maxHeight = Math.max(...heights);
      const tallBuildingsCount = heights.filter(height => height > 50).length;
      
      const result = {
        average: Math.round(averageHeight),
        max: Math.round(maxHeight),
        buildingCount: heights.length,
        tallBuildingsCount
      };
      
      StreetAnalyzer.surroundingHeightCache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });
      
      return result;
    } catch (error) {
      console.error('Failed to fetch surrounding buildings height:', error);
      return { average: 0, max: 0, buildingCount: 0 };
    }
  }

  public async getStreetsFromOSMOptimized(location: { lat: number; lng: number }, radius: number, boundary?: BoundaryData): Promise<StreetData[]> {
    try {
      if (boundary?.streets && boundary.streets.length > 0) return boundary.streets;
      
      const query = `
[out:json][timeout:${TRIGGER_POINTS_CONSTANTS.timeouts.osmQueryVeryLong}];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$"]["access"!~"^(no)$"](around:${radius},${location.lat},${location.lng});
);
out geom tags;
`;
      
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query,
        headers: { 'Content-Type': 'text/plain' }
      });
      
      if (!response.ok) throw new Error(`OSM API error: ${response.status}`);
      
      const data = await response.json();
      
      if (!data.elements || data.elements.length === 0) return [];
      
      const streets: StreetData[] = [];
      
      for (const element of data.elements) {
        if (element.type === 'way' && element.geometry && element.geometry.length > 1) {
          const streetCoordinates = element.geometry.map((point: any) => ({
            lat: point.lat,
            lng: point.lon
          }));
          
          let closestPoint = streetCoordinates[0];
          let minDistance = calculateDistance(location, closestPoint);
          
          for (const coord of streetCoordinates) {
            const distance = calculateDistance(location, coord);
            if (distance < minDistance) {
              minDistance = distance;
              closestPoint = coord;
            }
          }
          
          streets.push({
            id: `osm_way_${element.id}`,
            type: this.classifyOSMHighway(element.tags?.highway || 'unknown'),
            name: element.tags?.name || element.tags?.ref || 'Unnamed Street',
            coordinates: [closestPoint],
            accessibility: this.determineAccessibility(element.tags),
            confidence: 0.9,
            tags: {
              tunnel: element.tags?.tunnel,
              bridge: element.tags?.bridge,
              layer: element.tags?.layer,
              covered: element.tags?.covered,
              surface: element.tags?.surface,
              lit: element.tags?.lit,
              width: element.tags?.width,
              lanes: element.tags?.lanes,
              sidewalk: element.tags?.sidewalk,
              access: element.tags?.access,
              oneway: element.tags?.oneway,
              maxspeed: element.tags?.maxspeed
            }
          });
        }
      }
      return streets;
    } catch (error) {
      console.error('Error in OSM street search:', error);
      return [];
    }
  }

  public isStreetAccessiblePublic(road: StreetData, context: GeographicContext): boolean {
    return this.isStreetAccessible(road, context);
  }

  analyzeBlockStructure(
    poiLocation: { lat: number; lng: number },
    streets: StreetData[],
    buildings: any[],
    boundary?: BoundaryData
  ): Array<{ street: StreetData; classification: 'front' | 'side' | 'back'; distance: number; hasBuildingsBlocking: boolean }> {
    
    const isHighElevationPOI = boundary?.classification?.group === POIGroup.HIGH;
    const results: Array<{ street: StreetData; classification: 'front' | 'side' | 'back'; distance: number; hasBuildingsBlocking: boolean }> = [];
    
    for (const street of streets) {
      if (!street.coordinates || street.coordinates.length === 0) continue;
      if (!boundary || !boundary.coordinates || boundary.coordinates.length === 0) continue;
      
      let minDistanceToBoundary = Infinity;
      let closestStreetPoint: { lat: number; lng: number } | null = null;
      
      for (const point of street.coordinates) {
        const distanceToBoundary = calculateDistanceToPolygon(point, boundary.coordinates);
        if (distanceToBoundary < minDistanceToBoundary) {
          minDistanceToBoundary = distanceToBoundary;
          closestStreetPoint = point;
        }
      }
      
      if (!closestStreetPoint || minDistanceToBoundary === Infinity) continue;
      
      const distance = minDistanceToBoundary;
      const boundaryPoint = findClosestPointOnBoundary(closestStreetPoint, boundary.coordinates);
      const hasBuildingsBlocking = this.checkBuildingsBetweenPoints(boundaryPoint, closestStreetPoint, buildings, boundary);
      
      let classification: 'front' | 'side' | 'back';
      
      if (isHighElevationPOI) {
        classification = hasBuildingsBlocking ? 'back' : 'front';
      } else {
        if (hasBuildingsBlocking) {
          classification = 'back';
        } else if (distance < 50) {
          classification = 'front';
        } else if (distance < 100) {
          classification = 'side';
        } else {
          classification = 'back';
        }
      }
      
      results.push({
        street,
        classification,
        distance,
        hasBuildingsBlocking
      });
    }
    
    results.sort((a, b) => a.distance - b.distance);
    return results;
  }

  private checkBuildingsBetweenPoints(
    point1: { lat: number; lng: number },
    point2: { lat: number; lng: number },
    buildings: any[],
    boundary?: BoundaryData
  ): boolean {
    const bufferDistance = 20;
    const lineDistance = calculateDistance(point1, point2);
    let buildingsBlocking = 0;
    
    for (const building of buildings) {
      if (!building.geometry || building.geometry.length === 0) continue;
      
      const buildingCenter = this.calculateBuildingCentroid(building);
      
      if (boundary && boundary.coordinates && boundary.coordinates.length > 0) {
        if (isPointInPolygon(buildingCenter, boundary.coordinates)) continue;
      }
      
      const distanceToLine = calculateDistanceToLineSegment(buildingCenter, point1, point2);
      
      if (distanceToLine <= bufferDistance) {
        const distance1 = calculateDistance(point1, buildingCenter);
        const distance2 = calculateDistance(point2, buildingCenter);
        const distanceDiff = Math.abs(distance1 + distance2 - lineDistance);
        
        if (distanceDiff < 30) {
          buildingsBlocking++;
          return true;
        }
      }
    }
    return false;
  }

  private calculateBuildingCentroid(building: any): { lat: number; lng: number } {
    if (!building.geometry || building.geometry.length === 0) {
      return { lat: building.lat || 0, lng: building.lon || 0 };
    }
    
    if (Array.isArray(building.geometry[0])) {
      const coords = building.geometry[0];
      let sumLat = 0;
      let sumLng = 0;
      
      for (const coord of coords) {
        sumLat += coord[1] || coord.lat || 0;
        sumLng += coord[0] || coord.lng || 0;
      }
      
      return {
        lat: sumLat / coords.length,
        lng: sumLng / coords.length
      };
    }
    return { lat: building.lat || 0, lng: building.lon || 0 };
  }
}

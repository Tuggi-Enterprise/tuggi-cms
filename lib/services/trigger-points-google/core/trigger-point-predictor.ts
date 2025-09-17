// Core Trigger Point Predictor - Orquestrador principal do sistema

import { GeographicContextAnalyzer } from './geographic-analyzer';
import { BoundaryDetector } from './boundary-detector';
import { StreetAnalyzer } from '../analyzers/street-analyzer';
import { OptimalPointCalculator } from '../analyzers/point-calculator';
import { TriggerPointValidator } from '../analyzers/validator';
import { GoogleAPIsService } from '../services/google-apis.service';
import { POIData, TriggerPoint, TriggerPointGenerationOptions, TriggerPointPredictionResult, BoundaryData, GeographicContext } from '../types/interfaces';

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
    console.log(`🚀 Starting trigger point prediction for: ${poiData.name}`);
    const startTime = Date.now();
    
    try {
      // Validar dados de entrada
      const validation = this.validatePOIData(poiData);
      if (!validation.valid) {
        throw new Error(`Invalid POI data: ${validation.errors.join(', ')}`);
      }
      
      // 1. Análise automática do contexto geográfico
      console.log('📊 Step 1: Analyzing geographic context...');
      const context = await this.geographicAnalyzer.analyzeGeographicContext(poiData);
      
      // 2. Detecção de boundary
      console.log('🔍 Step 2: Detecting boundary...');
      const boundaryResult = await this.boundaryDetector.detectBoundary(poiData, context);
      if (!boundaryResult.success || !boundaryResult.data) {
        throw new Error(`Boundary detection failed: ${boundaryResult.error}`);
      }
      const boundary = boundaryResult.data;
      
      // 3. Análise de ruas acessíveis
      console.log('🛣️ Step 3: Finding accessible streets...');
      const accessibleStreets = await this.streetAnalyzer.findAccessibleStreets(poiData, boundary, context);
      
      if (accessibleStreets.length === 0) {
        console.warn('⚠️ No accessible streets found, using fallback strategy');
        const fallbackPoints = await this.generateFallbackTriggerPoints(poiData, boundary, context);
        const processingTime = Date.now() - startTime;
        
        return {
          triggerPoints: fallbackPoints,
          boundary,
          context,
          processingTime,
          metadata: {
            boundarySource: boundary.source,
            boundaryConfidence: boundary.confidence,
            streetCount: 0,
            optimalPointsFound: 0,
            validatedPoints: fallbackPoints.length,
            finalPoints: fallbackPoints.length,
            fallbackUsed: true
          }
        };
      }
      
      // 4. Cálculo de pontos ótimos
      console.log('🎯 Step 4: Calculating optimal points...');
      const optimalPoints = await this.pointCalculator.calculateOptimalPoints(poiData, accessibleStreets, boundary, context);
      
      if (optimalPoints.length === 0) {
        console.warn('⚠️ No optimal points calculated, using fallback strategy');
        const fallbackPoints = await this.generateFallbackTriggerPoints(poiData, boundary, context);
        const processingTime = Date.now() - startTime;
        
        return {
          triggerPoints: fallbackPoints,
          boundary,
          context,
          processingTime,
          metadata: {
            boundarySource: boundary.source,
            boundaryConfidence: boundary.confidence,
            streetCount: accessibleStreets.length,
            optimalPointsFound: 0,
            validatedPoints: fallbackPoints.length,
            finalPoints: fallbackPoints.length,
            fallbackUsed: true
          }
        };
      }
      
      // 5. Validação e ranking com distância mínima
      console.log('✅ Step 5: Validating and ranking points with optimal spacing...');
      const maxTPs = options.maxTriggerPoints || 50;
      const minDistance = this.calculateMinDistance(context, boundary);
      
      const validatedPoints = await this.validator.validateAndRankPoints(
        optimalPoints, 
        poiData, 
        context,
        boundary,
        maxTPs,
        minDistance
      );
      
      // 6. Aplicar opções de filtro adicionais (se houver)
      const filteredPoints = this.applyOptions(validatedPoints, options);
      
      // 7. Otimização final (agora menos necessária devido à distância mínima)
      const optimizedPoints = this.validator.optimizeTriggerPoints(filteredPoints);
      
      const processingTime = Date.now() - startTime;
      console.log(`🎉 Generated ${optimizedPoints.length} trigger points in ${processingTime}ms`);
      
      return {
        triggerPoints: optimizedPoints,
        boundary,
        context,
        processingTime,
        metadata: {
          boundarySource: boundary.source,
          boundaryConfidence: boundary.confidence,
          streetCount: accessibleStreets.length,
          optimalPointsFound: optimalPoints.length,
          validatedPoints: validatedPoints.length,
          finalPoints: optimizedPoints.length,
          fallbackUsed: false
        }
      };
      
    } catch (error) {
      console.error('Error in trigger point prediction:', error);
      throw new Error(`Failed to generate trigger points: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Gera trigger points de fallback quando não há ruas acessíveis
   */
  private async generateFallbackTriggerPoints(
    poiData: POIData, 
    boundary: any, 
    context: any
  ): Promise<TriggerPoint[]> {
    console.log('🔄 Generating fallback trigger points...');
    
    // Criar trigger points básicos ao redor do POI
    const fallbackPoints: TriggerPoint[] = [];
    const baseRadius = 100; // metros
    const directions = [0, 90, 180, 270]; // Norte, Leste, Sul, Oeste
    
    for (let i = 0; i < directions.length; i++) {
      const direction = directions[i];
      const point = this.calculatePointAtDistance(poiData.location, baseRadius, direction);
      
      const triggerPoint: TriggerPoint = {
        id: `fallback_${i + 1}`,
        location: point,
        radius: 50,
        expectedBearing: direction,
        bearingThreshold: 45,
        type: 'fallback',
        priority: i + 1,
        confidence: 0.3,
        quality: 0.3,
        street: {
          id: `fallback_street_${i + 1}`,
          type: 'fallback',
          coordinates: [point],
          accessibility: 'public',
          confidence: 0.3
        },
        distance: baseRadius,
        generationMethod: 'google_apis',
        contextData: context,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      fallbackPoints.push(triggerPoint);
    }
    
    return fallbackPoints;
  }
  
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
   * Aplica opções de filtro aos trigger points
   */
  private applyOptions(triggerPoints: TriggerPoint[], options: TriggerPointGenerationOptions): TriggerPoint[] {
    let filtered = [...triggerPoints];
    
    // Filtrar por qualidade mínima
    if (options.minQuality !== undefined) {
      filtered = filtered.filter(tp => tp.quality >= options.minQuality!);
    }
    
    // Limitar número máximo de trigger points
    if (options.maxTriggerPoints !== undefined) {
      filtered = filtered.slice(0, options.maxTriggerPoints);
    }
    
    return filtered;
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
   * Calcula distância mínima entre TPs baseado no contexto e tamanho do POI
   */
  private calculateMinDistance(context: GeographicContext, boundary: BoundaryData): number {
    let baseDistance = 50; // Base: 50m (otimizado para range de 20m por TP)
    
    console.log(`📏 Calculating minimum distance between TPs (20m range each)...`);
    
    // Ajustar baseado na densidade urbana
    switch (context.urbanDensity.level) {
      case 'very_dense':
        baseDistance = 40; // Mais próximos em áreas muito densas
        break;
      case 'dense':
        baseDistance = 45;
        break;
      case 'medium':
        baseDistance = 50;
        break;
      case 'low':
        baseDistance = 60;
        break;
      case 'rural':
        baseDistance = 70; // Mais distantes em áreas rurais
        break;
    }
    
    // Ajustar baseado no tamanho do POI
    if (boundary.area > 500000) { // POIs muito grandes (>50 hectares)
      baseDistance *= 1.3; // Reduzido de 1.5 para 1.3
      console.log(`🏞️ Large POI adjustment: +30% distance`);
    } else if (boundary.area > 100000) { // POIs grandes (>10 hectares)
      baseDistance *= 1.1; // Reduzido de 1.2 para 1.1
      console.log(`🏛️ Medium POI adjustment: +10% distance`);
    }
    
    // Ajustar baseado na elevação (POIs altos = TPs mais distantes)
    if (boundary.elevation) {
      const elevationDiff = boundary.elevation.center - boundary.elevation.average;
      if (elevationDiff > 50) {
        baseDistance *= 1.2; // Reduzido de 1.3 para 1.2
        console.log(`⛰️ High elevation adjustment: +20% distance`);
      }
    }
    
    // Ajustar baseado na altura do POI
    if (boundary.height && boundary.height > 50) {
      baseDistance *= 1.1; // Reduzido de 1.2 para 1.1
      console.log(`🏢 Tall POI adjustment: +10% distance`);
    }
    
    // Limites de segurança otimizados para range de 20m
    const minDistance = Math.max(30, Math.min(baseDistance, 100)); // 30m - 100m
    
    console.log(`✅ Minimum distance calculated: ${minDistance}m (base: ${baseDistance.toFixed(0)}m) - TP range: 20m`);
    return Math.round(minDistance);
  }
}

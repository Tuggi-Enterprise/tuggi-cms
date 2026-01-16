// Core principal do Trigger Point Predictor

import { POIData, TriggerPoint, TriggerPointCandidate, GeographicContext, BoundaryData, DirectionalAnalysis } from '../types/interfaces.ts';
import { POIGroup } from '../config/trigger-points-config.ts';
import { GeographicContextAnalyzer } from './geographic-analyzer.ts';
import { BoundaryDetector } from './boundary-detector.ts';
import { StreetAnalyzer } from '../analyzers/street-analyzer.ts';
import { OptimalPointCalculator } from '../analyzers/point-calculator.ts';
import { TriggerPointValidator } from '../analyzers/validator.ts';
import { loadTriggerPointsConfig } from '../config/trigger-points-config.ts';
import { GoogleAPIsService } from '../services/google-apis.service.ts';
import { calculateDistance } from '../utils/calculations.ts';
import { POIClassifierService, POIClassification } from '../services/poi-classifier.service.ts';

/**
 * Orquestrador principal da geração de trigger points
 */
export class CoreTriggerPointPredictor {
  private googleAPIs: GoogleAPIsService;
  private geographicAnalyzer: GeographicContextAnalyzer;
  private boundaryDetector: BoundaryDetector;
  private streetAnalyzer: StreetAnalyzer;
  private pointCalculator: OptimalPointCalculator;
  private validator: TriggerPointValidator;
  private poiClassifier: POIClassifierService;

  constructor() {
    this.googleAPIs = new GoogleAPIsService();
    this.geographicAnalyzer = new GeographicContextAnalyzer();
    this.boundaryDetector = new BoundaryDetector(this.googleAPIs);
    this.streetAnalyzer = new StreetAnalyzer(this.googleAPIs);
    this.pointCalculator = new OptimalPointCalculator();
    this.validator = new TriggerPointValidator(this.googleAPIs);
    this.poiClassifier = new POIClassifierService();
  }

  /**
   * Processo completo de predição de trigger points
   * Este é o método principal que deve ser chamado pela API
   */
  async predictTriggerPointsComplete(
    poiData: POIData, 
    options: { 
      maxPoints?: number, 
      minDistance?: number,
      forceRegenerate?: boolean
    } = {}
  ): Promise<{
    triggerPoints: TriggerPoint[];
    boundary: BoundaryData;
    context: GeographicContext; 
    metadata: {
      processingTime: number;
      method: string;
      version: string;
      poiGroup?: POIClassification; // ✅ Adicionado para retorno
      directionalAnalysis?: DirectionalAnalysis[]; // ✅ Adicionado para debug
    }
  }> {
    const startTime = Date.now();
    console.log(`🚀 Starting trigger point generation for: ${poiData.name}`);

    try {
      // 1. Carregar configurações
      const config = loadTriggerPointsConfig();

      // 2. Detectar Boundary (Limites do POI)
      const boundary = await this.boundaryDetector.detectBoundary(poiData);
      
      // 3. Analisar Contexto Geográfico
      const context = await this.geographicAnalyzer.analyzeContext(poiData, boundary);
      
      // 4. Classificar POI (NOVO)
      const classification = await this.poiClassifier.classifyPOI(
        poiData, 
        boundary.height,
        boundary.elevation ? { center: boundary.elevation.center } : undefined,
        boundary.area,
        context,
        boundary.osmTags
      );
      
      // Atualizar boundary e contexto com classificação
      boundary.classification = classification;
      
      console.log(`🏷️ POI Classified as: ${classification.group} (${classification.strategy})`);
      
      // 5. Encontrar Candidatos em Ruas
      const streetCandidates = await this.streetAnalyzer.findAccessibleStreets(
        poiData, 
        boundary, 
        context
      );
      
      // 6. Calcular Pontos Ótimos
      // 6. Calcular Pontos Ótimos
      const rawCandidates = await this.pointCalculator.calculateOptimalPoints(
        poiData,
        streetCandidates,
        boundary,
        context
      );

      // 7. Validar e Rankear Pontos
      // O Validator agora inclui análise direcional e verificação de visibilidade
      
      // 7a. Executar análise direcional primeiro (opcional, para debug/visualização)
      const directionalAnalysis = await this.validator.analyzeDirectionalVisibility(
        poiData, 
        boundary, 
        context,
        streetCandidates.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i) // Ruas únicas
      );
      
      const finalTriggerPoints = await this.validator.validateAndRankPoints(
        rawCandidates,
        poiData,
        context,
        boundary,
        options.maxPoints || classification.maxTriggerPoints, // Usar config da classe se não sobrescrito
        options.minDistance || classification.minDistanceBetweenTPs, // Usar config da classe se não sobrescrito
        directionalAnalysis // Passar análise direcional para validador
      );

      // 8.Fallback se nenhum ponto for encontrado
      if (finalTriggerPoints.length === 0) {
        console.warn('⚠️ No trigger points found via main algorithm. Using fallback.');
        const fallbackPoints = this.generateFallbackPoints(poiData, boundary);
        return {
          triggerPoints: fallbackPoints,
          boundary,
          context,
          metadata: {
            processingTime: Date.now() - startTime,
            method: 'fallback_circular',
            version: '2.0.0',
            poiGroup: classification,
            directionalAnalysis
          }
        };
      }

      console.log(`✅ Generated ${finalTriggerPoints.length} trigger points in ${Date.now() - startTime}ms`);

      return {
        triggerPoints: finalTriggerPoints,
        boundary,
        context,
        metadata: {
          processingTime: Date.now() - startTime,
          method: 'comprehensive_v2',
          version: '2.0.0',
          poiGroup: classification,
          directionalAnalysis
        }
      };

    } catch (error) {
      console.error('❌ Critical error in trigger point generation:', error);
      throw error;
    }
  }

  /**
   * Gera pontos de fallback (círculo simples) quando tudo falha
   */
  private generateFallbackPoints(poiData: POIData, boundary: BoundaryData): TriggerPoint[] {
    const points: TriggerPoint[] = [];
    const radius = 80; // 80m fallback radius
    
    // Gerar 3 pontos em triângulo
    for (let i = 0; i < 3; i++) {
        const angle = (i * 120) * (Math.PI / 180);
        // Aproximação simples
        const lat = poiData.location.lat + (radius / 111320) * Math.cos(angle);
        const lng = poiData.location.lng + (radius / (111320 * Math.cos(poiData.location.lat * (Math.PI / 180)))) * Math.sin(angle);
        
        points.push({
            id: `fallback_${i}`,
            location: { lat, lng },
            radius: 40,
            expectedBearing: (angle * (180 / Math.PI) + 180) % 360, // Apontando para o centro
            bearingThreshold: 120, // Ângulo amplo para fallback
            type: 'fallback',
            priority: 99,
            confidence: 0.3,
            quality: 0.3,
            street: { id: 'fallback', name: 'Fallback Virtual Street', type: 'virtual', coordinates: [], accessibility: 'public', confidence: 0 },
            distance: radius,
            generationMethod: 'fallback',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
    }
    
    return points;
  }
}

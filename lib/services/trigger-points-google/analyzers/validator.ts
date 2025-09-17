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
    console.log(`✅ Validating and ranking ${candidates.length} trigger point candidates`);
    console.log(`🎯 Max TPs: ${maxTriggerPoints}, Min distance: ${minDistanceBetweenTPs}m`);
    
    try {
      // Filtrar candidatos válidos (básico)
      const basicValidCandidates = candidates.filter(candidate => 
        this.isValidCandidate(candidate, poiData, context)
      );
      
      console.log(`📊 ${basicValidCandidates.length} candidates passed basic validation`);
      
      // VALIDAÇÃO DE VISIBILIDADE (TEMPORARIAMENTE DESABILITADA)
      console.log(`⚠️ Visibility validation temporarily disabled to preserve boundary detection`);
      const visibilityValidCandidates = basicValidCandidates; // Skip visibility validation for now
      
      console.log(`👁️ ${visibilityValidCandidates.length} candidates (visibility check skipped)`);
      
      // Ordenar por qualidade (melhores primeiro)
      const rankedCandidates = visibilityValidCandidates.sort((a, b) => b.quality - a.quality);
      
      // NOVA LÓGICA: Seleção com distância mínima
      const selectedTriggerPoints = this.selectTriggerPointsWithMinDistance(
        rankedCandidates, 
        maxTriggerPoints, 
        minDistanceBetweenTPs,
        context
      );
      
      console.log(`🎯 Selected ${selectedTriggerPoints.length} trigger points with optimal spacing`);
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
        console.log(`🚫 TP rejected (too close): ${candidate.location.lat.toFixed(6)}, ${candidate.location.lng.toFixed(6)} - Quality: ${candidate.quality.toFixed(3)}`);
        continue;
      }
      
      // Candidato aprovado - converter para TriggerPoint
      const triggerPoint = this.convertToTriggerPoint(candidate, selectedTPs.length, context);
      selectedTPs.push(triggerPoint);
      
      console.log(`✅ TP selected: ${triggerPoint.location.lat.toFixed(6)}, ${triggerPoint.location.lng.toFixed(6)} - Quality: ${triggerPoint.quality.toFixed(3)}`);
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
   * Verifica se um candidato é válido
   */
  private isValidCandidate(
    candidate: TriggerPointCandidate, 
    poiData: POIData, 
    context: GeographicContext
  ): boolean {
    // Verificar qualidade mínima
    if (candidate.quality < 0.3) {
      return false;
    }
    
    // Verificar distância máxima
    if (candidate.distance > 1000) {
      return false;
    }
    
    // Verificar acessibilidade
    if (!this.isAccessible(candidate.location, context)) {
      return false;
    }
    
    // Verificar confiança mínima
    if (candidate.confidence < 0.2) {
      return false;
    }
    
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

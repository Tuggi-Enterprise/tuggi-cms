/**
 * 🎯 POI CLASSIFIER SERVICE
 * =========================
 * 
 * Classifica POIs em 4 GRUPOS UNIVERSAIS baseados em características físicas:
 * 1. 🏔️ HIGH: Alta elevação + qualquer altura (visível de longe)
 * 2. 🏗️ MEDIUM: Baixa elevação + estrutura alta (torres, edifícios isolados)
 * 3. 🏙️ CANYON: Baixa elevação + estrutura média + área densa (visibilidade restrita)
 * 4. 🏞️ FLAT: Baixa elevação + estrutura baixa (visibilidade local)
 * 
 * NÃO classifica por tipo de POI (stadium, park, etc.) - apenas por física!
 */

import { BoundaryData, GeographicContext, POIData } from '../types/interfaces';
import { POIGroup, GROUP_CONFIGS } from '../config/trigger-points-config';
import { ElevationAnalysisService } from './elevation-service';

export interface POIClassification {
  group: POIGroup;
  strategy: 'circular' | 'linear' | 'standard';
  searchRadius: number;
  maxTriggerPoints: number;
  minDistanceBetweenTPs: number;
  visibilityThreshold: number;
  streetPriority: string[];
  blockStreets: string[];
  metadata: {
    height: number;
    elevation: number;
    elevationDiff: number;
    area: number;
    urbanDensity: string;
    reasoning: string;
  };
}

export class POIClassifierService {
  
  /**
   * Classifica um POI em um dos 4 grupos universais
   * Baseado em: Elevação × Altura × Densidade × Área
   */
  async classifyPOI(
    poiData: POIData,
    poiHeight: number | undefined,
    poiElevation: { center: number } | undefined,
    area: number,
    context: GeographicContext,
    osmTags?: any
  ): Promise<POIClassification> {
    // ====================================================================
    // ✅ PRIORIDADE 0: VERIFICAR CATEGORIA OSM (SIMPLICIDADE MÁXIMA)
    // ====================================================================
    // Se POI tem categoria OSM de pico/montanha, classificar como HIGH imediatamente
    // Não precisa calcular densidade ou elevationDiff - já sabemos que é alto
    // ====================================================================
    
    const isHighElevationPOIByCategory = this.checkHighElevationCategory(poiData, osmTags);
    
    if (isHighElevationPOIByCategory) {
      //console.log(`🏔️ [HIGH GROUP] High elevation POI detected by OSM category (peak/mountain/volcano)`);
      //console.log(`   → Category already indicates HIGH - skipping density calculation`);
      //console.log(`   → Visible from long distances due to natural elevation`);
      
      // Usar elevação se disponível, senão usar valor padrão baseado em categoria
      const effectiveElevation = poiElevation?.center || 800; // Default para peaks
      const effectiveElevationDiff = poiElevation?.center ? 
        (await this.calculateElevationDiff(poiData, poiElevation, context)) : 200; // Default 200m diff
      
      const config = GROUP_CONFIGS[POIGroup.HIGH];
      // 🛡️ PROTEÇÃO: elevationDiff pode ser negativo se baseElevation > center (evitar NaN no sqrt)
      const safeElevationDiff = Math.max(0, effectiveElevationDiff);
      const theoreticalRange = Math.sqrt(safeElevationDiff) * 200;
      const calculatedRange = Math.max(theoreticalRange, config.searchRadius.min!);
      const finalRadius = Math.min(calculatedRange, config.searchRadius.max!);
      
      //console.log(`   → Radius: ${finalRadius.toFixed(0)}m (category-based: peak/mountain)`);
      
      return {
        group: POIGroup.HIGH,
        strategy: config.strategy,
        searchRadius: Math.round(finalRadius),
        maxTriggerPoints: config.maxTriggerPoints,
        minDistanceBetweenTPs: config.minDistanceBetweenTPs,
        visibilityThreshold: config.visibilityThreshold,
        streetPriority: config.streetPriority,
        blockStreets: config.blockStreets,
        metadata: {
          height: poiHeight || 0,
          elevation: effectiveElevation,
          elevationDiff: effectiveElevationDiff,
          area,
          urbanDensity: context.urbanDensity.level,
          reasoning: `HIGH: OSM category indicates peak/mountain/volcano (visible from long distances)`
        }
      };
    }
    
    // PASSO 1: Calcular métricas base
    let elevationDiff = 0;
    let baseElevation: number | null = null;
    
    // ✅ PRIORIDADE 1: ELEVAÇÃO - Se temos dados de elevação, calcular elevationDiff
    if (poiElevation && poiElevation.center > 0) {
      baseElevation = await ElevationAnalysisService.estimateRegionalBaseElevation(
        { lat: poiData.location.lat, lng: poiData.location.lng },
        context,
        poiData
      );
      elevationDiff = poiElevation.center - baseElevation;
      
    } else {
      console.warn(`⚠️ [NO ELEVATION DATA]: Cannot calculate elevation difference`);
    }
    
    const height = poiHeight || 0;
    
    // PASSO 2: Classificar altura do POI
    const isHighStructure = height > 50;      // Torre, edifício alto
    const isMediumStructure = height >= 10 && height <= 50; // Edifício médio
    const isLowStructure = height < 10;       // Baixo ou sem altura
    
    // PASSO 3: Classificar elevação
    // ✅ PRIORIDADE MÁXIMA: Elevação > 150m = HIGH (independente de densidade)
    // ✅ TAMBÉM: Se POI tem elevação absoluta muito alta (>800m) E altura significativa (>0m),
    //    considerar HIGH mesmo que elevationDiff não seja > 150m (pode ser erro no baseElevation)
    const isHighElevation = elevationDiff > 150; // Pico, montanha
    const isVeryHighAbsoluteElevation = (poiElevation?.center || 0) > 800 && height > 0; // Pico absoluto alto
    const isLowElevation = elevationDiff <= 150 && !isVeryHighAbsoluteElevation;
    const isVeryLowElevation = elevationDiff <= 50;
    
    // PASSO 4: Classificar densidade (usado apenas para CANYON e MEDIUM, NÃO para HIGH)
    const isDenseArea = 
      context.urbanDensity.level === 'very_dense' || 
      context.urbanDensity.level === 'dense';
    
    // PASSO 5: Classificar área
    const isLargeArea = area > 50000;
    
    // ====================================================================
    // GRUPO 1: HIGH - PRIORIDADE MÁXIMA (ELEVAÇÃO > DENSIDADE)
    // ====================================================================
    // Critérios: ALTA elevação + QUALQUER altura
    // Exemplos: Pico do Jaraguá, Cristo Redentor, Pão de Açúcar
    // Lógica: Se está em local alto, é visível de longe independente da altura
    // ✅ IMPORTANTE: Elevação tem PRIORIDADE sobre densidade (rural não impede HIGH)
    // ✅ TAMBÉM: POIs com elevação absoluta muito alta (>800m) são HIGH mesmo se elevationDiff < 150m
    // ====================================================================
    
    if (isHighElevation || isVeryHighAbsoluteElevation) {
      const reason = isHighElevation 
        ? `elevation diff: ${elevationDiff.toFixed(1)}m` 
        : `absolute elevation: ${poiElevation?.center || 0}m (very high peak)`;
      
      //console.log(`🏔️ [HIGH GROUP] High elevation POI detected (${reason})`);
      //console.log(`   → Elevation has PRIORITY over density (${context.urbanDensity.level})`);
      //console.log(`   → Visible from long distances due to elevation, regardless of urban density`);
      
      // Usar elevationDiff se disponível, senão usar elevação absoluta como proxy
      const effectiveElevationDiff = isHighElevation ? elevationDiff : Math.max((poiElevation?.center || 0) - 500, 200);
      const config = GROUP_CONFIGS[POIGroup.HIGH];
      
      // 🛡️ PROTEÇÃO: elevationDiff pode ser negativo se baseElevation > center (evitar NaN no sqrt)
      const safeElevationDiff = Math.max(0, effectiveElevationDiff);
      const theoreticalRange = Math.sqrt(safeElevationDiff) * 200;
      const calculatedRange = Math.max(theoreticalRange, config.searchRadius.min!);
      const finalRadius = Math.min(calculatedRange, config.searchRadius.max!);
      
      
      return {
        group: POIGroup.HIGH,
        strategy: config.strategy,
        searchRadius: Math.round(finalRadius),
        maxTriggerPoints: config.maxTriggerPoints,
        minDistanceBetweenTPs: config.minDistanceBetweenTPs,
        visibilityThreshold: config.visibilityThreshold,
        streetPriority: config.streetPriority,
        blockStreets: config.blockStreets,
        metadata: {
          height,
          elevation: poiElevation?.center || 0,
          elevationDiff: isHighElevation ? elevationDiff : effectiveElevationDiff,
          area,
          urbanDensity: context.urbanDensity.level,
          reasoning: isHighElevation 
            ? `HIGH: Elevation diff ${elevationDiff.toFixed(0)}m (visible from long distances)`
            : `HIGH: Absolute elevation ${poiElevation?.center || 0}m (very high peak, visible from long distances)`
        }
      };
    }
    
    // ====================================================================
    // GRUPO 3: CANYON (MOVED UP - CHECK BEFORE MEDIUM)
    // ====================================================================
    // Critérios: BAIXA elevação + (MÉDIA altura OU ALTA altura em área densa) + ÁREA DENSA + área pequena/média
    // Exemplos: Edifício Copan, prédios em centros urbanos densos
    // Lógica: POI médio/alto cercado por outros prédios similares, visibilidade muito limitada
    // ====================================================================
    
    // 🔍 DEBUG: Log detalhado para diagnóstico
    if (isLowElevation && (isMediumStructure || (isHighStructure && isDenseArea)) && isDenseArea && !isLargeArea) {
      const config = GROUP_CONFIGS[POIGroup.CANYON];
      
      return {
        group: POIGroup.CANYON,
        strategy: config.strategy,
        searchRadius: config.searchRadius.fixed!,
        maxTriggerPoints: config.maxTriggerPoints,
        minDistanceBetweenTPs: config.minDistanceBetweenTPs,
        visibilityThreshold: config.visibilityThreshold,
        streetPriority: config.streetPriority,
        blockStreets: config.blockStreets,
        metadata: {
          height,
          elevation: poiElevation?.center || 0,
          elevationDiff,
          area,
          urbanDensity: context.urbanDensity.level,
          reasoning: `CANYON: ${isHighStructure && isDenseArea ? 'Tall' : 'Medium'} structure ${height}m in ${context.urbanDensity.level} area (urban canyon effect)`
        }
      };
    }
    
    // ====================================================================
    // GRUPO 2: MEDIUM
    // ====================================================================
    // Critérios: BAIXA elevação + ALTA altura (>50m) + ÁREA NÃO DENSA
    // Exemplos: Torre Eiffel, Sagrada Família, Edifício Itália (se isolado)
    // Lógica: POI alto mas no nível do chão, visível de média distância
    // ====================================================================
    
    if (isLowElevation && isHighStructure && !isDenseArea) {
      const config = GROUP_CONFIGS[POIGroup.MEDIUM];
      const calculatedRadius = height * 15;  // altura × 15
      const finalRadius = Math.max(
        config.searchRadius.min!,
        Math.min(calculatedRadius, config.searchRadius.max!)
      );
      
      
      return {
        group: POIGroup.MEDIUM,
        strategy: config.strategy,
        searchRadius: Math.round(finalRadius),
        maxTriggerPoints: config.maxTriggerPoints,
        minDistanceBetweenTPs: config.minDistanceBetweenTPs,
        visibilityThreshold: config.visibilityThreshold,
        streetPriority: config.streetPriority,
        blockStreets: config.blockStreets,
        metadata: {
          height,
          elevation: poiElevation?.center || 0,
          elevationDiff,
          area,
          urbanDensity: context.urbanDensity.level,
          reasoning: `MEDIUM: Tall structure ${height}m at ground level (visible from medium distances)`
        }
      };
    }
    
    
    // ====================================================================
    // GRUPO 4: FLAT
    // ====================================================================
    // Critérios: 
    // - BAIXA elevação + BAIXA altura (<10m)
    // - OU BAIXA elevação + MÉDIA altura em área NÃO densa
    // - OU MUITO BAIXA elevação + área grande (parques)
    // Exemplos: Parque Ibirapuera, praças, monumentos baixos, estádios
    // Lógica: POI baixo ou médio sem obstruções, visibilidade limitada à vizinhança
    // ====================================================================
    
    const config = GROUP_CONFIGS[POIGroup.FLAT];
    
    let reasoning: string;
    if (isLowStructure) {
      reasoning = `FLAT: Low structure ${height}m (visibility limited to surroundings)`;
    } else if (isMediumStructure && !isDenseArea) {
      reasoning = `FLAT: Medium structure ${height}m in non-dense area (visibility limited to surroundings)`;
    } else if (isVeryLowElevation && isLargeArea) {
      reasoning = `FLAT: Large flat area ${area.toFixed(0)}m² with low elevation (visibility limited to surroundings)`;
    } else {
      reasoning = `FLAT: Default classification (low elevation ${elevationDiff.toFixed(0)}m, height ${height}m)`;
    }
    
    
    return {
      group: POIGroup.FLAT,
      strategy: config.strategy,
      searchRadius: config.searchRadius.fixed!,
      maxTriggerPoints: config.maxTriggerPoints,
      minDistanceBetweenTPs: config.minDistanceBetweenTPs,
      visibilityThreshold: config.visibilityThreshold,
      streetPriority: config.streetPriority,
      blockStreets: config.blockStreets,
      metadata: {
        height,
        elevation: poiElevation?.center || 0,
        elevationDiff,
        area,
        urbanDensity: context.urbanDensity.level,
        reasoning
      }
    };
  }
  
  /**
   * Verifica se POI tem categoria OSM que indica alta elevação (peak, mountain, volcano)
   * SIMPLICIDADE: Se tem essa categoria, já sabemos que é HIGH
   */
  private checkHighElevationCategory(poiData: POIData, osmTags?: any): boolean {
    // 1. Verificar no nome do POI (já detectado no boundary-detector)
    const nameLower = poiData.name.toLowerCase();
    const isPeakInName = nameLower.includes('pico') ||
                        nameLower.includes('morro') ||
                        nameLower.includes('cristo') ||
                        nameLower.includes('mountain') ||
                        nameLower.includes('montanha') ||
                        nameLower.includes('peak') ||
                        nameLower.includes('volcano') ||
                        nameLower.includes('vulcão');
    
    if (isPeakInName) {
      console.log(`🏔️ Peak/mountain detected in POI name: "${poiData.name}"`);
      return true;
    }
    
    // 2. Verificar tags OSM
    if (!osmTags) {
      return false;
    }
    
    // Verificar tags comuns de peaks/mountains
    const highElevationTags = [
      'natural=peak',
      'natural=mountain',
      'natural=volcano',
      'natural=mountain_range',
      'type=peak',
      'class=peak',
      'place=mountain',
      'tourism=peak',
      'tourism=mountain'
    ];
    
    // Verificar se alguma tag corresponde
    for (const [key, value] of Object.entries(osmTags)) {
      const tagString = `${key}=${value}`.toLowerCase();
      
      if (highElevationTags.some(tag => tagString.includes(tag.toLowerCase()))) {
        console.log(`🏔️ High elevation category detected in OSM tags: ${key}=${value}`);
        return true;
      }
      
      // Verificar valores específicos
      if (key === 'natural' && (value === 'peak' || value === 'mountain' || value === 'volcano')) {
        console.log(`🏔️ High elevation category detected in OSM tags: natural=${value}`);
        return true;
      }
      
      if (key === 'type' && value === 'peak') {
        console.log(`🏔️ High elevation category detected in OSM tags: type=${value}`);
        return true;
      }
      
      if (key === 'class' && value === 'peak') {
        console.log(`🏔️ High elevation category detected in OSM tags: class=${value}`);
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Calcula elevationDiff (helper para evitar duplicação)
   */
  private async calculateElevationDiff(
    poiData: POIData,
    poiElevation: { center: number },
    context: GeographicContext
  ): Promise<number> {
    const baseElevation = await ElevationAnalysisService.estimateRegionalBaseElevation(
      { lat: poiData.location.lat, lng: poiData.location.lng },
      context,
      poiData
    );
    return poiElevation.center - baseElevation;
  }
}

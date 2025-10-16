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
    console.log(`🎯 [CLASSIFICATION] Starting POI classification for: ${poiData.name}`);
    
    // PASSO 1: Calcular métricas base
    let elevationDiff = 0;
    if (poiElevation && poiElevation.center > 0) {
      const baseElevation = await ElevationAnalysisService.estimateRegionalBaseElevation(
        { lat: poiData.location.lat, lng: poiData.location.lng },
        context,
        poiData
      );
      elevationDiff = poiElevation.center - baseElevation;
    }
    
    const height = poiHeight || 0;
    
    console.log(`📊 [METRICS]:`);
    console.log(`   Height: ${height}m`);
    console.log(`   Elevation: ${poiElevation?.center || 0}m`);
    console.log(`   Elevation diff: ${elevationDiff.toFixed(1)}m`);
    console.log(`   Area: ${area.toFixed(0)}m²`);
    console.log(`   Density: ${context.urbanDensity.level}`);
    
    // PASSO 2: Classificar altura do POI
    const isHighStructure = height > 50;      // Torre, edifício alto
    const isMediumStructure = height >= 10 && height <= 50; // Edifício médio
    const isLowStructure = height < 10;       // Baixo ou sem altura
    
    // PASSO 3: Classificar elevação
    const isHighElevation = elevationDiff > 150; // Pico, montanha
    const isLowElevation = elevationDiff <= 150;
    const isVeryLowElevation = elevationDiff <= 50;
    
    // PASSO 4: Classificar densidade
    const isDenseArea = 
      context.urbanDensity.level === 'very_dense' || 
      context.urbanDensity.level === 'dense';
    
    // PASSO 5: Classificar área
    const isLargeArea = area > 50000;
    
    console.log(`📊 [CLASSIFICATION MATRIX]:`);
    console.log(`   Elevation: ${isHighElevation ? 'HIGH' : 'LOW'} (${elevationDiff.toFixed(0)}m)`);
    console.log(`   Height: ${isHighStructure ? 'HIGH' : isMediumStructure ? 'MEDIUM' : 'LOW'} (${height}m)`);
    console.log(`   Density: ${isDenseArea ? 'DENSE' : 'NORMAL'} (${context.urbanDensity.level})`);
    console.log(`   Area: ${isLargeArea ? 'LARGE' : 'NORMAL'} (${area.toFixed(0)}m²)`);
    
    // ====================================================================
    // GRUPO 1: HIGH
    // ====================================================================
    // Critérios: ALTA elevação + QUALQUER altura
    // Exemplos: Pico do Jaraguá, Cristo Redentor, Pão de Açúcar
    // Lógica: Se está em local alto, é visível de longe independente da altura
    // ====================================================================
    
    if (isHighElevation) {
      const config = GROUP_CONFIGS[POIGroup.HIGH];
      const theoreticalRange = Math.sqrt(elevationDiff) * 200;
      const calculatedRange = Math.max(theoreticalRange, config.searchRadius.min!);
      const finalRadius = Math.min(calculatedRange, config.searchRadius.max!);
      
      console.log(`🏔️ [HIGH GROUP] High elevation POI`);
      console.log(`   → Visible from long distances due to elevation`);
      console.log(`   → Radius: ${finalRadius.toFixed(0)}m (elevation-based: √${elevationDiff.toFixed(0)} × 200)`);
      
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
          elevationDiff,
          area,
          urbanDensity: context.urbanDensity.level,
          reasoning: `HIGH: Elevation diff ${elevationDiff.toFixed(0)}m (visible from long distances)`
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
    
    if (isLowElevation && (isMediumStructure || (isHighStructure && isDenseArea)) && isDenseArea && !isLargeArea) {
      const config = GROUP_CONFIGS[POIGroup.CANYON];
      
      console.log(`🏙️ [CANYON GROUP] ${isHighStructure && isDenseArea ? 'Tall' : 'Medium'} structure in dense urban area`);
      console.log(`   → Visibility heavily restricted by surrounding buildings`);
      console.log(`   → Radius: ${config.searchRadius.fixed}m (limited by urban canyon effect)`);
      
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
      
      console.log(`🏗️ [MEDIUM GROUP] Tall structure at ground level`);
      console.log(`   → Visible from medium distances due to height`);
      console.log(`   → Radius: ${finalRadius.toFixed(0)}m (height-based: ${height}m × 15)`);
      
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
    
    console.log(`🏞️ [FLAT GROUP] ${reasoning}`);
    console.log(`   → Radius: ${config.searchRadius.fixed}m (flat POI characteristics)`);
    
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
}

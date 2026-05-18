// Analisador de ruas acessíveis usando Google Roads API

import { GoogleAPIsService } from '../services/google-apis.service';
import { POIData, BoundaryData, GeographicContext, StreetData } from '../types/interfaces';
import { calculateDistance, isPointInPolygon, extractBuildingHeight, calculateBearing, calculateDistanceToLineSegment, calculateDistanceToPolygon, calculateDistanceToBoundary, findClosestPointOnBoundary } from '../utils/calculations';
import { ElevationAnalysisService } from '../services/elevation-service';
import { loadTriggerPointsConfig, TriggerPointsConfig, TRIGGER_POINTS_CONSTANTS, POIGroup } from '../config/trigger-points-config';
import { LRUCacheWithTTL } from '../utils/lru-cache';

export class StreetAnalyzer {
  private googleAPIs: GoogleAPIsService;

  // ✅ LRU cache: max 1000 entries, TTL 30min. Antes era Map<{data, timestamp}>
  // ilimitado com TTL manual.
  private static surroundingHeightCache = new LRUCacheWithTTL<
    string,
    { average: number; max: number; buildingCount: number; tallBuildingsCount?: number }
  >(1000, 30 * 60 * 1000);
  
  constructor() {
    this.googleAPIs = new GoogleAPIsService();
  }
  
  /**
   * 🔄 RETRY COM BACKOFF EXPONENCIAL para queries OSM (QUALIDADE > VELOCIDADE)
   * Retry até conseguir os dados necessários, não continua sem eles.
   * Agora usa MÚLTIPLOS MIRRORS para evitar rate limiting (429/504).
   */
  private async retryOSMQuery(
    query: string,
    description: string,
    maxRetries: number = 7,
    initialDelay: number = 2000 // 2 segundos inicial
  ): Promise<Response> {
    // Lista de mirrors do Overpass API para resiliência
    const mirrors = [
      'https://overpass-api.de/api/interpreter',
      'https://lz4.overpass-api.de/api/interpreter',
      'https://z.overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass.osm.ch/api/interpreter',
      'https://overpass.be/api/interpreter',
      'https://overpass-api.enit.it/api/interpreter'
    ];
    
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Rotacionar mirror a cada tentativa
      const mirror = mirrors[(attempt - 1) % mirrors.length];
      
      try {
        const timeout = 30000; // 30s timeout por tentativa
        const response = await fetch(mirror, {
          method: 'POST',
          body: query,
          headers: { 
            'Content-Type': 'text/plain',
            'User-Agent': 'TuggiCMS/1.0 (trigger-points-generation)'
          },
          signal: AbortSignal.timeout(timeout)
        });
        
        if (response.ok) {
          return response;
        }
        
        console.warn(`⚠️ [RETRY ${attempt}/${maxRetries}] ${description} failed (mirror: ${new URL(mirror).hostname}): ${response.status}`);
        
        lastError = new Error(`OSM query failed: ${response.status}`);
        
        // Se não for a última tentativa, aguardar antes de retry com backoff + jitter
        if (attempt < maxRetries) {
          // Backoff exponencial: 2s, 4s, 8s... + jitter de até 1s
          const jitter = Math.random() * 1000;
          const delay = (initialDelay * Math.pow(2, attempt - 1)) + jitter;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(`⚠️ [RETRY ${attempt}/${maxRetries}] ${description} error (mirror: ${new URL(mirror).hostname}):`, lastError.message);
        
        if (attempt < maxRetries) {
          const jitter = Math.random() * 1000;
          const delay = (initialDelay * Math.pow(2, attempt - 1)) + jitter;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // Se chegou aqui, todas as tentativas falharam
    console.error(`❌ [RETRY FAILED] ${description} failed after ${maxRetries} attempts across multiple mirrors`);
    throw lastError || new Error(`OSM query failed after ${maxRetries} attempts`);
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
      
      // Filtrar ruas acessíveis
      const accessibleStreets = roads.filter(road => 
        this.isStreetAccessible(road, context)
      );
      
      // NOVO: Para Urban Canyon, usar análise de quarteirão para identificar front/side/back streets
      const isUrbanCanyon = this.isUrbanCanyon(boundary, context);
      if (isUrbanCanyon && boundary.buildings && boundary.buildings.length > 0) {
        const blockAnalysis = this.analyzeBlockStructure(
          boundary.center,
          accessibleStreets,
          boundary.buildings,
          boundary
        );
        
        // Filtrar apenas front/side streets (sem buildings bloqueando)
        const validStreets = blockAnalysis
          .filter(result => result.classification === 'front' || result.classification === 'side')
          .map(result => result.street);
        
        if (validStreets.length > 0) {
          const streetPoints = validStreets.map(street => 
            this.findClosestPointToBoundary(street, boundary)
          );
          return streetPoints;
        } else {
        }
      }
      
      // Calcular pontos mais próximos ao boundary
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
   * Versão que retorna metadados para visualização no frontend
   */
  async findAccessibleStreetsWithMetadata(
    poiData: POIData,
    boundary: BoundaryData,
    context: GeographicContext
  ): Promise<{ streets: StreetData[]; searchRadius: number; elevationAnalysis?: any }> {
    try {
      // Modo fan: usa o alcance máximo do polígono de visibilidade como raio de busca.
      // Garante que streets dentro do fan são fetchadas (não importa a classificação).
      const fanMax = boundary.visibilityFan?.maxDistanceM;
      const categoricalRadius = await this.calculateIntelligentRadius(boundary, context, poiData);
      const searchRadius = fanMax && fanMax > categoricalRadius
        ? Math.ceil(fanMax + 100) // pequena margem
        : categoricalRadius;

      if (fanMax) {
        console.log(`🔭 Street search radius driven by visibility fan: ${searchRadius}m (fan max ${fanMax}m, categorical ${categoricalRadius}m)`);
      }

      const roads = await this.getRoadsAroundBoundary(boundary, searchRadius, context);
      
      if (roads.length === 0) {
        console.error(`❌ [CRITICAL] getRoadsAroundBoundary returned 0 roads despite ${boundary.streets?.length || 0} consolidated streets`);
      }
      
      // Filtrar ruas acessíveis
      const accessibleStreets = roads.filter(road => 
        this.isStreetAccessible(road, context)
      );
      
      // Calcular pontos mais próximos ao boundary
      const streetPoints = accessibleStreets.map(street => 
        this.findClosestPointToBoundary(street, boundary)
      );

      // Coletar dados de elevação para o frontend
      let elevationAnalysis;
      if (boundary.elevation) {
        elevationAnalysis = await ElevationAnalysisService.analyzeElevationDifference(
          boundary.elevation.center,
          boundary.center,
          context,
          poiData
        );
      }
      
      if (streetPoints.length === 0 && roads.length > 0) {
        console.error(`❌ [CRITICAL] ${roads.length} roads found but 0 street points after processing`);
        console.error(`   → Check: filterStreetPointsByRadius and isStreetAccessible filters`);
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
  
  /**
   * Calcula raio de busca inteligente baseado em elevação, altura e contexto
   * Implementa a lógica DINÂMICA do sistema legado usando dados reais de elevação
   */
  private async calculateIntelligentRadius(boundary: BoundaryData, context: GeographicContext, poiData: POIData, config?: TriggerPointsConfig): Promise<number> {
    // ✅ REGRA CONSERVADORA: POIs sem dados de elevação ou desconhecidos no OSM
    // Ser conservador: melhor range menor do que TPs muito longe
    const hasElevationData = boundary.elevation && boundary.elevation.center > 0;
    // POI é desconhecido se: boundary é manual (ou manual_drawing) E OSM não identificou
    const isManualBoundary = boundary.source === 'manual' || boundary.source === 'manual_drawing';
    const isUnknownPOI = isManualBoundary && boundary.osmIdentified === false;
    
    if (!hasElevationData || isUnknownPOI) {
      const conservativeRadius = 150; // Range conservador: 150m máximo (regras FLAT)
      return conservativeRadius;
    }
    
    // 🎯 STEP 0: PRIORIDADE MÁXIMA - Usar classificação do boundary se disponível (SSOT)
    // A classificação já foi calculada no boundary-detector e deve ser respeitada
    if (boundary.classification && boundary.classification.searchRadius) {
      const classificationRadius = boundary.classification.searchRadius;
      const classificationGroup = boundary.classification.group;
      
      // 🏙️ CANYON: Raio muito limitado (visibilidade muito restrita)
      if (classificationGroup === 'canyon') {
        const baseCanyonRadius = classificationRadius;
        
        // Para POIs muito altos (>100m) em canyon, permitir pequeno aumento, mas máximo 100m
        let canyonRadius = baseCanyonRadius;
        if (boundary.height && boundary.height > 100) {
          const heightAdjustment = Math.min((boundary.height - 100) * 0.3, 25);
          canyonRadius = Math.min(baseCanyonRadius + heightAdjustment, 100);
        }
        
        return canyonRadius;
      }
      
      // Para outros grupos (HIGH, MEDIUM, FLAT), usar o raio da classificação diretamente
      return classificationRadius;
    }
    
    // 🏙️ FALLBACK: Se não há classificação, verificar CANYON manualmente (para compatibilidade)
    if (boundary.classification?.group === 'canyon') {
      const baseCanyonRadius = boundary.classification.searchRadius || 75;
      
      let canyonRadius = baseCanyonRadius;
      if (boundary.height && boundary.height > 100) {
        const heightAdjustment = Math.min((boundary.height - 100) * 0.3, 25);
        canyonRadius = Math.min(baseCanyonRadius + heightAdjustment, 100);
      } else {
      }
      return canyonRadius;
    }
    
    // 🏔️ STEP 1: Check if this is a high-visibility POI using REAL elevation data (DYNAMIC LOGIC)
    if (boundary.elevation && boundary.elevation.center > 0) {
      const poiElevation = boundary.elevation.center;
      const baseElevation = await ElevationAnalysisService.estimateRegionalBaseElevation(boundary.center, context, poiData);
      const elevationDiff = poiElevation - baseElevation;
      
      
      // 🏔️ Apply dynamic formula for high-visibility landmarks (>150m difference)
      // ✅ PRIORIDADE MÁXIMA: Este cálculo dinâmico tem precedência sobre qualquer outro
      if (elevationDiff > 150) {
        const theoreticalRange = Math.sqrt(elevationDiff) * 200; // Fórmula dinâmica
        // 🎯 SEM LIMITES ARTIFICIAIS: Apenas mínimo de 3km e máximo de 15km (Cristo Redentor até Copacabana ~8km)
        const calculatedRange = Math.max(theoreticalRange, 3000); // Mínimo 3km
        const maxRange = Math.min(calculatedRange, 15000); // Máximo 15km (limite físico de visibilidade)
        
        
        return Math.round(maxRange);
      }
      
      // 🏞️ NOVA LÓGICA: POIs FLAT (baixa elevação) - usar configuração do grupo
      // 🆕 CORRIGIDO: Usar raio da configuração do grupo ao invés de valor hardcoded
      if (elevationDiff <= 50 && boundary.classification?.group === 'flat') {
        const flatRadius = boundary.classification.searchRadius || 120; // Usar da configuração, fallback 120m
        return flatRadius;
      }
      // Moderate elevation bonus for smaller differences
      else if (elevationDiff > 50) {
        const elevationBonus = elevationDiff * 8; // 8m radius per meter of elevation
        // Continue with normal calculation but add elevation bonus later
      }
    }
    
    // Carregar configuração
    const cfg = config || loadTriggerPointsConfig();
    
    let baseRadius = cfg.searchRadius.baseRadius[context.urbanDensity.level];
    
    
    // 2. NOVO: Ajuste por elevação absoluta e relativa do POI
    if (boundary.elevation) {
      const poiElevation = boundary.elevation.center;
      const elevationDiff = boundary.elevation.center - boundary.elevation.average;
      
      // Para POIs EXTREMAMENTE altos (>1000m), usar fórmula agressiva para picos/montanhas
      if (poiElevation > 1000) {
        const extremeAltitudeBonus = Math.min((poiElevation - 1000) * 10 + 2000, 4000); // 10m raio por metro acima de 1000m + 2000m base, max 4000m
        baseRadius += extremeAltitudeBonus;
      }
      // Para POIs muito altos (>800m), usar elevação absoluta (picos, montanhas)
      else if (poiElevation > 800) {
        const highAltitudeBonus = Math.min((poiElevation - 800) * 6 + 1200, 2500); // 6m raio por metro acima de 800m + 1200m base, max 2500m
        baseRadius += highAltitudeBonus;
      }
      // Para POIs moderadamente altos (>400m), usar elevação absoluta moderada
      else if (poiElevation > 400) {
        const moderateAltitudeBonus = Math.min((poiElevation - 400) * 2, 800);
        baseRadius += moderateAltitudeBonus;
      }
      
      // Ajuste adicional por elevação relativa (diferença interna do POI)
      if (elevationDiff > 50) {
        // POI muito acima da média interna - visível de longe
        const elevationBonus = Math.min(elevationDiff * 8, 400); // Max 400m bonus
        baseRadius += elevationBonus;
      } else if (elevationDiff > 20) {
        // POI moderadamente acima da média interna
        const elevationBonus = elevationDiff * 5;
        baseRadius += elevationBonus;
      } else if (elevationDiff < -20) {
        // POI abaixo da média interna - menos visível
        const elevationPenalty = Math.abs(elevationDiff) * TRIGGER_POINTS_CONSTANTS.ratios.elevationPenalty;
        baseRadius = Math.max(baseRadius - elevationPenalty, TRIGGER_POINTS_CONSTANTS.ratios.elevationPenaltyMin); // Mínimo configurável
        console.log(`🕳️ Low elevation penalty: POI is ${Math.abs(elevationDiff).toFixed(1)}m below internal average → -${elevationPenalty.toFixed(0)}m radius`);
      }
      
      // Terreno muito variado = maior raio (melhor visibilidade de pontos altos)
      const elevationRange = boundary.elevation.max - boundary.elevation.min;
      if (elevationRange > 100) {
        const terrainBonus = Math.min(elevationRange * 2, 200);
        baseRadius += terrainBonus;
        console.log(`🗻 Varied terrain bonus: ${elevationRange.toFixed(1)}m range → +${terrainBonus.toFixed(0)}m radius`);
      }
    }
    
    // 3. NOVO: Ajuste por altura da construção/POI
    if (boundary.height && boundary.height > 10) {
      const heightBonus = Math.min(boundary.height * TRIGGER_POINTS_CONSTANTS.ratios.heightMultiplier, TRIGGER_POINTS_CONSTANTS.ratios.heightMultiplierMax); // Multiplicador configurável
      baseRadius += heightBonus;
      console.log(`🏢 Height bonus: ${boundary.height}m tall → +${heightBonus.toFixed(0)}m radius`);
    }

    // 3.5. NOVO: Ajuste por altura RELATIVA aos prédios vizinhos (LÓGICA MATEMÁTICA PURA)
    // Em áreas densas, SEMPRE analisar altura relativa, independente da altura do POI
    const isDenseArea = context.urbanDensity.level === 'very_dense' || context.urbanDensity.level === 'dense';
    const shouldAnalyzeRelativeHeight = isDenseArea || (boundary.height && boundary.height > 10);
    
    if (shouldAnalyzeRelativeHeight) {
      try {
        console.log(`🏙️ Analyzing relative height: ${isDenseArea ? 'dense area' : 'tall POI'} (${boundary.height || 'no height'}m)`);
        
        // Buscar altura dos prédios ao redor com raio dinâmico baseado na altura do POI
        const poiHeight = boundary.height || 0;
        let analysisRadius = TRIGGER_POINTS_CONSTANTS.distances.surroundingHeightsRadius; // 800m base
        
        // Raio dinâmico: POIs muito altos precisam de raio maior para capturar prédios similares
        if (poiHeight > 100) {
          analysisRadius = 1500; // Raio máximo para POIs muito altos (m)
          console.log(`🏗️ Using extended radius (${analysisRadius}m) for very tall POI (${poiHeight}m)`);
        } else if (poiHeight > 50) {
          analysisRadius = Math.min(1200, TRIGGER_POINTS_CONSTANTS.distances.surroundingHeightsRadius * 1.5); // 1200m para POIs altos
          console.log(`🏢 Using increased radius (${analysisRadius}m) for tall POI (${poiHeight}m)`);
        }
        
        const surroundingHeights = await Promise.race([
          this.calculateSurroundingBuildingsHeight(boundary.center, analysisRadius),
          new Promise<{ average: number; max: number; buildingCount: number }>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 15000) // Timeout configurável (QUALIDADE > PERFORMANCE)
          )
        ]);
        
        // ✅ SALVAR OS DADOS NO BOUNDARY PARA USO NA VALIDAÇÃO DE CANYON
        boundary.surroundingHeight = surroundingHeights;
        console.log(`✅ Saved surrounding height data to boundary: ${surroundingHeights.buildingCount} buildings, avg ${surroundingHeights.average}m`);
        
        if (surroundingHeights.buildingCount > 5) {
          // Calcular diferença relativa
          const poiHeight = boundary.height || 0; // Se não tem altura, considerar 0
          console.log(`🔍 DEBUG: boundary.height: ${boundary.height}, poiHeight: ${poiHeight}, type: ${typeof boundary.height}`);
          const heightDifference = poiHeight - surroundingHeights.average;
          
          if (isDenseArea) {
            // EM ÁREAS DENSAS: Lógica ajustada para POIs muito altos
            if (heightDifference > 100) {
              // POI EXTREMAMENTE alto (landmarks como Sagrada Família) → raio generoso
              const relativeRadius = Math.min(heightDifference * cfg.searchRadius.heightMultipliers.extremely_tall.multiplier, cfg.searchRadius.heightMultipliers.extremely_tall.maxRadius);
              baseRadius = Math.max(relativeRadius, cfg.searchRadius.heightMultipliers.extremely_tall.minRadius);
              console.log(`🏗️ DENSE AREA: POI EXTREMELY tall landmark: ${poiHeight}m vs avg ${surroundingHeights.average}m → radius ${baseRadius}m`);
            } else if (heightDifference > 50) {
              // POI MUITO mais alto que vizinhos → raio baseado na diferença
              const relativeRadius = Math.min(heightDifference * cfg.searchRadius.heightMultipliers.very_tall.multiplier, cfg.searchRadius.heightMultipliers.very_tall.maxRadius);
              baseRadius = Math.max(relativeRadius, cfg.searchRadius.heightMultipliers.very_tall.minRadius);
              console.log(`🏢 DENSE AREA: POI VERY tall relative to surroundings: ${poiHeight}m vs avg ${surroundingHeights.average}m → radius ${baseRadius}m`);
            } else if (heightDifference > 20) {
              // POI moderadamente mais alto → raio moderado
              const relativeRadius = Math.min(heightDifference * cfg.searchRadius.heightMultipliers.tall.multiplier, cfg.searchRadius.heightMultipliers.tall.maxRadius);
              baseRadius = Math.max(relativeRadius, cfg.searchRadius.heightMultipliers.tall.minRadius);
              console.log(`🏗️ DENSE AREA: POI tall relative to surroundings: ${poiHeight}m vs avg ${surroundingHeights.average}m → radius ${baseRadius}m`);
            } else if (heightDifference > 0) {
              // POI ligeiramente mais alto → raio conservador
              const relativeRadius = Math.min(heightDifference * cfg.searchRadius.heightMultipliers.medium.multiplier, cfg.searchRadius.heightMultipliers.medium.maxRadius);
              baseRadius = Math.max(relativeRadius, cfg.searchRadius.heightMultipliers.medium.minRadius);
              console.log(`🏙️ DENSE AREA: POI slightly tall relative to surroundings: ${poiHeight}m vs avg ${surroundingHeights.average}m → radius ${baseRadius}m`);
            } else {
              // POI igual ou menor que vizinhos → raio pequeno
              baseRadius = Math.max(30, 20 + Math.abs(heightDifference) * 0.5); // 20-30m base + 0.5m por metro de diferença
              console.log(`🏘️ DENSE AREA: POI lower than surroundings: ${poiHeight}m vs avg ${surroundingHeights.average}m → radius ${baseRadius}m`);
            }
          } else {
            // EM ÁREAS NÃO DENSAS: Lógica original (bonus/penalty)
            if (heightDifference > 50) {
              const relativeBonus = Math.min(heightDifference * 4, 600);
              baseRadius += relativeBonus;
              console.log(`🏢 POI VERY tall relative to surroundings: ${poiHeight}m vs avg ${surroundingHeights.average}m → +${relativeBonus}m radius`);
            } else if (heightDifference > 20) {
              const relativeBonus = heightDifference * 2;
              baseRadius += relativeBonus;
              console.log(`🏗️ POI tall relative to surroundings: ${poiHeight}m vs avg ${surroundingHeights.average}m → +${relativeBonus}m radius`);
            } else if (heightDifference < -20) {
              const penalty = Math.abs(heightDifference) * 2;
              baseRadius = Math.max(baseRadius - penalty, 150);
              console.log(`🏘️ POI lower than surroundings: ${poiHeight}m vs avg ${surroundingHeights.average}m → -${penalty}m radius`);
            } else {
              console.log(`🏙️ POI similar height to surroundings: ${poiHeight}m vs avg ${surroundingHeights.average}m → no adjustment`);
            }
          }
        } else {
          console.log(`⚠️ Insufficient surrounding height data (${surroundingHeights.buildingCount} buildings), using fallback`);
          if (isDenseArea) {
            // Em áreas densas, usar raio conservador se não tem dados de altura
            baseRadius = Math.min(baseRadius, 150);
            console.log(`🏙️ DENSE AREA: No height data, using conservative radius: ${baseRadius}m`);
          }
        }
      } catch (error) {
        console.warn(`⚠️ Failed to analyze surrounding buildings height: ${error instanceof Error ? error.message : String(error)}, using fallback`);
        if (isDenseArea) {
          // Em áreas densas, usar raio conservador se falhar
          baseRadius = Math.min(baseRadius, 150);
          console.log(`🏙️ DENSE AREA: Analysis failed, using conservative radius: ${baseRadius}m`);
        }
      }
    }
    
    // 4. Ajuste por tipo de terreno (elevação)
    if (context.elevationContext.type === 'mountainous') {
      baseRadius *= 1.4; // Montanhas = visibilidade maior
      console.log(`⛰️ Mountainous terrain multiplier: x1.4`);
    } else if (context.elevationContext.type === 'hilly') {
      baseRadius *= 1.2;
      console.log(`🏔️ Hilly terrain multiplier: x1.2`);
    }
    
    // 5. Limites de segurança
    const minRadius = cfg.searchRadius.limits.min;
    const maxRadius = cfg.searchRadius.limits.max;
    const finalRadius = Math.max(minRadius, Math.min(baseRadius, maxRadius));
    
    console.log(`✅ Intelligent radius calculated: ${finalRadius.toFixed(0)}m (base: ${baseRadius.toFixed(0)}m)`);
    
    return Math.round(finalRadius);
  }

  /**
   * Estima a elevação base da região usando dados de contexto e heurísticas
   * Substitui a lista hardcoded de landmarks por lógica dinâmica
   */

  // ✅ DRY: calculateDistance removido - usar função importada de utils/calculations.ts
  
  /**
   * Busca ruas ao redor do boundary do POI (ESTRATÉGIA HÍBRIDA para POIs grandes)
   * ✅ CORREÇÃO ESTRUTURAL: Garante que todas as ruas retornadas respeitam o searchRadius
   */
  private async getRoadsAroundBoundary(boundary: BoundaryData, searchRadius: number, context?: GeographicContext): Promise<StreetData[]> {
    console.log(`🗺️ [getRoadsAroundBoundary] Boundary: ${boundary.coordinates.length} points, radius: ${searchRadius}m`);
    console.log(`📊 [INPUT] boundary.streets: ${boundary.streets?.length || 0} consolidated streets`);
    
    try {
      // 🚀 ESTRATÉGIA: usar streets consolidadas + EXPANDIR se o searchRadius
      // pedido for maior que o raio coberto durante detecção do boundary.
      //
      // Crítico para o modo visibility-driven: o fan pode dizer "POI visível a
      // 3km" mas `boundary.streets` só tem ruas no raio inicial (500m). Sem
      // re-fetch, FAN-WALK roda só com as 39 streets do quarteirão e perde
      // todas as ruas no entorno expandido.
      if (boundary.streets && boundary.streets.length > 0) {
        let streets = boundary.streets;

        // Quando o fan está ativo, SEMPRE buscar streets usando amostragem ao
        // longo do boundary. A `boundary.streets` consolidada veio da detecção
        // inicial (bbox ~600m centrada no PIN do POI), o que enviesa cobertura
        // pro lado do pin em boundaries grandes/assimétricos. O fetch ao longo
        // do boundary distribui os bboxes uniformemente pelo perímetro real.
        //
        // Estratégia: N pontos amostrados ao longo do perímetro × raio fan
        // por ponto = cobertura proporcional ao tamanho real do POI E à
        // visibilidade física.
        const fanActive = !!boundary.visibilityFan?.polygons?.length;
        if (fanActive) {
          console.log(`🔭 [EXTEND] Fan active → fetching streets along boundary (searchRadius=${searchRadius}m, bypassing pin-bias from initial fetch)`);
          try {
            const { LocalOSMFetcher } = require('../services/local-osm-fetcher');
            const fetcher = LocalOSMFetcher.getInstance();

            // Raio por sample-point = distância máxima de visibilidade do fan.
            //
            // Crítico: para POIs altos (Cristo, Jaraguá), o boundary é pequeno
            // mas a visibilidade vai a quilômetros. O fan já calculou a real
            // distância máxima visível considerando altura+terreno+prédios.
            // Usar isso como raio garante:
            //  - Cristo: 1 sample point × fan.max=10km → cobre Botafogo, Copa
            //  - Queensboro: 8 sample points × fan.max=5km → cobre Manhattan + Queens
            //  - Pier 97: 1 sample × fan.max=100m → cobre só o entorno (correto)
            //
            // Cap em 4km por sample-point para limitar carga em SP/NY denso.
            const fanMaxM = boundary.visibilityFan?.maxDistanceM ?? searchRadius;
            const radiusPerPoint = Math.max(300, Math.min(fanMaxM, 4000));
            console.log(`🔭 [EXTEND] Using radiusPerPoint=${radiusPerPoint}m (fan max=${fanMaxM}m)`);

            const extended = fetcher.fetchStreetsAlongBoundary(
              boundary.coordinates,
              radiusPerPoint
            );

            if (extended && extended.length > 0) {
              const seen = new Set(streets.map(s => String(s.id)));
              const additional = extended.filter((s: any) => !seen.has(String(s.id)));
              streets = [...streets, ...additional];
              console.log(`✅ [EXTEND] Added ${additional.length} streets sampled along boundary (total: ${streets.length})`);
            } else {
              console.log(`⚠️ [EXTEND] No additional streets found along boundary`);
            }
          } catch (err) {
            console.warn(`⚠️ [EXTEND] Failed to fetch streets along boundary:`, err);
          }
        }

        // Memory cap: pra POIs em áreas hiper-densas (Manhattan, parques grandes),
        // streets podem chegar a 12k+ entradas. Sort por distância ao boundary
        // center e mantém top-N. Streets longe-do-POI raramente são candidatos
        // a TP relevante. SSOT do limite em TRIGGER_POINTS_CONSTANTS.memory.
        const MAX_STREETS = TRIGGER_POINTS_CONSTANTS.memory.maxStreetsPerPOI;
        if (streets.length > MAX_STREETS) {
          const poiCenter = boundary.center;
          const distanceToCenter = (s: any): number => {
            if (!s.coordinates || s.coordinates.length === 0) return Infinity;
            // Usa o ponto mais próximo do center pra avaliar (não primeiro vertex)
            let minD = Infinity;
            for (const p of s.coordinates) {
              const d = calculateDistance(poiCenter, p);
              if (d < minD) minD = d;
            }
            return minD;
          };
          streets = streets
            .map(s => ({ s, d: distanceToCenter(s) }))
            .sort((a, b) => a.d - b.d)
            .slice(0, MAX_STREETS)
            .map(x => x.s);
          console.log(`🧠 Memory cap: trimmed streets to ${MAX_STREETS} closest to POI center`);
        }

        console.log(`✅ [STRATEGY] Using ${streets.length} streets (consolidated + any extensions)`);
        console.log(`🔍 [FILTER] Filtering ${streets.length} streets by radius ${searchRadius}m...`);

        // ✅ CRÍTICO: Filtrar ruas consolidadas pelo raio também (podem ter sido criadas com raio maior)
        const filtered = this.filterStreetPointsByRadius(streets, boundary, searchRadius);
        console.log(`✅ [RESULT] After filtering: ${filtered.length} streets within ${searchRadius}m radius (from ${streets.length} input)`);
        
        if (filtered.length === 0 && boundary.streets.length > 0) {
          console.error(`❌ [CRITICAL] All ${boundary.streets.length} consolidated streets were rejected by filterStreetPointsByRadius`);
          console.error(`   → searchRadius: ${searchRadius}m`);
          console.error(`   → Check: Are streets too far from boundary?`);
        }
        
        return filtered;
      }
      
      // 🚀 ESTRATÉGIA INTELIGENTE: Usar dados do Nominatim + ruas virtuais
      if (boundary.coordinates.length > 100) {
        console.log(`🏗️ [STRATEGY] Large POI (${boundary.coordinates.length} points) - checking for urban canyon`);
        
        // 1. Detectar se é canyon urbano (POI alto em área densa)
        const isUrbanCanyon = context ? this.isUrbanCanyon(boundary, context) : false;
        
        if (isUrbanCanyon && context) {
          console.log(`🏙️ [STRATEGY] Urban canyon detected - using OSM query`);
          try {
            const osmStreets = await this.getStreetsFromOSMOptimizedBoundary(boundary, searchRadius);
            if (osmStreets && osmStreets.length > 0) {
              console.log(`✅ [RESULT] Found ${osmStreets.length} streets via OSM`);
              return osmStreets;
            }
          } catch (error) {
            console.warn(`⚠️ [FALLBACK] OSM query failed, using Nominatim:`, error);
          }
        }
        
        // Fallback: Criar ruas reais dos dados do Nominatim
        const nominatimStreets = this.createRealStreetsFromNominatimData(boundary);
        console.log(`✅ [FALLBACK] Created ${nominatimStreets.length} streets from Nominatim`);
        return this.filterStreetPointsByRadius(nominatimStreets, boundary, searchRadius);
      }
      
      // Para boundaries médios (50-100 pontos), tentar Nominatim primeiro, depois OSM como fallback
      if (boundary.coordinates.length > 50) {
        console.log(`⚡ [STRATEGY] Medium POI (${boundary.coordinates.length} points) - trying Nominatim first`);
        const nominatimStreets = this.createRealStreetsFromNominatimData(boundary);
        console.log(`✅ [RESULT] Created ${nominatimStreets.length} streets from Nominatim`);
        
        // ✅ FALLBACK: Se Nominatim não retornou ruas, buscar via OSM
        if (nominatimStreets.length === 0) {
          console.log(`🔄 [FALLBACK] No streets from Nominatim, trying OSM query...`);
          try {
            const osmStreets = await this.getStreetsFromOSMOptimizedBoundary(boundary, searchRadius);
            if (osmStreets && osmStreets.length > 0) {
              console.log(`✅ [FALLBACK] Found ${osmStreets.length} streets via OSM`);
              return this.filterStreetPointsByRadius(osmStreets, boundary, searchRadius);
            }
          } catch (error) {
            console.warn(`⚠️ [FALLBACK] OSM query failed:`, error);
          }
        }
        
        return this.filterStreetPointsByRadius(nominatimStreets, boundary, searchRadius);
      }
      
      // Para boundaries pequenos, tentar Nominatim primeiro, depois OSM como fallback
      console.log(`🎯 [STRATEGY] Small POI (${boundary.coordinates.length} points) - trying Nominatim first`);
      const nominatimStreets = this.createRealStreetsFromNominatimData(boundary);
      console.log(`✅ [RESULT] Created ${nominatimStreets.length} streets from Nominatim`);
      
      // ✅ FALLBACK: Se Nominatim não retornou ruas, buscar via OSM
      if (nominatimStreets.length === 0) {
        console.log(`🔄 [FALLBACK] No streets from Nominatim, trying OSM query...`);
        try {
          const osmStreets = await this.getStreetsFromOSMOptimizedBoundary(boundary, searchRadius);
          if (osmStreets && osmStreets.length > 0) {
            console.log(`✅ [FALLBACK] Found ${osmStreets.length} streets via OSM`);
            return this.filterStreetPointsByRadius(osmStreets, boundary, searchRadius);
          }
        } catch (error) {
          console.warn(`⚠️ [FALLBACK] OSM query failed:`, error);
        }
      }
      
      return this.filterStreetPointsByRadius(nominatimStreets, boundary, searchRadius);
      
    } catch (error) {
      console.error('❌ [ERROR] Finding roads around boundary:', error);
      console.log(`🔄 [FALLBACK] Trying Nominatim first...`);
      const nominatimStreets = this.createRealStreetsFromNominatimData(boundary);
      console.log(`✅ [RESULT] Created ${nominatimStreets.length} streets from Nominatim (fallback)`);
      
      // ✅ FALLBACK FINAL: Se Nominatim não retornou ruas, buscar via OSM
      if (nominatimStreets.length === 0) {
        console.log(`🔄 [FALLBACK FINAL] No streets from Nominatim, trying OSM query...`);
        try {
          const osmStreets = await this.getStreetsFromOSMOptimizedBoundary(boundary, searchRadius);
          if (osmStreets && osmStreets.length > 0) {
            console.log(`✅ [FALLBACK FINAL] Found ${osmStreets.length} streets via OSM`);
            return this.filterStreetPointsByRadius(osmStreets, boundary, searchRadius);
          }
        } catch (osmError) {
          console.warn(`⚠️ [FALLBACK FINAL] OSM query also failed:`, osmError);
        }
      }
      
      return this.filterStreetPointsByRadius(nominatimStreets, boundary, searchRadius);
    }
  }
  
  /**
   * ✅ NOVA FUNÇÃO: Filtra PONTOS das ruas pelo raio de busca
   * Garante que apenas pontos dentro do raio sejam mantidos
   */
  private filterStreetPointsByRadius(
    streets: StreetData[],
    boundary: BoundaryData,
    searchRadius: number
  ): StreetData[] {
    if (!streets || streets.length === 0) {
      console.log(`🔍 [filterStreetPointsByRadius] No streets to filter`);
      return streets;
    }
    if (!boundary.coordinates || boundary.coordinates.length === 0) {
      console.log(`🔍 [filterStreetPointsByRadius] No boundary coordinates, returning all streets`);
      return streets;
    }
    
    const maxAllowedDistance = searchRadius + 20; // Margem de 20m
    const filtered: StreetData[] = [];
    let approvedCount = 0;
    let rejectedCount = 0;
    const rejectionReasons: { reason: string; count: number }[] = [];
    
    console.log(`🔍 [filterStreetPointsByRadius] Filtering ${streets.length} streets by radius ${searchRadius}m (max: ${maxAllowedDistance}m)`);
    
    for (const street of streets) {
      if (!street.coordinates || street.coordinates.length === 0) {
        rejectedCount++;
        continue;
      }
      
      // Filtrar pontos pelo raio
      const validPoints: Array<{ lat: number; lng: number }> = [];
      let minDistanceToBoundary = Infinity;
      let pointsInsideBoundary = 0;
      
      for (const point of street.coordinates) {
        // Ignorar pontos dentro do boundary
        if (isPointInPolygon(point, boundary.coordinates)) {
          pointsInsideBoundary++;
          continue;
        }
        
        // Calcular distância ao boundary
        const distanceToBoundary = calculateDistanceToPolygon(point, boundary.coordinates);
        minDistanceToBoundary = Math.min(minDistanceToBoundary, distanceToBoundary);
        
        if (distanceToBoundary <= maxAllowedDistance) {
          validPoints.push(point);
        }
      }
      
      // ✅ REGRA: Aprovar ruas que têm pelo menos 1 ponto válido dentro do raio
      if (validPoints.length >= 1) {
        const pointsToUse = validPoints.length >= 2 
          ? validPoints 
          : [validPoints[0], validPoints[0]]; // Duplicar ponto para manter formato de segmento
        
        filtered.push({
          ...street,
          coordinates: pointsToUse
        });
        approvedCount++;
      } else {
        rejectedCount++;
        let reason = '';
        if (pointsInsideBoundary === street.coordinates.length) {
          reason = `all points inside boundary`;
        } else if (minDistanceToBoundary !== Infinity) {
          reason = `closest point ${minDistanceToBoundary.toFixed(0)}m (max: ${maxAllowedDistance.toFixed(0)}m)`;
        } else {
          reason = `no valid points`;
        }
        
        // Agrupar razões de rejeição
        const existingReason = rejectionReasons.find(r => r.reason === reason);
        if (existingReason) {
          existingReason.count++;
        } else {
          rejectionReasons.push({ reason, count: 1 });
        }
      }
    }
    
    // Log resumido
    console.log(`📊 [filterStreetPointsByRadius] Result: ${approvedCount} approved, ${rejectedCount} rejected (from ${streets.length} total)`);
    
    if (rejectedCount > 0 && rejectedCount <= 10) {
      // Mostrar detalhes das primeiras 10 rejeições
      console.log(`   Rejection reasons: ${rejectionReasons.map(r => `${r.reason} (${r.count}x)`).join(', ')}`);
    } else if (rejectedCount > 10) {
      // Mostrar apenas resumo para muitas rejeições
      console.log(`   Top rejection reasons: ${rejectionReasons.slice(0, 3).map(r => `${r.reason} (${r.count}x)`).join(', ')}`);
    }
    
    if (filtered.length === 0 && streets.length > 0) {
      console.error(`❌ [CRITICAL] All ${streets.length} streets were rejected by radius filter`);
      console.error(`   → searchRadius: ${searchRadius}m, maxAllowed: ${maxAllowedDistance}m`);
      console.error(`   → Check: Are streets too far from boundary?`);
    }
    
    return filtered;
  }
  
  // ✅ DRY: calculateDistanceToBoundary removido - usar função importada de utils/calculations.ts
  
  /**
   * Calcula distância de um ponto a um segmento de linha
   */
  private distancePointToLineSegment(point: { lat: number; lng: number }, lineStart: { lat: number; lng: number }, lineEnd: { lat: number; lng: number }): number {
    const A = point.lat - lineStart.lat;
    const B = point.lng - lineStart.lng;
    const C = lineEnd.lat - lineStart.lat;
    const D = lineEnd.lng - lineStart.lng;
    
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    
    if (lenSq === 0) {
      // Linha é um ponto
      return Math.sqrt(A * A + B * B) * 111000; // Converter para metros
    }
    
    let param = dot / lenSq;
    
    let xx, yy;
    
    if (param < 0) {
      xx = lineStart.lat;
      yy = lineStart.lng;
    } else if (param > 1) {
      xx = lineEnd.lat;
      yy = lineEnd.lng;
    } else {
      xx = lineStart.lat + param * C;
      yy = lineStart.lng + param * D;
    }
    
    const dx = point.lat - xx;
    const dy = point.lng - yy;
    return Math.sqrt(dx * dx + dy * dy) * 111000; // Converter para metros
  }

  /**
   * Cria ruas reais baseadas nos dados do Nominatim (DINÂMICO E GENÉRICO - MÚLTIPLAS RUAS)
   */
  private createRealStreetsFromNominatimData(boundary: BoundaryData): StreetData[] {
    const streets: StreetData[] = [];
    
    try {
      // 1. Verificar se temos dados de endereço do Nominatim
      if (!boundary.address?.street) {
        console.log(`⚠️ No street address found in Nominatim data, skipping real street creation`);
        return streets;
      }
      
      // 2. NOVO: Criar ruas para todas as ruas encontradas
      const allStreets = boundary.address.allStreets || [boundary.address.street];
      console.log(`🏠 Creating real streets from Nominatim data: ${allStreets.length} streets found`);
      
      for (let i = 0; i < allStreets.length; i++) {
        const streetName = allStreets[i];
        console.log(`🏠 Creating real street ${i + 1}/${allStreets.length}: "${streetName}"`);
        
        // 3. Gerar coordenadas da rua baseadas no boundary
        const streetCoordinates = this.generateStreetCoordinatesFromBoundary(boundary, streetName);
        
        if (streetCoordinates.length >= 2) {
          streets.push({
            id: `nominatim_street_${streetName.toLowerCase().replace(/\s+/g, '_')}`,
            name: streetName,
            type: 'residential',
            coordinates: streetCoordinates,
            accessibility: 'public',
            confidence: 0.9 // Alta confiança - dados reais do Nominatim
          });
          
          console.log(`✅ Created real street: "${streetName}" with ${streetCoordinates.length} coordinates`);
        } else {
          console.log(`⚠️ Could not generate valid coordinates for street: "${streetName}"`);
        }
      }
      
    } catch (error) {
      console.warn(`❌ Failed to create real streets from Nominatim data:`, error);
    }
    
    return streets;
  }
  
  /**
   * Gera coordenadas de rua baseadas no boundary (DINÂMICO)
   */
  private generateStreetCoordinatesFromBoundary(boundary: BoundaryData, streetName: string): Array<{ lat: number; lng: number }> {
    try {
      if (!boundary.coordinates || boundary.coordinates.length < 3) {
        return [];
      }
      
      // 1. Encontrar o lado do boundary mais próximo de uma rua principal
      const streetSide = this.findBestStreetSide(boundary);
      
      if (!streetSide) {
        console.log(`⚠️ Could not determine best street side for: "${streetName}"`);
        return [];
      }
      
      // 2. Criar segmento de rua paralelo ao lado do boundary
      const streetCoordinates = this.createParallelStreetSegment(streetSide, boundary.center, boundary);
      
      console.log(`📍 Generated ${streetCoordinates.length} coordinates for street: "${streetName}"`);
      return streetCoordinates;
      
    } catch (error) {
      console.warn(`❌ Failed to generate street coordinates:`, error);
      return [];
    }
  }
  
  /**
   * Encontra o melhor lado do boundary para criar a rua (DINÂMICO)
   */
  private findBestStreetSide(boundary: BoundaryData): { start: { lat: number; lng: number }; end: { lat: number; lng: number } } | null {
    try {
      if (!boundary.coordinates || boundary.coordinates.length < 4) {
        return null;
      }
      
      // Estratégia: Encontrar o lado mais longo (provavelmente a fachada principal)
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
      
      console.log(`📏 Found longest boundary side: ${maxLength.toFixed(1)}m`);
      return longestSide;
      
    } catch (error) {
      console.warn(`❌ Failed to find best street side:`, error);
      return null;
    }
  }
  
  /**
   * Cria segmento de rua paralelo ao lado do boundary (DINÂMICO)
   */
  private createParallelStreetSegment(
    boundarySide: { start: { lat: number; lng: number }; end: { lat: number; lng: number } },
    center: { lat: number; lng: number },
    boundary: BoundaryData
  ): Array<{ lat: number; lng: number }> {
    try {
      // 1. Calcular direção do lado do boundary
      const dx = boundarySide.end.lng - boundarySide.start.lng;
      const dy = boundarySide.end.lat - boundarySide.start.lat;
      const length = Math.sqrt(dx * dx + dy * dy);
      
      if (length === 0) {
        return [];
      }
      
      // 2. Calcular offset perpendicular (distância da rua ao boundary)
      const offsetDistance = TRIGGER_POINTS_CONSTANTS.distances.realStreetBoundaryOffset;
      const offsetLat = (dx / length) * (offsetDistance / 111000); // Aproximação
      const offsetLng = (dy / length) * (offsetDistance / (111000 * Math.cos(center.lat * Math.PI / 180)));
      
      // 3. Criar pontos da rua paralelos ao boundary
      const streetStart = {
        lat: boundarySide.start.lat + offsetLat,
        lng: boundarySide.start.lng + offsetLng
      };
      
      const streetEnd = {
        lat: boundarySide.end.lat + offsetLat,
        lng: boundarySide.end.lng + offsetLng
      };
      
      // 4. Validar se os pontos estão fora do boundary (CORRIGIDO: usar distância real ao boundary)
      const streetCoordinates = [streetStart, streetEnd];
      const validCoordinates = streetCoordinates.filter(coord => {
        // CORRIGIDO: Calcular distância real ao boundary, não ao centro
        const distanceToBoundary = calculateDistanceToBoundary(coord, boundary.coordinates); // ✅ DRY: usar função SSOT
        const isOutside = distanceToBoundary > TRIGGER_POINTS_CONSTANTS.distances.realStreetValidationMargin;
        
        if (!isOutside) {
          console.log(`⚠️ Street point too close to boundary: ${distanceToBoundary.toFixed(1)}m (min required: ${TRIGGER_POINTS_CONSTANTS.distances.realStreetValidationMargin}m)`);
        }
        
        return isOutside;
      });
      
      if (validCoordinates.length < 2) {
        console.log(`⚠️ Not enough valid street coordinates outside boundary (${validCoordinates.length}/2)`);
        return [];
      }
      
      console.log(`✅ Street coordinates validated: ${validCoordinates.length} points outside boundary`);
      return validCoordinates;
      
    } catch (error) {
      console.warn(`❌ Failed to create parallel street segment:`, error);
      return [];
    }
  }
  

  /**
   * Calcula o centro de uma rua (ponto médio)
   */
  private calculateRoadCenter(road: any): { lat: number; lng: number } {
    if (!road.geometry || road.geometry.length === 0) {
      return { lat: 0, lng: 0 };
    }
    
    const midIndex = Math.floor(road.geometry.length / 2);
    return {
      lat: road.geometry[midIndex].lat,
      lng: road.geometry[midIndex].lon
    };
  }


  /**
   * Detecta se um POI está em um canyon urbano
   * Canyon urbano = POI alto em área muito densa, cercado por edifícios altos
   */
  private isUrbanCanyon(boundary: BoundaryData, context: GeographicContext): boolean {
    // Critérios para canyon urbano:
    // 1. POI deve estar em área muito densa
    const isVeryDense = context.urbanDensity.level === 'very_dense';
    
    // 2. POI deve ter altura significativa (>50m)
    const hasSignificantHeight = boundary.height && boundary.height > 50;
    
    // 3. Deve haver dados de prédios ao redor
    const hasSurroundingData = boundary.surroundingHeight && boundary.surroundingHeight.buildingCount > 10;
    
    // 4. POI deve estar significativamente mais alto que a média (landmark)
    const isTallLandmark = boundary.surroundingHeight && 
                           boundary.height && 
                           boundary.height > boundary.surroundingHeight.average * 2;
    
    const isCanyon = !!(isVeryDense && hasSignificantHeight && (hasSurroundingData || isTallLandmark));
    
    if (isCanyon) {
      console.log(`🏙️ Urban canyon detected: very_dense=${isVeryDense}, height=${boundary.height}m, avg_surrounding=${boundary.surroundingHeight?.average}m`);
    }
    
    return isCanyon;
  }

  /**
   * NOVA: Query OSM otimizada para buscar ruas ao redor do boundary
   */
  private async getStreetsFromOSMOptimizedBoundary(boundary: BoundaryData, searchRadius: number): Promise<StreetData[]> {
    try {
      console.log(`🚀 Optimized OSM query for streets around boundary...`);
      
      // ═══════════════════════════════════════════════════════════════
      // ESTRATÉGIA 1: LOCAL OSM DB (primário - sem rede)
      // ═══════════════════════════════════════════════════════════════
      try {
        const { LocalOSMFetcher } = await import('../services/local-osm-fetcher');
        const localStreets = LocalOSMFetcher.getInstance().fetchExtendedStreets(boundary.center, searchRadius);
        if (localStreets && localStreets.length > 0) {
          console.log(`🚀 [LocalOSMFetcher] Found ${localStreets.length} streets locally around boundary`);
          return localStreets;
        }
      } catch (localError) {
        console.warn(`⚠️ [LocalOSMFetcher] Local DB query failed, falling back to Overpass:`, localError);
      }
      
      // ═══════════════════════════════════════════════════════════════
      // ESTRATÉGIA 2: OVERPASS API (fallback - rede)
      // ═══════════════════════════════════════════════════════════════
      
      // Selecionar pontos estratégicos do boundary com cobertura 360° (AUMENTADO para melhor cobertura)
      const strategicPoints = this.selectStrategicBoundaryPoints(boundary.coordinates, 16);
      
      // Criar query OSM combinada e otimizada (MELHORADA para incluir avenidas)
      // RELAXADO: Remover 'private' da exclusão para incluir ruas ao redor de igrejas/monumentos
      const pointQueries = strategicPoints.map(point => 
        `way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|track|service)$"]["access"!~"^(no)$"](around:${searchRadius},${point.lat},${point.lng})`
      ).join(';\n  ');
      
      // Query simplificada para evitar erro 400 (validação será feita no código)
      const query = `
[out:json][timeout:${TRIGGER_POINTS_CONSTANTS.timeouts.osmQueryVeryLong}];
(
  ${pointQueries};
);
out geom tags; // ADICIONAR 'tags' para obter tunnel, bridge, layer, etc
`;
      
      console.log(`📝 OSM Query: ${strategicPoints.length} strategic points, ${searchRadius}m radius`);
      
      const response = await this.retryOSMQuery(
        query,
        'OSM query for streets around boundary',
        7,
        2000
      );
      
      if (!response.ok) {
        throw new Error(`OSM API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.elements || data.elements.length === 0) {
        console.log('⚠️ No streets found via OSM');
        return [];
      }
      
      console.log(`📍 Found ${data.elements.length} street elements from OSM`);
      
      // ✅ CORREÇÃO ESTRUTURAL CRÍTICA: Filtrar PONTOS das ruas pelo raio ANTES de processar
      // PROBLEMA: OSM retorna ruas COMPLETAS (todos os pontos), não apenas segmentos dentro do raio
      // SOLUÇÃO: Filtrar os pontos de cada rua pelo raio de busca (searchRadius)
      // Isso garante que apenas pontos dentro do raio sejam considerados
      
      const streets: StreetData[] = [];
      const maxAllowedDistance = searchRadius + 20; // Margem de 20m para ruas que passam perto do limite
      
      console.log(`🔍 Filtering street POINTS by radius: ${searchRadius}m (max: ${maxAllowedDistance}m)`);
      
      for (const element of data.elements) {
        if (element.type === 'way' && element.geometry && element.geometry.length > 1) {
          const allStreetCoordinates = element.geometry.map((point: any) => ({
            lat: point.lat,
            lng: point.lon
          }));
          
          // ✅ PASSO 1: Filtrar pontos que estão dentro do boundary (não queremos TPs dentro do POI)
          const pointsOutsideBoundary = allStreetCoordinates.filter((coord: {lat: number, lng: number}) => 
            !isPointInPolygon(coord, boundary.coordinates)
          );
          
          if (pointsOutsideBoundary.length === 0) {
            // Rua completamente dentro do boundary - ignorar
            continue;
          }
          
          // ✅ PASSO 2: Filtrar pontos pelo RAIO DE BUSCA (CRÍTICO!)
          // Calcular distância de cada ponto ao boundary e manter apenas os que estão dentro do raio
          const pointsWithinRadius: Array<{ lat: number; lng: number }> = [];
          
          for (const point of pointsOutsideBoundary) {
            const distanceToBoundary = calculateDistanceToPolygon(point, boundary.coordinates); // ✅ DRY: usar função SSOT
            
            if (distanceToBoundary <= maxAllowedDistance) {
              pointsWithinRadius.push(point);
            }
          }
          
          // ✅ PASSO 3: Incluir rua apenas se tem pelo menos 2 pontos válidos (para formar um segmento)
          // E se pelo menos 30% dos pontos originais estão fora do boundary (para avenidas importantes)
          if (pointsWithinRadius.length >= 2 && pointsOutsideBoundary.length > allStreetCoordinates.length * 0.3) {
            const street: StreetData = {
              id: `osm_way_${element.id}`,
              type: this.classifyOSMHighway(element.tags?.highway || 'unknown'),
              name: element.tags?.name || element.tags?.ref || 'Unnamed Street',
              coordinates: pointsWithinRadius, // ✅ USAR APENAS PONTOS DENTRO DO RAIO
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
            
            if (pointsWithinRadius.length < allStreetCoordinates.length) {
              console.log(`✂️ Street ${element.id} (${element.tags?.name || 'unnamed'}): Filtered ${allStreetCoordinates.length - pointsWithinRadius.length} points outside radius (kept ${pointsWithinRadius.length}/${allStreetCoordinates.length})`);
            }
          } else {
            console.log(`🚫 Street ${element.id}: Rejected (${pointsWithinRadius.length} valid points < 2, or mostly inside boundary)`);
          }
        }
      }
      
      console.log(`✅ Processed ${streets.length} streets from OSM (with radius filtering)`);
      return streets;
      
    } catch (error) {
      console.error('Error in optimized OSM street search:', error);
      return [];
    }
  }
  
  /**
   * Converte boundary coordinates para string de polígono OSM
   */
  private boundaryToPolygonString(coordinates: Array<{lat: number, lng: number}>): string {
    return coordinates.map(coord => `${coord.lat} ${coord.lng}`).join(' ');
  }
  
  /**
   * Classifica tipo de highway OSM
   */
  private classifyOSMHighway(highway: string): string {
    const highwayMap: Record<string, string> = {
      'motorway': 'primary',     // Rodovias → Primary (alta prioridade)
      'trunk': 'primary',        // Vias expressas → Primary  
      'primary': 'primary',      // Avenidas principais → Primary
      'secondary': 'secondary',  // Avenidas secundárias → Secondary
      'tertiary': 'tertiary',    // Ruas coletoras → Tertiary
      'residential': 'residential',
      'service': 'service',
      'unclassified': 'residential' // Ruas sem classificação → Residential
    };
    
    return highwayMap[highway] || 'residential';
  }
  
  /**
   * Determina acessibilidade baseado nas tags OSM
   */
  private determineAccessibility(tags: any): 'public' | 'restricted' | 'private' {
    if (!tags) return 'public';
    
    if (tags.access === 'private' || tags.access === 'no') return 'private';
    if (tags.access === 'permissive' || tags.access === 'destination') return 'restricted';
    
    return 'public';
  }
  
  /**
   * 🔴 REMOVED: getRoadsFromGoogleFallback() - M0
   * Manter código comentado para possível re-ativação manual futura
   */
  // private async getRoadsFromGoogleFallback(
  //   boundary: BoundaryData, 
  //   searchRadius: number, 
  //   processedRoads: Set<string>
  // ): Promise<StreetData[]> {
  //   try {
  //     console.log(`🔄 Google Roads fallback...`);
  //     
  //     // Usar pontos estratégicos do boundary para snap to roads
  //     const strategicPoints = this.selectStrategicBoundaryPoints(boundary.coordinates, 6);
  //     const streets: StreetData[] = [];
  //     
  //     for (const point of strategicPoints) {
  //       try {
  //         const response = await this.googleAPIs.getNearestRoads([point]);
  //         
  //         if (response.success && response.data?.snappedPoints) {
  //           for (const snappedPoint of response.data.snappedPoints) {
  //             if (snappedPoint.placeId && !processedRoads.has(snappedPoint.placeId)) {
  //               processedRoads.add(snappedPoint.placeId);
  //               
  //               streets.push({
  //                 id: snappedPoint.placeId,
  //                 type: 'road',
  //                 coordinates: [{ lat: snappedPoint.location.lat, lng: snappedPoint.location.lng }],
  //                 accessibility: 'public',
  //                 confidence: 0.7 // Média confidence para Google fallback
  //               });
  //             }
  //           }
  //         }
  //       } catch (error) {
  //         console.warn(`Failed to get Google roads for point:`, error);
  //       }
  //     }
  //     
  //     console.log(`🔄 Google fallback found ${streets.length} additional roads`);
  //     return streets;
  //     
  //   } catch (error) {
  //     console.error('Error in Google Roads fallback:', error);
  //     return [];
  //   }
  // }
  
  /**
   * Busca ruas nos pontos do boundary (OTIMIZADO - evita queries desnecessárias)
   */
  private createVirtualStreetsFromBoundary(boundary: BoundaryData): StreetData[] {
    const streets: StreetData[] = [];
    
    // Calcular raio mínimo para garantir que as ruas fiquem FORA do boundary
    const boundaryRadius = Math.sqrt(boundary.area_m2 / Math.PI);
    const minDistance = Math.max(boundaryRadius * TRIGGER_POINTS_CONSTANTS.distances.virtualStreetBoundaryOffset, TRIGGER_POINTS_CONSTANTS.distances.virtualStreetMinDistance); // Proporção configurável
    
    // Criar ruas concêntricas FORA do boundary
    const center = boundary.center;
    const outerRadius = boundaryRadius + minDistance;
    
    // Criar círculo de ruas ao redor do POI (fora do boundary)
    const circlePoints = 16; // 16 pontos no círculo
    const circleCoordinates = [];
    
    for (let i = 0; i < circlePoints; i++) {
      const angle = (i * 360) / circlePoints;
      const radians = (angle * Math.PI) / 180;
      const lat = center.lat + (outerRadius / 111000) * Math.cos(radians);
      const lng = center.lng + (outerRadius / (111000 * Math.cos(center.lat * Math.PI / 180))) * Math.sin(radians);
      circleCoordinates.push({ lat, lng });
    }
    
    // Criar segmentos de rua conectando pontos do círculo
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
    
    // Adicionar ruas radiais FORA do boundary (para melhor cobertura)
    const radialStartRadius = outerRadius; // Começar fora do boundary
    const radialEndRadius = outerRadius * 2; // Ir para mais longe
    
    for (let angle = 0; angle < 360; angle += 45) { // 8 direções
      const radians = (angle * Math.PI) / 180;
      
      // Ponto inicial: fora do boundary
      const startLat = center.lat + (radialStartRadius / 111000) * Math.cos(radians);
      const startLng = center.lng + (radialStartRadius / (111000 * Math.cos(center.lat * Math.PI / 180))) * Math.sin(radians);
      
      // Ponto final: mais longe
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
    
    console.log(`🎯 Created ${streets.length} virtual streets outside boundary (radius: ${outerRadius.toFixed(0)}m)`);
    
    // 🔍 LOG DETALHADO: Listar todas as ruas virtuais criadas
    console.log(`🔍 DETAILED VIRTUAL STREETS ANALYSIS:`);
    for (let i = 0; i < streets.length; i++) {
      const street = streets[i];
      console.log(`  ${i + 1}. ID: ${street.id}, Type: ${street.type}, Coordinates: ${street.coordinates.length} points`);
    }
    
    return streets;
  }

  /**
   * Busca ruas na área expandida ao redor do boundary
   */
  private selectStrategicBoundaryPoints(
    coordinates: Array<{lat: number, lng: number}>, 
    maxPoints: number = 8
  ): Array<{lat: number, lng: number}> {
    if (coordinates.length <= maxPoints) {
      return coordinates; // Se poucos pontos, usar todos
    }
    
    console.log(`🧭 Selecting strategic points for 360° coverage from ${coordinates.length} boundary points`);
    
    // NOVA ESTRATÉGIA: Distribuição uniforme por ângulo (não por índice)
    const center = this.calculateBoundaryCenter(coordinates);
    const strategicPoints: Array<{lat: number, lng: number}> = [];
    
    // Calcular ângulos de todos os pontos em relação ao centro
    const pointsWithAngles = coordinates.map((coord, index) => ({
      coord,
      index,
      angle: this.calculateAngle(center, coord)
    }));
    
    // Ordenar por ângulo para garantir sequência circular
    pointsWithAngles.sort((a, b) => a.angle - b.angle);
    
    // Selecionar pontos distribuídos uniformemente por ângulo (360°)
    const angleStep = 360 / maxPoints;
    
    for (let i = 0; i < maxPoints; i++) {
      const targetAngle = i * angleStep;
      
      // Encontrar ponto mais próximo ao ângulo alvo
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
    
    console.log(`📍 Selected ${strategicPoints.length} strategic points with 360° coverage (${angleStep.toFixed(1)}° intervals)`);
    return strategicPoints;
  }
  
  /**
   * Calcula centro do boundary
   */
  private calculateBoundaryCenter(coordinates: Array<{lat: number, lng: number}>): {lat: number, lng: number} {
    const sumLat = coordinates.reduce((sum, coord) => sum + coord.lat, 0);
    const sumLng = coordinates.reduce((sum, coord) => sum + coord.lng, 0);
    
    return {
      lat: sumLat / coordinates.length,
      lng: sumLng / coordinates.length
    };
  }
  
  /**
   * Calcula ângulo de um ponto em relação ao centro
   */
  private calculateAngle(center: {lat: number, lng: number}, point: {lat: number, lng: number}): number {
    const deltaLng = point.lng - center.lng;
    const deltaLat = point.lat - center.lat;
    
    let angle = Math.atan2(deltaLng, deltaLat) * 180 / Math.PI;
    return angle < 0 ? angle + 360 : angle; // Normalizar para 0-360°
  }
  
  /**
   * Normaliza diferença de ângulo para -180 a 180
   */
  private normalizeAngle(angle: number): number {
    while (angle > 180) angle -= 360;
    while (angle < -180) angle += 360;
    return Math.abs(angle);
  }
  
  /**
   * Busca ruas em um raio específico (método original mantido para fallback)
   */
  private generateSearchPath(center: { lat: number; lng: number }, radius: number): Array<{lat: number, lng: number}> {
    const points: Array<{lat: number, lng: number}> = [];
    const steps = 16;
    
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * 2 * Math.PI;
      const lat = center.lat + (radius / 111000) * Math.cos(angle);
      const lng = center.lng + (radius / (111000 * Math.cos(center.lat * Math.PI / 180))) * Math.sin(angle);
      points.push({ lat, lng });
    }
    
    return points;
  }
  
  /**
   * Verifica se uma rua é acessível
   */
  private isStreetAccessible(road: StreetData, context: GeographicContext): boolean {
    // Tipos de vias onde usuários passam e podem ouvir audio guides.
    // Inclui todos os modos: carro, ônibus, bicicleta, pedestre, trem, barco, teleférico.
    const MOTORIZED_ROAD_TYPES = new Set([
      'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
      'residential', 'living_street', 'unclassified',
      'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
      'bus_guideway',  // 🚌 Faixa exclusiva de ônibus
      'ferry',         // ⛴️ Ferry / táxi marítimo
    ]);

    const NON_MOTORIZED_TYPES = new Set([
      'cycleway',      // 🚲 Ciclovia dedicada
      'footway',       // 🚶 Calçada / passeio
      'pedestrian',    // 🚶 Zona pedestre (rua comercial, piazza)
      'path',          // 🥾 Caminho genérico (trilha, atalho urbano)
      'waterway',      // 🌊 Hidrovia navegável (rio, canal)
      'railway_rail',           // 🚆 Trem de superfície
      'railway_light_rail',     // 🚊 VLT / light rail
      'railway_tram',           // 🚃 Bonde / tram
      'railway_subway',         // 🚇 Metrô ELEVADO (filtro de túnel abaixo rejeita o subterrâneo)
      'railway_monorail',       // 🚝 Monotrilho
      'railway_narrow_gauge',   // 🚂 Trem de bitola estreita (turístico)
      'railway_preserved',      // 🚂 Ferrovia histórica preservada
      'aerialway_cable_car',    // 🚠 Teleférico (ex: Cristo Redentor)
      'aerialway_gondola',      // 🚡 Gôndola
      'aerialway_chair_lift',   // 🪑 Cadeirinha
      'aerialway_mixed_lift',   // 🚡 Teleférico misto
    ]);

    const isMotorizedRoad = MOTORIZED_ROAD_TYPES.has(road.type);
    const isNonMotorized = NON_MOTORIZED_TYPES.has(road.type);

    if (!isMotorizedRoad && !isNonMotorized) {
      console.log(`🚫 Road type '${road.type}' not in accessible types`);
      return false;
    }

    // Verificar restrições de acesso
    if (road.accessibility === 'private' || road.accessibility === 'no') {
      return false;
    }

    // motor_vehicle/vehicle filter: rejeitar vias RODOVIÁRIAS restritas a carros
    // (park loops do Central Park, drives de serviço, pedestrian zones taggeadas como tertiary legado).
    // NÃO aplica a rotas não-motorizadas (ciclovia, calçada, trem, barco) — elas
    // inerentemente não têm tráfego de motor_vehicle, então o tag seria irrelevante
    // ou ausente. Aplicar aqui causaria falsos negativos em pedestrian streets legítimas.
    if (isMotorizedRoad) {
      const motorVehicle = road.tags?.motor_vehicle;
      if (motorVehicle === 'no' || motorVehicle === 'private' || motorVehicle === 'destination') {
        console.log(`🚫 Street ${road.id} (${(road as any).name || 'unnamed'}) rejected: motor_vehicle=${motorVehicle}`);
        return false;
      }
      const vehicleTag = road.tags?.vehicle;
      if (vehicleTag === 'no' || vehicleTag === 'private') {
        console.log(`🚫 Street ${road.id} (${(road as any).name || 'unnamed'}) rejected: vehicle=${vehicleTag}`);
        return false;
      }
    }
    
    // NOVO: Rejeitar ruas em túneis (sem visibilidade do céu/POI)
    if (road.tags?.tunnel === 'yes' || road.tags?.covered === 'yes') {
      console.log(`🚫 Street ${road.id} rejected: tunnel/covered (no sky visibility)`);
      return false;
    }
    
    // NOVO: Penalizar viadutos elevados (layer > 0) se POI está no nível do solo
    if (road.tags?.bridge === 'yes' || (road.tags?.layer && parseInt(road.tags.layer) > 0)) {
      console.log(`⚠️ Street ${road.id} on elevated structure (bridge/layer=${road.tags.layer})`);
      // Permitir apenas se POI também está elevado
      // Por ora, aceitar mas logar para análise
    }
    
    // Ajustar critérios baseado no contexto
    if (context.urbanDensity.level === 'very_dense') {
      // Em áreas muito densas, aceitar mais tipos de ruas
      return true;
    }
    
    return true;
  }
  
  /**
   * Encontra ponto na rua mais próximo ao boundary
   */
  private findClosestPointToBoundary(street: StreetData, boundary: BoundaryData): StreetData {
    if (street.coordinates.length === 0) {
      return street;
    }

    // Encontrar ponto na rua mais próximo ao centro do boundary
    let closestPoint = street.coordinates[0];
    let minDistance = calculateDistance(street.coordinates[0], boundary.center);

    for (const point of street.coordinates) {
      const distance = calculateDistance(point, boundary.center);
      if (distance < minDistance) {
        minDistance = distance;
        closestPoint = point;
      }
    }

    // Preserva a polilinha original em `fullCoordinates` antes de colapsar
    // `coordinates` para 1 ponto. Consumers que precisam de upstream/downstream
    // (ex: `predictor.buildFrontalArrivalTP`) usam `fullCoordinates`.
    return {
      ...street,
      coordinates: [closestPoint],
      fullCoordinates: street.coordinates,
      distance: minDistance
    } as StreetData;
  }
  
  /**
   * Busca ruas usando Google Roads API com fallback
   */
  private async calculateSurroundingBuildingsHeight(
    poiLocation: { lat: number; lng: number },
    radius: number = 500
  ): Promise<{ average: number; max: number; buildingCount: number }> {
    // Verificar cache primeiro (TTL gerenciado internamente)
    const cacheKey = `${poiLocation.lat.toFixed(4)},${poiLocation.lng.toFixed(4)},${radius}`;
    const cached = StreetAnalyzer.surroundingHeightCache.get(cacheKey);

    if (cached !== undefined) {
      console.log(`🏙️ Using cached surrounding buildings data (${cached.buildingCount} buildings, avg: ${cached.average}m)`);
      return cached;
    }
    
    const query = `
[out:json][timeout:${TRIGGER_POINTS_CONSTANTS.timeouts.osmQueryVeryLong}];
(
  way["building"](around:${radius},${poiLocation.lat},${poiLocation.lng});
);
out tags;
`;

    try {
      console.log(`🏙️ Fetching surrounding buildings height data (${radius}m radius)...`);
      
      const response = await this.retryOSMQuery(
        query,
        'OSM surrounding buildings query',
        7,
        1500
      );
      
      if (!response.ok) {
        console.warn(`OSM surrounding buildings query failed: ${response.status}`);
        return { average: 0, max: 0, buildingCount: 0 };
      }
      
      const data = await response.json();
      
      if (!data.elements || data.elements.length === 0) {
        console.log('⚠️ No surrounding buildings found in OSM');
        return { average: 0, max: 0, buildingCount: 0 };
      }
      
      const heights: number[] = [];
      
      for (const element of data.elements || []) {
        const height = extractBuildingHeight(element.tags);
        if (height > 0) {
          heights.push(height);
        }
      }
      
      if (heights.length === 0) {
        console.log('⚠️ No surrounding buildings with height data found');
        return { average: 0, max: 0, buildingCount: 0 };
      }
      
      const averageHeight = heights.reduce((sum, h) => sum + h, 0) / heights.length;
      const maxHeight = Math.max(...heights);
      
      // Contar prédios altos (acima de 50m) para análise de canyon urbano
      const tallBuildingsCount = heights.filter(height => height > 50).length;
      
      const result = {
        average: Math.round(averageHeight),  // ✅ CORRIGIDO: average em vez de averageHeight
        max: Math.round(maxHeight),          // ✅ CORRIGIDO: max em vez de maxHeight
        buildingCount: heights.length,
        tallBuildingsCount: tallBuildingsCount // NOVO: contagem de prédios altos
      };
      
      // Armazenar no cache (TTL aplicado internamente)
      StreetAnalyzer.surroundingHeightCache.set(cacheKey, result);
      
      console.log(`🏙️ Surrounding buildings: ${heights.length} analyzed, avg height: ${averageHeight.toFixed(1)}m, max: ${maxHeight.toFixed(1)}m (cached)`);
      
      return result;
    } catch (error) {
      console.error('Failed to fetch surrounding buildings height:', error);
      return { average: 0, max: 0, buildingCount: 0 };
    }
  }

  /**
   * NOVO: Busca ruas ao redor de um ponto específico (para fallback)
   */
  public async getStreetsFromOSMOptimized(location: { lat: number; lng: number }, radius: number, boundary?: BoundaryData): Promise<StreetData[]> {
    try {
      console.log(`🚀 Optimized OSM query for streets around point...`);
      
      // 🚀 NOVA ESTRATÉGIA: Verificar se já temos dados consolidados do boundary
      if (boundary?.streets && boundary.streets.length > 0) {
        console.log(`✅ Using consolidated streets from boundary: ${boundary.streets.length} streets`);
        console.log(`🚀 CONSOLIDATION BENEFIT: Avoided OSM request for ${boundary.streets.length} streets`);
        return boundary.streets;
      }
      
      // ═══════════════════════════════════════════════════════════════
      // ESTRATÉGIA 1: LOCAL OSM DB (primário - sem rede)
      // ═══════════════════════════════════════════════════════════════
      try {
        const { LocalOSMFetcher } = await import('../services/local-osm-fetcher');
        const localStreets = LocalOSMFetcher.getInstance().fetchExtendedStreets(location, radius);
        if (localStreets && localStreets.length > 0) {
          console.log(`🚀 [LocalOSMFetcher] Found ${localStreets.length} streets locally around point`);
          return localStreets;
        }
      } catch (localError) {
        console.warn(`⚠️ [LocalOSMFetcher] Local DB query failed, falling back to Overpass:`, localError);
      }
      
      // ═══════════════════════════════════════════════════════════════
      // ESTRATÉGIA 2: OVERPASS API (fallback - rede)
      // ═══════════════════════════════════════════════════════════════
      
      // Query OSM para buscar ruas ao redor do ponto
      const query = `
[out:json][timeout:${TRIGGER_POINTS_CONSTANTS.timeouts.osmQueryVeryLong}];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|track|service)$"]["access"!~"^(no)$"](around:${radius},${location.lat},${location.lng});
);
out geom tags;
`;
      
      console.log(`📝 OSM Query: point ${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}, ${radius}m radius`);
      
      const response = await this.retryOSMQuery(
        query,
        'OSM query for streets around point',
        7,
        2000
      );
      
      if (!response.ok) {
        throw new Error(`OSM API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.elements || data.elements.length === 0) {
        console.log('⚠️ No streets found via OSM');
        return [];
      }
      
      console.log(`📍 Found ${data.elements.length} street elements from OSM`);
      
      // Processar elementos OSM em StreetData
      const streets: StreetData[] = [];
      
      for (const element of data.elements) {
        if (element.type === 'way' && element.geometry && element.geometry.length > 1) {
          const streetCoordinates = element.geometry.map((point: any) => ({
            lat: point.lat,
            lng: point.lon
          }));
          
          // Pegar ponto mais próximo ao POI
          let closestPoint = streetCoordinates[0];
          let minDistance = calculateDistance(location, closestPoint);
          
          for (const coord of streetCoordinates) {
            const distance = calculateDistance(location, coord);
            if (distance < minDistance) {
              minDistance = distance;
              closestPoint = coord;
            }
          }
          
          const street: StreetData = {
            id: `osm_way_${element.id}`,
            type: this.classifyOSMHighway(element.tags?.highway || 'unknown'),
            name: element.tags?.name || element.tags?.ref || 'Unnamed Street',
            coordinates: [closestPoint], // Usar apenas o ponto mais próximo
            accessibility: this.determineAccessibility(element.tags),
            confidence: 0.9, // Alta confidence para OSM
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
      
      console.log(`✅ Processed ${streets.length} streets from OSM`);
      return streets;
      
    } catch (error) {
      console.error('Error in OSM street search:', error);
      return [];
    }
  }

  /**
   * NOVO: Verifica se uma rua é acessível (método público para fallback)
   */
  public isStreetAccessiblePublic(road: StreetData, context: GeographicContext): boolean {
    return this.isStreetAccessible(road, context);
  }

  /**
   * Analisa a estrutura do quarteirão ao redor do POI
   * Classifica ruas como front, side, ou back baseado em distância e buildings bloqueando
   * Usa dados já coletados (boundary.streets, boundary.buildings) - SEM novas queries OSM
   */
  analyzeBlockStructure(
    poiLocation: { lat: number; lng: number },
    streets: StreetData[],
    buildings: any[],
    boundary?: BoundaryData
  ): Array<{ street: StreetData; classification: 'front' | 'side' | 'back'; distance: number; hasBuildingsBlocking: boolean }> {
    console.log(`🏘️ Analyzing block structure for ${streets.length} streets and ${buildings.length} buildings`);
    
    // ✅ NOVO: Detectar se é POI HIGH (alta elevação) - para esses, distância não importa, apenas buildings bloqueando
    const isHighElevationPOI = boundary?.classification?.group === POIGroup.HIGH;
    
    if (isHighElevationPOI) {
      //console.log(`🏔️ HIGH elevation POI detected - classification based ONLY on building obstructions (distance ignored)`);
    }
    
    const results: Array<{ street: StreetData; classification: 'front' | 'side' | 'back'; distance: number; hasBuildingsBlocking: boolean }> = [];
    
    for (const street of streets) {
      if (!street.coordinates || street.coordinates.length === 0) continue;
      if (!boundary || !boundary.coordinates || boundary.coordinates.length === 0) continue;
      
      // Encontrar ponto mais próximo da rua ao boundary (não ao centro do POI)
      // Calcular distância do boundary até o ponto mais próximo da rua
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
      
      // Encontrar ponto mais próximo do boundary na direção da rua para verificar bloqueio
      const boundaryPoint = findClosestPointOnBoundary(closestStreetPoint, boundary.coordinates);
      
      // Verificar se há buildings entre boundary e rua
      // Passar boundary para excluir buildings dentro do POI
      const hasBuildingsBlocking = this.checkBuildingsBetweenPoints(boundaryPoint, closestStreetPoint, buildings, boundary);
      
      // ✅ LÓGICA CORRIGIDA: Para POIs HIGH, classificar baseado APENAS em buildings bloqueando
      // Para outros POIs, usar distância + buildings
      let classification: 'front' | 'side' | 'back';
      
      if (isHighElevationPOI) {
        // 🏔️ POI HIGH: Visibilidade não depende de distância, apenas de obstruções
        // Se há buildings bloqueando = "back" (não visível)
        // Se NÃO há buildings bloqueando = "front" (visível, independente da distância)
        if (hasBuildingsBlocking) {
          classification = 'back'; // Buildings bloqueando = não visível
        } else {
          classification = 'front'; // Sem buildings bloqueando = visível (mesmo que distante)
        }
      } else {
        // 🏙️ POIs normais (CANYON, FLAT, MEDIUM): Usar distância + buildings
        if (hasBuildingsBlocking) {
          classification = 'back'; // Buildings bloqueando = rua de trás
        } else if (distance < 50) {
          classification = 'front'; // Mais próxima + sem buildings = frente
        } else if (distance < 100) {
          classification = 'side'; // Média distância + sem buildings = lado
        } else {
          classification = 'back'; // Distante = trás
        }
      }
      
      // ✅ COMENTADO: Logs individuais de cada rua poluem muito o console
      // if (results.length < 5) {
      //   const streetName = street.name || street.id || 'unnamed';
      //   console.log(`  📍 Street ${street.id} (${streetName}): distance=${distance.toFixed(0)}m, blocked=${hasBuildingsBlocking}, classification=${classification}`);
      // }
      
      results.push({
        street,
        classification,
        distance,
        hasBuildingsBlocking
      });
    }
    
    // Ordenar por distância (mais próxima primeiro)
    results.sort((a, b) => a.distance - b.distance);
    
    const frontCount = results.filter(r => r.classification === 'front').length;
    const sideCount = results.filter(r => r.classification === 'side').length;
    const backCount = results.filter(r => r.classification === 'back').length;
    const blockedCount = results.filter(r => r.hasBuildingsBlocking).length;
    
    console.log(`📊 Block structure: ${frontCount} front, ${sideCount} side, ${backCount} back`);
    console.log(`   → ${blockedCount} streets blocked by buildings, ${results.length - blockedCount} without blocking`);
    console.log(`   → Distance ranges: ${Math.min(...results.map(r => r.distance)).toFixed(0)}m - ${Math.max(...results.map(r => r.distance)).toFixed(0)}m`);
    
    return results;
  }

  /**
   * Encontra o ponto mais próximo de uma linha de coordenadas a uma localização
   */
  private findClosestPointToLocation(
    coordinates: Array<{ lat: number; lng: number }>,
    location: { lat: number; lng: number }
  ): { lat: number; lng: number } {
    let closestPoint = coordinates[0];
    let minDistance = calculateDistance(location, coordinates[0]);
    
    for (const point of coordinates) {
      const distance = calculateDistance(location, point);
      if (distance < minDistance) {
        minDistance = distance;
        closestPoint = point;
      }
    }
    
    return closestPoint;
  }

  /**
   * Verifica se há buildings entre dois pontos (POI e rua)
   * Usa dados já coletados - SEM novas queries
   * EXCLUI buildings dentro do boundary (são parte do POI)
   */
  private checkBuildingsBetweenPoints(
    point1: { lat: number; lng: number },
    point2: { lat: number; lng: number },
    buildings: any[],
    boundary?: BoundaryData
  ): boolean {
    // Verificar se algum building está entre os dois pontos
    // Usar buffer de 20m ao redor da linha entre os pontos
    const bufferDistance = 20; // metros
    const lineDistance = calculateDistance(point1, point2);
    
    let buildingsInsideBoundary = 0;
    let buildingsNearLine = 0;
    let buildingsBlocking = 0;
    
    for (const building of buildings) {
      if (!building.geometry || building.geometry.length === 0) continue;
      
      // Calcular centroid do building
      const buildingCenter = this.calculateBuildingCentroid(building);
      
      // ✅ NOVO: Excluir buildings que estão DENTRO do boundary (são parte do POI)
      if (boundary && boundary.coordinates && boundary.coordinates.length > 0) {
        if (isPointInPolygon(buildingCenter, boundary.coordinates)) {
          buildingsInsideBoundary++;
          continue; // Building é parte do POI, não bloqueia visão
        }
      }
      
      // Calcular distância do building à linha entre os pontos
      const distanceToLine = calculateDistanceToLineSegment( // ✅ DRY: usar função SSOT
        buildingCenter,
        point1,
        point2
      );
      
      // Se building está próximo da linha (dentro do buffer), considera bloqueando
      if (distanceToLine <= bufferDistance) {
        buildingsNearLine++;
        // Verificar se building está entre os pontos (não apenas próximo)
        const distance1 = calculateDistance(point1, buildingCenter);
        const distance2 = calculateDistance(point2, buildingCenter);
        
        // Se building está entre os pontos (soma das distâncias ≈ distância da linha)
        const distanceDiff = Math.abs(distance1 + distance2 - lineDistance);
        if (distanceDiff < 30) {
          buildingsBlocking++;
          return true; // Building bloqueia
        }
      }
    }
    
    // Log detalhado apenas para debug (primeiras verificações)
    if (buildingsBlocking === 0 && buildingsNearLine > 0) {
      // console.log(`  🔍 No blocking: ${buildingsInsideBoundary} inside boundary, ${buildingsNearLine} near line (but not between), ${buildings.length} total`);
    }
    
    return false; // Nenhum building bloqueando
  }

  /**
   * Calcula centroid de um building OSM
   */
  private calculateBuildingCentroid(building: any): { lat: number; lng: number } {
    if (!building.geometry || building.geometry.length === 0) {
      return { lat: building.lat || 0, lng: building.lon || 0 };
    }
    
    // Se geometry é array de coordenadas
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
    
    // Fallback
    return { lat: building.lat || 0, lng: building.lon || 0 };
  }

  // ✅ DRY: calculateDistanceToLineSegment removido - usar função importada de utils/calculations.ts
}

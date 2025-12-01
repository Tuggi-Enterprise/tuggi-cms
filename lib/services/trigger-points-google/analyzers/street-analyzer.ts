// Analisador de ruas acessíveis usando Google Roads API

import { GoogleAPIsService } from '../services/google-apis.service';
import { POIData, BoundaryData, GeographicContext, StreetData } from '../types/interfaces';
import { calculateDistance, isPointInPolygon, extractBuildingHeight, calculateBearing, calculateDistanceToLineSegment, calculateDistanceToPolygon, calculateDistanceToBoundary } from '../utils/calculations';
import { ElevationAnalysisService } from '../services/elevation-service';
import { loadTriggerPointsConfig, TriggerPointsConfig, TRIGGER_POINTS_CONSTANTS } from '../config/trigger-points-config';

export class StreetAnalyzer {
  private googleAPIs: GoogleAPIsService;
  
  // Cache para altura de prédios vizinhos (QUALIDADE > PERFORMANCE)
  private static surroundingHeightCache = new Map<string, { 
    data: { average: number; max: number; buildingCount: number }, 
    timestamp: number 
  }>();
  private static CACHE_DURATION = 30 * 60 * 1000; // 30 minutos
  
  constructor() {
    this.googleAPIs = new GoogleAPIsService();
  }
  
  /**
   * Encontra ruas acessíveis ao redor do POI e retorna junto com metadados do raio
   */
  async findAccessibleStreets(
    poiData: POIData, 
    boundary: BoundaryData, 
    context: GeographicContext
  ): Promise<StreetData[]> {
    console.log(`🛣️ Finding accessible streets for: ${poiData.name}`);
    
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
        console.log(`🏙️ Urban Canyon detected - analyzing block structure for ${accessibleStreets.length} streets`);
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
          console.log(`✅ Urban Canyon: ${validStreets.length} front/side streets (${accessibleStreets.length - validStreets.length} blocked by buildings)`);
          const streetPoints = validStreets.map(street => 
            this.findClosestPointToBoundary(street, boundary)
          );
          return streetPoints;
        } else {
          console.log(`⚠️ Urban Canyon: All streets blocked by buildings, using all accessible streets anyway`);
        }
      }
      
      // Calcular pontos mais próximos ao boundary
      const streetPoints = accessibleStreets.map(street => 
        this.findClosestPointToBoundary(street, boundary)
      );
      
      console.log(`✅ Found ${streetPoints.length} accessible street points`);
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
    console.log(`🛣️ Finding accessible streets for: ${poiData.name} (with metadata)`);
    
    try {
      const searchRadius = await this.calculateIntelligentRadius(boundary, context, poiData);
      const roads = await this.getRoadsAroundBoundary(boundary, searchRadius, context);
      
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
      
      console.log(`✅ Found ${streetPoints.length} accessible street points (radius: ${searchRadius}m)`);
      return { 
        streets: streetPoints, 
        searchRadius,
        elevationAnalysis
      };
      
    } catch (error) {
      console.error('Error finding accessible streets:', error);
      return { streets: [], searchRadius: 300 };
    }
  }
  
  /**
   * Calcula raio de busca inteligente baseado em elevação, altura e contexto
   * Implementa a lógica DINÂMICA do sistema legado usando dados reais de elevação
   */
  private async calculateIntelligentRadius(boundary: BoundaryData, context: GeographicContext, poiData: POIData, config?: TriggerPointsConfig): Promise<number> {
    console.log(`🧮 Calculating intelligent search radius...`);
    
    // 🎯 STEP 0: PRIORIDADE MÁXIMA - Usar classificação do boundary se disponível (SSOT)
    // A classificação já foi calculada no boundary-detector e deve ser respeitada
    if (boundary.classification && boundary.classification.searchRadius) {
      const classificationRadius = boundary.classification.searchRadius;
      const classificationGroup = boundary.classification.group;
      
      console.log(`🎯 [CLASSIFICATION-BASED RADIUS] Using classification from boundary:`);
      console.log(`   → Group: ${classificationGroup.toUpperCase()}`);
      console.log(`   → Search radius: ${classificationRadius}m`);
      console.log(`   → Reasoning: ${boundary.classification.metadata?.reasoning || 'N/A'}`);
      console.log(`   ✅ RESPECTING CLASSIFICATION (SSOT) - ignoring dynamic calculations`);
      
      // 🏙️ CANYON: Raio muito limitado (visibilidade muito restrita)
      if (classificationGroup === 'canyon') {
        const baseCanyonRadius = classificationRadius;
        
        // Para POIs muito altos (>100m) em canyon, permitir pequeno aumento, mas máximo 100m
        let canyonRadius = baseCanyonRadius;
        if (boundary.height && boundary.height > 100) {
          const heightAdjustment = Math.min((boundary.height - 100) * 0.3, 25);
          canyonRadius = Math.min(baseCanyonRadius + heightAdjustment, 100);
          console.log(`   → Tall POI (${boundary.height}m) in canyon: adjusted to ${canyonRadius}m`);
        }
        
        console.log(`   → Final radius: ${canyonRadius}m (STRICTLY LIMITED - visibility blocked by surrounding buildings)`);
        return canyonRadius;
      }
      
      // Para outros grupos (HIGH, MEDIUM, FLAT), usar o raio da classificação diretamente
      console.log(`   → Final radius: ${classificationRadius}m (from ${classificationGroup.toUpperCase()} group config)`);
      return classificationRadius;
    }
    
    // 🏙️ FALLBACK: Se não há classificação, verificar CANYON manualmente (para compatibilidade)
    if (boundary.classification?.group === 'canyon') {
      const baseCanyonRadius = boundary.classification.searchRadius || 75;
      
      let canyonRadius = baseCanyonRadius;
      if (boundary.height && boundary.height > 100) {
        const heightAdjustment = Math.min((boundary.height - 100) * 0.3, 25);
        canyonRadius = Math.min(baseCanyonRadius + heightAdjustment, 100);
        console.log(`🏙️ CANYON POI DETECTED: Tall POI (${boundary.height}m) in canyon`);
        console.log(`   → Base radius: ${baseCanyonRadius}m + height adjustment: +${heightAdjustment.toFixed(0)}m`);
        console.log(`   → Final radius: ${canyonRadius}m (STRICTLY LIMITED - visibility blocked by surrounding buildings)`);
      } else {
        console.log(`🏙️ CANYON POI DETECTED: Using FIXED radius (${canyonRadius}m) - visibility limited by surrounding buildings`);
        console.log(`   → POI height: ${boundary.height || 'unknown'}m`);
      }
      console.log(`   → Even tall POIs in canyons have restricted visibility`);
      console.log(`   → Ignoring dynamic height-based calculations (would be ${300}+m otherwise)`);
      return canyonRadius;
    }
    
    // 🏔️ STEP 1: Check if this is a high-visibility POI using REAL elevation data (DYNAMIC LOGIC)
    if (boundary.elevation && boundary.elevation.center > 0) {
      const poiElevation = boundary.elevation.center;
      const baseElevation = await ElevationAnalysisService.estimateRegionalBaseElevation(boundary.center, context, poiData);
      const elevationDiff = poiElevation - baseElevation;
      
      console.log(`📏 DYNAMIC elevation analysis:`);
      console.log(`  📍 POI elevation: ${poiElevation.toFixed(1)}m (from real data)`);
      console.log(`  🏞️ Estimated base elevation: ${baseElevation.toFixed(1)}m`);
      console.log(`  📈 Relative difference: ${elevationDiff.toFixed(1)}m`);
      
      // 🏔️ Apply dynamic formula for high-visibility landmarks (>150m difference)
      // ✅ PRIORIDADE MÁXIMA: Este cálculo dinâmico tem precedência sobre qualquer outro
      if (elevationDiff > 150) {
        const theoreticalRange = Math.sqrt(elevationDiff) * 200; // Fórmula dinâmica
        // 🎯 SEM LIMITES ARTIFICIAIS: Apenas mínimo de 3km e máximo de 15km (Cristo Redentor até Copacabana ~8km)
        const calculatedRange = Math.max(theoreticalRange, 3000); // Mínimo 3km
        const maxRange = Math.min(calculatedRange, 15000); // Máximo 15km (limite físico de visibilidade)
        
        console.log(`🏔️ HIGH-VISIBILITY LANDMARK DETECTED (dynamic calculation)`);
        console.log(`  📏 Theoretical range (√${elevationDiff.toFixed(0)} × 200): ${theoreticalRange.toFixed(0)}m`);
        console.log(`  🎯 Final calculated range: ${maxRange.toFixed(0)}m`);
        console.log(`  ✅ Using DYNAMIC CALCULATION (no hardcoded limits)`);
        
        return Math.round(maxRange);
      }
      
      // 🏞️ NOVA LÓGICA: POIs FLAT (baixa elevação) - usar configuração do grupo
      // 🆕 CORRIGIDO: Usar raio da configuração do grupo ao invés de valor hardcoded
      if (elevationDiff <= 50 && boundary.classification?.group === 'flat') {
        const flatRadius = boundary.classification.searchRadius || 120; // Usar da configuração, fallback 120m
        console.log(`🏞️ FLAT POI DETECTED: ${elevationDiff.toFixed(0)}m elevation difference`);
        console.log(`🎯 Using FLAT group radius: ${flatRadius}m (from classification config)`);
        return flatRadius;
      }
      // Moderate elevation bonus for smaller differences
      else if (elevationDiff > 50) {
        const elevationBonus = elevationDiff * 8; // 8m radius per meter of elevation
        console.log(`⛰️ Moderate elevation bonus: +${elevationBonus.toFixed(0)}m (${elevationDiff.toFixed(1)}m above base)`);
        // Continue with normal calculation but add elevation bonus later
      }
    }
    
    // Carregar configuração
    const cfg = config || loadTriggerPointsConfig();
    
    let baseRadius = cfg.searchRadius.baseRadius[context.urbanDensity.level];
    
    console.log(`🏙️ ${context.urbanDensity.level.toUpperCase()} area: using ${baseRadius}m base radius (from config)`);
    
    // 2. NOVO: Ajuste por elevação absoluta e relativa do POI
    if (boundary.elevation) {
      const poiElevation = boundary.elevation.center;
      const elevationDiff = boundary.elevation.center - boundary.elevation.average;
      
      // Para POIs EXTREMAMENTE altos (>1000m), usar fórmula agressiva para picos/montanhas
      if (poiElevation > 1000) {
        const extremeAltitudeBonus = Math.min((poiElevation - 1000) * 10 + 2000, 4000); // 10m raio por metro acima de 1000m + 2000m base, max 4000m
        baseRadius += extremeAltitudeBonus;
        console.log(`🗻 EXTREME altitude bonus: ${poiElevation.toFixed(0)}m elevation → +${extremeAltitudeBonus.toFixed(0)}m radius`);
      }
      // Para POIs muito altos (>800m), usar elevação absoluta (picos, montanhas)
      else if (poiElevation > 800) {
        const highAltitudeBonus = Math.min((poiElevation - 800) * 6 + 1200, 2500); // 6m raio por metro acima de 800m + 1200m base, max 2500m
        baseRadius += highAltitudeBonus;
        console.log(`🏔️ High altitude bonus: ${poiElevation.toFixed(0)}m elevation → +${highAltitudeBonus.toFixed(0)}m radius`);
      }
      // Para POIs moderadamente altos (>400m), usar elevação absoluta moderada
      else if (poiElevation > 400) {
        const moderateAltitudeBonus = Math.min((poiElevation - 400) * 2, 800);
        baseRadius += moderateAltitudeBonus;
        console.log(`⛰️ Moderate altitude bonus: ${poiElevation.toFixed(0)}m elevation → +${moderateAltitudeBonus.toFixed(0)}m radius`);
      }
      
      // Ajuste adicional por elevação relativa (diferença interna do POI)
      if (elevationDiff > 50) {
        // POI muito acima da média interna - visível de longe
        const elevationBonus = Math.min(elevationDiff * 8, 400); // Max 400m bonus
        baseRadius += elevationBonus;
        console.log(`🏗️ Internal elevation bonus: POI is ${elevationDiff.toFixed(1)}m above internal average → +${elevationBonus.toFixed(0)}m radius`);
      } else if (elevationDiff > 20) {
        // POI moderadamente acima da média interna
        const elevationBonus = elevationDiff * 5;
        baseRadius += elevationBonus;
        console.log(`🏢 Moderate internal elevation bonus: +${elevationBonus.toFixed(0)}m radius`);
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
          analysisRadius = TRIGGER_POINTS_CONSTANTS.distances.surroundingHeightsRadiusMax; // 1500m para POIs muito altos
          console.log(`🏗️ Using extended radius (${analysisRadius}m) for very tall POI (${poiHeight}m)`);
        } else if (poiHeight > 50) {
          analysisRadius = Math.min(1200, TRIGGER_POINTS_CONSTANTS.distances.surroundingHeightsRadius * 1.5); // 1200m para POIs altos
          console.log(`🏢 Using increased radius (${analysisRadius}m) for tall POI (${poiHeight}m)`);
        }
        
        const surroundingHeights = await Promise.race([
          this.calculateSurroundingBuildingsHeight(boundary.center, analysisRadius),
          new Promise<{ average: number; max: number; buildingCount: number }>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), TRIGGER_POINTS_CONSTANTS.distances.heightAnalysisTimeout) // Timeout configurável (QUALIDADE > PERFORMANCE)
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
    console.log(`🗺️ Searching roads around boundary (${boundary.coordinates.length} points, radius: ${searchRadius}m)`);
    
    try {
      // 🚀 NOVA ESTRATÉGIA: Verificar se já temos dados consolidados do boundary
      if (boundary.streets && boundary.streets.length > 0) {
        console.log(`✅ Using consolidated streets from boundary: ${boundary.streets.length} streets`);
        console.log(`🚀 CONSOLIDATION BENEFIT: Avoided OSM request for ${boundary.streets.length} streets`);
        
        // ✅ CRÍTICO: Filtrar ruas consolidadas pelo raio também (podem ter sido criadas com raio maior)
        return this.filterStreetPointsByRadius(boundary.streets, boundary, searchRadius);
      }
      
      // 🚀 ESTRATÉGIA INTELIGENTE: Usar dados do Nominatim + ruas virtuais
      if (boundary.coordinates.length > 100) {
        console.log(`🏗️ LARGE POI STRATEGY: ${boundary.coordinates.length} points`);
        
        // 1. Detectar se é canyon urbano (POI alto em área densa)
        const isUrbanCanyon = context ? this.isUrbanCanyon(boundary, context) : false;
        
        if (isUrbanCanyon && context) {
          console.log(`🏙️ URBAN CANYON DETECTED: Using OSM query for real streets around boundary`);
          // Para canyons urbanos, usar OSM query para encontrar ruas reais
          // ✅ getStreetsFromOSMOptimizedBoundary já filtra pontos pelo raio internamente
          try {
            const osmStreets = await this.getStreetsFromOSMOptimizedBoundary(boundary, searchRadius);
            if (osmStreets && osmStreets.length > 0) {
              console.log(`✅ Found ${osmStreets.length} real streets via OSM for urban canyon (already filtered by radius)`);
              return osmStreets;
            }
          } catch (error) {
            console.warn(`⚠️ OSM query failed for urban canyon, using Nominatim fallback:`, error);
          }
        }
        
        // Fallback: Criar ruas reais dos dados do Nominatim
        const nominatimStreets = this.createRealStreetsFromNominatimData(boundary);
        console.log(`✅ Created ${nominatimStreets.length} real streets from Nominatim data`);
        // ✅ Filtrar pontos pelo raio (ruas do Nominatim podem ser longas)
        return this.filterStreetPointsByRadius(nominatimStreets, boundary, searchRadius);
      }
      
      // Para boundaries médios (50-100 pontos), usar APENAS ruas reais
      if (boundary.coordinates.length > 50) {
        console.log(`⚡ MEDIUM POI: ${boundary.coordinates.length} points, using ONLY real streets (virtual streets disabled)`);
        const nominatimStreets = this.createRealStreetsFromNominatimData(boundary);
        console.log(`✅ Created ${nominatimStreets.length} real streets from Nominatim data (virtual streets disabled)`);
        // ✅ Filtrar pontos pelo raio
        return this.filterStreetPointsByRadius(nominatimStreets, boundary, searchRadius);
      }
      
      // Para boundaries pequenos, usar APENAS ruas reais do Nominatim
      console.log(`🎯 SMALL POI: ${boundary.coordinates.length} points, using ONLY real streets (virtual streets disabled)`);
      const nominatimStreets = this.createRealStreetsFromNominatimData(boundary);
      console.log(`✅ Created ${nominatimStreets.length} real streets from Nominatim data (virtual streets disabled)`);
      // ✅ Filtrar pontos pelo raio
      return this.filterStreetPointsByRadius(nominatimStreets, boundary, searchRadius);
      
    } catch (error) {
      console.error('Error finding roads around boundary:', error);
      console.log(`🔄 Fallback: Using ONLY real streets from Nominatim data (virtual streets disabled)`);
      const nominatimStreets = this.createRealStreetsFromNominatimData(boundary);
      console.log(`✅ Created ${nominatimStreets.length} real streets from Nominatim data (fallback)`);
      // ✅ Filtrar pontos pelo raio mesmo no fallback
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
    if (!streets || streets.length === 0) return streets;
    if (!boundary.coordinates || boundary.coordinates.length === 0) return streets;
    
    const maxAllowedDistance = searchRadius + 20; // Margem de 20m
    const filtered: StreetData[] = [];
    
    for (const street of streets) {
      if (!street.coordinates || street.coordinates.length === 0) continue;
      
      // Filtrar pontos pelo raio
      const validPoints: Array<{ lat: number; lng: number }> = [];
      
      for (const point of street.coordinates) {
        // Ignorar pontos dentro do boundary
        if (isPointInPolygon(point, boundary.coordinates)) {
          continue;
        }
        
        // Calcular distância ao boundary
        const distanceToBoundary = calculateDistanceToPolygon(point, boundary.coordinates); // ✅ DRY: usar função SSOT
        
        if (distanceToBoundary <= maxAllowedDistance) {
          validPoints.push(point);
        }
      }
      
      // Incluir rua apenas se tem pelo menos 2 pontos válidos
      if (validPoints.length >= 2) {
        filtered.push({
          ...street,
          coordinates: validPoints
        });
        
        if (validPoints.length < street.coordinates.length) {
          console.log(`✂️ Street ${street.id}: Filtered ${street.coordinates.length - validPoints.length} points outside radius (kept ${validPoints.length}/${street.coordinates.length})`);
        }
      }
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
      
      // Selecionar pontos estratégicos do boundary com cobertura 360° (AUMENTADO para melhor cobertura)
      const strategicPoints = this.selectStrategicBoundaryPoints(boundary.coordinates, 16);
      
      // Criar query OSM combinada e otimizada (MELHORADA para incluir avenidas)
      // RELAXADO: Remover 'private' da exclusão para incluir ruas ao redor de igrejas/monumentos
      const pointQueries = strategicPoints.map(point => 
        `way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$"]["access"!~"^(no)$"](around:${searchRadius},${point.lat},${point.lng})`
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
      
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query,
        headers: {
          'Content-Type': 'text/plain'
        }
      });
      
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
  private async getRoadsFromBoundaryPoints(boundary: BoundaryData, processedRoads: Set<string>): Promise<StreetData[]> {
    const streets: StreetData[] = [];
    
    // 🚀 OTIMIZAÇÃO: Para boundaries grandes (>100 pontos), usar estratégia inteligente
    if (boundary.coordinates.length > 100) {
      console.log(`⚡ SMART OPTIMIZATION: Large boundary (${boundary.coordinates.length} points), creating virtual streets from boundary perimeter`);
      
      // Criar "ruas virtuais" baseadas no perímetro do boundary
      // Isso evita queries OSM desnecessárias e usa os dados já disponíveis
      const virtualStreets = this.createVirtualStreetsFromBoundary(boundary);
      console.log(`🎯 Created ${virtualStreets.length} virtual streets from boundary perimeter`);
      return virtualStreets;
    }
    
    // Para boundaries menores, usar pontos estratégicos
    const strategicPoints = this.selectStrategicBoundaryPoints(boundary.coordinates);
    console.log(`📍 Using ${strategicPoints.length} strategic points from boundary`);
    
    for (const point of strategicPoints) {
      try {
        // Query OSM otimizada para buscar ruas próximas ao ponto
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
              
              // Converter geometria OSM para formato esperado
              const coordinates = road.geometry ? road.geometry.map((point: any) => ({
                lat: point.lat,
                lng: point.lon
              })) : [];
              
              streets.push({
                id: road.id.toString(),
                type: road.tags?.highway || 'road',
                coordinates,
                accessibility: this.determineAccessibility(road.tags),
                confidence: 0.9 // Alta confidence para pontos no boundary
              });
            }
          }
        }
      } catch (error) {
        console.warn(`Failed to get roads for boundary point via OSM:`, error);
      }
    }
    
    console.log(`📍 Found ${streets.length} roads from boundary points`);
    return streets;
  }
  
  /**
   * Cria ruas virtuais baseadas no perímetro do boundary (OTIMIZAÇÃO)
   * Evita queries OSM desnecessárias quando já temos boundary completo
   */
  private createVirtualStreetsFromBoundary(boundary: BoundaryData): StreetData[] {
    const streets: StreetData[] = [];
    
    // Calcular raio mínimo para garantir que as ruas fiquem FORA do boundary
    const boundaryRadius = Math.sqrt(boundary.area / Math.PI);
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
  private async getRoadsFromExpandedArea(boundary: BoundaryData, searchRadius: number, processedRoads: Set<string>): Promise<StreetData[]> {
    const streets: StreetData[] = [];
    
    // Criar círculo expandido ao redor do centro do boundary
    const expandedPoints = this.generateSearchPath(boundary.center, searchRadius);
    
    try {
      // 🔴 REMOVED: Google Roads API usage (M0 - economia)
      // Usar query OSM para buscar ruas na área expandida
      const query = `
[out:json][timeout:${TRIGGER_POINTS_CONSTANTS.timeouts.osmQueryMedium}];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$"](around:${searchRadius},${boundary.center.lat},${boundary.center.lng});
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
            
            // Converter geometria OSM para formato esperado
            const coordinates = road.geometry ? road.geometry.map((point: any) => ({
              lat: point.lat,
              lng: point.lon
            })) : [];
            
            streets.push({
              id: road.id.toString(),
              type: road.tags?.highway || 'road',
              coordinates,
              accessibility: this.determineAccessibility(road.tags),
              confidence: 0.7 // Média confidence para área expandida
            });
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to get roads from expanded area via OSM:`, error);
    }
    
    console.log(`🔄 Found ${streets.length} roads from expanded area`);
    return streets;
  }
  
  /**
   * Seleciona pontos estratégicos do boundary (MELHORADO: cobertura 360°)
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
  private async getRoadsInRadius(location: { lat: number; lng: number }, radius: number): Promise<StreetData[]> {
    try {
      // Gerar pontos em círculo para buscar ruas
      const searchPath = this.generateSearchPath(location, radius);
      
      // 🔴 REMOVED: Google Roads API usage (M0 - economia)
      // Usar query OSM para buscar ruas no raio
      const query = `
[out:json][timeout:${TRIGGER_POINTS_CONSTANTS.timeouts.osmQueryMedium}];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$"](around:${radius},${location.lat},${location.lng});
);
out geom tags;
`;
      
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query,
        headers: { 'Content-Type': 'text/plain' }
      });
      
      if (!response.ok) {
        return [];
      }
      
      const data = await response.json();
      const roads = data.elements || [];
      
      // Processar ruas OSM
      const streets: StreetData[] = [];
      const processedRoads = new Set<string>();
      
      for (const road of roads) {
        if (road.id && !processedRoads.has(road.id.toString())) {
          processedRoads.add(road.id.toString());
          
          // Converter geometria OSM para formato esperado
          const coordinates = road.geometry ? road.geometry.map((point: any) => ({
            lat: point.lat,
            lng: point.lon
          })) : [];
          
          streets.push({
            id: road.id.toString(),
            type: road.tags?.highway || 'road',
            coordinates,
            accessibility: this.determineAccessibility(road.tags),
            confidence: 0.8
          });
        }
      }
      
      return streets;
    } catch (error) {
      console.warn('Error getting roads in radius:', error);
      return [];
    }
  }
  
  /**
   * Gera caminho de busca em círculo
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
    // Verificar se a rua é acessível - INCLUINDO RODOVIAS PARA POIs DE ALTA ELEVAÇÃO
    const accessibleRoadTypes = [
      'motorway',        // 🛣️ Rodovias (ex: Rodoanel)
      'trunk',           // 🛣️ Vias Expressas (ex: Anhanguera) 
      'primary',         // 🛤️ Vias Principais
      'secondary',       // 🛤️ Vias Secundárias
      'tertiary',        // 🛤️ Vias Terciárias
      'residential',     // 🏘️ Ruas Residenciais
      'living_street',   // 🏘️ Ruas de Convivência
      'unclassified',    // 🛤️ Ruas não classificadas (ex: Estradas Turísticas)
      'motorway_link',   // 🔗 Acessos às Rodovias
      'trunk_link'       // 🔗 Acessos às Vias Expressas
    ];
    
    if (!accessibleRoadTypes.includes(road.type)) {
      console.log(`🚫 Road type '${road.type}' not in accessible types: [${accessibleRoadTypes.join(', ')}]`);
      return false;
    }
    
    // Verificar restrições de acesso
    if (road.accessibility === 'private' || road.accessibility === 'no') {
      return false;
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
    
    return {
      ...street,
      coordinates: [closestPoint],
      distance: minDistance
    };
  }
  
  /**
   * Busca ruas usando Google Roads API com fallback
   */
  async getRoadsWithFallback(location: { lat: number; lng: number }, radius: number): Promise<StreetData[]> {
    try {
      // Tentar Google Roads API primeiro
      const roads = await this.getRoadsInRadius(location, radius);
      
      if (roads.length > 0) {
        return roads;
      }
      
      // Fallback para OSM se Google não retornar resultados
      console.log('Google Roads API returned no results, trying OSM fallback...');
      return await this.getOSMRoads(location, radius);
      
    } catch (error) {
      console.error('Error getting roads with fallback:', error);
      return [];
    }
  }
  
  /**
   * Busca ruas usando OSM como fallback
   */
  private async getOSMRoads(location: { lat: number; lng: number }, radius: number): Promise<StreetData[]> {
    try {
      const query = `
[out:json][timeout:${TRIGGER_POINTS_CONSTANTS.timeouts.osmQueryExtreme}];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|living_street|pedestrian|service|footway|path|track)$"](around:${radius},${location.lat},${location.lng});
);
out geom;
`;
      
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query,
        headers: {
          'Content-Type': 'text/plain'
        }
      });
      
      if (!response.ok) {
        throw new Error(`OSM API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.elements || data.elements.length === 0) {
        return [];
      }
      
      const streets: StreetData[] = [];
      
      for (const element of data.elements) {
        if (element.type === 'way' && element.geometry) {
          // Pegar ponto médio da rua
          const midIndex = Math.floor(element.geometry.length / 2);
          const midPoint = element.geometry[midIndex];
          
          streets.push({
            id: element.id.toString(),
            type: element.tags?.highway || 'road',
            coordinates: [{ lat: midPoint.lat, lng: midPoint.lon }],
            accessibility: element.tags?.access || 'public',
            confidence: 0.6
          });
        }
      }
      
      return streets;
    } catch (error) {
      console.error('Error getting OSM roads:', error);
      return [];
    }
  }
  
  /**
   * Calcula confiança da rua baseada em múltiplos fatores
   */
  calculateStreetConfidence(street: StreetData, context: GeographicContext): number {
    let confidence = street.confidence || 0.5;
    
    // Ajustar baseado no tipo de rua
    const roadTypeConfidence: Record<string, number> = {
      'primary': 0.9,
      'secondary': 0.8,
      'tertiary': 0.7,
      'residential': 0.6,
      'living_street': 0.5,
      'pedestrian': 0.4,
      'service': 0.3,
      'footway': 0.2,
      'path': 0.1,
      'track': 0.1
    };
    
    const typeConfidence = roadTypeConfidence[street.type] || 0.5;
    confidence = (confidence + typeConfidence) / 2;
    
    // Ajustar baseado na acessibilidade
    if (street.accessibility === 'public') {
      confidence += 0.1;
    } else if (street.accessibility === 'private' || street.accessibility === 'no') {
      confidence -= 0.3;
    }
    
    // Ajustar baseado no contexto urbano
    if (context.urbanDensity.level === 'very_dense' && street.type === 'residential') {
      confidence += 0.1; // Ruas residenciais são mais importantes em áreas densas
    }
    
    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * NOVO: Calcula altura média dos prédios vizinhos para ajustar raio de visibilidade
   * COM CACHE para evitar re-queries (QUALIDADE > PERFORMANCE)
   */
  private async calculateSurroundingBuildingsHeight(
    poiLocation: { lat: number; lng: number },
    radius: number = 500
  ): Promise<{ average: number; max: number; buildingCount: number }> {
    // Verificar cache primeiro
    const cacheKey = `${poiLocation.lat.toFixed(4)},${poiLocation.lng.toFixed(4)},${radius}`;
    const cached = StreetAnalyzer.surroundingHeightCache.get(cacheKey);
    
      if (cached && (Date.now() - cached.timestamp) < StreetAnalyzer.CACHE_DURATION) {
      console.log(`🏙️ Using cached surrounding buildings data (${cached.data.buildingCount} buildings, avg: ${cached.data.average}m)`);
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
      console.log(`🏙️ Fetching surrounding buildings height data (${radius}m radius)...`);
      
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: query
      });
      
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
      
      // Armazenar no cache
      StreetAnalyzer.surroundingHeightCache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });
      
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
      
      // Query OSM para buscar ruas ao redor do ponto
      const query = `
[out:json][timeout:${TRIGGER_POINTS_CONSTANTS.timeouts.osmQueryVeryLong}];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$"]["access"!~"^(no)$"](around:${radius},${location.lat},${location.lng});
);
out geom tags;
`;
      
      console.log(`📝 OSM Query: point ${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}, ${radius}m radius`);
      
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query,
        headers: {
          'Content-Type': 'text/plain'
        }
      });
      
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
    
    const results: Array<{ street: StreetData; classification: 'front' | 'side' | 'back'; distance: number; hasBuildingsBlocking: boolean }> = [];
    
    for (const street of streets) {
      if (!street.coordinates || street.coordinates.length === 0) continue;
      
      // Encontrar ponto mais próximo da rua ao POI
      const closestStreetPoint = this.findClosestPointToLocation(street.coordinates, poiLocation);
      const distance = calculateDistance(poiLocation, closestStreetPoint);
      
      // Verificar se há buildings entre POI e rua
      const hasBuildingsBlocking = this.checkBuildingsBetweenPoints(poiLocation, closestStreetPoint, buildings);
      
      // Classificar rua
      let classification: 'front' | 'side' | 'back';
      if (hasBuildingsBlocking) {
        classification = 'back'; // Buildings bloqueando = rua de trás
      } else if (distance < 50) {
        classification = 'front'; // Mais próxima + sem buildings = frente
      } else if (distance < 100) {
        classification = 'side'; // Média distância + sem buildings = lado
      } else {
        classification = 'back'; // Distante = trás
      }
      
      results.push({
        street,
        classification,
        distance,
        hasBuildingsBlocking
      });
    }
    
    // Ordenar por distância (mais próxima primeiro)
    results.sort((a, b) => a.distance - b.distance);
    
    console.log(`📊 Block structure: ${results.filter(r => r.classification === 'front').length} front, ${results.filter(r => r.classification === 'side').length} side, ${results.filter(r => r.classification === 'back').length} back`);
    
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
   */
  private checkBuildingsBetweenPoints(
    point1: { lat: number; lng: number },
    point2: { lat: number; lng: number },
    buildings: any[]
  ): boolean {
    // Verificar se algum building está entre os dois pontos
    // Usar buffer de 20m ao redor da linha entre os pontos
    const bufferDistance = 20; // metros
    
    for (const building of buildings) {
      if (!building.geometry || building.geometry.length === 0) continue;
      
      // Calcular centroid do building
      const buildingCenter = this.calculateBuildingCentroid(building);
      
      // Calcular distância do building à linha entre os pontos
      const distanceToLine = calculateDistanceToLineSegment( // ✅ DRY: usar função SSOT
        buildingCenter,
        point1,
        point2
      );
      
      // Se building está próximo da linha (dentro do buffer), considera bloqueando
      if (distanceToLine <= bufferDistance) {
        // Verificar se building está entre os pontos (não apenas próximo)
        const distance1 = calculateDistance(point1, buildingCenter);
        const distance2 = calculateDistance(point2, buildingCenter);
        const lineDistance = calculateDistance(point1, point2);
        
        // Se building está entre os pontos (soma das distâncias ≈ distância da linha)
        if (Math.abs(distance1 + distance2 - lineDistance) < 30) {
          return true; // Building bloqueia
        }
      }
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

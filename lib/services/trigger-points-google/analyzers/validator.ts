// Validador e ranker de trigger points

import { POIData, GeographicContext, TriggerPointCandidate, TriggerPoint, BoundaryData } from '../types/interfaces';
import { calculateOptimalRadius, calculateDistance, calculateBearing, extractBuildingHeight, normalizeAngleDifference, isPointInPolygon, calculateDistanceToBoundary } from '../utils/calculations';
import { ElevationAnalysisService } from '../services/elevation-service';
import { loadTriggerPointsConfig, TriggerPointsConfig, TRIGGER_POINTS_CONSTANTS, POIGroup } from '../config/trigger-points-config';
import { GoogleAPIsService } from '../services/google-apis.service';
import { SRTMLocalService } from '../../srtm-local-service';
import { resolveStreetSpeedKmh, calculateGpsAwareRadius, isApproachableForBearing } from '../../../geometry';

export class TriggerPointValidator {
  // Cache para resultado de isPOIInUrbanCanyon (evita recalcular para cada candidato)
  private urbanCanyonCache: { result: boolean; boundaryId: string } | null = null;

  constructor(_googleAPIs: GoogleAPIsService) {
    // GoogleAPIs aceito por compat com construtor anterior, não usado.
  }

  /**
   * Calcula limite dinâmico de TPs baseado nos candidatos reais
   * NOVA FÓRMULA: Mais permissiva para itens altos e grandes
   */
  private calculateDynamicTPLimit(candidates: TriggerPointCandidate[], fallbackLimit: number, boundary?: BoundaryData, context?: GeographicContext, config?: TriggerPointsConfig): number {
    if (candidates.length === 0) {
      return Math.max(3, fallbackLimit);
    }
    
    // Carregar configuração
    const cfg = config || loadTriggerPointsConfig();
    
    // 🎯 NOVA LÓGICA: Base mais permissiva baseada em características do POI
    let basePercentage = cfg.maxTriggerPoints.basePercentage;
    let maxLimit = cfg.maxTriggerPoints.limits.max;
    
    // 🏢 AJUSTE POR ALTURA DO POI
    if (boundary?.height) {
      const poiHeight = boundary.height;
      if (poiHeight > TRIGGER_POINTS_CONSTANTS.height.extremelyTallThreshold) {
        // POIs muito altos (>100m) - muito mais permissivo
        basePercentage = cfg.maxTriggerPoints.heightAdjustments.extremely_tall.percentage;
        maxLimit = cfg.maxTriggerPoints.heightAdjustments.extremely_tall.maxLimit;
      } else if (poiHeight > TRIGGER_POINTS_CONSTANTS.height.veryTallThreshold) {
        // POIs altos (50-100m) - mais permissivo
        basePercentage = cfg.maxTriggerPoints.heightAdjustments.very_tall.percentage;
        maxLimit = cfg.maxTriggerPoints.heightAdjustments.very_tall.maxLimit;
      } else if (poiHeight > TRIGGER_POINTS_CONSTANTS.height.tallThreshold) {
        // POIs médios (20-50m) - moderadamente permissivo
        basePercentage = cfg.maxTriggerPoints.heightAdjustments.tall.percentage;
        maxLimit = cfg.maxTriggerPoints.heightAdjustments.tall.maxLimit;
      }
    }
    
    // 🏞️ AJUSTE POR ÁREA DO POI
    if (boundary?.area_m2) {
      const area = boundary.area_m2;
      if (area > TRIGGER_POINTS_CONSTANTS.height.veryLargeAreaThreshold) { // >1km²
        basePercentage = Math.max(basePercentage, cfg.maxTriggerPoints.areaAdjustments.very_large.percentage);
        maxLimit = Math.max(maxLimit, cfg.maxTriggerPoints.areaAdjustments.very_large.maxLimit);
      } else if (area > TRIGGER_POINTS_CONSTANTS.height.largeAreaThreshold) { // >0.5km²
        basePercentage = Math.max(basePercentage, cfg.maxTriggerPoints.areaAdjustments.large.percentage);
        maxLimit = Math.max(maxLimit, cfg.maxTriggerPoints.areaAdjustments.large.maxLimit);
      }
    }
    
    // 🏔️ AJUSTE POR ELEVAÇÃO (landmarks em montanhas)
    if (boundary?.elevation && context) {
      const elevationDiff = boundary.elevation.center - boundary.elevation.average;
      if (elevationDiff > TRIGGER_POINTS_CONSTANTS.height.highElevationThreshold) {
        basePercentage = Math.max(basePercentage, cfg.maxTriggerPoints.elevationAdjustments.high_landmark.percentage);
        maxLimit = Math.max(maxLimit, cfg.maxTriggerPoints.elevationAdjustments.high_landmark.maxLimit);
      }
    }
    
    // Calcular limite base
    const baseLimit = Math.min(Math.floor(candidates.length * basePercentage), maxLimit);
    
    // 🎯 NOVA ABORDAGEM: Confiar 100% no sistema de filtragem de visibilidade e qualidade
    // Removemos os multiplicadores artificiais e deixamos o sistema de validação fazer seu trabalho
    const finalLimit = Math.max(cfg.maxTriggerPoints.limits.min, baseLimit);
    
    
    return finalLimit;
  }

  /**
   * Valida e rankeia candidatos a trigger points (NOVO: distância mínima + visibilidade)
   * 🎯 ATUALIZADO: Usa configurações específicas do grupo do POI
   */
  async validateAndRankPoints(
    candidates: TriggerPointCandidate[],
    poiData: POIData,
    context: GeographicContext,
    boundary: BoundaryData,
    maxTriggerPoints: number = 50,
    minDistanceBetweenTPs: number = 40, // metros (aumentado para melhor qualidade)
    options: {
      simulateApproach?: boolean;
      validateCorridor?: boolean;
      clusterIntersections?: boolean;
      intersectionClusterRadiusM?: number;
    } = {}
  ): Promise<TriggerPoint[]> {
    // 🎯 USAR CONFIGURAÇÕES DO GRUPO DO POI (se disponível)
    if (boundary.classification) {
      const classification = boundary.classification;
      // Substituir parâmetros pelos do grupo
      maxTriggerPoints = classification.maxTriggerPoints;
      minDistanceBetweenTPs = classification.minDistanceBetweenTPs;
    }
    // 🚀 OTIMIZAÇÃO: Calcular elevação base UMA ÚNICA VEZ para evitar centenas de chamadas de API
    let baseElevation: number | null = null;
    if (boundary?.elevation && boundary.elevation.center > 0) {
      baseElevation = await ElevationAnalysisService.estimateRegionalBaseElevation(boundary.center, context, poiData);
    }
    
    // 🎯 NOVO: Confiar 100% no limite calculado pelo predictor (sem recalcular)
    // O predictor já calculou o limite baseado na área e características do POI
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
      
      
      // ✅ M2 v2: Validação de sentido de via reimplementada (issue 1.2).
      //
      // Por que isso importa: o app `tuggi-drive-v2` BLOQUEIA o trigger quando a
      // direção classificada (front/right/left/back) é "back". Um TP numa rua de
      // mão única que flui PARA LONGE do POI sempre disparará como "back", logo
      // nunca executará.
      //
      // Aqui descartamos candidatos cuja rua é one-way e cuja única direção de
      // tráfego resultaria em "back" relativo ao POI. Vias bidirecionais sempre
      // passam (alguém indo na direção certa pode disparar).
      // One-way validation:
      //
      // Modo fan: DESLIGADO. Motivo: a direção de way no OSM tem inconsistências
      // (alguns segmentos desenhados na direção contrária ao tráfego real),
      // gerando falsos positivos de rejeição em ruas de mão única famosas
      // (ex: 5th Ave em Manhattan). O app `tuggi-drive-v2` já filtra
      // `direction=back` em runtime — TPs gerados em ruas de mão errada
      // simplesmente não disparam, sem prejuízo. Aqui apenas LOGAMOS o que
      // SERIA rejeitado, pra monitoramento.
      //
      // Modo categórico (sem fan): mantém pre-filter (legado).
      const fanModeForOneway = !!boundary.visibilityFan?.polygons?.length;
      const onewayWouldReject: string[] = [];
      const onewayValidCandidates = basicValidCandidates.filter(c => {
        const streetTags: any = (c.street as any)?.tags || {};
        const oneway: string | undefined = streetTags.oneway;

        if (!oneway || oneway === 'no' || oneway === 'false' || oneway === '0') return true;

        const streetCoords = (c.street as any)?.coordinates;
        if (!streetCoords || streetCoords.length < 2) return true;

        // TP está DENTRO do boundary do POI? Não aplica one-way.
        if (isPointInPolygon(c.location, boundary.coordinates)) return true;

        const ok = isApproachableForBearing(streetCoords, oneway, c.expectedBearing);

        if (!ok) {
          onewayWouldReject.push(`${c.street?.id} (${(c.street as any)?.name || 'unnamed'}) oneway=${oneway}, bearing=${c.expectedBearing.toFixed(0)}°`);
          // Modo fan: NÃO descarta, só registra. Modo categórico: descarta.
          return fanModeForOneway;
        }
        return true;
      });

      if (onewayWouldReject.length > 0) {
        const action = fanModeForOneway ? 'flagged-only (fan mode, app filters runtime)' : 'DISCARDED';
        console.log(`🚦 One-way validation: ${action} ${onewayWouldReject.length}/${basicValidCandidates.length} candidate(s):`);
        for (const r of onewayWouldReject.slice(0, 10)) console.log(`   → ${r}`);
        if (onewayWouldReject.length > 10) console.log(`   → (+${onewayWouldReject.length - 10} more)`);
      }

      
      // ✅ ORDENAR POR PRIORIDADE (RÁPIDO - sem verificação de visibilidade)
      // Ordenar por prioridade: FRONT STREETS primeiro, depois por qualidade
      const rankedCandidates = onewayValidCandidates.sort((a, b) => {
        const aIsFrontStreet = this.isTPOnFrontStreet(a, boundary);
        const bIsFrontStreet = this.isTPOnFrontStreet(b, boundary);
        
        // Front streets têm prioridade máxima
        if (aIsFrontStreet && !bIsFrontStreet) return -1;
        if (!aIsFrontStreet && bIsFrontStreet) return 1;
        
        // Se ambos são front streets ou nenhum é, ordenar por qualidade
        return b.quality - a.quality;
      });
      
      
      // ✅ FILTRO DE PROXIMIDADE — duas variantes:
      //
      // Modo fan (type-aware smart dedup):
      //   - Pré-classifica cada candidato como 'primary' (alto valor: intersection,
      //     rua principal, perto do POI, addr:street match) ou 'secondary'.
      //   - Dedup com thresholds DIFERENTES por type:
      //       primary+primary próximos: 20m + 30° (muito permissivo)
      //       secondary+secondary próximos: 50m + 45° (atual)
      //       mixed (primary vs secondary próximos): primary sempre vence
      //
      // Modo categórico (fallback): spacing tradicional por distância apenas.
      const fanActiveForSpacing = !!boundary.visibilityFan?.polygons?.length;
      let distanceFilteredCandidates: TriggerPointCandidate[];
      if (fanActiveForSpacing) {
        // Tag cada candidato com primaryScore e predictedType
        this.classifyCandidatesByPrimaryScore(rankedCandidates, boundary);
        distanceFilteredCandidates = this.selectCandidatesWithTypeAwareDedup(rankedCandidates, dynamicMaxTPs);

        // Pós-processamento: intersection clustering.
        // Default ON em modo fan. Resolve "corner POIs" onde múltiplos segmentos
        // OSM do mesmo cruzamento (ruas diferentes) sobrevivem ao dedup
        // type-aware por terem bearings muito diferentes (>45°).
        const clusterEnabled = options.clusterIntersections !== false;
        if (clusterEnabled) {
          const radiusM = options.intersectionClusterRadiusM ?? 25;
          distanceFilteredCandidates = this.clusterIntersections(distanceFilteredCandidates, radiusM);
        }
      } else {
        distanceFilteredCandidates = this.selectCandidatesWithMinDistance(rankedCandidates, dynamicMaxTPs, minDistanceBetweenTPs, boundary, context);
      }

      // Validação de visibilidade já aconteceu via fan (ray-cast 2.5D) em
      // point-calculator.calculateFanWalkStrategy. Não precisa re-validar aqui.
      // Path categórico legado removido em Tier 3.1 (era onde filterByVisibilityOptimized rodava).
      const visibilityValidCandidates = distanceFilteredCandidates;

      // Issue 2.1 / 2.3 — Validação via OSRM (opt-in).
      // - simulateApproach: rotas reais que passam pelo TP em direção ao POI;
      //   rejeita se >50% das simulações resultarem em direction="back".
      // - validateCorridor: testa se a rua do TP de fato leva ao POI;
      //   rejeita se OSRM não roteia ou se o heading no TP difere >60° do bearing.
      // Ambos rodam DEPOIS da visibilidade (caros, ~1 HTTP por candidato × N).
      let postSimulationCandidates = visibilityValidCandidates;
      if ((options.simulateApproach || options.validateCorridor) && visibilityValidCandidates.length > 0) {
        const { ApproachSimulator } = await import('./approach-simulator');
        const survivors: TriggerPointCandidate[] = [];
        let rejectedSim = 0, rejectedCorridor = 0;
        for (const cand of visibilityValidCandidates) {
          const candRadius = this.calculateRadius(cand, context, boundary);

          if (options.validateCorridor) {
            const corridor = await ApproachSimulator.validateCorridor(cand, poiData.location, candRadius);
            if (!corridor.valid) { rejectedCorridor++; continue; }
          }
          if (options.simulateApproach) {
            const sim = await ApproachSimulator.simulate(cand, poiData.location, candRadius);
            if (sim.shouldReject) { rejectedSim++; continue; }
          }
          survivors.push(cand);
        }
        if (rejectedSim + rejectedCorridor > 0) {
          console.log(`🧭 OSRM filters: rejected ${rejectedSim} (approach) + ${rejectedCorridor} (corridor) / ${visibilityValidCandidates.length}`);
        }
        postSimulationCandidates = survivors;
      }

      // Converter candidatos validados para TriggerPoint[]
      const selectedTriggerPoints: TriggerPoint[] = [];
      for (let i = 0; i < postSimulationCandidates.length; i++) {
        const candidate = postSimulationCandidates[i];
        const triggerPoint = this.convertToTriggerPoint(candidate, i, boundary, context);
        selectedTriggerPoints.push(triggerPoint);
      }
      
      
      // ✅ REMOVER DUPLICATAS FINAIS
      const finalTriggerPoints = this.removeDuplicateTriggerPoints(selectedTriggerPoints);
      if (finalTriggerPoints.length !== selectedTriggerPoints.length) {
      }
      
      return finalTriggerPoints;
      
    } catch (error) {
      console.error('Error validating and ranking points:', error);
      return [];
    }
  }
  
  
  /**
   * Score-based classification — atribui `predictedType` e `primaryScore` a
   * cada candidato baseado em propriedades intrínsecas:
   *  - street class (motorway/primary > residential)
   *  - proximidade ao boundary (mais perto = melhor)
   *  - intersection (≥1 outro candidato com street.id diferente em raio 30m)
   *  - addr:street match (rua = endereço OSM do POI)
   *
   * Score >= 0.55 → primary, senão → secondary.
   * Substitui o velho `determineTriggerType` baseado em índice.
   */
  private classifyCandidatesByPrimaryScore(
    candidates: TriggerPointCandidate[],
    boundary: BoundaryData
  ): void {
    // FIXES (round 2):
    //  - proximity agora usa `calculateDistanceToBoundary` (distância à aresta,
    //    0 se dentro do polígono). Antes usava centroide, o que dava bônus
    //    baixo pra TPs em cantos de POIs grandes.
    //  - threshold 0.55 → 0.50 (achievable por secondary street + edge + intersection)
    //  - intersection bonus 0.15 → 0.20 (esquinas valem mais)
    const PRIMARY_THRESHOLD = 0.50;
    const INTERSECTION_RADIUS_M = 30;
    const INTERSECTION_BONUS = 0.20;
    const addrStreet = (boundary.address?.street || '').toLowerCase().trim();

    const streetClassScore: Record<string, number> = {
      motorway: 0.30,
      trunk: 0.25,
      primary: 0.20,
      secondary: 0.15,
      tertiary: 0.10,
      residential: 0.05,
      unclassified: 0.03,
      living_street: 0.03,
      service: 0.02,
      pedestrian: 0.05,
    };

    let primaryCount = 0;
    for (const cand of candidates) {
      let score = 0;
      const breakdown: any = {};

      // 1. Street class
      const sc = streetClassScore[cand.street?.type] ?? 0;
      score += sc; breakdown.streetClass = sc;

      // 2. Proximity to boundary EDGE (FIX: usa distância à aresta, 0 se dentro)
      const distToEdge = calculateDistanceToBoundary(cand.location, boundary.coordinates);
      let proximityBonus = 0;
      if (distToEdge <= 30) proximityBonus = 0.15;
      else if (distToEdge <= 100) proximityBonus = 0.10;
      else if (distToEdge <= 500) proximityBonus = 0.05;
      score += proximityBonus; breakdown.proximity = proximityBonus;

      // 3. Intersection: outro candidato com street.id diferente em raio 30m
      const hasIntersection = candidates.some(other => {
        if (other === cand) return false;
        if (String(other.street?.id) === String(cand.street?.id)) return false;
        return calculateDistance(other.location, cand.location) < INTERSECTION_RADIUS_M;
      });
      const interBonus = hasIntersection ? INTERSECTION_BONUS : 0;
      score += interBonus; breakdown.intersection = interBonus;

      // 4. addr:street match (POI's named front street)
      let addrBonus = 0;
      if (addrStreet) {
        const sName = (cand.street?.name || '').toLowerCase().trim();
        if (sName && (sName.includes(addrStreet) || addrStreet.includes(sName))) {
          addrBonus = 0.20;
        }
      }
      score += addrBonus; breakdown.addrMatch = addrBonus;

      cand.primaryScore = Math.round(score * 100) / 100;
      cand.predictedType = score >= PRIMARY_THRESHOLD ? 'primary' : 'secondary';
      cand.metadata = { ...(cand.metadata || {}), primaryScoreBreakdown: breakdown };

      if (cand.predictedType === 'primary') primaryCount++;
    }

    console.log(`🏷️ Classification: ${primaryCount} primary / ${candidates.length - primaryCount} secondary (threshold=${PRIMARY_THRESHOLD})`);
  }

  /**
   * Type-aware dedup. Aplica thresholds DIFERENTES por type:
   *  - primary+primary próximos: 20m + 30° (muito permissivo)
   *  - secondary+secondary próximos: 50m + 45° (atual)
   *  - mixed: primary vence, secondary descartado
   *
   * Ordem de processamento: primaries primeiro (asc quality), depois secondaries
   * (asc quality). Isso garante que primaries "ocupam" o espaço antes dos
   * secondaries serem avaliados.
   */
  private selectCandidatesWithTypeAwareDedup(
    candidates: TriggerPointCandidate[],
    maxTriggerPoints: number
  ): TriggerPointCandidate[] {
    // Sort: primaries primeiro, dentro de cada grupo por quality desc
    const sorted = [...candidates].sort((a, b) => {
      const aPrim = a.predictedType === 'primary' ? 1 : 0;
      const bPrim = b.predictedType === 'primary' ? 1 : 0;
      if (aPrim !== bPrim) return bPrim - aPrim;
      return b.quality - a.quality;
    });

    const selected: TriggerPointCandidate[] = [];
    let droppedRedundant = 0;
    let droppedByMixed = 0;
    let droppedByCap = 0;

    // Thresholds bumpados (round 2):
    //  - Hard floor 15m: pares < 15m sempre dedup (radii sobrepostos, duplicata física)
    //  - Primary+Primary: 30m + 45° (era 20m + 30°)
    //  - Secondary+Secondary: 70m + 60° (era 50m + 45°)
    //  - Primary absorve Secondary: 70m + 60° (era 50m + 45°)
    const HARD_FLOOR_M = 15;

    for (const cand of sorted) {
      if (selected.length >= maxTriggerPoints) { droppedByCap++; continue; }

      const candType = cand.predictedType || 'secondary';
      let isRedundant = false;

      for (const existing of selected) {
        const existingType = existing.predictedType || 'secondary';
        const dist = calculateDistance(cand.location, existing.location);
        const bearingDiff = Math.abs(normalizeAngleDifference(existing.expectedBearing - cand.expectedBearing));
        const qualityGap = existing.quality - cand.quality;

        // Hard floor: TPs colados são duplicata física, dropa independente de type/bearing
        if (dist < HARD_FLOOR_M) {
          isRedundant = true;
          droppedRedundant++;
          break;
        }

        let thresholdDist: number, thresholdBearing: number, requireQualityGap: boolean;
        if (candType === 'primary' && existingType === 'primary') {
          // Primary vs Primary: permissivo
          thresholdDist = 30; thresholdBearing = 45; requireQualityGap = true;
        } else if (candType === 'primary' && existingType === 'secondary') {
          // Primary sendo avaliado contra Secondary — primary nunca perde
          continue;
        } else if (candType === 'secondary' && existingType === 'primary') {
          // Mixed: secondary perde pra primary se "próximos"
          thresholdDist = 70; thresholdBearing = 60; requireQualityGap = false;
          if (dist < thresholdDist && bearingDiff < thresholdBearing) {
            isRedundant = true;
            droppedByMixed++;
            break;
          }
          continue;
        } else {
          // Secondary vs Secondary: mais agressivo
          thresholdDist = 70; thresholdBearing = 60; requireQualityGap = true;
        }

        if (dist < thresholdDist && bearingDiff < thresholdBearing) {
          if (requireQualityGap && qualityGap < 0.05) continue;
          isRedundant = true;
          droppedRedundant++;
          break;
        }
      }

      if (!isRedundant) selected.push(cand);
    }

    const finalPrim = selected.filter(c => c.predictedType === 'primary').length;
    const finalSec = selected.length - finalPrim;
    console.log(
      `🏷️ Type-aware dedup: kept ${selected.length}/${candidates.length} (${finalPrim} primary + ${finalSec} secondary). ` +
      `Dropped: ${droppedRedundant} redundant same-type, ${droppedByMixed} secondary-absorbed-by-primary, ${droppedByCap} by cap.`
    );
    return selected;
  }

  /**
   * Intersection clustering (pós-dedup).
   *
   * O type-aware dedup é bearing-aware: dois TPs próximos com bearings >45°
   * de diferença são considerados approaches distintos e ambos sobrevivem.
   * Isso é correto pra ruas paralelas / approaches por lados opostos do POI,
   * mas falha em "corner POIs" — cruzamentos onde 3-4 segmentos OSM de ruas
   * diferentes geram TPs nos 25m do mesmo cruzamento, cada um apontando pra
   * um lado. Bearings divergem 90°+, dedup mantém todos.
   *
   * Esta passagem agrupa TPs que estão a ≤`radiusM` metros DE OUTRO TP em
   * uma **rua diferente** (street.id distinto). Mantém o de melhor score
   * dentro do cluster, descarta os demais.
   *
   * Não toca TPs próximos na MESMA rua — esses são spacing legítimo
   * (FAN-WALK soltou candidatos a cada 40m, dedup já filtrou colados).
   */
  private clusterIntersections(
    candidates: TriggerPointCandidate[],
    radiusM: number
  ): TriggerPointCandidate[] {
    if (candidates.length <= 1) return candidates;

    // Ordem: primary > secondary; depois primaryScore desc; depois quality desc.
    const sorted = [...candidates].sort((a, b) => {
      const aPrim = a.predictedType === 'primary' ? 1 : 0;
      const bPrim = b.predictedType === 'primary' ? 1 : 0;
      if (aPrim !== bPrim) return bPrim - aPrim;
      const aScore = a.primaryScore ?? a.quality;
      const bScore = b.primaryScore ?? b.quality;
      if (aScore !== bScore) return bScore - aScore;
      return b.quality - a.quality;
    });

    const selected: TriggerPointCandidate[] = [];
    const clusterLog: string[] = [];

    for (const cand of sorted) {
      const candStreetId = String(cand.street?.id ?? '');

      // É descartado se houver TP já selecionado em raio `radiusM` numa rua
      // diferente. Mesmo street.id próximo é spacing legítimo — não toca.
      const winner = selected.find(existing => {
        const existingStreetId = String(existing.street?.id ?? '');
        if (!candStreetId || !existingStreetId) return false;
        if (existingStreetId === candStreetId) return false;
        return calculateDistance(cand.location, existing.location) < radiusM;
      });

      if (winner) {
        const dropName = cand.street?.name || cand.street?.id || '?';
        const winName = winner.street?.name || winner.street?.id || '?';
        clusterLog.push(`${dropName} (score=${(cand.primaryScore ?? cand.quality).toFixed(2)}) → ${winName} (score=${(winner.primaryScore ?? winner.quality).toFixed(2)})`);
        continue;
      }

      selected.push(cand);
    }

    const dropped = candidates.length - selected.length;
    if (dropped > 0) {
      console.log(
        `🔀 Intersection clustering: kept ${selected.length}/${candidates.length} ` +
        `(dropped ${dropped} TPs within ${radiusM}m of a higher-ranked TP on a different street).`
      );
      for (const line of clusterLog.slice(0, 10)) console.log(`   → ${line}`);
      if (clusterLog.length > 10) console.log(`   → (+${clusterLog.length - 10} more)`);
    }
    return selected;
  }

  /**
   * Smart dedup bearing-aware (modo fan).
   *
   * Princípio: dois candidatos são considerados "duplicatas" só quando
   * fisicamente próximos E apontando pra mesma direção. Caso contrário,
   * mesmo se próximos, ambos são mantidos (ruas perpendiculares no cruzamento,
   * ruas paralelas próximas, approaches distintos).
   *
   * "Errar por mais": empate de quality (diff < threshold) mantém os dois.
   * Só dropa o claramente pior.
   *
   * Complexidade: O(n²) por par. Pra n típico (<300 candidatos) é trivial.
   */
  private selectCandidatesWithBearingDedup(
    rankedCandidates: TriggerPointCandidate[],
    maxTriggerPoints: number,
    config: { proximityM: number; bearingDeltaDeg: number; qualityTieDelta: number }
  ): TriggerPointCandidate[] {
    const selected: TriggerPointCandidate[] = [];
    let droppedRedundant = 0;
    let droppedByCap = 0;

    // Já chega ordenado por (front-street, quality desc). Iteração greedy.
    for (const cand of rankedCandidates) {
      if (selected.length >= maxTriggerPoints) {
        droppedByCap++;
        continue;
      }

      const isRedundant = selected.some(existing => {
        const dist = calculateDistance(cand.location, existing.location);
        if (dist >= config.proximityM) return false;

        // Diferença angular tratada com wrap-around (0/360°)
        const diff = Math.abs(normalizeAngleDifference(existing.expectedBearing - cand.expectedBearing));
        if (diff >= config.bearingDeltaDeg) return false;

        // Empate de quality: NÃO considera redundante (mantém ambos)
        const qualityGap = existing.quality - cand.quality;
        if (qualityGap < config.qualityTieDelta) return false;

        // Caiu nos 3 critérios → redundante de fato
        return true;
      });

      if (isRedundant) {
        droppedRedundant++;
        continue;
      }

      selected.push(cand);
    }

    console.log(`👁️ Smart dedup: kept ${selected.length}/${rankedCandidates.length} (dropped ${droppedRedundant} as redundant, ${droppedByCap} by max cap=${maxTriggerPoints}). Thresholds: dist<${config.proximityM}m AND |Δbearing|<${config.bearingDeltaDeg}° AND Δquality≥${config.qualityTieDelta}`);
    return selected;
  }

  /**
   * NOVO: Seleciona candidatos garantindo distância mínima entre eles (mantém como candidatos)
   * ✅ OTIMIZAÇÃO: Mantém candidatos para aplicar verificação de visibilidade depois
   */
  private selectCandidatesWithMinDistance(
    rankedCandidates: TriggerPointCandidate[],
    maxTriggerPoints: number,
    minDistance: number,
    boundary: BoundaryData,
    context: GeographicContext
  ): TriggerPointCandidate[] {
    const selectedCandidates: TriggerPointCandidate[] = [];
    let rejectedCount = 0;
    
    // Issue 2.4b — Cobertura completa. Apenas honramos `minDistance` configurada
    // (vinda de `GROUP_CONFIGS.minDistanceBetweenTPs`). Removidos:
    //  1. O override "forced 60m para POIs pequenos" — bloqueava cobertura em pier/edifícios.
    //  2. O override "forced 80m para FLAT+dense" — bloqueava cobertura em parques urbanos.
    //  3. A duplicação do raio (`STANDARD_TP_RADIUS * 2`) — usava valor hardcoded de 20m
    //     e era inconsistente com o radius adaptativo (audio-aware). Esse "espaçamento de
    //     segurança" não tem propósito funcional: o app já tem cooldown de 10min por POI,
    //     então TPs próximos não causam disparos duplicados.
    const adjustedMinDistance = minDistance;
    const minDistanceBetweenCenters = adjustedMinDistance;
    
    for (const candidate of rankedCandidates) {
      // Verificar se já temos o máximo de candidatos
      if (selectedCandidates.length >= maxTriggerPoints) {
        break;
      }
      
      // Verificar distância mínima com candidatos já selecionados
      const isTooClose = selectedCandidates.some(existing => {
        const distanceBetweenCenters = calculateDistance(candidate.location, existing.location);
        return distanceBetweenCenters < minDistanceBetweenCenters;
      });
      
      if (isTooClose) {
        rejectedCount++;
        continue;
      }
      
      // Candidato aprovado - manter como candidato (não converter ainda)
      selectedCandidates.push(candidate);
    }
    
    return selectedCandidates;
  }

  /**
   * LEGACY: Seleciona TPs garantindo distância mínima entre eles (converte para TriggerPoint)
   * ⚠️ Usado apenas quando necessário converter diretamente para TriggerPoint
   */
  private selectTriggerPointsWithMinDistance(
    rankedCandidates: TriggerPointCandidate[],
    maxTriggerPoints: number,
    minDistance: number,
    boundary: BoundaryData,
    context: GeographicContext
  ): TriggerPoint[] {
    const selectedTPs: TriggerPoint[] = [];
    let rejectedCount = 0;
    
    // Issue 2.4b — Cobertura completa (mesma lógica de selectCandidatesWithMinDistance):
    // honra apenas `minDistance` da config; sem overrides forçados nem duplicação de raio.
    const adjustedMinDistance = minDistance;
    const minDistanceBetweenCenters = adjustedMinDistance;
    
    for (const candidate of rankedCandidates) {
      if (selectedTPs.length >= maxTriggerPoints) break;
      
      const isTooClose = selectedTPs.some(existingTP => {
        const distanceBetweenCenters = calculateDistance(candidate.location, existingTP.location);
        return distanceBetweenCenters < minDistanceBetweenCenters;
      });
      
      if (isTooClose) {
        rejectedCount++;
        continue;
      }
      
      const triggerPoint = this.convertToTriggerPoint(candidate, selectedTPs.length, boundary, context);
      selectedTPs.push(triggerPoint);
    }
    
    return selectedTPs;
  }

  private calculateBuildingCentroid(building: any): { lat: number; lng: number } {
    if (!building.geometry || building.geometry.length === 0) {
      return { lat: building.lat || 0, lng: building.lon || 0 };
    }

    let sumLat = 0;
    let sumLng = 0;
    let count = 0;

    for (const point of building.geometry) {
      sumLat += point.lat;
      sumLng += (point.lng !== undefined ? point.lng : point.lon);
      count++;
    }

    return {
      lat: sumLat / count,
      lng: sumLng / count
    };
  }

  /**
   * Calcula distância de um ponto a uma linha
   */
  private calculateDistanceToLine(
    lineStart: { lat: number; lng: number },
    lineEnd: { lat: number; lng: number },
    point: { lat: number; lng: number }
  ): number {
    // Implementação simplificada usando distância perpendicular
    const A = lineEnd.lat - lineStart.lat;
    const B = lineStart.lng - lineEnd.lng;
    const C = lineEnd.lng * lineStart.lat - lineStart.lng * lineEnd.lat;
    
    const distance = Math.abs(A * point.lng + B * point.lat + C) / Math.sqrt(A * A + B * B);
    
    // Converter para metros (aproximação)
    return distance * 111000; // 1 grau ≈ 111km
  }

  /**
   * 🔥 NOVA: Usa a lógica ORIGINAL de validação com buildings já carregados (sem API calls)
   * Agora considera altura do POI para validação correta
   * 
   * 🏙️ CANYON URBANO: Em áreas densas, prédios vizinhos sem altura conhecida
   * assumem altura SIMILAR ao POI (ex: Copan 110m = vizinhos ~110m)
   */
  private checkCachedBuildingsBlocking(
    tpLocation: { lat: number; lng: number },
    boundaryPoint: { lat: number; lng: number },
    buildings: any[],
    context: GeographicContext,
    poiHeight: number = 0
  ): boolean {
    try {
      const distance = calculateDistance(tpLocation, boundaryPoint);
      const isDenseZone = context.urbanDensity.level === 'very_dense' || context.urbanDensity.level === 'dense';
      const isUrbanCanyon = isDenseZone && poiHeight > 20; // Canyon = zona densa + POI alto
      
      // 🏠 CONSTANTE ALTURA DE CASAS (6m)
      const DEFAULT_HOUSE_HEIGHT = TRIGGER_POINTS_CONSTANTS.obstructions.defaultHouseHeight || 6;
      
      // 🏙️ CONFIGURAÇÃO DE CANYON URBANO
      const useCanyonNeighborHeight = TRIGGER_POINTS_CONSTANTS.obstructions.useCanyonNeighborHeight ?? true;
      const canyonHeightMultiplier = TRIGGER_POINTS_CONSTANTS.obstructions.canyonHeightMultiplier ?? 1.0;
      const minBlockingHeight = TRIGGER_POINTS_CONSTANTS.obstructions.minBlockingHeight ?? 3;
      
      // 🎯 VALIDAÇÃO RIGOROSA PARA POIs BAIXOS (FLAT)
      // Para POIs com 0m de altura, qualquer building entre TP e POI bloqueia
      if (poiHeight === 0 || poiHeight < 5) {
        for (const building of buildings) {
          let buildingHeight = extractBuildingHeight(building.tags) || building.height || 0;
          
          // 🏠 Se não tem altura, assumir altura de casa (6m) - CONSERVADOR
          if (!buildingHeight || buildingHeight <= 0) {
            buildingHeight = DEFAULT_HOUSE_HEIGHT;
          }
          
          const intersects = this.checkBuildingIntersectsLine(building, tpLocation, boundaryPoint);
          if (intersects) {
            // Para POI FLAT, qualquer building > minBlockingHeight (3m) bloqueia
            if (buildingHeight > minBlockingHeight) {
              console.log(`🚫 FLAT POI BLOCKED: Building (${buildingHeight}m) blocks FLAT POI (${poiHeight}m) - TP REJECTED`);
              return true; // BLOQUEADO
            }
          }
        }
      }
      
      // Validação para POIs com altura (inclui lógica de CANYON URBANO)
      for (const building of buildings) {
        let buildingHeight = extractBuildingHeight(building.tags) || building.height || 0;
        const buildingTags = building.tags || {};
        const buildingType = buildingTags.building?.toLowerCase() || '';
        
        // 🏙️ LÓGICA DE CANYON URBANO
        // Em canyons urbanos, prédios vizinhos assumem altura SIMILAR ao POI
        if (isUrbanCanyon && useCanyonNeighborHeight) {
          const hasUnknownHeight = !buildingHeight || buildingHeight <= 0;
          const hasGenericTag = buildingType === 'yes' || buildingType === '' || buildingType === 'building';
          
          if (hasUnknownHeight || hasGenericTag) {
            buildingHeight = Math.round(poiHeight * canyonHeightMultiplier);
            // Log aleatório para não poluir
            if (Math.random() < 0.01) {
              console.log(`🏙️ CANYON MODE: Vizinhos sem altura assumindo ~${buildingHeight}m (POI: ${poiHeight}m)`);
            }
          }
        } else if (!buildingHeight || buildingHeight <= 0) {
          buildingHeight = DEFAULT_HOUSE_HEIGHT;
        }
        
        // 🔥 USAR LÓGICA ORIGINAL: verificar se building intersecta linha de visão
        const intersects = this.checkBuildingIntersectsLine(building, tpLocation, boundaryPoint);
        
        if (intersects) {
          const buildingCenter = this.calculateBuildingCentroid(building);
          const distanceFromTP = calculateDistance(tpLocation, buildingCenter);
          
          // 🎯 VALIDAÇÃO CONSIDERANDO ALTURA DO POI
          if (poiHeight > 0) {
            // Se POI tem altura conhecida, comparar com building
            const blockingRatio = TRIGGER_POINTS_CONSTANTS.obstructions.buildingBlockingRatio; // 0.6 (60%)
            if (buildingHeight >= poiHeight * blockingRatio) {
              console.log(`🚫 BLOCKED: Building (${buildingHeight}m) blocks POI (${poiHeight}m) view - TP REJECTED`);
              return true; // BLOQUEADO
            }
            // Se building é menor que 60% da altura do POI, pode ver por cima
            continue;
          }
          
          // 🔥 VALIDAÇÃO ORIGINAL RIGOROSA (POI sem altura conhecida)
          if (isDenseZone) {
            // Em zonas densas, ser mais rigoroso
            if (buildingHeight > 8) {
              console.log(`🏢 DENSE ZONE BLOCKED: Tall building (${buildingHeight}m) blocks line of sight`);
              return true; // BLOQUEADO
            }
          } else {
            // Em zonas normais, usar altura mínima
            if (buildingHeight > 15) {
              console.log(`🚫 BLOCKED: Tall building (${buildingHeight}m) blocks unknown POI height - TP REJECTED`);
              return true; // BLOQUEADO
            } else if (buildingHeight > TRIGGER_POINTS_CONSTANTS.obstructions.mediumBuildingHeight && distanceFromTP < TRIGGER_POINTS_CONSTANTS.obstructions.closeDistanceThreshold) {
              console.log(`🚫 BLOCKED: Medium building (${buildingHeight}m) too close (${distanceFromTP.toFixed(0)}m) - TP REJECTED`);
              return true; // BLOQUEADO
            }
          }
        }
      }
      
      return false; // NÃO BLOQUEADO
      
    } catch (error) {
      console.warn('Cached buildings blocking check failed:', error);
      // Em caso de erro, ser conservador - BLOQUEAR em zonas densas
      const isDenseZone = context.urbanDensity.level === 'very_dense' || context.urbanDensity.level === 'dense';
      return isDenseZone; // Em zonas densas, BLOQUEAR se não conseguir verificar (conservador)
    }
  }

  /**
   * Verifica se um building intersecta a linha de visão (lógica original)
   */
  private checkBuildingIntersectsLine(
    building: any,
    tpLocation: { lat: number; lng: number },
    boundaryPoint: { lat: number; lng: number }
  ): boolean {
    if (!building.geometry || building.geometry.length < 3) return false;
    
    // Converter geometry OSM para formato usado na validação original
    const buildingCoords = building.geometry.map((coord: any) => ({
      lat: coord.lat,
      lng: coord.lng !== undefined ? coord.lng : coord.lon
    }));
    
    // Usar ray-casting para verificar se a linha intersecta o polígono do building
    return this.lineIntersectsPolygon(tpLocation, boundaryPoint, buildingCoords);
  }

  /**
   * Verificação rápida de visibilidade usando apenas buildings OSM
   */
  private analyzeBuildingsWithHeightInDenseZone(
    buildings: any[],
    tpLocation: { lat: number; lng: number },
    boundaryPoint: { lat: number; lng: number },
    context: GeographicContext
  ): boolean {
    let blockingBuildings = 0;
    let totalBuildingHeight = 0;
    let buildingsWithHeight = 0;

    for (const building of buildings) {
      if (building.geometry && building.geometry.length > 3) {
        const buildingCoords = building.geometry.map((coord: any) => ({
          lat: coord.lat,
          lng: coord.lng !== undefined ? coord.lng : coord.lon
        }));

        // Verificar se building intersecta linha de visão
        if (this.lineIntersectsPolygon(tpLocation, boundaryPoint, buildingCoords)) {
          blockingBuildings++;
          
          // Analisar altura do building
          const buildingHeight = extractBuildingHeight(building.tags) || building.height || 0;
          if (buildingHeight && buildingHeight > 0) {
            totalBuildingHeight += buildingHeight;
            buildingsWithHeight++;
            
            // REGRA RIGOROSA: Buildings altos (>15m) em zonas densas = bloqueio automático
            if (buildingHeight > 15) {
              console.log(`🏢 DENSE ZONE BLOCKED: Tall building (${buildingHeight}m) blocks line of sight`);
              return false;
            }
          } else {
            // Se não tem altura definida em zona densa, assumir altura padrão (12m = 4 andares)
            const assumedHeight = 12;
            totalBuildingHeight += assumedHeight;
            buildingsWithHeight++;
            console.log(`🏢 DENSE ZONE: Assuming ${assumedHeight}m height for building without height data`);
          }
        }
      }
    }

    // REGRA ESPECIAL PARA ZONAS DENSAS
    if (blockingBuildings > 0) {
      const avgBuildingHeight = buildingsWithHeight > 0 ? totalBuildingHeight / buildingsWithHeight : 12;
      
      console.log(`🏙️ DENSE ZONE ANALYSIS: ${blockingBuildings} blocking buildings, avg height: ${avgBuildingHeight.toFixed(1)}m`);
      
      // Se há múltiplos buildings bloqueando OU altura média alta = rejeitar TP
      if (blockingBuildings >= 2 || avgBuildingHeight > 10) {
        console.log(`🚫 DENSE ZONE REJECTED: Multiple buildings (${blockingBuildings}) or high buildings (${avgBuildingHeight.toFixed(1)}m avg)`);
        return false;
      }
      
      // Building único e baixo = aceitar com cuidado
      console.log(`⚠️ DENSE ZONE CAUTIOUS: Single low building, allowing TP`);
      return true;
    }
      console.log(`✅ DENSE ZONE CLEAR: No blocking buildings found`);
    return true;
  }
  
  // === HELPER METHODS ===
  
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
  
  
  private calculateMidpoint(
    point1: { lat: number; lng: number },
    point2: { lat: number; lng: number }
  ): { lat: number; lng: number } {
    return {
      lat: (point1.lat + point2.lat) / 2,
      lng: (point1.lng + point2.lng) / 2
    };
  }
  
  private lineIntersectsPolygon(
    lineStart: { lat: number; lng: number },
    lineEnd: { lat: number; lng: number },
    polygon: Array<{ lat: number; lng: number }>
  ): boolean {
    // Verificar se a linha cruza alguma aresta do polígono
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
  

  /**
   * Verifica se um candidato é válido
   */
  private async isValidCandidate(
    candidate: TriggerPointCandidate,
    poiData: POIData,
    context: GeographicContext,
    boundary?: BoundaryData,
    cachedBaseElevation?: number | null
  ): Promise<boolean> {
    // Verificar qualidade mínima
    if (candidate.quality < 0.3) {
      console.log(`🚫 Candidate rejected: quality ${candidate.quality.toFixed(2)} < 0.3`);
      return false;
    }

    // Issue 2.7 — Speed-aware filter: descartar TPs em vias rápidas (>80 km/h)
    // para POIs FLAT muito baixos (<10m). A janela visual a 80+ km/h é curta
    // demais para o motorista identificar uma estrutura baixa.
    const streetTags: any = (candidate.street as any)?.tags || {};
    const speedKmh = resolveStreetSpeedKmh(streetTags.maxspeed, candidate.street?.type);
    const poiHeight = boundary?.height ?? 0;
    if (speedKmh > 80 && poiHeight > 0 && poiHeight < 10) {
      console.log(`🚫 Candidate rejected: high-speed road (${speedKmh}km/h) + low POI (${poiHeight}m)`);
      return false;
    }
    
    // Distância máxima do candidato ao centroide do POI.
    //
    // Modo fan-driven: PULA a checagem por completo. O FAN-WALK já filtrou
    // fisicamente (fan polygons + boundary + safety 100m). Se um candidato
    // chegou aqui, ele passou pela visibilidade — não há razão pra rejeitar
    // por distância arbitrária. Casos típicos onde a regra antiga atrapalha:
    //  - POIs storefront com fan degenerado (max=30m): a regra rejeitava TPs
    //    legítimos em ruas adjacentes a 35-100m.
    //  - Infraestruturas vizinhas visíveis (Roosevelt Island Bridge a 1.5km
    //    da Queensboro): a regra cortava antes mesmo do fan opinar.
    //
    // Modo categórico (fallback, sem fan): mantém regra antiga.
    const fanForDistance = !!boundary?.visibilityFan?.polygons?.length;
    if (!fanForDistance) {
      let maxDistance = 1000;
      if (boundary?.elevation && boundary.elevation.center > 0 && cachedBaseElevation !== null) {
        const poiElevation = boundary.elevation.center;
        const baseElevation = cachedBaseElevation || await ElevationAnalysisService.estimateRegionalBaseElevation(boundary.center, context, poiData);
        const elevationDiff = poiElevation - baseElevation;
        if (elevationDiff > 150) maxDistance = 15000;
        else if (elevationDiff > 50) maxDistance = 4000;
      } else if (context.urbanDensity.level === 'rural') {
        maxDistance = 3000;
        console.log(`🌾 Rural area without elevation data → extending max distance to ${maxDistance}m`);
      }

      if (candidate.distance > maxDistance) {
        console.log(`🚫 Candidate rejected: distance ${candidate.distance.toFixed(0)}m > ${maxDistance}m`);
        return false;
      }
    }

    // Verificar acessibilidade
    if (!this.isAccessible(candidate.location, context)) {
      console.log(`🚫 Candidate rejected: not accessible`);
      return false;
    }
    
    // Verificar confiança mínima
    if (candidate.confidence < TRIGGER_POINTS_CONSTANTS.scores.minConfidence) {
      //console.log(`🚫 Candidate rejected: confidence ${candidate.confidence.toFixed(2)} < 0.2`);
      return false;
    }
    
   // console.log(`✅ Candidate accepted: distance ${candidate.distance.toFixed(0)}m, quality ${candidate.quality.toFixed(2)}, confidence ${candidate.confidence.toFixed(2)}`);
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
    boundary: BoundaryData,
    context: GeographicContext
  ): TriggerPoint {
    const id = this.generateTriggerPointId(boundary, candidate);
    // Prefere o type pré-computado por `classifyCandidatesByPrimaryScore`
    // (intrínseco: street class + proximity + intersection + addr:street).
    // Fallback pro velho `determineTriggerType` (baseado em índice) quando o
    // pré-computado não está disponível (modo categórico, sem fan).
    const type = candidate.predictedType
      || this.determineTriggerType(index, candidate.quality, candidate, boundary, context);
    const priority = index + 1;
    const radius = this.calculateRadius(candidate, context, boundary);
    
    return {
      id,
      location: candidate.location,
      radius,
      expectedBearing: candidate.expectedBearing,
      bearingThreshold: TRIGGER_POINTS_CONSTANTS.triggerPoint.defaultBearingThreshold,
      type,
      priority,
      confidence: candidate.confidence,
      quality: candidate.quality,
      street: candidate.street,
      distance: candidate.distance,
      generationMethod: 'local_osm',
      contextData: context,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }
  
  /**
   * Determina o tipo de trigger point baseado na posição, qualidade e contexto urbano
   */
  private determineTriggerType(
    index: number, 
    quality: number, 
    candidate: TriggerPointCandidate,
    boundary: BoundaryData,
    context: GeographicContext
  ): 'primary' | 'secondary' | 'fallback' {
    
    // NOVO: Verificar se POI está em canyon urbano (cercado por prédios)
    // Nota: Resultado é cacheado, então não há overhead em chamar múltiplas vezes
    const isUrbanCanyon = this.isPOIInUrbanCanyon(boundary, context);
    
    if (isUrbanCanyon) {
      // Em canyon urbano, critérios mais rigorosos
      if (index < 2 && quality > 0.8) {
        return 'primary'; // Apenas 2 primários, qualidade muito alta
      }
      
      if (quality > 0.7) {
        return 'secondary'; // Qualidade alta para secundários
      }
      
      // Qualidade baixa em canyon = fallback
      return 'fallback';
    }
    
    // Lógica original para áreas não-canyon
    if (index < 3 && quality > 0.7) {
      return 'primary';
    }
    
    if (quality > 0.5) {
      return 'secondary';
    }
    
    return 'fallback';
  }
  
  /**
   * Verifica se o TP está na rua da frente do POI (visibilidade garantida)
   */
  private isTPOnFrontStreet(candidate: TriggerPointCandidate, boundary: BoundaryData): boolean {
    // 1. Verificar se o POI tem informações de endereço (addr:street)
    if (boundary.address?.street) {
      const frontStreetName = boundary.address.street.toLowerCase();
      const candidateStreetName = candidate.street.name?.toLowerCase();
      
      if (candidateStreetName && frontStreetName.includes(candidateStreetName)) {
        console.log(`🏠 Front street match: "${candidateStreetName}" matches POI address "${frontStreetName}"`);
        return true;
      }
    }
    
    // 2. Verificar se TP está muito próximo (menos de 30m) - provavelmente na frente
    const nearestBoundaryPoint = this.findNearestBoundaryPoint(candidate.location, boundary.coordinates);
    const distance = calculateDistance(candidate.location, nearestBoundaryPoint);
    
    if (distance < 30) {
      // console.log(`🏠 Very close to POI (${distance.toFixed(0)}m) - likely front street`);
      return true;
    }
    
    // 3. Verificar ângulo de aproximação - TPs frontais têm ângulo < 45° - MANTIDO
    if (candidate.street.coordinates.length >= 2 && boundary.center) {
      // Calcular direção da rua usando primeiro e último ponto
      const streetStart = candidate.street.coordinates[0];
      const streetEnd = candidate.street.coordinates[candidate.street.coordinates.length - 1];
      
      const approachAngle = this.calculateApproachAngle(
        candidate.location,
        boundary.center,
        streetEnd // Usar ponto final da rua como direção
      );
      
      if (approachAngle < 45) {
        //console.log(`🏠 Frontal approach angle (${approachAngle.toFixed(0)}°) - likely front street`);
        return true;
      }
    }
    
    // 4. NOVO - Verificar se TP está no lado mais próximo de ruas principais (MELHORIA INCREMENTAL)
    if (this.isTPOnMainStreetSide(candidate, boundary)) {
      // console.log(`🏠 TP on main street side - likely front street`);
      return true;
    }
    
    return false;
  }
  
  /**
   * Calcula ângulo de aproximação entre TP e POI
   */
  private calculateApproachAngle(
    tpLocation: { lat: number; lng: number },
    poiLocation: { lat: number; lng: number },
    streetDirection: { lat: number; lng: number }
  ): number {
    // Calcular bearing da rua (usando função existente)
    const streetBearing = calculateBearing(tpLocation, streetDirection);
    
    // Calcular bearing do TP para o POI (usando função existente)
    const viewBearing = calculateBearing(tpLocation, poiLocation);
    
    // Calcular diferença angular (0-180°)
    let angleDiff = Math.abs(streetBearing - viewBearing);
    if (angleDiff > 180) angleDiff = 360 - angleDiff;
    
    return angleDiff;
  }
  
  // Usar função existente do utils/calculations.ts (SSOT)

  /**
   * NOVO: Verifica se TP está no lado mais próximo de ruas principais (MELHORIA INCREMENTAL)
   * Analisa a geometria do boundary para identificar o lado mais próximo de ruas
   */
  private isTPOnMainStreetSide(candidate: TriggerPointCandidate, boundary: BoundaryData): boolean {
    // Só aplicar se temos coordenadas suficientes
    if (!boundary.coordinates || boundary.coordinates.length < 4) {
      return false;
    }
    
    // Encontrar o lado do boundary mais próximo do TP
    const tpLocation = candidate.location;
    let minDistance = Infinity;
    let closestSideIndex = -1;
    
    // Calcular distância para cada lado do boundary
    for (let i = 0; i < boundary.coordinates.length; i++) {
      const point1 = boundary.coordinates[i];
      const point2 = boundary.coordinates[(i + 1) % boundary.coordinates.length];
      
      // Calcular distância do TP para o segmento de linha
      const distance = this.distanceToLineSegment(tpLocation, point1, point2);
      
      if (distance < minDistance) {
        minDistance = distance;
        closestSideIndex = i;
      }
    }
    
    // Se TP está muito próximo de um lado específico (< 50m), é provavelmente front street
    if (minDistance < 50) {
      // console.log(`🏠 TP very close to boundary side (${minDistance.toFixed(1)}m) - likely front street`);
      return true;
    }
    
    return false;
  }

  /**
   * NOVO: Calcula distância de um ponto para um segmento de linha (MELHORIA INCREMENTAL)
   */
  private distanceToLineSegment(
    point: { lat: number; lng: number },
    lineStart: { lat: number; lng: number },
    lineEnd: { lat: number; lng: number }
  ): number {
    // Calcular distância usando fórmula de distância ponto-linha
    const A = point.lat - lineStart.lat;
    const B = point.lng - lineStart.lng;
    const C = lineEnd.lat - lineStart.lat;
    const D = lineEnd.lng - lineStart.lng;
    
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    
    if (lenSq === 0) {
      // Linha degenerada (ponto)
      return calculateDistance(point, lineStart);
    }
    
    const param = dot / lenSq;
    
    let closestPoint;
    if (param < 0) {
      closestPoint = lineStart;
    } else if (param > 1) {
      closestPoint = lineEnd;
    } else {
      closestPoint = {
        lat: lineStart.lat + param * C,
        lng: lineStart.lng + param * D
      };
    }
    
    return calculateDistance(point, closestPoint);
  }

  /**
   * Verifica se o POI está em um canyon urbano (cercado por prédios altos)
   * CACHEADO: Resultado é calculado apenas uma vez por POI (não recalcula para cada candidato)
   */
  private isPOIInUrbanCanyon(boundary: BoundaryData, context: GeographicContext): boolean {
    // Cache: usar resultado já calculado se disponível
    const boundaryId = `${boundary.center?.lat}-${boundary.center?.lng}-${boundary.height}`;
    if (this.urbanCanyonCache && this.urbanCanyonCache.boundaryId === boundaryId) {
      return this.urbanCanyonCache.result;
    }
    
    // Calcular resultado (apenas uma vez)
    const result = this._calculateUrbanCanyon(boundary, context);
    
    // Armazenar no cache
    this.urbanCanyonCache = { result, boundaryId };
    
    return result;
  }
  
  /**
   * Lógica de cálculo de canyon urbano (separada para permitir cache)
   */
  private _calculateUrbanCanyon(boundary: BoundaryData, context: GeographicContext): boolean {
    // 1. Verificar densidade urbana
    if (context.urbanDensity.level !== 'very_dense' && context.urbanDensity.level !== 'dense') {
      return false;
    }
    
    // 2. Verificar se há dados de altura dos vizinhos
    if (!boundary.surroundingHeight) {
      return false;
    }
    
    const poiHeight = boundary.height || 0;
    const avgSurroundingHeight = boundary.surroundingHeight.average;
    const maxSurroundingHeight = boundary.surroundingHeight.max;
    const buildingCount = boundary.surroundingHeight.buildingCount;
    const heightDifference = poiHeight - avgSurroundingHeight;
    
    // Log apenas uma vez (na primeira chamada)
    console.log(`🏙️ [CANYON CHECK] Analyzing POI...`);
    console.log(`   Height diff: ${heightDifference.toFixed(1)}m (POI ${poiHeight}m - avg ${avgSurroundingHeight}m)`);
    console.log(`   Max surrounding: ${maxSurroundingHeight}m`);
    console.log(`   Building count: ${buildingCount}`);
    
    // 3. Se POI é MUITO MAIS ALTO que vizinhos = NÃO é canyon (visível de longe)
    // SOMENTE se a altura do POI é real (não 0) E não há prédios similares
    if (poiHeight > 0 && heightDifference > 50) {
      // NOVO: Verificar se há prédios com altura similar ao POI
      const maxHeightDifference = Math.abs(poiHeight - maxSurroundingHeight);
      if (maxHeightDifference <= 60) {
        console.log(`   ✅ CANYON: POI similar height to tallest nearby building (POI: ${poiHeight}m, Max nearby: ${maxSurroundingHeight}m, diff: ${maxHeightDifference.toFixed(1)}m)`);
        return true;
      }
      console.log(`   ❌ NOT CANYON: POI much taller than surroundings (+${heightDifference.toFixed(1)}m)`);
      return false;
    }
    
    // 4. Se POI é moderadamente mais alto = NÃO é canyon se área não tiver muitos prédios
    // SOMENTE se a altura do POI é real (não 0)
    if (poiHeight > 0 && heightDifference > 20 && buildingCount < 50) {
      console.log(`   ❌ NOT CANYON: POI taller with low building density (+${heightDifference.toFixed(1)}m, ${buildingCount} buildings)`);
      return false;
    }
    
    // 5. REGRA PRINCIPAL: Densidade ULTRA ALTA de prédios altos = CANYON
    // Copan: 1424 prédios, avg 26m, max 118m
    if (buildingCount > 1000 && avgSurroundingHeight > 20) {
      console.log(`   ✅ CANYON: Ultra high building density with tall buildings (${buildingCount} buildings, avg ${avgSurroundingHeight}m)`);
      return true;
    }
    
    // 5.1. NOVA REGRA: Prédios muito altos próximos ao POI = CANYON
    // Se há prédios com altura similar ao POI (dentro de 20m), é canyon
    if (maxSurroundingHeight > 0 && poiHeight > 0) {
      const heightSimilarity = Math.abs(poiHeight - maxSurroundingHeight);
      if (heightSimilarity <= 20 && buildingCount > 500) {
        console.log(`   ✅ CANYON: Similar height buildings nearby (POI: ${poiHeight}m, Max nearby: ${maxSurroundingHeight}m, diff: ${heightSimilarity.toFixed(1)}m)`);
        return true;
      }
    }
    
    // 6. Densidade MUITO ALTA + prédios muito altos = CANYON
    // Para áreas com muitos prédios E prédios muito altos
    if (buildingCount > 500 && avgSurroundingHeight > 25) {
      console.log(`   ✅ CANYON: Very high building density with very tall buildings (${buildingCount} buildings, avg ${avgSurroundingHeight}m)`);
      return true;
    }
    
    // 6.1. NOVA REGRA: Análise de distribuição de alturas (canyon urbano)
    // Se há muitos prédios altos (acima de 80% da altura do POI), é canyon
    if (boundary.surroundingHeight.tallBuildingsCount && poiHeight > 0) {
      const tallBuildingsRatio = boundary.surroundingHeight.tallBuildingsCount / buildingCount;
      const tallBuildingThreshold = poiHeight * 0.8; // 80% da altura do POI
      
      if (tallBuildingsRatio > 0.1 && maxSurroundingHeight > tallBuildingThreshold) {
        console.log(`   ✅ CANYON: High ratio of tall buildings (${(tallBuildingsRatio * 100).toFixed(1)}% above ${tallBuildingThreshold.toFixed(0)}m)`);
        return true;
      }
    }
    
    // 7. NOVO: Densidade ALTA + prédios moderados = CANYON (para áreas densas)
    // Museu Municipal: 18 prédios, avg 14m em área very_dense
    if (context.urbanDensity.level === 'very_dense' && buildingCount > 15 && avgSurroundingHeight > 10) {
      console.log(`   ✅ CANYON: High building density in very dense area (${buildingCount} buildings, avg ${avgSurroundingHeight}m)`);
      return true;
    }
    
    // 8. NOVO: Densidade MÉDIA + prédios moderados = CANYON (para áreas densas)
    if (context.urbanDensity.level === 'dense' && buildingCount > 30 && avgSurroundingHeight > 12) {
      console.log(`   ✅ CANYON: Medium building density in dense area (${buildingCount} buildings, avg ${avgSurroundingHeight}m)`);
      return true;
    }
    
    // 9. Se POI tem altura E não é significativamente mais alto + densidade alta = canyon
    // SOMENTE se POI tem altura conhecida (não fallback para 0)
    if (poiHeight > 0 && heightDifference < 10 && buildingCount > 300) {
      console.log(`   ✅ CANYON: POI not taller than surroundings in dense area (${poiHeight}m vs avg ${avgSurroundingHeight}m, ${buildingCount} buildings)`);
      return true;
    }
    
    // 10. Padrão: NÃO é canyon (dar chance de validar visibilidade)
    console.log(`   ❌ NOT CANYON: Insufficient evidence (diff: ${heightDifference.toFixed(1)}m, ${buildingCount} buildings)`);
    return false;
  }
  
  /**
   * Validação rigorosa de visibilidade para canyon urbano
   */
  private validateCanyonVisibility(
    tpLocation: { lat: number; lng: number },
    poiLocation: { lat: number; lng: number },
    buildings: any[],
    distance: number
  ): { isVisible: boolean; reason: string; obstructionDensity: number } {
    
    if (buildings.length === 0) {
      return { isVisible: true, reason: 'No buildings in line of sight', obstructionDensity: 0 };
    }
    
    // 1. Calcular densidade de obstruções ao longo da linha de visão
    const lineOfSightLength = distance;
    const obstructionDensity = (buildings.length / lineOfSightLength) * 1000; // obstruções por km
    
    // 2. Em canyon urbano, tolerância EXTREMAMENTE baixa para obstruções
    if (obstructionDensity > 1) { // Mais de 1 prédio por km de linha de visão (era 2)
      return { 
        isVisible: false, 
        reason: 'Too many buildings in line of sight', 
        obstructionDensity 
      };
    }
    
    // 3. Verificar se há prédios bloqueando (qualquer altura em canyon urbano)
    const blockingBuildings = buildings.filter(building => {
      const height = extractBuildingHeight(building.tags);
      return height > 20; // Qualquer prédio >20m bloqueia em canyon urbano
    });
    
    if (blockingBuildings.length > 0) {
      return { 
        isVisible: false, 
        reason: `Buildings blocking (${blockingBuildings.length} buildings >20m)`, 
        obstructionDensity 
      };
    }
    
    // 4. Verificar distância - em canyon, TPs muito distantes são problemáticos
    if (distance > TRIGGER_POINTS_CONSTANTS.distances.canyonAnalysisDistance) { // Distância configurável
      return { 
        isVisible: false, 
        reason: 'Too far in urban canyon (distance > 100m)', 
        obstructionDensity 
      };
    }
    
    return { isVisible: true, reason: 'Canyon validation passed', obstructionDensity };
  }
  
  // Usar função centralizada do utils/calculations.ts (DRY)
  
  /**
   * Calcula o radius do trigger point para garantir que o GPS pinga pelo menos
   * uma vez enquanto o usuário passa pela zona — NÃO está relacionado à
   * duração da narração (o app toca até o fim mesmo fora do radius).
   *
   * Fórmula: radius = speed × gpsPingWindow × safetyFactor, capada por grupo.
   *
   * Exemplos (com defaults 3s × 2x):
   *   - rua urbana 40km/h → ~67m → capado em FLAT (50m)
   *   - rodovia 100km/h   → ~167m → capado em HIGH (100m)
   *   - calçada 5km/h     → ~8m → clamp pelo min (15m)
   */
  private calculateRadius(
    candidate: TriggerPointCandidate,
    context: GeographicContext,
    boundary?: BoundaryData
  ): number {
    const cfg = TRIGGER_POINTS_CONSTANTS.triggerPoint;
    const tags: any = (candidate.street as any)?.tags || {};
    const streetType = candidate.street?.type;
    const speedKmh = resolveStreetSpeedKmh(tags.maxspeed, streetType);

    // Cap por grupo: rodovia precisa de mais que calçada por causa do ping GPS
    const groupCap = boundary?.classification?.maxTPRadiusM ?? cfg.maxRadiusM;

    return calculateGpsAwareRadius(
      speedKmh,
      cfg.gpsPingWindowSec,
      cfg.gpsPingSafetyFactor,
      { min: cfg.minRadiusM, max: groupCap }
    );
  }
  
  /**
   * Gera ID determinístico pra trigger point baseado em identidade do POI +
   * coordenadas do candidato. Re-rodar mesmo POI → mesmos IDs temporários.
   * (O DB atribui UUID final via gen_random_uuid; este ID é interno/log.)
   */
  private generateTriggerPointId(boundary: BoundaryData, candidate: TriggerPointCandidate): string {
    // Usa boundary.center como proxy pra POI identity (não temos POI ID neste escopo).
    // Combina com lat/lng do candidato pra unicidade dentro do POI.
    const { deterministicTPId } = require('../utils/deterministic');
    const poiKey = `${boundary.center.lat.toFixed(6)},${boundary.center.lng.toFixed(6)}`;
    return deterministicTPId(poiKey, 'tp', candidate.location.lat, candidate.location.lng);
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
    const minDistance = 35; // Distância mínima entre trigger points (aumentado para qualidade)
    
    for (const tp of sorted) {
      const isTooClose = optimized.some(existing => 
        calculateDistance(tp.location, existing.location) < minDistance // ✅ DRY: usar função SSOT
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
  // ✅ DRY: calculateDistance removido - usar função importada de utils/calculations.ts

  /**
   * NOVO: Verifica se vegetação densa bloqueia linha de visão
   */
  private extractBarrierHeight(tags: any): number {
    if (tags?.height) {
      const heightMatch = tags.height.match(/(\d+\.?\d*)/);
      if (heightMatch) return parseFloat(heightMatch[1]);
    }
    
    // Alturas padrão por tipo
    const defaultHeights: Record<string, number> = {
      'wall': 2.5,
      'city_wall': 8,
      'fence': 1.8,
      'hedge': 2.0
    };
    
    return defaultHeights[tags?.barrier] || 0;
  }

  /**
   * NOVO: Verifica se outros picos/montanhas bloqueiam linha de visão
   */
  private checkPeaksBlocking(
    tpLocation: { lat: number; lng: number },
    poiLocation: { lat: number; lng: number },
    peaks: any[],
    poiElevation: number
  ): boolean {
    if (peaks.length === 0) return false;
    
    const distance = calculateDistance(tpLocation, poiLocation);
    
    // Filtrar picos ao longo da linha TP → POI
    const relevantPeaks = peaks.filter((peak: any) => {
      let peakLocation: { lat: number; lng: number } | null = null;
      
      // Para nodes OSM, coordenadas podem vir diretamente ou em geometry
      if (peak.type === 'node') {
        if (peak.lat && peak.lon) {
          peakLocation = { lat: peak.lat, lng: peak.lon };
        } else if (peak.geometry && peak.geometry.length > 0) {
          // Geometry para nodes pode ser um array com um ponto
          const point = peak.geometry[0];
          if (point && point.lat && (point.lon !== undefined || point.lng !== undefined)) {
            peakLocation = { lat: point.lat, lng: point.lng !== undefined ? point.lng : point.lon };
          }
        }
        
        if (peakLocation) {
          const distanceFromTP = calculateDistance(tpLocation, peakLocation);
          const distanceFromPOI = calculateDistance(peakLocation, poiLocation);
          
          // Pico está entre TP e POI se está mais próximo do que a distância total
          // E está dentro de um buffer de 50% da distância total
          return distanceFromTP < distance * 0.9 && distanceFromPOI < distance * 0.9;
        }
      }
      
      // Para ways, verificar se intersecta a linha
      if (peak.type === 'way' && peak.geometry && peak.geometry.length > 2) {
        const peakCoords = peak.geometry.map((coord: any) => ({
          lat: coord.lat,
          lng: coord.lon
        })).filter((coord: any) => coord.lat && coord.lng);
        
        if (peakCoords.length > 2) {
          return this.lineIntersectsPolygon(tpLocation, poiLocation, peakCoords);
        }
      }
      
      return false;
    });
    
    if (relevantPeaks.length === 0) return false;
    
    // Verificar se algum pico tem elevação maior que o POI
    for (const peak of relevantPeaks) {
      const peakElevation = this.extractPeakElevation(peak);
      
      // Se pico tem elevação maior que POI, bloqueia
      if (peakElevation > poiElevation) {
        console.log(`🏔️ Peak/mountain blocking line of sight: ${peak.tags?.name || 'unnamed'} (${peakElevation}m > POI ${poiElevation}m)`);
        return true;
      }
      
      // Se pico tem elevação similar ao POI (>90%), também pode bloquear
      if (poiElevation > 0 && peakElevation >= poiElevation * 0.9) {
        console.log(`🏔️ Peak/mountain may block line of sight: ${peak.tags?.name || 'unnamed'} (${peakElevation}m ≈ POI ${poiElevation}m)`);
        return true;
      }
    }
    
    return false;
  }

  /**
   * NOVO: Extrai elevação de pico/montanha de tags OSM
   */
  private extractPeakElevation(peak: any): number {
    if (!peak.tags) return 0;
    
    // Tentar tags de elevação
    if (peak.tags.ele) {
      const ele = parseFloat(peak.tags.ele);
      if (!isNaN(ele) && ele > 0) return ele;
    }
    
    if (peak.tags.elevation) {
      const elevation = parseFloat(peak.tags.elevation);
      if (!isNaN(elevation) && elevation > 0) return elevation;
    }
    
    // Se não tem elevação, usar estimativa baseada em tipo
    // Peaks geralmente são altos (mínimo 100m acima do terreno)
    if (peak.tags.natural === 'peak' || peak.tags.natural === 'volcano') {
      return 500; // Estimativa conservadora para peaks sem elevação
    }
    
    if (peak.tags.natural === 'mountain') {
      return 800; // Estimativa conservadora para montanhas
    }
    
    return 0;
  }

  /**
   * NOVO: Verifica se elevação do terreno bloqueia linha de visão
   * ✅ AJUSTE: Considera classificação do POI para ajustar tolerância
   */
  private async getElevationsForPoints(
    points: Array<{ lat: number; lng: number }>
  ): Promise<number[]> {
    try {
      const srtm = SRTMLocalService.getInstance();
      const results = await Promise.all(
        points.map(p => srtm.getElevation(p.lat, p.lng))
      );
      return results.map(e => e ?? 0);
      
    } catch (error) {
      console.warn('Failed to get elevations from SRTM Local Service:', error);
      return [];
    }
  }

  /**
   * FALLBACK: Busca apenas buildings (método original simplificado)
   */
  private selectVisibilityCheckPoints(coordinates: Array<{lat: number, lng: number}>, count: number): Array<{lat: number, lng: number}> {
    if (!coordinates || coordinates.length === 0) return [];
    if (coordinates.length <= count) return [...coordinates];
    
    const result: Array<{lat: number, lng: number}> = [];
    const step = Math.floor(coordinates.length / count);
    
    for (let i = 0; i < count; i++) {
      const index = (i * step) % coordinates.length;
      result.push(coordinates[index]);
    }
    
    // Garantir que temos pontos únicos suficiente para análise
    // Se o boundary for um triângulo ou retângulo simples, pegar os vértices é melhor
    if (result.length < count && coordinates.length > result.length) {
       // Preencher com pontos intermediários se necessário
       // Mas a lógica acima já deve cobrir bem
    }
    
    return result;
  }

  /**
   * ✅ NOVO: Retorna a direção cardeal baseada no bearing
   */
  private getCardinalDirection(angle: number): string {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(((angle %= 360) < 0 ? angle + 360 : angle) / 45) % 8;
    return directions[index];
  }
}

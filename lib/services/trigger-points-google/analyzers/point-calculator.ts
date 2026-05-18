// Calculador de pontos ótimos para trigger points

import { POIData, BoundaryData, GeographicContext, StreetData, TriggerPointCandidate } from '../types/interfaces';
import { calculateDistance, calculateBearing, calculateDistanceToBoundary, isPointInPolygon, resolveBearingTarget } from '../utils/calculations';
import { TRIGGER_POINTS_CONSTANTS } from '../config/trigger-points-config';
import { POIClassifierService } from '../services/poi-classifier.service';

export class OptimalPointCalculator {
  private poiClassifier: POIClassifierService;
  
  constructor() {
    this.poiClassifier = new POIClassifierService();
  }
  
  /**
   * Calcula pontos ótimos nas ruas para trigger points
   */
  async calculateOptimalPoints(
    poiData: POIData,
    streets: StreetData[],
    boundary: BoundaryData,
    context: GeographicContext,
    /**
     * SSOT do searchRadius — passado pelo predictor com o valor já computado
     * em `street-analyzer.findAccessibleStreetsWithMetadata`. Se não informado,
     * cai no fallback derivado de `classification.searchRadius` (legado).
     */
    upstreamSearchRadius?: number
  ): Promise<TriggerPointCandidate[]> {
    // 🎯 USAR CLASSIFICAÇÃO DO BOUNDARY (já calculada no boundary-detector)
    let classification = boundary.classification;
    
    if (!classification) {
      console.warn(`⚠️ No classification found in boundary, using fallback`);
      // Fallback: criar classificação padrão APENAS se não existe classificação
      // ✅ IMPORTANTE: Não recategorizar se já existe classificação (evitar redundância)
      const fallbackClassification = await this.poiClassifier.classifyPOI(
        poiData,
        boundary.height,
        boundary.elevation ? { center: boundary.elevation.center } : undefined,
        boundary.area_m2,
        context,
        boundary.osmTags
      );
      boundary.classification = fallbackClassification;
      classification = fallbackClassification; // ✅ CORREÇÃO: Atualizar variável local também
    }
    
    // ✅ GARANTIR: classification nunca será undefined aqui
    if (!classification) {
      throw new Error('Classification is still undefined after fallback creation');
    }
    
    // SSOT: searchRadius computado pelo street-analyzer e propagado via
    // `upstreamSearchRadius`. Fallback (legado) re-deriva de classification.
    const searchRadius = upstreamSearchRadius !== undefined && upstreamSearchRadius > 0
      ? upstreamSearchRadius
      : (classification.searchRadius || 300);

    // Filtrar ruas após classificação — usar apenas as dentro do raio calculado
    const filteredStreets = this.filterStreetsByRadius(streets, boundary, searchRadius);
    console.log(`🔍 Filtered streets: ${filteredStreets.length}/${streets.length} within ${searchRadius}m radius (from initial 500m query)`);

    // 👁️ FAN-WALK é a ÚNICA estratégia em produção. As legadas (circular/linear/
    // standard) foram removidas em 2026-05 (Tier 3.1) — todo o pipeline depende
    // do visibility fan ser computado em `predictor.attachVisibilityFan`.
    if (!boundary.visibilityFan || boundary.visibilityFan.polygons.length === 0) {
      console.warn(`⚠️ [point-calculator] Visibility fan ausente — pipeline retornando 0 candidatos. ` +
        `Predictor deveria ter chamado attachVisibilityFan ANTES. Fallback em buildFanCollapseFallback cobre este caso.`);
      return [];
    }

    console.log(`👁️ FAN-WALK STRATEGY: Walking each street and dropping candidates spaced by minDistanceBetweenTPs`);
    const candidates = await this.calculateFanWalkStrategy(filteredStreets, poiData, boundary, context, classification);

    // Ordenar candidatos por qualidade
    candidates.sort((a, b) => b.quality - a.quality);

    return candidates;
  }
  
  /**
   * ✅ CORREÇÃO CRÍTICA: Filtra ruas E PONTOS baseado no raio calculado após classificação
   * Remove ruas que estão fora do raio E também remove pontos das ruas que estão muito distantes
   * 
   * PROBLEMA IDENTIFICADO: Ruas do OSM contêm TODOS os pontos da rua, mesmo os muito distantes.
   * Exemplo: Uma rua pode ter pontos a 50m do boundary (dentro do raio) e outros a 1500m (fora).
   * 
   * SOLUÇÃO: Filtrar não apenas as ruas, mas também os PONTOS dentro de cada rua pelo raio.
   * 
   * IMPORTANTE: Usa distância ao BOUNDARY (perímetro), não ao centro
   */
  /**
   * Segmenta uma rua de acordo com sua relação com o polígono do boundary.
   *
   * Quando o boundary do POI invade levemente a rua perimetral (caso comum em
   * parques: a calçada/faixa fica "dentro" do polígono OSM), o caminho antigo
   * rejeitava o candidato. Aqui dividimos a rua em trechos dentro/fora e
   * geramos sub-ruas externas para o gerador de candidatos.
   *
   * Regras:
   *  - `internal` (≥80% dentro): rua dentro do POI (trilhas), sem TPs
   *  - `border`/`partial`: usar apenas trechos externos contíguos
   *  - `external` (0% dentro): rua intacta
   *
   * Trechos externos com comprimento < 15m são ignorados (resíduo de ruído OSM).
   */
  private segmentStreetByBoundary(
    originalStreet: StreetData,
    pointsToUse: Array<{ lat: number; lng: number }>,
    boundary: BoundaryData
  ): StreetData[] {
    if (!boundary.coordinates || boundary.coordinates.length < 3) {
      return [{ ...originalStreet, coordinates: pointsToUse }];
    }

    const { classifyStreetVsBoundary } = require('../../../geometry');
    const result = classifyStreetVsBoundary(pointsToUse, boundary.coordinates);

    if (result.relation === 'external') {
      return [{ ...originalStreet, coordinates: pointsToUse }];
    }
    if (result.relation === 'internal') {
      return [];
    }

    // border / partial → emitir uma sub-rua por trecho externo significativo
    const MIN_SEGMENT_LENGTH_M = 15;
    const subStreets: StreetData[] = [];
    let segIdx = 0;
    for (const seg of result.outsideSegments) {
      if (seg.lengthMeters < MIN_SEGMENT_LENGTH_M) continue;
      // Manter formato de "segmento" mesmo quando há um único ponto
      const coords = seg.coordinates.length >= 2 ? seg.coordinates : [seg.coordinates[0], seg.coordinates[0]];
      subStreets.push({
        ...originalStreet,
        id: `${originalStreet.id}__ext${segIdx}`,
        coordinates: coords,
      });
      segIdx++;
    }
    return subStreets;
  }

  private filterStreetsByRadius(
    streets: StreetData[],
    boundary: BoundaryData,
    searchRadius: number
  ): StreetData[] {
    if (!streets || streets.length === 0) return streets;
    if (!boundary.coordinates || boundary.coordinates.length === 0) return streets;

    const filtered: StreetData[] = [];

    // Princípio: visibilidade física é GATE, não score. Streets de onde o POI
    // não é visível (fora do visibility fan) são rejeitadas — colocar TP onde
    // o POI não pode ser visto é desastre de produto (audio guide tocando
    // sobre nada visível).
    //
    // Quando o fan COLAPSA (POI pequeno em hiper-densa), o pipeline cai pra
    // `buildFanCollapseFallback` no predictor que gera 2 frontais simétricos
    // na rua de endereço + 1 geofence. Esse path é o safety net adequado.
    const fanPolygons = boundary.visibilityFan?.polygons;
    const useFan = !!(fanPolygons && fanPolygons.length > 0 && fanPolygons[0].length >= 3);

    const maxAllowedDistance = searchRadius + 20;
    if (useFan) {
      console.log(`🔍 Filtering streets by VISIBILITY FAN (${fanPolygons!.length} sub-polygons, max ${boundary.visibilityFan!.maxDistanceM}m, mean ${boundary.visibilityFan!.meanDistanceM}m)`);
    } else {
      console.log(`🔍 Filtering streets and points by radius: ${searchRadius}m (max: ${maxAllowedDistance}m)`);
    }

    for (const street of streets) {
      if (!street.coordinates || street.coordinates.length === 0) continue;

      const validPoints: Array<{ lat: number; lng: number }> = [];
      let minDistanceToBoundary = Infinity;
      let maxDistanceToBoundary = 0;

      for (const streetPoint of street.coordinates) {
        const distanceToBoundary = calculateDistanceToBoundary(streetPoint, boundary.coordinates);

        minDistanceToBoundary = Math.min(minDistanceToBoundary, distanceToBoundary);
        maxDistanceToBoundary = Math.max(maxDistanceToBoundary, distanceToBoundary);

        // Modo fan: dentro de qualquer sub-polígono de visibilidade OU dentro
        // do boundary OU colado (≤30m) à aresta (safety net calçada perimetral).
        // Modo radius (sem fan): dentro do raio.
        const accepted = useFan
          ? (
              fanPolygons!.some(poly => isPointInPolygon(streetPoint, poly)) ||
              isPointInPolygon(streetPoint, boundary.coordinates) ||
              distanceToBoundary <= 30
            )
          : distanceToBoundary <= maxAllowedDistance;

        if (accepted) {
          validPoints.push(streetPoint);
        }
      }
      
      // ✅ REGRA: Aprovar ruas que têm pelo menos 1 ponto válido dentro do raio
      // A função findPointAtDistanceFromBoundary funciona perfeitamente com 1 ponto,
      // então não há necessidade de exigir 2+ pontos para "formar um segmento"
      // Se tem 1 ponto válido dentro do raio, podemos usar esse ponto diretamente
      if (validPoints.length >= 1) {
        // Se tem apenas 1 ponto, duplicar para manter compatibilidade (mas não é necessário)
        const pointsToUse = validPoints.length >= 2
          ? validPoints
          : [validPoints[0], validPoints[0]]; // Duplicar ponto para manter formato de segmento

        // 🆕 Boundary segmentation (issue 1.8):
        // Quando o boundary OSM "invade" a calçada/faixa da rua perimetral, a regra
        // antiga rejeitava o candidato como "dentro do boundary". Aqui dividimos a
        // rua em trechos dentro/fora do polígono e usamos apenas os trechos externos.
        const subStreets = this.segmentStreetByBoundary(street, pointsToUse, boundary);
        for (const sub of subStreets) {
          filtered.push(sub);
        }

        if (subStreets.length === 0) {
          const streetName = street.name || street.id || 'unnamed';
          console.log(`🚫 Street ${street.id} (${streetName}): Rejected - fully internal to boundary`);
        } else if (validPoints.length < street.coordinates.length) {
          console.log(`✂️ Street ${street.id}: Filtered ${street.coordinates.length - validPoints.length} points outside radius (kept ${validPoints.length}/${street.coordinates.length}) → ${subStreets.length} external sub-segment(s)`);
        }
      } else {
        // Mensagem de log mais clara com nome da rua
        const streetName = street.name || street.id || 'unnamed';
        const reason = `no valid points (all points: ${minDistanceToBoundary.toFixed(0)}m-${maxDistanceToBoundary.toFixed(0)}m from boundary, max allowed: ${maxAllowedDistance.toFixed(0)}m)`;
        console.log(`🚫 Street ${street.id} (${streetName}): Rejected - ${reason}`);
      }
    }
    
    return filtered;
  }
  
  /**
   * 👁️ FAN-WALK STRATEGY — usada quando o visibility map está ativo.
   *
   * Princípio: o fan JÁ filtrou onde o POI é fisicamente visível. Agora
   * caminhamos por cada rua filtrada e soltamos candidatos espaçados, sem
   * regras categóricas de "distância alvo" nem descartar pontos por estarem
   * dentro do boundary (pontes têm o deck no boundary).
   *
   * Espaçamento: usa minDistanceBetweenTPs da classificação (default 40m).
   * Bearing target: já tratado depois (entrance/centroid/closest-on-boundary).
   */
  private async calculateFanWalkStrategy(
    streets: StreetData[],
    poiData: POIData,
    boundary: BoundaryData,
    context: GeographicContext,
    classification: any
  ): Promise<TriggerPointCandidate[]> {
    const candidates: TriggerPointCandidate[] = [];
    const minSpacing = classification.minDistanceBetweenTPs || 40;
    const fanPolygons = boundary.visibilityFan!.polygons;

    // Pre-resolver bearing target uma vez (SSOT em utils/calculations)
    const bearingTarget = resolveBearingTarget(boundary);

    for (const street of streets) {
      if (!street.coordinates || street.coordinates.length < 2) continue;

      // Visibilidade é GATE: mantém só os pontos onde o POI é fisicamente
      // visível (inside any fan OR inside boundary OR ≤30m da aresta —
      // calçada perimetral). Pontos invisíveis não viram TP.
      //
      // Quando todos os pontos da rua são invisíveis, a rua é descartada.
      // Se TODAS as ruas forem descartadas (fan colapsado completamente),
      // o predictor cai em `buildFanCollapseFallback`.
      const visiblePoints = street.coordinates.filter(p => {
        if (fanPolygons.some(poly => isPointInPolygon(p, poly))) return true;
        if (isPointInPolygon(p, boundary.coordinates)) return true;
        const distToBoundary = calculateDistanceToBoundary(p, boundary.coordinates);
        return distToBoundary <= 30;
      });
      if (visiblePoints.length === 0) continue;

      // Caminha pelos pontos visíveis em ordem, droppando candidato a cada
      // `minSpacing` metros acumulados.
      let accumulatedDist = minSpacing; // garantir candidato no primeiro ponto
      let streetCandidates = 0;
      for (let i = 0; i < visiblePoints.length; i++) {
        if (i > 0) {
          accumulatedDist += calculateDistance(visiblePoints[i - 1], visiblePoints[i]);
        }
        if (accumulatedDist < minSpacing && i > 0) continue;
        accumulatedDist = 0;

        const pointOnStreet = visiblePoints[i];

        // Quality 100% física — fan já validou visibilidade. Restam só
        // qualidade da rua (tipo OSM) e proximidade ao POI.
        const quality = this.calculateFanWalkQuality(pointOnStreet, boundary, street);

        const expectedBearing = calculateBearing(pointOnStreet, bearingTarget);
        const distance = calculateDistance(pointOnStreet, boundary.center);

        candidates.push({
          location: pointOnStreet,
          distance,
          quality,
          street,
          expectedBearing,
          confidence: 0.85,
        });
        streetCandidates++;
      }
      if (streetCandidates > 0) {
        console.log(`  ↳ ${street.id} (${street.name || 'unnamed'}): ${streetCandidates} candidate(s) from ${visiblePoints.length} visible point(s)`);
      }
    }

    console.log(`👁️ FAN-WALK: generated ${candidates.length} candidates from ${streets.length} streets`);
    return candidates;
  }

  /**
   * Quality score 100% físico — sem bônus categóricos por urbanDensity ou
   * elevationType. Usado pelo FAN-WALK (modo visibility-driven).
   *
   * Sinais:
   *  - Tipo de rua OSM (motorway/primary > residential > unknown)
   *  - Proximidade ao POI (mais perto = melhor, capped)
   *  - Confiança do registro OSM da rua
   *
   * Pré-condição: o ponto JÁ passou pelo filtro de visibilidade do fan.
   * Visibilidade não entra no score porque é gate upstream.
   */
  private calculateFanWalkQuality(
    point: { lat: number; lng: number },
    boundary: BoundaryData,
    street: StreetData
  ): number {
    // Base: 0.6 (já validado pelo fan)
    let q = 0.6;

    // Tipo de rua — preferência por vias com tráfego real
    const streetTypeScore: Record<string, number> = {
      motorway: 0.25,
      trunk: 0.22,
      primary: 0.20,
      secondary: 0.17,
      tertiary: 0.14,
      residential: 0.10,
      unclassified: 0.08,
      living_street: 0.06,
      service: 0.04,
      pedestrian: 0.05,
      footway: 0.03,
      cycleway: 0.03,
    };
    q += streetTypeScore[street.type] ?? 0.05;

    // Proximidade ao POI (capped: ganho diminui ao se aproximar muito)
    const distanceToBoundary = calculateDistanceToBoundary(point, boundary.coordinates);
    if (distanceToBoundary <= 50) q += 0.10;
    else if (distanceToBoundary <= 200) q += 0.05;
    else if (distanceToBoundary <= 500) q += 0.02;
    // > 500m: sem bônus, mas também sem penalidade (fan já validou visibilidade)

    // Confiança do dado da rua
    if (street.confidence > 0.8) q += 0.03;

    return Math.min(1.0, Math.max(0, q));
  }

}

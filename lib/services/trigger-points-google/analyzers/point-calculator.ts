// Calculador de pontos ótimos para trigger points

import { POIData, BoundaryData, GeographicContext, StreetData, TriggerPointCandidate } from '../types/interfaces';
import { calculateBearing, calculateDistanceToBoundary, findClosestPointOnBoundary, streetFootOnEdge, samplePolylineAround } from '../utils/calculations';
import { TRIGGER_POINTS_CONSTANTS } from '../config/trigger-points-config';
import { proximityRankScore } from '../config/visibility-class';
import { measureAndClassify } from '../services/poi-classifier.service';

export class OptimalPointCalculator {
  
  constructor() {
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
      const { classification: fallbackClassification } = await measureAndClassify({
        poiData,
        boundary: boundary.coordinates,
        synthetic: boundary.synthetic,
        areaM2: boundary.area_m2,
        tags: boundary.osmTags,
        knownHeightM: boundary.height,
        context,
      });
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

    // Arquitetura: fan = MEDIDOR DE ALCANCE (max distance), per-TP = VERIFICADOR.
    //
    // O fan computa `maxDistanceM` (até onde o POI é visível em ALGUMA direção).
    // Usamos isso como RAIO para o filtro inicial — permissivo, captura streets
    // que o polígono do fan rejeitaria por edge effects ou ray-cast errors
    // (ex: Vieira Souto/Ipanema do Cristo, onde fan polygon under-shoots).
    //
    // O per-TP check downstream faz ray-cast EXATO ponto a ponto e rejeita
    // os falsos positivos (ex: Av. Niemeyer atrás de Vidigal/Dois Irmãos).
    //
    // Quando o fan COLAPSA, `buildFanCollapseFallback` no predictor cobre.
    const fanMaxM = boundary.visibilityFan?.maxDistanceM ?? 0;
    const useFanRadius = fanMaxM > 0;
    const effectiveRadius = useFanRadius ? fanMaxM : searchRadius;
    const maxAllowedDistance = effectiveRadius + 20;

    if (useFanRadius) {
      console.log(`🔍 Filtering streets by FAN-DERIVED RADIUS: ${fanMaxM}m (per-TP check downstream validates exact LOS)`);
    } else {
      console.log(`🔍 Filtering streets and points by radius: ${searchRadius}m (max: ${maxAllowedDistance}m)`);
    }

    for (const street of streets) {
      if (!street.coordinates || street.coordinates.length === 0) continue;

      // Whole polyline, not vertices: a long segment passing in front of the POI has
      // both vertices far away and used to be rejected (BR-AUDIO-010).
      const foot = streetFootOnEdge(street.coordinates, boundary.center, boundary.coordinates);
      if (!foot || foot.edgeDistanceM > maxAllowedDistance) {
        const reason = `outside radius (${foot ? foot.edgeDistanceM.toFixed(0) : '?'}m from boundary, max allowed: ${maxAllowedDistance.toFixed(0)}m${useFanRadius ? ' = fan max' : ''})`;
        console.log(`🚫 Street ${street.id} (${street.name || street.id || 'unnamed'}): Rejected - ${reason}`);
        continue;
      }

      const pointsToUse = street.coordinates.length >= 2
        ? street.coordinates
        : [street.coordinates[0], street.coordinates[0]];
      // Boundary segmentation (issue 1.8): keep only the stretches outside the polygon.
      const subStreets = this.segmentStreetByBoundary(street, pointsToUse, boundary);
      for (const sub of subStreets) filtered.push(sub);
      if (subStreets.length === 0) {
        console.log(`🚫 Street ${street.id} (${street.name || street.id || 'unnamed'}): Rejected - fully internal to boundary`);
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
    // Reach from the EDGE: the fan (visibility) bounded by the class cap (BR-AUDIO-010).
    // The ≤30 m band next to the edge is always visible (perimeter sidewalk).
    const fanRadiusM = boundary.visibilityFan!.maxDistanceM || 0;
    const reachM = Math.max(30, Math.min(fanRadiusM + 20, classification.maxEdgeDistanceM ?? Infinity));

    for (const street of streets) {
      if (!street.coordinates || street.coordinates.length < 2) continue;

      // Walk the whole street from the foot of the perpendicular on the POI edge,
      // outwards both ways, one candidate every `minSpacing` meters of arc length.
      const foot = streetFootOnEdge(street.coordinates, boundary.center, boundary.coordinates);
      if (!foot || foot.edgeDistanceM > reachM) continue;

      let streetCandidates = 0;
      for (const pointOnStreet of samplePolylineAround(street.coordinates, foot.point, minSpacing)) {
        const edgeDistance = calculateDistanceToBoundary(pointOnStreet, boundary.coordinates);
        if (edgeDistance > reachM) continue;

        const quality = this.calculateFanWalkQuality(pointOnStreet, boundary, street);
        // Bearing points at the closest point of the edge — right for any POI shape.
        const closestOnBoundary = findClosestPointOnBoundary(pointOnStreet, boundary.coordinates);
        const expectedBearing = calculateBearing(pointOnStreet, closestOnBoundary);

        candidates.push({
          location: pointOnStreet,
          distance: edgeDistance,
          quality,
          street,
          expectedBearing,
          confidence: 0.85,
        });
        streetCandidates++;
      }
      if (streetCandidates > 0) {
        console.log(`  ↳ ${street.id} (${street.name || 'unnamed'}): ${streetCandidates} candidate(s), foot ${foot.edgeDistanceM.toFixed(0)}m from edge`);
      }
    }

    console.log(`👁️ FAN-WALK: generated ${candidates.length} candidates from ${streets.length} streets`);
    return candidates;
  }

  /**
   * Physical quality score for a fan-walk candidate (already inside the visible fan).
   * Proximity band to the EDGE dominates; road type only breaks ties inside a band
   * (BR-AUDIO-010: a primary 400 m away must not beat a residential street in front).
   */
  private calculateFanWalkQuality(
    point: { lat: number; lng: number },
    boundary: BoundaryData,
    street: StreetData
  ): number {
    const edgeDistance = calculateDistanceToBoundary(point, boundary.coordinates);
    return 0.4 + 0.55 * proximityRankScore(edgeDistance, street.type);
  }

}

// Calculador de pontos ótimos para trigger points

import { POIData, BoundaryData, GeographicContext, StreetData, TriggerPointCandidate } from '../types/interfaces';
import { calculateBearing, calculateDistance, findClosestPointOnBoundary, samplePolylineAround } from '../utils/calculations';
import { edgeDistanceFarLaneM, poiEdgeRing, streetEdgeReach, streetFootOnEdgeFarLane, tpReachCapM } from '../utils/validation';
import { TRIGGER_POINTS_CONSTANTS } from '../config/trigger-points-config';
import {
  EDGE_BAND_M,
  FAR_CANDIDATES_PER_CELL,
  FAR_STREET_TYPES,
  landmarkStreetTier,
  observerPath,
  FAR_CELL_SPACING_M,
  FAR_RINGS_M,
  LANDMARK_CELL_RINGS_M,
  landmarkSectorOf,
  VisibilityClass,
  proximityRankScore,
  sizeReachFarFromM,
} from '../config/visibility-class';
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
    /** the reach the street search used (`tpReachCapM`); recomputed from the class when absent */
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
    
    // INV-E6: one reach — the one the street search used (`tpReachCapM`, from the edge).
    const searchRadius = upstreamSearchRadius !== undefined && upstreamSearchRadius > 0
      ? upstreamSearchRadius
      : tpReachCapM(classification);

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
    const candidates = await this.calculateFanWalkStrategy(filteredStreets, poiData, boundary, context, classification, searchRadius);

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

  /**
   * E6 — the SAME reach as the street search (`validation#streetEdgeReach` with
   * `tpReachCapM`), then only the stretches outside the boundary (issue 1.8). The street
   * search already dropped and traced what is beyond reach; here it is a guard, not a 2nd ruler.
   */
  private filterStreetsByRadius(
    streets: StreetData[],
    boundary: BoundaryData,
    searchRadius: number
  ): StreetData[] {
    if (!streets || streets.length === 0) return streets;
    const filtered: StreetData[] = [];
    for (const street of streets) {
      if (!street.coordinates || street.coordinates.length === 0) continue;
      if (!streetEdgeReach(street, boundary, searchRadius).within) continue;
      const pointsToUse = street.coordinates.length >= 2
        ? street.coordinates
        : [street.coordinates[0], street.coordinates[0]];
      for (const sub of this.segmentStreetByBoundary(street, pointsToUse, boundary)) filtered.push(sub);
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
    classification: any,
    reachM: number = tpReachCapM(classification)
  ): Promise<TriggerPointCandidate[]> {
    const candidates: TriggerPointCandidate[] = [];
    const minSpacing = classification.minDistanceBetweenTPs || 40;
    const ring = poiEdgeRing(boundary);
    // `area`/`linear` walk at a quarter of the spacing: E10 takes one TP per perimeter sector
    // (INV-E10d), and with one candidate every `minSpacing` a sector whose street is in reach for
    // under 100 m got none, or only one inside its neighbour's spacing (Estádio Nilton Santos: 2 of
    // 5 sectors bare at a half, none at a quarter, #772).
    const farFromM = sizeReachFarFromM(classification.group);
    const walkStepM = ring && (classification.group === VisibilityClass.AREA || classification.group === VisibilityClass.LINEAR)
      ? minSpacing / 4
      : minSpacing;

    for (const street of streets) {
      if (!street.coordinates || street.coordinates.length < 2) continue;

      // INV-E7b: the first candidate is the foot of the perpendicular from the POI edge on the
      // street, then outwards both ways, one every `minSpacing` meters of arc length.
      const foot = streetFootOnEdgeFarLane(street.coordinates, boundary);
      if (!foot || foot.edgeDistanceM > reachM) continue;
      const touristWay = FAR_STREET_TYPES.includes(street.type);

      for (const pointOnStreet of samplePolylineAround(street.coordinates, foot.point, walkStepM)) {
        const edgeDistance = edgeDistanceFarLaneM(pointOnStreet, boundary);
        if (edgeDistance > reachM) continue;
        // INV-E6 by size: beyond the class table, a tourist way only (`sizeReachFarFromM`).
        if (farFromM !== null && edgeDistance > farFromM && !touristWay) continue;
        // Bearing points at the closest point of the edge — right for any POI shape.
        const target = ring ? findClosestPointOnBoundary(pointOnStreet, ring) : boundary.center;
        candidates.push({
          location: pointOnStreet,
          distance: edgeDistance,
          quality: 0.4 + 0.55 * proximityRankScore(edgeDistance, street.type),
          street,
          expectedBearing: calculateBearing(pointOnStreet, target),
          confidence: 0.85,
        });
      }
    }

    // Far candidates are sampled by cell (INV-E7c). Outside `landmark_high` far starts at the
    // class table and E10 keeps only `maxFarTPs` of them: a cell holds FAR_CANDIDATES_PER_CELL,
    // not every tourist-way candidate (INV-E6 by size).
    const out = farFromM === null
      ? sampleFarBySectorAndRing(candidates, boundary.center)
      : sampleFarBySectorAndRing(candidates, boundary.center, farFromM, false);
    console.log(`👁️ FAN-WALK: ${out.length} candidates (${candidates.length} walked) from ${streets.length} streets, reach ${reachM} m`);
    return out;
  }
}

/**
 * INV-E7c / INV-E10c: a landmark's candidates FAR from the edge, sampled along the streets in
 * reach and spread by direction. Beyond EDGE_BAND_M the walked candidates go into cells of
 * (sector `landmarkSectorOf` seen from the POI × distance ring FAR_RINGS_M), FAR_CELL_SPACING_M
 * apart. Inside the last E10 inner ring a cell keeps EVERY tourist-street candidate (by street
 * length: 6 per cell left the orla of Copacabana and the south shore of the Lagoa without one),
 * and the other streets fill up to FAR_CANDIDATES_PER_CELL; in the horizon, tourist streets only,
 * FAR_CANDIDATES_PER_CELL per cell (E10 takes nothing else there). The near band stays whole.
 */
export function sampleFarBySectorAndRing(
  candidates: TriggerPointCandidate[],
  centre: { lat: number; lng: number },
  /** where far starts: EDGE_BAND_M for a landmark, the class table otherwise (`sizeReachFarFromM`) */
  farFromM = EDGE_BAND_M,
  /** a landmark keeps every inner tourist-way candidate (E10 fills 28 cells); the other classes keep 2 */
  keepEveryInnerTouristWay = true
): TriggerPointCandidate[] {
  const near = candidates.filter(c => c.distance <= farFromM);
  const innerLimitM = LANDMARK_CELL_RINGS_M[LANDMARK_CELL_RINGS_M.length - 1];
  const cells = new Map<string, TriggerPointCandidate[]>();
  for (const c of candidates) {
    if (c.distance <= farFromM) continue;
    if (c.distance > innerLimitM && landmarkStreetTier(c.street?.type) > 0) continue;
    const ringIdx = FAR_RINGS_M.findIndex(r => c.distance <= r);
    const sector = landmarkSectorOf(calculateBearing(centre, c.location), c.distance);
    const key = `${sector}:${ringIdx}`;
    (cells.get(key) ?? cells.set(key, []).get(key)!).push(c);
  }
  const far: TriggerPointCandidate[] = [];
  for (const cell of cells.values()) {
    // Tourist streets first (INV-E10a): by quality alone the cell filled up with tracks and service lanes.
    cell.sort((a, b) => landmarkStreetTier(a.street?.type) - landmarkStreetTier(b.street?.type) || b.quality - a.quality);
    const inner = cell[0].distance <= innerLimitM;
    const kept: TriggerPointCandidate[] = [];
    for (const c of cell) {
      const byLength = keepEveryInnerTouristWay && inner && landmarkStreetTier(c.street?.type) === 0;
      if (!byLength && kept.length >= FAR_CANDIDATES_PER_CELL) break;
      if (kept.some(k => observerPath(k.street?.type) === observerPath(c.street?.type)
        && calculateDistance(k.location, c.location) < FAR_CELL_SPACING_M)) continue;
      kept.push(c);
    }
    far.push(...kept);
  }
  return [...near, ...far];
}

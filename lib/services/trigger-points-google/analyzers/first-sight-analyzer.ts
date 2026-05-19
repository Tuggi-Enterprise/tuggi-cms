/**
 * First-Sight Analyzer (issue 2.6)
 *
 * Para POIs HIGH/MEDIUM (montanhas, monumentos visíveis de longe), o TP "ideal"
 * de arrival não é necessariamente "X metros antes do POI" — é o ponto onde o
 * POI APARECE visualmente para o usuário que se aproxima.
 *
 * Algoritmo:
 *  1. Dada uma rua que leva ao POI, caminhamos OUTWARD a partir do POI
 *  2. A cada passo (~50m), fazemos ray-cast 2.5D do ponto até o topo do POI
 *  3. Encontramos o PRIMEIRO ponto onde a linha de visão fica obstruída
 *  4. Recuamos 50m: esse é o "first sight" point
 *  5. Colocamos TP arrival lá (radius dimensionado para a velocidade da via)
 *
 * Resultado:
 *  - Áudio começa exatamente quando o POI aparece (impacto emocional)
 *  - Radius é grande o suficiente para a narração completar antes do POI passar
 *
 * Status: opt-in via options.useFirstSight (não default).
 */

import { BoundaryData, StreetData, GeographicContext } from '../types/interfaces';
import {
  calculateDistance,
  calculateBearing,
  isSightLineBlockedBy,
  buildingCentroid,
  calculateGpsAwareRadius,
  resolveStreetSpeedKmh,
} from '../../../geometry';
import { TRIGGER_POINTS_CONSTANTS } from '../config/trigger-points-config';

export interface FirstSightOptions {
  /** Distância máxima a caminhar a partir do POI (m) */
  maxWalkDistanceM?: number;
  /** Passo entre amostras (m) */
  stepM?: number;
  /** Eye height do observador (carro) */
  eyeHeightM?: number;
}

export interface FirstSightPoint {
  location: { lat: number; lng: number };
  street: StreetData;
  distanceFromPOI: number;
  expectedBearing: number;
  radius: number;
}

const DEFAULTS: Required<FirstSightOptions> = {
  maxWalkDistanceM: 3000,
  stepM: 50,
  eyeHeightM: 1.5,
};

export class FirstSightAnalyzer {
  /**
   * Encontra o "first sight" point ao longo de uma rua.
   *
   * @param street      polilinha da rua (do banco local OSM)
   * @param boundary    boundary do POI com `coordinates` e `height`
   * @param buildings   buildings dentro da área para teste de obstrução
   */
  static findFirstSight(
    street: StreetData,
    boundary: BoundaryData,
    buildings: any[],
    options: FirstSightOptions = {}
  ): FirstSightPoint | null {
    const opts = { ...DEFAULTS, ...options };
    const coords = street.coordinates;
    if (!coords || coords.length < 2) return null;
    if (!boundary.coordinates || boundary.coordinates.length < 3) return null;

    const poiCenter = boundary.center;
    const poiTopHeightM = (boundary.elevation?.center || 0) + (boundary.height || 0);

    // Ordenar pontos da rua pela distância ao centro do POI (mais perto → mais longe).
    const sorted = [...coords]
      .map(c => ({ point: c, dist: calculateDistance(c, poiCenter) }))
      .filter(p => p.dist <= opts.maxWalkDistanceM)
      .sort((a, b) => a.dist - b.dist);

    if (sorted.length === 0) return null;

    // Caminhar OUTWARD: começa no ponto mais próximo (deve ter LoS),
    // continua até encontrar o primeiro ponto obstruído.
    let lastVisible: { point: { lat: number; lng: number }; dist: number } | null = null;
    let lastDist = -Infinity;
    for (const { point, dist } of sorted) {
      // Pular pontos muito próximos ao anterior (respeitar `step`)
      if (dist - lastDist < opts.stepM) continue;
      lastDist = dist;

      const obstructed = this.isObstructed(
        point,
        opts.eyeHeightM,
        poiCenter,
        poiTopHeightM,
        buildings
      );

      if (obstructed) {
        // Encontramos a obstrução. O TP fica no último ponto VISÍVEL.
        if (!lastVisible) return null; // POI nunca foi visível nesta rua
        break;
      }
      lastVisible = { point, dist };
    }

    if (!lastVisible) return null;

    const tags: any = (street as any).tags || {};
    const speed = resolveStreetSpeedKmh(tags.maxspeed, street.type);
    const cfg = TRIGGER_POINTS_CONSTANTS.triggerPoint;
    const radius = calculateGpsAwareRadius(
      speed,
      cfg.gpsPingWindowSec,
      cfg.gpsPingSafetyFactor,
      { min: cfg.minRadiusM, max: cfg.maxRadiusM }
    );

    return {
      location: lastVisible.point,
      street,
      distanceFromPOI: lastVisible.dist,
      expectedBearing: calculateBearing(lastVisible.point, poiCenter),
      radius,
    };
  }

  /**
   * Retorna true se algum building bloqueia em 2.5D a linha do observador
   * ao topo do POI.
   */
  private static isObstructed(
    observer: { lat: number; lng: number },
    eyeHeightM: number,
    poi: { lat: number; lng: number },
    poiTopHeightM: number,
    buildings: any[]
  ): boolean {
    const defaultHouseHeight = TRIGGER_POINTS_CONSTANTS.obstructions.defaultHouseHeight;

    for (const b of buildings) {
      if (!b.geometry || b.geometry.length === 0) continue;
      const coords = b.geometry.map((c: any) => ({
        lat: c.lat,
        lng: c.lon ?? c.lng,
      }));

      let buildingHeightM = Number(b.height) || 0;
      if (!buildingHeightM && b.tags) {
        const lv = parseFloat(b.tags['building:levels']);
        if (!isNaN(lv) && lv > 0) buildingHeightM = lv * 3.5;
      }
      if (!buildingHeightM) buildingHeightM = defaultHouseHeight;

      const centroid = buildingCentroid(coords);
      // Heurística rápida: apenas testa se o centroide do building está
      // aproximadamente no caminho (within ~30m do raio observer→poi)
      const distFromRay = this.perpDistanceToRay(observer, poi, centroid);
      if (distFromRay > 30) continue;

      const blocks = isSightLineBlockedBy(
        observer,
        eyeHeightM,
        poi,
        poiTopHeightM,
        centroid,
        buildingHeightM
      );
      if (blocks) return true;
    }
    return false;
  }

  /**
   * Distância perpendicular de um ponto até o raio AB (aproximação cartesiana).
   */
  private static perpDistanceToRay(
    A: { lat: number; lng: number },
    B: { lat: number; lng: number },
    P: { lat: number; lng: number }
  ): number {
    // Trabalhar em metros (aproximação local).
    const mPerDegLat = 111000;
    const mPerDegLng = 111000 * Math.cos((A.lat * Math.PI) / 180);

    const ax = A.lng * mPerDegLng, ay = A.lat * mPerDegLat;
    const bx = B.lng * mPerDegLng, by = B.lat * mPerDegLat;
    const px = P.lng * mPerDegLng, py = P.lat * mPerDegLat;

    const dx = bx - ax, dy = by - ay;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return calculateDistance(A, P);

    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (len * len)));
    const closestX = ax + t * dx, closestY = ay + t * dy;
    const ddx = px - closestX, ddy = py - closestY;
    return Math.sqrt(ddx * ddx + ddy * ddy);
  }
}

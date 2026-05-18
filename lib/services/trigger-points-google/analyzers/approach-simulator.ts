/**
 * Approach Simulator (issue 2.1 / KILLER FEATURE)
 *
 * Para cada TP candidato:
 *  1. Gera N origens em direções cardinais (1-3 km do POI)
 *  2. Pede ao OSRM rotas dessas origens até o POI
 *  3. Para cada rota, encontra o ponto onde a rota entra no radius do TP
 *  4. Calcula o heading do usuário ali (bearing dos últimos ~50m da rota)
 *  5. Aplica a mesma lógica do app (zones front/right/left/back)
 *  6. Rejeita o candidato se >50% das simulações resultam em "back"
 *
 * Isso valida na geração exatamente o que o app vai fazer em produção:
 * elimina TPs que, embora "geometricamente bonitos", jamais disparariam
 * por causa da direção real do tráfego.
 */

import { OSRMService, LatLng } from '../../routing/OSRMService';
import {
  calculateDistance,
  calculateBearing,
  getDirectionZone,
} from '../../../geometry';
import { TriggerPointCandidate } from '../types/interfaces';

export interface ApproachSimulationResult {
  totalRoutes: number;
  routesReached: number;
  backCount: number;
  frontCount: number;
  rightCount: number;
  leftCount: number;
  backRate: number; // 0..1
  shouldReject: boolean;
}

export interface ApproachSimulatorOptions {
  /** Distâncias (m) das origens em relação ao POI */
  originDistancesM?: number[];
  /** Quantos bearings cardinais usar (4=NESW, 8=NE/NW/etc) */
  cardinalCount?: number;
  /** Threshold de back-rate acima do qual o candidato é rejeitado */
  rejectIfBackRateAbove?: number;
  /** Timeout total da simulação (ms) — após isso, retorna o que tem */
  timeoutMs?: number;
}

const DEFAULTS: Required<ApproachSimulatorOptions> = {
  originDistancesM: [1500, 3000],
  cardinalCount: 4,
  rejectIfBackRateAbove: 0.5,
  timeoutMs: 5000,
};

/**
 * Gera pontos de origem em direções cardinais a uma distância dada do POI.
 */
function generateOrigins(
  poi: LatLng,
  distancesM: number[],
  cardinalCount: number
): LatLng[] {
  const origins: LatLng[] = [];
  const angleStep = 360 / cardinalCount;

  for (const d of distancesM) {
    for (let i = 0; i < cardinalCount; i++) {
      const bearing = i * angleStep;
      const bearingRad = (bearing * Math.PI) / 180;
      // Aproximação esfera local: 1° lat ≈ 111000m
      const latDelta = (d / 111000) * Math.cos(bearingRad);
      const lngDelta = (d / (111000 * Math.cos((poi.lat * Math.PI) / 180))) * Math.sin(bearingRad);
      origins.push({
        lat: poi.lat + latDelta,
        lng: poi.lng + lngDelta,
      });
    }
  }
  return origins;
}

/**
 * Encontra o ponto em uma rota onde o usuário entra no radius do TP.
 * Retorna o índice ou null se nunca entra.
 */
function findEntryPointIndex(
  route: LatLng[],
  tp: LatLng,
  radius: number
): number | null {
  for (let i = 0; i < route.length; i++) {
    if (calculateDistance(route[i], tp) <= radius) {
      return i;
    }
  }
  return null;
}

/**
 * Calcula o heading do usuário no momento de entrada no radius,
 * usando o trecho anterior ao ponto de entrada (~50m).
 */
function headingAtEntry(route: LatLng[], entryIdx: number): number | null {
  if (entryIdx === 0) return null; // entrou já na origem — sem heading definido
  // Voltamos no path até acumular ~50m para um bearing estável
  let acc = 0;
  let backIdx = entryIdx;
  while (backIdx > 0 && acc < 50) {
    acc += calculateDistance(route[backIdx], route[backIdx - 1]);
    backIdx--;
  }
  if (backIdx === entryIdx) return null;
  return calculateBearing(route[backIdx], route[entryIdx]);
}

export class ApproachSimulator {
  /**
   * Simula aproximações ao candidato e retorna o veredito.
   * Erros de OSRM são tolerados: rotas que falham contam como "não alcançou".
   */
  static async simulate(
    candidate: TriggerPointCandidate,
    poi: LatLng,
    candidateRadius: number,
    options: ApproachSimulatorOptions = {}
  ): Promise<ApproachSimulationResult> {
    const opts = { ...DEFAULTS, ...options };
    const tp: LatLng = candidate.location;
    const origins = generateOrigins(poi, opts.originDistancesM, opts.cardinalCount);

    let frontCount = 0;
    let rightCount = 0;
    let leftCount = 0;
    let backCount = 0;
    let reached = 0;

    const start = Date.now();

    // Executar em paralelo (com Promise.allSettled para tolerar falhas)
    const promises = origins.map(origin =>
      OSRMService.getRoute([origin, tp]).catch(() => null)
    );

    const results = await Promise.race([
      Promise.allSettled(promises),
      new Promise<PromiseSettledResult<any>[]>(resolve =>
        setTimeout(() => resolve([]), opts.timeoutMs)
      ),
    ]);

    for (const r of results) {
      if (r.status !== 'fulfilled' || !r.value) continue;
      const route = r.value.coordinates as LatLng[];
      const entryIdx = findEntryPointIndex(route, tp, candidateRadius);
      if (entryIdx === null) continue;
      reached++;

      const heading = headingAtEntry(route, entryIdx);
      if (heading === null) continue;

      const direction = getDirectionZone(candidate.expectedBearing, heading);
      if (direction === 'front') frontCount++;
      else if (direction === 'right') rightCount++;
      else if (direction === 'left') leftCount++;
      else backCount++;
    }

    const totalClassified = frontCount + rightCount + leftCount + backCount;
    const backRate = totalClassified > 0 ? backCount / totalClassified : 0;
    const shouldReject = totalClassified > 0 && backRate > opts.rejectIfBackRateAbove;

    const elapsed = Date.now() - start;
    console.log(
      `🧭 Approach sim: ${origins.length} origins, ${reached} reached, ` +
      `F=${frontCount} R=${rightCount} L=${leftCount} B=${backCount} ` +
      `(backRate=${(backRate * 100).toFixed(0)}%, ${elapsed}ms) → ${shouldReject ? 'REJECT' : 'pass'}`
    );

    return {
      totalRoutes: origins.length,
      routesReached: reached,
      backCount,
      frontCount,
      rightCount,
      leftCount,
      backRate,
      shouldReject,
    };
  }

  /**
   * Issue 2.3 — Corridor validation.
   *
   * Verifica se existe rota OSRM partindo de `2 × radius` ANTES do TP
   * (na direção contrária ao POI), passando pelo TP e seguindo até o POI.
   *
   * Se OSRM não traçar a rota OU o ângulo da rota no TP for muito diferente
   * do `expectedBearing` (>60°), o TP está numa rua que não leva ao POI.
   */
  static async validateCorridor(
    candidate: TriggerPointCandidate,
    poi: LatLng,
    candidateRadius: number,
    maxAngleDiffDeg: number = 60
  ): Promise<{ valid: boolean; reason?: string }> {
    const tp = candidate.location;
    const expectedBearing = candidate.expectedBearing;

    // Origem: 2x radius "atrás" do TP em relação ao POI
    const backwardBearing = (expectedBearing + 180) % 360;
    const offsetM = candidateRadius * 2;
    const angleRad = (backwardBearing * Math.PI) / 180;
    const latDelta = (offsetM / 111000) * Math.cos(angleRad);
    const lngDelta = (offsetM / (111000 * Math.cos((tp.lat * Math.PI) / 180))) * Math.sin(angleRad);
    const origin: LatLng = { lat: tp.lat + latDelta, lng: tp.lng + lngDelta };

    try {
      const route = await OSRMService.getRoute([origin, tp, poi]);
      if (!route || !route.coordinates || route.coordinates.length < 2) {
        return { valid: false, reason: 'osrm_no_route' };
      }

      // Heading nas vizinhanças do TP (50m antes)
      const entryIdx = findEntryPointIndex(route.coordinates, tp, Math.max(candidateRadius, 30));
      if (entryIdx === null) return { valid: false, reason: 'route_does_not_pass_tp' };

      const actualHeading = headingAtEntry(route.coordinates, entryIdx);
      if (actualHeading === null) return { valid: true }; // pouca info — não bloquear

      const diff = Math.abs(((actualHeading - expectedBearing + 540) % 360) - 180);
      if (diff > maxAngleDiffDeg) {
        return { valid: false, reason: `heading_mismatch (Δ=${diff.toFixed(0)}°)` };
      }
      return { valid: true };
    } catch {
      return { valid: false, reason: 'osrm_error' };
    }
  }
}

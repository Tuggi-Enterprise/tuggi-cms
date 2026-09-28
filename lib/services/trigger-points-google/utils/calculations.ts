import { GeoPoint } from '../types/interfaces';
import { heightFromTags } from '../config/visibility-class';

/**
 * Calcula a distância entre dois pontos em metros usando a fórmula de Haversine
 */
export function calculateDistance(
  point1: GeoPoint,
  point2: GeoPoint
): number {
  const R = 6371000; // Raio da Terra em metros
  const dLat = (point2.lat - point1.lat) * Math.PI / 180;
  const dLng = (point2.lng - point1.lng) * Math.PI / 180;
  
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(point1.lat * Math.PI / 180) * Math.cos(point2.lat * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  
  return R * c;
}

/**
 * Calcula o bearing (direção) entre dois pontos em graus
 */
export function calculateBearing(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): number {
  const dLng = (to.lng - from.lng) * Math.PI / 180;
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;
  
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  
  let bearing = Math.atan2(y, x) * 180 / Math.PI;
  return (bearing + 360) % 360; // Normalizar para 0-360
}

/**
 * Normaliza a diferença de ângulos para o range -180 a 180
 */
export function normalizeAngleDifference(angle: number): number {
  while (angle > 180) angle -= 360;
  while (angle < -180) angle += 360;
  return angle;
}

/**
 * Closest point on segment AB to `point`, projected on a local metric plane (longitude
 * scaled by cos(lat)). Raw-degree projection skews the foot of the perpendicular away
 * from the equator — BR-AUDIO-010: the TP must sit in front of the POI edge.
 * The single implementation: every point-to-segment helper here delegates to it.
 */
export function closestPointOnSegment(
  point: GeoPoint,
  lineStart: GeoPoint,
  lineEnd: GeoPoint
): { point: GeoPoint; t: number } {
  const k = Math.cos((lineStart.lat * Math.PI) / 180);
  const dx = (lineEnd.lng - lineStart.lng) * k;
  const dy = lineEnd.lat - lineStart.lat;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { point: { lat: lineStart.lat, lng: lineStart.lng }, t: 0 };
  let t = (((point.lng - lineStart.lng) * k) * dx + (point.lat - lineStart.lat) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return {
    point: {
      lat: lineStart.lat + t * (lineEnd.lat - lineStart.lat),
      lng: lineStart.lng + t * (lineEnd.lng - lineStart.lng),
    },
    t,
  };
}

/** Distance in meters from `point` to segment AB. */
export function distanceToLineSegment(
  point: GeoPoint,
  lineStart: GeoPoint,
  lineEnd: GeoPoint
): number {
  return calculateDistance(point, closestPointOnSegment(point, lineStart, lineEnd).point);
}

/**
 * Verifica se um ângulo está dentro de um range de tolerância
 */
export function isInBearingRange(
  actualBearing: number,
  expectedBearing: number,
  threshold: number = 30
): boolean {
  const difference = normalizeAngleDifference(actualBearing - expectedBearing);
  return Math.abs(difference) <= threshold;
}

/**
 * Building height from OSM tags; 0 when none. Delegates to the engine's one floor ruler
 * (config/visibility-class#heightFromTags, INV-E3) — this copy used ×3 per floor.
 */
export function extractBuildingHeight(tags: any): number {
  return heightFromTags(tags)?.heightM ?? 0;
}

/**
 * Calcula a área de um polígono usando a fórmula de Shoelace
 * Retorna área em graus² (não converte para m²)
 */
export function calculatePolygonArea(coordinates: Array<{lat: number, lng: number}>): number {
  if (coordinates.length < 3) return 0;
  
  let area = 0;
  const n = coordinates.length;
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += coordinates[i].lng * coordinates[j].lat;
    area -= coordinates[j].lng * coordinates[i].lat;
  }
  
  return Math.abs(area) / 2;
}

/**
 * Converte área de graus² para metros²
 * @param areaDegrees2 Área em graus²
 * @returns Área em metros²
 */
export function convertDegrees2ToM2(areaDegrees2: number): number {
  // 1 grau ≈ 111,320 metros (aproximação para latitude)
  const METERS_PER_DEGREE = 111320;
  return areaDegrees2 * METERS_PER_DEGREE * METERS_PER_DEGREE;
}

/**
 * Calcula a área de um polígono em metros²
 * Combina calculatePolygonArea + conversão para m²
 */
export function calculatePolygonAreaInM2(coordinates: Array<{lat: number, lng: number}>): number {
  const areaDegrees2 = calculatePolygonArea(coordinates);
  return convertDegrees2ToM2(areaDegrees2);
}

/**
 * Calcula o perímetro de um polígono
 */
export function calculatePolygonPerimeter(coordinates: Array<{lat: number, lng: number}>): number {
  if (coordinates.length < 2) return 0;
  
  let perimeter = 0;
  for (let i = 0; i < coordinates.length; i++) {
    const nextIndex = (i + 1) % coordinates.length;
    perimeter += calculateDistance(coordinates[i], coordinates[nextIndex]);
  }
  
  return perimeter;
}

/**
 * Verifica se um ponto está dentro de um polígono
 */
export function isPointInPolygon(
  point: { lat: number; lng: number },
  polygon: Array<{lat: number, lng: number}>
): boolean {
  let inside = false;
  const x = point.lng;
  const y = point.lat;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  
  return inside;
}

/**
 * Calcula a distância de um ponto até um polígono
 */
export function calculateDistanceToPolygon(
  point: { lat: number; lng: number },
  polygon: Array<{lat: number, lng: number}>
): number {
  if (isPointInPolygon(point, polygon)) {
    return 0;
  }
  
  let minDistance = Infinity;
  
  for (let i = 0; i < polygon.length; i++) {
    const nextIndex = (i + 1) % polygon.length;
    const distance = calculateDistanceToLineSegment(
      point,
      polygon[i],
      polygon[nextIndex]
    );
    minDistance = Math.min(minDistance, distance);
  }
  
  return minDistance;
}

/** Distance in meters from `point` to segment AB (same as distanceToLineSegment). */
export function calculateDistanceToLineSegment(
  point: { lat: number; lng: number },
  lineStart: { lat: number; lng: number },
  lineEnd: { lat: number; lng: number }
): number {
  return distanceToLineSegment(point, lineStart, lineEnd);
}

/**
 * Projeta um ponto na polilinha de uma rua e retorna:
 *  - point: posição projetada na polilinha (interpolada dentro do segmento mais próximo)
 *  - segmentIndex: índice do segmento (coords[i] → coords[i+1])
 *  - t: parâmetro de interpolação [0..1] dentro do segmento
 *  - distance: distância (metros) do ponto original à projeção
 *
 * Generaliza `calculateDistanceToLineSegment` pra polilinhas multi-segmento.
 * Útil pra spawnar TPs a partir do "closest point on street to POI".
 */
export function closestPointOnPolyline(
  point: { lat: number; lng: number },
  coords: Array<{ lat: number; lng: number }>
): { point: { lat: number; lng: number }; segmentIndex: number; t: number; distance: number } | null {
  if (!coords || coords.length === 0) return null;
  if (coords.length === 1) {
    return {
      point: { lat: coords[0].lat, lng: coords[0].lng },
      segmentIndex: 0,
      t: 0,
      distance: calculateDistance(point, coords[0]),
    };
  }

  let best = {
    point: { lat: coords[0].lat, lng: coords[0].lng },
    segmentIndex: 0,
    t: 0,
    distance: Infinity,
  };

  for (let i = 0; i < coords.length - 1; i++) {
    const A = coords[i];
    const B = coords[i + 1];
    if (A.lat === B.lat && A.lng === B.lng) continue;
    const { point: proj, t } = closestPointOnSegment(point, A, B);
    const d = calculateDistance(point, proj);
    if (d < best.distance) {
      best = { point: proj, segmentIndex: i, t, distance: d };
    }
  }
  return best;
}

/**
 * Ponto da rua mais próximo do POI — da borda quando ela existe, do pino quando não.
 *
 * Usa `fullCoordinates` quando a rua foi colapsada a 1 ponto. Substitui o antigo
 * `street.coordinates[0]` (1º vértice), que numa rota longa caía a quilômetros do POI
 * (BR-AUDIO-010: o TP dispara onde o POI está).
 */
export function closestStreetPointToPoi(
  street: { coordinates: Array<{ lat: number; lng: number }>; fullCoordinates?: Array<{ lat: number; lng: number }> },
  poiPin: { lat: number; lng: number },
  boundaryCoords?: Array<{ lat: number; lng: number }>
): { point: { lat: number; lng: number }; distance: number } | null {
  const polyline = street.fullCoordinates && street.fullCoordinates.length >= 2
    ? street.fullCoordinates
    : street.coordinates;
  const targets = boundaryCoords && boundaryCoords.length >= 3 ? boundaryCoords : [poiPin];

  let best: { point: { lat: number; lng: number }; distance: number } | null = null;
  for (const target of targets) {
    const projection = closestPointOnPolyline(target, polyline);
    if (projection && (!best || projection.distance < best.distance)) {
      best = { point: projection.point, distance: projection.distance };
    }
  }
  return best;
}

/**
 * Point of the WHOLE street polyline closest to the POI edge (or pin, without a
 * boundary), with its edge distance. Considers the foot of the perpendicular from every
 * boundary vertex and every street vertex, so a long segment passing in front of a small
 * POI anchors in front of it instead of at a far vertex. BR-AUDIO-010.
 */
export function streetFootOnEdge(
  polyline: GeoPoint[],
  poiPin: GeoPoint,
  boundaryCoords?: GeoPoint[]
): { point: GeoPoint; edgeDistanceM: number } | null {
  if (!polyline || polyline.length === 0) return null;
  const hasBoundary = !!boundaryCoords && boundaryCoords.length >= 3;
  const edgeDist = (p: GeoPoint) => hasBoundary ? calculateDistanceToBoundary(p, boundaryCoords!) : calculateDistance(p, poiPin);
  const seeds: GeoPoint[] = [...polyline];
  for (const target of hasBoundary ? boundaryCoords! : [poiPin]) {
    const proj = closestPointOnPolyline(target, polyline);
    if (proj) seeds.push(proj.point);
  }
  let best: { point: GeoPoint; edgeDistanceM: number } | null = null;
  for (const p of seeds) {
    const d = edgeDist(p);
    if (!best || d < best.edgeDistanceM) best = { point: p, edgeDistanceM: d };
  }
  return best;
}

/**
 * Samples the polyline every `spacingM` meters of arc length, both ways from `anchor`
 * (anchor first, then alternating outwards). Points are interpolated, not vertices.
 */
export function samplePolylineAround(
  polyline: GeoPoint[],
  anchor: GeoPoint,
  spacingM: number
): GeoPoint[] {
  if (!polyline || polyline.length < 2 || spacingM <= 0) return polyline?.length ? [anchor] : [];
  const cum: number[] = [0];
  for (let i = 1; i < polyline.length; i++) cum.push(cum[i - 1] + calculateDistance(polyline[i - 1], polyline[i]));
  const total = cum[cum.length - 1];
  const proj = closestPointOnPolyline(anchor, polyline)!;
  const s0 = cum[proj.segmentIndex] + proj.t * (cum[proj.segmentIndex + 1] - cum[proj.segmentIndex]);
  const at = (s: number): GeoPoint => {
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < s) i++;
    const seg = cum[i + 1] - cum[i];
    const r = seg > 0 ? (s - cum[i]) / seg : 0;
    return { lat: polyline[i].lat + (polyline[i + 1].lat - polyline[i].lat) * r, lng: polyline[i].lng + (polyline[i + 1].lng - polyline[i].lng) * r };
  };
  const out: GeoPoint[] = [proj.point];
  for (let k = 1; ; k++) {
    const fwd = s0 + k * spacingM;
    const back = s0 - k * spacingM;
    if (fwd > total && back < 0) break;
    if (fwd <= total) out.push(at(fwd));
    if (back >= 0) out.push(at(back));
  }
  return out;
}

/**
 * Caminha pela polilinha a partir de uma posição inicial (resultado de
 * `closestPointOnPolyline`) por `distanceM` metros. Sinal de `distanceM`:
 *  - positivo: avança no sentido coords[i] → coords[i+1] → ...
 *  - negativo: retrocede no sentido coords[i] → coords[i-1] → ...
 *
 * Se atingir o fim da polilinha antes de consumir `distanceM`, retorna o
 * último ponto alcançável (endpoint da polilinha). Nunca retorna null se
 * `start` for válido.
 */
export function walkAlongPolyline(
  coords: Array<{ lat: number; lng: number }>,
  start: { point: { lat: number; lng: number }; segmentIndex: number; t: number },
  distanceM: number
): { lat: number; lng: number } {
  if (!coords || coords.length === 0) return start.point;

  const forward = distanceM >= 0;
  let remaining = Math.abs(distanceM);
  let currentPoint = { lat: start.point.lat, lng: start.point.lng };

  if (forward) {
    let nextIdx = start.segmentIndex + 1;
    while (remaining > 0 && nextIdx < coords.length) {
      const next = coords[nextIdx];
      const segLen = calculateDistance(currentPoint, next);
      if (segLen >= remaining) {
        const r = remaining / segLen;
        return {
          lat: currentPoint.lat + (next.lat - currentPoint.lat) * r,
          lng: currentPoint.lng + (next.lng - currentPoint.lng) * r,
        };
      }
      remaining -= segLen;
      currentPoint = { lat: next.lat, lng: next.lng };
      nextIdx++;
    }
  } else {
    let nextIdx = start.segmentIndex;
    while (remaining > 0 && nextIdx >= 0) {
      const next = coords[nextIdx];
      const segLen = calculateDistance(currentPoint, next);
      if (segLen >= remaining) {
        const r = remaining / segLen;
        return {
          lat: currentPoint.lat + (next.lat - currentPoint.lat) * r,
          lng: currentPoint.lng + (next.lng - currentPoint.lng) * r,
        };
      }
      remaining -= segLen;
      currentPoint = { lat: next.lat, lng: next.lng };
      nextIdx--;
    }
  }
  return currentPoint;
}

/**
 * Calcula o centro (centroid) de um polígono
 */
export function calculatePolygonCenter(coordinates: Array<{lat: number, lng: number}>): {lat: number, lng: number} {
  if (coordinates.length === 0) return { lat: 0, lng: 0 };
  
  let totalLat = 0;
  let totalLng = 0;
  
  for (const coord of coordinates) {
    totalLat += coord.lat;
    totalLng += coord.lng;
  }
  
  return {
    lat: totalLat / coordinates.length,
    lng: totalLng / coordinates.length
  };
}

/**
 * Calcula a variância de um array de números
 */
export function calculateVariance(values: number[]): number {
  if (values.length === 0) return 0;
  
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
  
  return Math.sqrt(variance);
}

/**
 * Gera pontos de amostra em um círculo. Quando `seed` é fornecido, distâncias
 * são reproduzíveis (PRNG seedado). Sem seed, mantém Math.random.
 *
 * NOTA: função atualmente sem callers no motor (mantida por API stability).
 * Adicionada opção de seed pra futura adoção determinística.
 */
export function generateCircleSamplePoints(
  center: { lat: number; lng: number },
  radius: number,
  count: number,
  seed?: string
): Array<{lat: number, lng: number}> {
  const points = [];

  let rng: () => number;
  if (seed) {
    // PRNG determinístico (mulberry32)
    let h = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
      h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
    }
    let state = h >>> 0;
    rng = () => {
      state = (state + 0x6D2B79F5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  } else {
    rng = Math.random;
  }

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * 2 * Math.PI;
    const distance = rng() * radius;

    const lat = center.lat + (distance / 111000) * Math.cos(angle);
    const lng = center.lng + (distance / (111000 * Math.cos(center.lat * Math.PI / 180))) * Math.sin(angle);

    points.push({ lat, lng });
  }

  return points;
}

/**
 * Converte viewport do Google Maps para polígono
 */
export function convertViewportToPolygon(viewport: {
  northeast: { lat: number; lng: number };
  southwest: { lat: number; lng: number };
}): Array<{lat: number, lng: number}> {
  return [
    { lat: viewport.northeast.lat, lng: viewport.southwest.lng },
    { lat: viewport.northeast.lat, lng: viewport.northeast.lng },
    { lat: viewport.southwest.lat, lng: viewport.northeast.lng },
    { lat: viewport.southwest.lat, lng: viewport.southwest.lng },
    { lat: viewport.northeast.lat, lng: viewport.southwest.lng }
  ];
}

/**
 * Calcula a distância mínima de um ponto até o boundary (perímetro) de um polígono
 * Retorna 0 se o ponto estiver dentro do polígono
 */
export function calculateDistanceToBoundary(
  point: { lat: number; lng: number },
  boundaryCoordinates: Array<{ lat: number; lng: number }>
): number {
  // Verificar se o ponto está dentro do polígono
  if (isPointInPolygon(point, boundaryCoordinates)) {
    return 0; // Ponto dentro do boundary
  }
  
  // Calcular distância mínima até qualquer segmento do boundary
  let minDistance = Infinity;
  
  for (let i = 0; i < boundaryCoordinates.length - 1; i++) {
    const segmentStart = boundaryCoordinates[i];
    const segmentEnd = boundaryCoordinates[i + 1];
    
    const distance = calculateDistanceToLineSegment(point, segmentStart, segmentEnd);
    minDistance = Math.min(minDistance, distance);
  }
  
  return minDistance;
}


/**
 * Gera pontos em um raio específico A PARTIR DO BOUNDARY (não do centro)
 * Esta é a função principal para calcular TPs baseado no boundary
 */
export function generatePointsFromBoundary(
  boundaryCoordinates: Array<{ lat: number; lng: number }>,
  radiusFromBoundary: number,
  numberOfPoints: number = 16
): Array<{ lat: number; lng: number; distanceFromBoundary: number }> {
  const points: Array<{ lat: number; lng: number; distanceFromBoundary: number }> = [];
  
  // Calcular centro do boundary para referência
  const center = calculatePolygonCenter(boundaryCoordinates);
  
  // Calcular raio máximo do boundary (do centro até o ponto mais distante)
  const maxBoundaryRadius = Math.max(
    ...boundaryCoordinates.map(coord => calculateDistance(center, coord))
  );
  
  // Raio total: raio do boundary + raio adicional solicitado
  const totalRadius = maxBoundaryRadius + radiusFromBoundary;
  
  // Gerar pontos candidatos em círculo expandido
  for (let i = 0; i < numberOfPoints; i++) {
    const angle = (i / numberOfPoints) * 2 * Math.PI;
    
    // Calcular ponto no raio total
    const lat = center.lat + (totalRadius / 111000) * Math.cos(angle);
    const lng = center.lng + (totalRadius / (111000 * Math.cos(center.lat * Math.PI / 180))) * Math.sin(angle);
    
    const candidatePoint = { lat, lng };
    
    // Verificar distância real até o boundary
    const actualDistanceToBoundary = calculateDistanceToBoundary(candidatePoint, boundaryCoordinates);
    
    // Ajustar ponto para estar exatamente no raio solicitado do boundary
    if (actualDistanceToBoundary > 0) {
      const adjustmentFactor = radiusFromBoundary / actualDistanceToBoundary;
      
      if (Math.abs(adjustmentFactor - 1) > 0.1) { // Se diferença > 10%
        // Reposicionar ponto para estar na distância correta
        const nearestBoundaryPoint = findNearestBoundaryPoint(candidatePoint, boundaryCoordinates);
        const adjustedPoint = adjustPointDistance(nearestBoundaryPoint, candidatePoint, radiusFromBoundary);
        
        points.push({
          ...adjustedPoint,
          distanceFromBoundary: radiusFromBoundary
        });
      } else {
        points.push({
          ...candidatePoint,
          distanceFromBoundary: actualDistanceToBoundary
        });
      }
    }
  }
  
  return points;
}

/**
 * Encontra o ponto mais próximo no boundary
 */
export function findNearestBoundaryPoint(
  point: { lat: number; lng: number },
  boundaryCoordinates: Array<{ lat: number; lng: number }>
): { lat: number; lng: number } {
  let nearestPoint = boundaryCoordinates[0];
  let minDistance = calculateDistance(point, boundaryCoordinates[0]);
  
  for (const boundaryPoint of boundaryCoordinates) {
    const distance = calculateDistance(point, boundaryPoint);
    if (distance < minDistance) {
      minDistance = distance;
      nearestPoint = boundaryPoint;
    }
  }
  
  return nearestPoint;
}

/**
 * Ajusta um ponto para estar a uma distância específica de um ponto de referência
 */
export function adjustPointDistance(
  fromPoint: { lat: number; lng: number },
  toPoint: { lat: number; lng: number },
  targetDistance: number
): { lat: number; lng: number } {
  const currentDistance = calculateDistance(fromPoint, toPoint);
  if (currentDistance === 0) return toPoint;
  
  const ratio = targetDistance / currentDistance;
  
  const deltaLat = (toPoint.lat - fromPoint.lat) * ratio;
  const deltaLng = (toPoint.lng - fromPoint.lng) * ratio;
  
  return {
    lat: fromPoint.lat + deltaLat,
    lng: fromPoint.lng + deltaLng
  };
}

/**
 * 🎯 NOVO: Calcula o comprimento de um vetor 2D
 * DRY: Evita duplicação de Math.sqrt(lat² + lng²)
 */
export function calculateVectorLength(vector: { lat: number; lng: number }): number {
  return Math.sqrt(vector.lat * vector.lat + vector.lng * vector.lng);
}

/**
 * Find the closest point on a boundary polygon to a given trigger point
 * This enables accurate bearing calculation to the visible edge of the POI
 * More precise than findNearestBoundaryPoint as it also checks points along boundary edges
 */
export function findClosestPointOnBoundary(
  triggerPoint: { lat: number; lng: number },
  boundaryCoordinates: Array<{ lat: number; lng: number }>
): { lat: number; lng: number; distance: number } {
  let closestPoint = boundaryCoordinates[0];
  let minDistance = calculateDistance(triggerPoint, closestPoint);
  
  // Check all boundary points
  for (const point of boundaryCoordinates) {
    const distance = calculateDistance(triggerPoint, point);
    if (distance < minDistance) {
      minDistance = distance;
      closestPoint = point;
    }
  }
  
  // Also check points along boundary edges for better precision
  for (let i = 0; i < boundaryCoordinates.length; i++) {
    const edgeStart = boundaryCoordinates[i];
    const edgeEnd = boundaryCoordinates[(i + 1) % boundaryCoordinates.length];
    
    // Find closest point on this edge
    const closestOnEdge = closestPointOnSegment(triggerPoint, edgeStart, edgeEnd).point;
    const distanceToEdge = calculateDistance(triggerPoint, closestOnEdge);
    
    if (distanceToEdge < minDistance) {
      minDistance = distanceToEdge;
      closestPoint = closestOnEdge;
    }
  }
  
  return {
    lat: closestPoint.lat,
    lng: closestPoint.lng,
    distance: minDistance
  };
}

/**
 * Check if a line segment intersects with a polygon
 */
export function lineIntersectsPolygon(point1: GeoPoint, point2: GeoPoint, polygon: GeoPoint[]): boolean {
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    if (lineSegmentsIntersect(point1, point2, polygon[i], polygon[j])) {
      return true;
    }
  }
  return false;
}

/**
 * Check if two line segments intersect
 */
function lineSegmentsIntersect(p1: GeoPoint, q1: GeoPoint, p2: GeoPoint, q2: GeoPoint): boolean {
  const orientation = (p: GeoPoint, q: GeoPoint, r: GeoPoint): number => {
    const val = (q.lng - p.lng) * (r.lat - q.lat) - (q.lat - p.lat) * (r.lng - q.lng);
    if (val === 0) return 0;
    return val > 0 ? 1 : 2;
  };

  const onSegment = (p: GeoPoint, q: GeoPoint, r: GeoPoint): boolean => {
    return q.lng <= Math.max(p.lng, r.lng) && q.lng >= Math.min(p.lng, r.lng) &&
           q.lat <= Math.max(p.lat, r.lat) && q.lat >= Math.min(p.lat, r.lat);
  };

  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;

  return false;
}



/**
 * The ring is a circle drawn around a point (≥12 vertices, all at the same distance from
 * their centroid, ±2%) — the engine's fallback shape, not a surveyed footprint. Stored
 * boundaries from earlier runs carry it without any source flag (#779).
 */
export function isDrawnCircle(coords: Array<{ lat: number; lng: number }>): boolean {
  const ring = coords.length > 1 && coords[0].lat === coords[coords.length - 1].lat && coords[0].lng === coords[coords.length - 1].lng
    ? coords.slice(0, -1)
    : coords;
  if (ring.length < 12) return false;
  const c = { lat: ring.reduce((t, p) => t + p.lat, 0) / ring.length, lng: ring.reduce((t, p) => t + p.lng, 0) / ring.length };
  const r = ring.map(p => calculateDistance(c, p));
  const mean = r.reduce((t, x) => t + x, 0) / r.length;
  return mean > 0 && r.every(x => Math.abs(x - mean) <= 0.02 * mean);
}

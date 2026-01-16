import { GeoPoint } from '../types/interfaces';

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
 * Calcula a distância mínima de um ponto a um segmento de linha
 */
export function distanceToLineSegment(
  point: GeoPoint,
  lineStart: GeoPoint,
  lineEnd: GeoPoint
): number {
  const A = point.lat - lineStart.lat;
  const B = point.lng - lineStart.lng;
  const C = lineEnd.lat - lineStart.lat;
  const D = lineEnd.lng - lineStart.lng;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;

  if (lenSq !== 0) param = dot / lenSq;

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

  return calculateDistance(point, { lat: xx, lng: yy });
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
 * Extrai altura de prédio de tags OSM (função centralizada - DRY)
 */
export function extractBuildingHeight(tags: any): number {
  if (!tags) return 0;
  
  // 1. Tag height direta
  if (tags.height) {
    // tags.height pode ser número ou string
    if (typeof tags.height === 'number') {
      return tags.height;
    }
    const match = String(tags.height).match(/(\d+\.?\d*)/);
    if (match) return parseFloat(match[1]);
  }
  
  // 2. Tag building:height
  if (tags['building:height']) {
    if (typeof tags['building:height'] === 'number') {
      return tags['building:height'];
    }
    const match = String(tags['building:height']).match(/(\d+\.?\d*)/);
    if (match) return parseFloat(match[1]);
  }
  
  // 3. Converter building:levels em altura (3m por andar)
  if (tags['building:levels']) {
    const levels = parseInt(tags['building:levels']);
    if (!isNaN(levels)) return levels * 3;
  }
  
  return 0;
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

/**
 * Calcula a distância de um ponto até um segmento de linha
 */
export function calculateDistanceToLineSegment(
  point: { lat: number; lng: number },
  lineStart: { lat: number; lng: number },
  lineEnd: { lat: number; lng: number }
): number {
  const A = point.lng - lineStart.lng;
  const B = point.lat - lineStart.lat;
  const C = lineEnd.lng - lineStart.lng;
  const D = lineEnd.lat - lineStart.lat;
  
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  
  if (lenSq === 0) {
    return calculateDistance(point, lineStart);
  }
  
  let param = dot / lenSq;
  
  let xx, yy;
  
  if (param < 0) {
    xx = lineStart.lng;
    yy = lineStart.lat;
  } else if (param > 1) {
    xx = lineEnd.lng;
    yy = lineEnd.lat;
  } else {
    xx = lineStart.lng + param * C;
    yy = lineStart.lat + param * D;
  }
  
  return calculateDistance(point, { lat: yy, lng: xx });
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
 * Gera pontos de amostra em um círculo
 */
export function generateCircleSamplePoints(
  center: { lat: number; lng: number },
  radius: number,
  count: number
): Array<{lat: number, lng: number}> {
  const points = [];
  
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * 2 * Math.PI;
    const distance = Math.random() * radius;
    
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
 * Calcula o raio ótimo baseado no contexto geográfico
 */
export function calculateOptimalRadius(
  context: {
    urbanDensity: { level: string; score: number };
    elevationContext: { type: string; variance: number };
  }
): number {
  const baseRadius = 100; // metros
  
  // Ajustar baseado na densidade urbana
  let densityMultiplier = 1.0;
  switch (context.urbanDensity.level) {
    case 'very_dense':
      densityMultiplier = 0.7;
      break;
    case 'dense':
      densityMultiplier = 0.8;
      break;
    case 'medium':
      densityMultiplier = 1.0;
      break;
    case 'low':
      densityMultiplier = 1.2;
      break;
    case 'rural':
      densityMultiplier = 1.5;
      break;
  }
  
  // Ajustar baseado na elevação
  let elevationMultiplier = 1.0;
  switch (context.elevationContext.type) {
    case 'mountainous':
      elevationMultiplier = 1.3;
      break;
    case 'hilly':
      elevationMultiplier = 1.1;
      break;
    case 'flat':
      elevationMultiplier = 1.0;
      break;
  }
  
  return Math.round(baseRadius * densityMultiplier * elevationMultiplier);
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
 * Calcula raio inteligente baseado na elevação e altura do POI
 */
export function calculateElevationBasedRadius(
  elevation?: {
    min: number;
    max: number;
    average: number;
    center: number;
  },
  height?: number,
  baseRadius: number = 200
): number {
  let calculatedRadius = baseRadius;
  
  // Ajustar baseado na altura do POI (ex: prédios altos)
  if (height && height > 0) {
    // Regra: para cada 10m de altura, adicionar 15m de raio
    const heightBonus = Math.floor(height / 10) * 15;
    calculatedRadius += heightBonus;
    console.log(`📏 Height bonus: ${height}m → +${heightBonus}m radius`);
  }
  
  // Ajustar baseado na variação de elevação
  if (elevation) {
    const elevationRange = elevation.max - elevation.min;
    
    if (elevationRange > 50) {
      // Terreno muito variado - aumentar raio para melhor visibilidade
      const terrainBonus = Math.floor(elevationRange / 20) * 25;
      calculatedRadius += terrainBonus;
      console.log(`⛰️ Terrain bonus: ${elevationRange}m range → +${terrainBonus}m radius`);
    }
    
    // Se POI está em elevação alta, aumentar raio (melhor visibilidade)
    if (elevation.center > elevation.average + 20) {
      calculatedRadius += 50;
      console.log(`🏔️ High elevation bonus: +50m radius`);
    }
  }
  
  // Limites mínimos e máximos
  calculatedRadius = Math.max(calculatedRadius, 100); // Mínimo 100m
  calculatedRadius = Math.min(calculatedRadius, 1000); // Máximo 1km
  
  return calculatedRadius;
}

/**
 * 🎯 NOVO: Calcula a distância mínima de uma rua até um ponto central
 * DRY: Evita duplicação de lógica em point-calculator.ts e street-analyzer.ts
 */
export function calculateMinDistanceToCenter(
  streetCoordinates: Array<{ lat: number; lng: number }>,
  center: { lat: number; lng: number }
): number {
  if (!streetCoordinates || streetCoordinates.length === 0) {
    return Infinity;
  }
  
  let minDistance = Infinity;
  for (const coord of streetCoordinates) {
    const distance = calculateDistance(coord, center);
    if (distance < minDistance) {
      minDistance = distance;
    }
  }
  
  return minDistance;
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
    const closestOnEdge = findClosestPointOnLineSegment(triggerPoint, edgeStart, edgeEnd);
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
 * Find the closest point on a line segment to a given point
 */
function findClosestPointOnLineSegment(
  point: { lat: number; lng: number },
  lineStart: { lat: number; lng: number },
  lineEnd: { lat: number; lng: number }
): { lat: number; lng: number } {
  const A = point.lat - lineStart.lat;
  const B = point.lng - lineStart.lng;
  const C = lineEnd.lat - lineStart.lat;
  const D = lineEnd.lng - lineStart.lng;
  
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  
  if (lenSq !== 0) {
    param = dot / lenSq;
  }
  
  let xx: number, yy: number;
  
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
  
  return { lat: xx, lng: yy };
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



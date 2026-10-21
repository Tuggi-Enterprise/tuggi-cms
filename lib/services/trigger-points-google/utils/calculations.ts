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

/** WGS84 semi-major axis and first eccentricity squared: the ellipsoid of PostGIS `geography`. */
const WGS84_A_M = 6_378_137;
const WGS84_E2 = 0.00669437999014;

/**
 * Distance on the WGS84 ellipsoid, the metric of `ST_DWithin(geography, geography, m)` (use_spheroid
 * defaults to true). Local radii of curvature at the mean latitude: < 1 m off GeographicLib up to
 * tens of km. `calculateDistance` (sphere, R = 6371 km) is off by up to 0.4 % at Rio's latitude —
 * 60 m at 15 km — so a check that must agree with the database measures here (BR-POI-009, #779).
 */
export function spheroidDistanceM(a: GeoPoint, b: GeoPoint): number {
  const phi = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const w = 1 - WGS84_E2 * Math.sin(phi) ** 2;
  const meridianRadius = (WGS84_A_M * (1 - WGS84_E2)) / w ** 1.5;
  const primeVerticalRadius = WGS84_A_M / Math.sqrt(w);
  let dLng = b.lng - a.lng;
  if (dLng > 180) dLng -= 360;
  if (dLng < -180) dLng += 360;
  const dy = meridianRadius * (b.lat - a.lat) * Math.PI / 180;
  const dx = primeVerticalRadius * Math.cos(phi) * dLng * Math.PI / 180;
  return Math.hypot(dx, dy);
}

/** `calculateDistanceToPolygon` in the `spheroidDistanceM` metric: 0 inside, else to the nearest edge. */
export function spheroidDistanceToPolygonM(point: GeoPoint, polygon: GeoPoint[]): number {
  if (isPointInPolygon(point, polygon)) return 0;
  if (polygon.length >= RING_INDEX_MIN_VERTICES) {
    // Same minimum through the ring index; the ellipsoid's radii are above MIN_M_PER_DEG_LAT too.
    const idx = ringIndexOf(polygon);
    let min = Infinity;
    walkRingAround(point, idx, k => {
      min = Math.min(min, spheroidDistanceM(point, closestPointOnSegment(point, polygon[k], polygon[(k + 1) % polygon.length]).point));
    }, boundM => min < boundM);
    return min;
  }
  let min = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const foot = closestPointOnSegment(point, polygon[i], polygon[(i + 1) % polygon.length]).point;
    min = Math.min(min, spheroidDistanceM(point, foot));
  }
  return min;
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
 * Rings at or above this many vertices are queried through a spatial index (`ringIndexOf`).
 * Below it the plain loop is cheaper than building the grid.
 */
export const RING_INDEX_MIN_VERTICES = 512;

/** Lower bound of metres per degree of latitude (110 574 m at the equator), kept conservative. */
const MIN_M_PER_DEG_LAT = 110_000;

type RingIndex = {
  ring: GeoPoint[];
  n: number;
  minLat: number; minLng: number;
  cellLat: number; cellLng: number;
  rows: number; cols: number;
  /** segment k (vertex k → k+1 mod n) ids per cell, row-major */
  cells: Int32Array[];
  /** segment ids per latitude row, for the crossing count of `isPointInPolygon` */
  rowsOf: Int32Array[];
  /** metres of the smaller cell side, lower bound over the grid's latitudes */
  cellMinM: number;
  /** arc length from vertex 0 to vertex k, summed in ring order (`perimeterPositionM`) */
  walked: Float64Array;
  stamp: Uint32Array;
  query: number;
};

const ringIndexes = new WeakMap<GeoPoint[], RingIndex>();

/**
 * Uniform grid over the segments of a large ring, cached per ring array (the border is read
 * thousands of times per POI: street reach, fan walk, perimeter TPs, spacing). Every query below
 * evaluates the same segment formula as the plain loop and only skips segments that provably
 * cannot be the minimum, so the result is the same number. Lago di Como (9 943 vertices) and the
 * Golfo di Taranto (14 323) spent the 3 600 s timeout in O(vertices) per point (2026-10-21).
 */
function ringIndexOf(ring: GeoPoint[]): RingIndex {
  const hit = ringIndexes.get(ring);
  if (hit && hit.n === ring.length) return hit;
  const n = ring.length;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of ring) {
    if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng; if (p.lng > maxLng) maxLng = p.lng;
  }
  // Points queried sit a few km off the ring at most; 1° of slack keeps the cos bound safe.
  const cosMax = Math.cos((Math.min(89, Math.max(Math.abs(minLat), Math.abs(maxLat)) + 1) * Math.PI) / 180);
  const spanLatM = Math.max(1, (maxLat - minLat) * MIN_M_PER_DEG_LAT);
  const spanLngM = Math.max(1, (maxLng - minLng) * MIN_M_PER_DEG_LAT * cosMax);
  // About one segment per cell.
  const cellM = Math.max(10, Math.sqrt((spanLatM * spanLngM) / n));
  const cellLat = cellM / MIN_M_PER_DEG_LAT;
  const cellLng = cellM / (MIN_M_PER_DEG_LAT * cosMax);
  const rows = Math.max(1, Math.ceil((maxLat - minLat) / cellLat) + 1);
  const cols = Math.max(1, Math.ceil((maxLng - minLng) / cellLng) + 1);
  const lists: number[][] = Array.from({ length: rows * cols }, () => []);
  const rowLists: number[][] = Array.from({ length: rows }, () => []);
  const walked = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const a = ring[k], b = ring[(k + 1) % n];
    if (k < n - 1) walked[k + 1] = walked[k] + calculateDistance(a, b);
    const r0 = Math.floor((Math.min(a.lat, b.lat) - minLat) / cellLat);
    const r1 = Math.floor((Math.max(a.lat, b.lat) - minLat) / cellLat);
    const c0 = Math.floor((Math.min(a.lng, b.lng) - minLng) / cellLng);
    const c1 = Math.floor((Math.max(a.lng, b.lng) - minLng) / cellLng);
    for (let r = r0; r <= r1; r++) {
      rowLists[r].push(k);
      for (let c = c0; c <= c1; c++) lists[r * cols + c].push(k);
    }
  }
  const index: RingIndex = {
    ring, n, minLat, minLng, cellLat, cellLng, rows, cols,
    cells: lists.map(l => Int32Array.from(l)),
    rowsOf: rowLists.map(l => Int32Array.from(l)),
    // A gap of k whole cells is at least k·cellM in latitude, and in longitude at the highest
    // latitude of the grid; haversine never measures less than that (0.95 for the sine bound).
    cellMinM: cellM * 0.95,
    walked, stamp: new Uint32Array(n), query: 0,
  };
  ringIndexes.set(ring, index);
  return index;
}

/**
 * Visits the segments of an indexed ring (each once) in rings of cells around `p`, nearest first,
 * until `settled(boundM)`: every segment not visited yet lies at least `boundM` from `p`.
 */
function walkRingAround(p: GeoPoint, idx: RingIndex, visit: (k: number) => void, settled: (boundM: number) => boolean): void {
  const { rows, cols } = idx;
  if (++idx.query === 0xffffffff) { idx.stamp.fill(0); idx.query = 1; }
  const q = idx.query;
  const pr = Math.floor((p.lat - idx.minLat) / idx.cellLat);
  const pc = Math.floor((p.lng - idx.minLng) / idx.cellLng);
  // Cells outside the grid hold nothing: start at the first ring that touches it.
  const kStart = Math.max(pr < 0 ? -pr : pr >= rows ? pr - rows + 1 : 0, pc < 0 ? -pc : pc >= cols ? pc - cols + 1 : 0);
  const kEnd = kStart + Math.max(rows, cols);
  const cell = (r: number, c: number) => {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return;
    const list = idx.cells[r * cols + c];
    for (let i = 0; i < list.length; i++) {
      const k = list[i];
      if (idx.stamp[k] === q) continue;
      idx.stamp[k] = q;
      visit(k);
    }
  };
  for (let k = kStart; k <= kEnd; k++) {
    if (k === 0) cell(pr, pc);
    else {
      for (let c = pc - k; c <= pc + k; c++) { cell(pr - k, c); cell(pr + k, c); }
      for (let r = pr - k + 1; r <= pr + k - 1; r++) { cell(r, pc - k); cell(r, pc + k); }
    }
    // Every segment not seen yet lies beyond k whole cells.
    if (settled(k * idx.cellMinM)) return;
  }
}

/**
 * Nearest segment of an indexed ring to `p`: the smallest `calculateDistanceToLineSegment`, and
 * on a tie the lowest segment id — the one the plain loop keeps. `closed: false` leaves out the
 * closing segment (n−1 → 0), as `calculateDistanceToBoundary` and `perimeterPositionM` do.
 */
function nearestRingSegment(p: GeoPoint, idx: RingIndex, closed: boolean): { k: number; d: number } {
  const { ring, n } = idx;
  let best = Infinity, bestK = -1;
  walkRingAround(p, idx, k => {
    if (!closed && k === n - 1) return;
    const d = calculateDistanceToLineSegment(p, ring[k], ring[(k + 1) % n]);
    if (d < best || (d === best && k < bestK)) { best = d; bestK = k; }
  }, boundM => bestK >= 0 && best < boundM); // nothing unseen can beat, nor tie, `best`
  return { k: bestK, d: best };
}

/** Nearest vertex of an indexed ring to `p` (`calculateDistance`), the lowest index on a tie. */
function nearestRingVertexIndexed(p: GeoPoint, idx: RingIndex): { k: number; d: number } {
  const { ring } = idx;
  let best = Infinity, bestK = -1;
  // Vertex k is the start of segment k, so it is seen with it.
  walkRingAround(p, idx, k => {
    const d = calculateDistance(p, ring[k]);
    if (d < best || (d === best && k < bestK)) { best = d; bestK = k; }
  }, boundM => bestK >= 0 && best < boundM);
  return { k: bestK, d: best };
}

/**
 * Nearest vertex of `ring` to `p`: the first one at the smallest `calculateDistance`. Indexed on a
 * large ring (`RING_INDEX_MIN_VERTICES`).
 */
export function nearestRingVertex(p: GeoPoint, ring: GeoPoint[]): { point: GeoPoint; distance: number } {
  if (ring.length >= RING_INDEX_MIN_VERTICES) {
    const { k, d } = nearestRingVertexIndexed(p, ringIndexOf(ring));
    return { point: ring[k], distance: d };
  }
  let point = ring[0];
  let distance = calculateDistance(p, point);
  for (const v of ring) {
    const d = calculateDistance(p, v);
    if (d < distance) { distance = d; point = v; }
  }
  return { point, distance };
}

/**
 * Distance from `p` to the closest side of `ring`, closing side included, with no inside test (a
 * point inside measures to its nearest side, not 0). Indexed on a large ring.
 */
export function distanceToRingSidesM(p: GeoPoint, ring: GeoPoint[]): number {
  if (ring.length >= RING_INDEX_MIN_VERTICES) return nearestRingSegment(p, ringIndexOf(ring), true).d;
  let min = Infinity;
  for (let i = 0; i < ring.length; i++) min = Math.min(min, distanceToLineSegment(p, ring[i], ring[(i + 1) % ring.length]));
  return min;
}

/**
 * Segment ids of a large ring that can touch the straight line `a → b` (in lat/lng), each once;
 * null below `RING_INDEX_MIN_VERTICES` (the caller loops over every side). The line is sampled
 * every half cell and each sample's cell is read with its 8 neighbours, so every cell the line
 * crosses is read.
 */
export function ringSegmentsAlongLine(ring: GeoPoint[], a: GeoPoint, b: GeoPoint): number[] | null {
  if (ring.length < RING_INDEX_MIN_VERTICES) return null;
  const idx = ringIndexOf(ring);
  if (++idx.query === 0xffffffff) { idx.stamp.fill(0); idx.query = 1; }
  const q = idx.query;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b.lat - a.lat) / idx.cellLat, Math.abs(b.lng - a.lng) / idx.cellLng) * 2));
  const out: number[] = [];
  let lastR = NaN, lastC = NaN;
  for (let s = 0; s <= steps; s++) {
    const r0 = Math.floor((a.lat + ((b.lat - a.lat) * s) / steps - idx.minLat) / idx.cellLat);
    const c0 = Math.floor((a.lng + ((b.lng - a.lng) * s) / steps - idx.minLng) / idx.cellLng);
    if (r0 === lastR && c0 === lastC) continue;
    lastR = r0; lastC = c0;
    for (let r = r0 - 1; r <= r0 + 1; r++) {
      if (r < 0 || r >= idx.rows) continue;
      for (let c = c0 - 1; c <= c0 + 1; c++) {
        if (c < 0 || c >= idx.cols) continue;
        const list = idx.cells[r * idx.cols + c];
        for (let i = 0; i < list.length; i++) {
          const k = list[i];
          if (idx.stamp[k] === q) continue;
          idx.stamp[k] = q;
          out.push(k);
        }
      }
    }
  }
  return out;
}

/**
 * The vertices of `ring` that can be within `boundM` of the polyline, in ring order: those inside
 * the polyline's box grown by `boundM` (conservative in degrees).
 */
function ringVerticesNear(ring: GeoPoint[], polyline: GeoPoint[], boundM: number): GeoPoint[] {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of polyline) {
    if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng; if (p.lng > maxLng) maxLng = p.lng;
  }
  const growLat = (boundM + 1) / MIN_M_PER_DEG_LAT;
  const growLng = growLat / Math.cos((Math.min(89, Math.max(Math.abs(minLat), Math.abs(maxLat)) + growLat) * Math.PI) / 180);
  return ring.filter(t => t.lat >= minLat - growLat && t.lat <= maxLat + growLat
    && t.lng >= minLng - growLng && t.lng <= maxLng + growLng);
}

/** `isPointInPolygon` over an indexed ring: the same crossing test, on the segments of the point's row. */
function isPointInIndexedRing(point: GeoPoint, idx: RingIndex): boolean {
  const r = Math.floor((point.lat - idx.minLat) / idx.cellLat);
  if (r < 0 || r >= idx.rows) return false;
  const { ring, n } = idx;
  const x = point.lng;
  const y = point.lat;
  let inside = false;
  const list = idx.rowsOf[r];
  for (let s = 0; s < list.length; s++) {
    // Segment k is the plain loop's pair (j = k, i = k + 1 mod n).
    const k = list[s];
    const xi = ring[(k + 1) % n].lng, yi = ring[(k + 1) % n].lat;
    const xj = ring[k].lng, yj = ring[k].lat;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/**
 * Index of the ring segment closest to `p` and the arc length from vertex 0 to that segment's start,
 * for a ring large enough to be indexed; null below `RING_INDEX_MIN_VERTICES` (the caller loops).
 */
export function nearestBoundarySegment(p: GeoPoint, ring: GeoPoint[]): { k: number; walkedM: number } | null {
  if (ring.length < RING_INDEX_MIN_VERTICES) return null;
  const idx = ringIndexOf(ring);
  const { k } = nearestRingSegment(p, idx, false);
  return k < 0 ? null : { k, walkedM: idx.walked[k] };
}

/**
 * Verifica se um ponto está dentro de um polígono
 */
export function isPointInPolygon(
  point: { lat: number; lng: number },
  polygon: Array<{lat: number, lng: number}>
): boolean {
  if (polygon.length >= RING_INDEX_MIN_VERTICES) return isPointInIndexedRing(point, ringIndexOf(polygon));
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
  if (polygon.length >= RING_INDEX_MIN_VERTICES) return nearestRingSegment(point, ringIndexOf(polygon), true).d;

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
  let targets = boundaryCoords && boundaryCoords.length >= 3 ? boundaryCoords : [poiPin];
  if (boundaryCoords && boundaryCoords.length >= RING_INDEX_MIN_VERTICES && polyline.length) {
    // The nearest edge vertex to any street vertex bounds the answer: only the edge vertices that
    // can come closer than that are projected, in the same order (the first minimum still wins).
    let bound = Infinity;
    for (const p of polyline) bound = Math.min(bound, nearestRingVertex(p, boundaryCoords).distance);
    targets = ringVerticesNear(boundaryCoords, polyline, bound);
  }

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
  const seen = new Set(polyline.map(p => `${p.lat},${p.lng}`));
  let targets = hasBoundary ? boundaryCoords! : [poiPin];
  if (hasBoundary && boundaryCoords!.length >= RING_INDEX_MIN_VERTICES) {
    // Large border: an edge vertex farther from the street than its closest vertex already is
    // cannot hold the minimum (the closest pair of two polylines has a vertex in it), so only the
    // edge vertices near the street are projected. 10 000 projections per street x 5 000 streets
    // was most of Lago di Como's timeout (2026-10-21).
    let bound = Infinity;
    for (const p of polyline) bound = Math.min(bound, edgeDist(p));
    targets = ringVerticesNear(boundaryCoords!, polyline, bound);
  }
  for (const target of targets) {
    const proj = closestPointOnPolyline(target, polyline);
    if (!proj) continue;
    const key = `${proj.point.lat},${proj.point.lng}`;
    if (seen.has(key)) continue;
    seen.add(key);
    seeds.push(proj.point);
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
  if (boundaryCoordinates.length >= RING_INDEX_MIN_VERTICES) {
    return nearestRingSegment(point, ringIndexOf(boundaryCoordinates), false).d;
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
  if (boundaryCoordinates.length >= RING_INDEX_MIN_VERTICES) {
    // The plain loop below, through the ring index: the first nearest vertex, replaced by the
    // first nearest side only when that side is strictly closer.
    const idx = ringIndexOf(boundaryCoordinates);
    const { ring, n } = idx;
    let dV = Infinity, kV = -1, dE = Infinity, kE = -1;
    walkRingAround(triggerPoint, idx, k => {
      const v = calculateDistance(triggerPoint, ring[k]);
      if (v < dV || (v === dV && k < kV)) { dV = v; kV = k; }
      const e = calculateDistanceToLineSegment(triggerPoint, ring[k], ring[(k + 1) % n]);
      if (e < dE || (e === dE && k < kE)) { dE = e; kE = k; }
    }, boundM => kV >= 0 && (dV < boundM || (dE < boundM && dE < dV)));
    const point = dE < dV ? closestPointOnSegment(triggerPoint, ring[kE], ring[(kE + 1) % n]).point : ring[kV];
    return { lat: point.lat, lng: point.lng, distance: Math.min(dE, dV) };
  }
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

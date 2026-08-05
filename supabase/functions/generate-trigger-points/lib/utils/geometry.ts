// ========================================
// GEOMETRIC CALCULATIONS UTILITIES
// ========================================
// Extracted from monolithic index.ts for better maintainability

import { calculateDistance } from './calculations.ts';

/**
 * Interface for geographic point
 */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/**
 * Calculate area of a polygon using coordinates
 * @param coordinates Array of geographic points
 * @returns Area in square meters
 */
export function calculatePolygonArea(coordinates: GeoPoint[]): number {
  if (coordinates.length < 3) return 0;

  // Spherical excess. Must stay identical to lib/utils/geometry.ts -- Deno and Next cannot
  // share a module, so parity is enforced by tests/api/geometry-area.test.ts.
  //
  // The previous version summed (lng, lat) in radians as a flat Cartesian plane and
  // overestimated by exactly 1/cos(latitude): 33% in Barcelona, double near the polar circle.
  const R = 6371000; // Earth's radius in meters
  const rad = Math.PI / 180;
  const n = coordinates.length;
  let total = 0;

  for (let i = 0; i < n; i++) {
    const p1 = coordinates[i];
    const p2 = coordinates[(i + 1) % n];
    total += (p2.lng - p1.lng) * rad * (2 + Math.sin(p1.lat * rad) + Math.sin(p2.lat * rad));
  }

  return Math.abs((total * R * R) / 2);
}

/**
 * Calculate perimeter of a polygon
 * @param coordinates Array of geographic points
 * @returns Perimeter in meters
 */
export function calculatePolygonPerimeter(coordinates: GeoPoint[]): number {
  let perimeter = 0;
  for (let i = 0; i < coordinates.length; i++) {
    const j = (i + 1) % coordinates.length;
    perimeter += calculateDistance(
      coordinates[i].lat, coordinates[i].lng,
      coordinates[j].lat, coordinates[j].lng
    );
  }
  return perimeter;
}

/**
 * Check if a point is inside a polygon using ray casting algorithm
 * @param point Point to check
 * @param polygon Array of polygon vertices
 * @returns True if point is inside polygon
 */
export function isPointInPolygon(point: GeoPoint, polygon: GeoPoint[]): boolean {
  let inside = false;
  const n = polygon.length;
  
  for (let i = 0, j = n - 1; i < n; j = i++) {
    if (polygon[i].lat > point.lat !== polygon[j].lat > point.lat &&
        point.lng < (polygon[j].lng - polygon[i].lng) * (point.lat - polygon[i].lat) / 
                   (polygon[j].lat - polygon[i].lat) + polygon[i].lng) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Calculate minimum distance from point to polygon boundary
 * @param point Point to measure from
 * @param polygon Polygon vertices
 * @returns Minimum distance in meters
 */
export function calculateDistanceToPolygon(point: GeoPoint, polygon: GeoPoint[]): number {
  let minDistance = Infinity;
  
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const distance = distanceToLineSegment(point, polygon[i], polygon[j]);
    minDistance = Math.min(minDistance, distance);
  }
  
  return minDistance;
}

/**
 * Calculate distance from point to line segment
 * @param point Point to measure from
 * @param lineStart Start of line segment
 * @param lineEnd End of line segment
 * @returns Distance in meters
 */
export function distanceToLineSegment(point: GeoPoint, lineStart: GeoPoint, lineEnd: GeoPoint): number {
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
  
  return calculateDistance(point.lat, point.lng, xx, yy);
}

/**
 * Calculate center (centroid) of a polygon
 * @param coordinates Array of polygon vertices
 * @returns Center point
 */
export function calculatePolygonCenter(coordinates: GeoPoint[]): GeoPoint {
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
 * Check if a line segment intersects with a polygon
 * @param point1 First point of line segment
 * @param point2 Second point of line segment
 * @param polygon Polygon vertices
 * @returns True if line intersects polygon
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
 * @param p1 First point of first line
 * @param q1 Second point of first line
 * @param p2 First point of second line
 * @param q2 Second point of second line
 * @returns True if line segments intersect
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

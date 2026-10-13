/**
 * Geometry Utility Functions
 */

/**
 * Calculate polygon area using spherical geometry (Haver-formula based approximation)
 * Returns area in square meters
 * 
 * @param coordinates Array of {lat, lng} points
 * @returns area in square meters
 */
export function calculatePolygonArea(coordinates: Array<{ lat: number; lng: number }>): number {
  if (coordinates.length < 3) return 0

  // Spherical excess (the same formula as Google Maps' computeSignedArea), NOT the shoelace
  // sum over raw radians that lived here before.
  //
  // The old version treated (lng, lat) in radians as a flat Cartesian plane, so it never
  // narrowed the meridians as latitude grows: it overestimated by exactly 1/cos(latitude).
  // Measured against PostGIS in Barcelona (41.4 deg): 21,213 m2 stored for 15,933 m2 real on
  // the Sagrada Familia, and 27,448 for 20,621 on Placa de Catalunya -- both 1.331x, and
  // 1/cos(41.4 deg) = 1.3331. The error is nil at the equator, a third in Barcelona, and
  // doubles near the polar circle.
  const R = 6371000 // Earth's radius in meters
  const rad = Math.PI / 180
  const n = coordinates.length
  let total = 0

  for (let i = 0; i < n; i++) {
    const p1 = coordinates[i]
    const p2 = coordinates[(i + 1) % n]
    total += (p2.lng - p1.lng) * rad * (2 + Math.sin(p1.lat * rad) + Math.sin(p2.lat * rad))
  }

  return Math.max(1, Math.round(Math.abs((total * R * R) / 2)))
}

/**
 * Calculate polygon centroid (arithmetic mean)
 * 
 * @param coordinates Array of {lat, lng} points
 * @returns {lat, lng} center
 */
export function calculatePolygonCenter(coordinates: Array<{ lat: number; lng: number }>): { lat: number; lng: number } {
  if (coordinates.length === 0) return { lat: 0, lng: 0 }

  const total = coordinates.reduce(
    (acc, coord) => {
      acc.lat += coord.lat
      acc.lng += coord.lng
      return acc
    },
    { lat: 0, lng: 0 }
  )
  
  return {
    lat: total.lat / coordinates.length,
    lng: total.lng / coordinates.length
  }
}

/** GeoJSON geometry, coordinates in [lon, lat] order. */
export type GeoJsonGeometry = { type: string; coordinates: any }

const ringArea = (r: number[][]) => {
  let a = 0
  for (let i = 1; i < r.length; i++) a += r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1]
  return a / 2
}

const approxKm = (a: number[], b: number[]) =>
  Math.hypot((a[0] - b[0]) * 111.32 * Math.cos((a[1] * Math.PI) / 180), (a[1] - b[1]) * 110.54)

/**
 * A point guaranteed inside the (largest) polygon, in the spirit of PostGIS ST_PointOnSurface:
 * a horizontal line through the bbox mid-latitude, midpoint of the widest interior interval
 * (holes respected by even-odd crossing). calculatePolygonCenter averages vertices and lands
 * outside an L, a C or a serra; the vertex-average is not a pin.
 * Returns [lon, lat], or null for non-polygons.
 */
export function pointOnSurface(g: GeoJsonGeometry): [number, number] | null {
  const ps: number[][][][] = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
  if (!ps.length) return null
  const poly = ps.reduce((a, b) => (Math.abs(ringArea(b[0])) > Math.abs(ringArea(a[0])) ? b : a))
  const ys = poly[0].map((c) => c[1])
  const y0 = Math.min(...ys), y1 = Math.max(...ys)
  let best: [number, number] | null = null, bestW = -1
  for (const f of [0.5, 0.45, 0.55, 0.4, 0.6, 0.3, 0.7]) {
    const y = y0 + (y1 - y0) * f
    const xs: number[] = []
    for (const ring of poly) {
      for (let i = 1; i < ring.length; i++) {
        const [xa, ya] = ring[i - 1], [xb, yb] = ring[i]
        if ((ya > y) !== (yb > y)) xs.push(xa + ((y - ya) * (xb - xa)) / (yb - ya))
      }
    }
    xs.sort((a, b) => a - b)
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const w = xs[i + 1] - xs[i]
      if (w > bestW) { bestW = w; best = [(xs[i] + xs[i + 1]) / 2, y] }
    }
    if (best) break
  }
  return best
}

/** Midpoint by length of the longest part, like ST_LineInterpolatePoint(longest, 0.5). [lon, lat]. */
export function lineMidpoint(g: GeoJsonGeometry): [number, number] | null {
  const parts: number[][][] = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []
  if (!parts.length) return null
  const len = (p: number[][]) => p.slice(1).reduce((s, c, i) => s + approxKm(p[i], c), 0)
  const p = parts.reduce((a, b) => (len(b) > len(a) ? b : a))
  let half = len(p) / 2
  for (let i = 1; i < p.length; i++) {
    const d = approxKm(p[i - 1], p[i])
    if (d >= half) {
      const t = d ? half / d : 0
      return [p[i - 1][0] + t * (p[i][0] - p[i - 1][0]), p[i - 1][1] + t * (p[i][1] - p[i - 1][1])]
    }
    half -= d
  }
  return [p[p.length - 1][0], p[p.length - 1][1]]
}

/**
 * The pin of an OSM object: the point itself, a point inside an areal, the middle of a linear.
 * Returns [lon, lat], or null when the geometry carries none of those.
 */
export function representativePoint(g: GeoJsonGeometry | null | undefined): [number, number] | null {
  if (!g || !g.coordinates) return null
  if (g.type === 'Point') return [g.coordinates[0], g.coordinates[1]]
  return pointOnSurface(g) || lineMidpoint(g)
}

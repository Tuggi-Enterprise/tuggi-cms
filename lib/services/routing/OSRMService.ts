/**
 * OSRM Service - Open Source Routing Machine Integration
 * 
 * Provides routing and map matching capabilities using OSRM.
 * Used for the Custom Routes feature to generate road-snapped paths.
 * 
 * Follows project patterns: Static class methods, clear error handling.
 * 
 * @see https://router.project-osrm.org/ (Public Demo - Development Only)
 * @see http://project-osrm.org/docs/v5.24.0/api/ (API Documentation)
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteResult {
  /** Decoded coordinates of the route path */
  coordinates: LatLng[];
  /** Distance in meters */
  distance: number;
  /** Duration in seconds */
  duration: number;
  /** Encoded polyline string (Google Maps compatible) */
  geometryEncoded: string;
}

// Use environment variable to allow switching to self-hosted OSRM in production
const OSRM_BASE_URL = process.env.OSRM_API_URL || 'https://router.project-osrm.org';

/**
 * Service for interacting with OSRM (Open Source Routing Machine).
 * 
 * Provides two main operations:
 * 1. getRoute(): Point-to-point routing (A → B → C)
 * 2. matchRoute(): Snap a drawn/GPS trace to roads ("Map Matching")
 */
export class OSRMService {
  
  /**
   * Generate a driving route between waypoints.
   * Use this for "Point-to-Point" mode where user selects Start/End.
   * 
   * @param waypoints Array of at least 2 points
   * @returns Route geometry and metadata
   */
  static async getRoute(waypoints: LatLng[]): Promise<RouteResult> {
    if (waypoints.length < 2) {
      throw new Error('OSRMService.getRoute: At least 2 waypoints are required');
    }

    // OSRM expects coordinates as "lng,lat" (note: reversed from our LatLng interface)
    const coordinatesString = waypoints
      .map(p => `${p.lng},${p.lat}`)
      .join(';');

    // Request full geometry in encoded polyline format
    const url = `${OSRM_BASE_URL}/route/v1/driving/${coordinatesString}?overview=full&geometries=polyline`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`OSRM API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        throw new Error(`OSRM could not find a route: ${data.code || 'Unknown error'}`);
      }

      const route = data.routes[0];

      return {
        coordinates: this.decodePolyline(route.geometry),
        distance: route.distance,
        duration: route.duration,
        geometryEncoded: route.geometry
      };

    } catch (error) {
      console.error('OSRMService.getRoute Error:', error);
      throw error;
    }
  }

  /**
   * Snap a drawn GPS trace to the road network ("Map Matching").
   * Use this for "Draw Mode" where user sketches a rough path.
   * 
   * OSRM Match API tolerates GPS noise and connects the dots along roads.
   * 
   * @param trace Array of at least 2 points representing the drawn path
   * @returns Snapped route geometry and metadata
   */
  static async matchRoute(trace: LatLng[]): Promise<RouteResult> {
    if (trace.length < 2) {
      throw new Error('OSRMService.matchRoute: At least 2 points are required');
    }

    // OSRM expects "lng,lat"
    const coordinatesString = trace
      .map(p => `${p.lng},${p.lat}`)
      .join(';');

    // tidy=true helps with GPS noise (cleaning up wiggly lines)
    const url = `${OSRM_BASE_URL}/match/v1/driving/${coordinatesString}?overview=full&geometries=polyline&tidy=true`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`OSRM Match API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (data.code !== 'Ok' || !data.matchings || data.matchings.length === 0) {
        // Match can fail if the trace is too far from any road
        throw new Error(`OSRM could not match the trace to roads: ${data.code || 'Unknown error'}`);
      }

      // Use the first (best) matching
      const match = data.matchings[0];

      return {
        coordinates: this.decodePolyline(match.geometry),
        distance: match.distance,
        duration: match.duration,
        geometryEncoded: match.geometry
      };

    } catch (error) {
      console.error('OSRMService.matchRoute Error:', error);
      throw error;
    }
  }

  /**
   * Decode an encoded polyline string to an array of coordinates.
   * Uses the Google Maps Polyline Algorithm (precision 5 for OSRM).
   * 
   * @see https://developers.google.com/maps/documentation/utilities/polylinealgorithm
   */
  private static decodePolyline(encoded: string, precision = 5): LatLng[] {
    const coordinates: LatLng[] = [];
    let index = 0;
    let lat = 0;
    let lng = 0;
    const factor = Math.pow(10, precision);

    while (index < encoded.length) {
      // Decode latitude
      let shift = 0;
      let result = 0;
      let byte: number;

      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);

      const deltaLat = (result & 1) ? ~(result >> 1) : (result >> 1);
      lat += deltaLat;

      // Decode longitude
      shift = 0;
      result = 0;

      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);

      const deltaLng = (result & 1) ? ~(result >> 1) : (result >> 1);
      lng += deltaLng;

      coordinates.push({
        lat: lat / factor,
        lng: lng / factor
      });
    }

    return coordinates;
  }

  /**
   * Convert coordinates array to WKT LINESTRING format for PostGIS.
   * 
   * @param coordinates Array of LatLng points
   * @returns WKT string like "SRID=4326;LINESTRING(lng lat, lng lat, ...)"
   */
  static toWKT(coordinates: LatLng[]): string {
    if (coordinates.length < 2) {
      throw new Error('At least 2 coordinates required for a LineString');
    }

    const points = coordinates
      .map(c => `${c.lng} ${c.lat}`)
      .join(', ');

    return `SRID=4326;LINESTRING(${points})`;
  }
}

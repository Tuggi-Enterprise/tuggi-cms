/**
 * GET|POST /api/attraction-groups/nearby — POIs near a reference POI or inside a polygon.
 *
 * Gated by CARD-CMS-01. Roles are the ones that can sign into the CMS at all
 * (app/[locale]/login/page.tsx); who may curate groups specifically is CARD-CMS-25.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-middleware';

// Helper to calculate distance in meters between two lat/lng points
function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Ray-casting point-in-polygon test. polygon: [{ lat, lng }, ...] (lat=y, lng=x).
function pointInPolygon(lat: number, lng: number, polygon: Array<{ lat: number; lng: number }>) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;
    const intersect = (yi > lat) !== (yj > lat) &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Hard cap on candidate rows pulled for the in-memory refine step.
const NEARBY_CANDIDATE_LIMIT = 50000;
// Hard cap on POIs returned (group-selection UI).
const NEARBY_RESULT_LIMIT = 500;

export const GET = withAuth({ roles: ['admin', 'client', 'editor'] }, async function (req: NextRequest, _ctx, auth) {
  const supabase = auth.supabase;
  const { searchParams } = new URL(req.url);
  const poiId = searchParams.get('poiId');
  const radius = Number(searchParams.get('radius') || 50);

  if (!poiId) {
    return NextResponse.json({ error: 'Missing poiId' }, { status: 400 });
  }

  // Get coordinates of the reference POI
  const { data: refCoord, error: refError } = await supabase
    .schema('core')
    .from('attraction_coordinate')
    .select('latitude, longitude')
    .eq('attraction_id', poiId)
    .single();

  if (refError || !refCoord) {
    return NextResponse.json({ error: 'Reference POI not found' }, { status: 404 });
  }

  // Get all POIs with coordinates
  const { data: allCoords, error: allError } = await supabase
    .schema('core')
    .from('attraction_coordinate')
    .select('attraction_id, latitude, longitude');

  if (allError) {
    return NextResponse.json({ error: 'Failed to fetch POIs' }, { status: 500 });
  }

  // Filter POIs within radius (excluding the reference POI)
  const nearby = allCoords.filter((coord: any) => {
    if (coord.attraction_id === poiId) return false;
    const dist = haversine(refCoord.latitude, refCoord.longitude, coord.latitude, coord.longitude);
    return dist <= radius;
  });

  // Optionally, fetch POI details for these IDs
  const ids = nearby.map((c: any) => c.attraction_id);
  let details: any[] = [];
  if (ids.length > 0) {
    const { data: pois } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, google_types, category')
      .in('id', ids);
    details = pois || [];
  }

  return NextResponse.json({ nearby: details });
})

export const POST = withAuth({ roles: ['admin', 'client', 'editor'] }, async function (req: NextRequest, _ctx, auth) {
  const supabase = auth.supabase;
  const body = await req.json();
  const { polygon, poiId, radius = 50 } = body;

  console.log('🔍 API: Request body:', { polygon: polygon?.length, poiId, radius });

  if (polygon && Array.isArray(polygon) && polygon.length >= 3) {
    console.log('🔍 API: Using polygon search (bbox prefilter + point-in-polygon)');

    // Bounding box of the search polygon. We prefilter candidates by a cheap
    // lat/lng range comparison (works for any polygon size and does NOT depend
    // on the PostGIS spatial index that pois_in_polygon relied on — that index
    // was dropped, making ST_Contains over 640k geometries time out / 57014).
    const lats = polygon.map((p: any) => p.lat);
    const lngs = polygon.map((p: any) => p.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);

    const { data: candidates, error } = await supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('attraction_id, latitude, longitude')
      .gte('latitude', minLat).lte('latitude', maxLat)
      .gte('longitude', minLng).lte('longitude', maxLng)
      .limit(NEARBY_CANDIDATE_LIMIT);

    console.log('🔍 API: bbox candidates:', { count: candidates?.length, error });

    if (error) {
      console.error('❌ API: Supabase bbox query error:', error);
      return NextResponse.json({ error: 'Failed to fetch POIs in polygon', details: error }, { status: 500 });
    }

    // Refine with exact point-in-polygon, excluding the reference POI.
    const ids = (candidates || [])
      .filter((c: any) => c.attraction_id !== poiId && pointInPolygon(c.latitude, c.longitude, polygon))
      .map((c: any) => c.attraction_id)
      .slice(0, NEARBY_RESULT_LIMIT);
    console.log('🔍 API: POIs inside polygon:', ids.length);

    let details: any[] = [];
    if (ids.length > 0) {
      const { data: pois, error: poisError } = await supabase
        .schema('core')
        .from('attractions')
        .select(`
          id, 
          name, 
          google_types, 
          category,
          coordinates:attraction_coordinate(latitude, longitude)
        `)
        .in('id', ids);
        
      console.log('🔍 API: POI details query result:', { pois: pois?.length, poisError });
      
      if (poisError) {
        console.error('❌ API: Error fetching POI details:', poisError);
      }
      // Transform the data to match expected format
      details = pois?.map((poi: any) => ({
        ...poi,
        coordinates: poi.coordinates?.[0] || null
      })) || [];
    }
    
    console.log('✅ API: Returning nearby POIs:', details.length);
    return NextResponse.json({ nearby: details });
  } else {
    console.log('🔍 API: Using radius search (fallback)');
    
    // Fallback to radius logic (same as GET)
    if (!poiId) {
      console.log('❌ API: Missing poiId for radius search');
      return NextResponse.json({ error: 'Missing poiId' }, { status: 400 });
    }
    
    // Get coordinates of the reference POI
    const { data: refCoord, error: refError } = await supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('latitude, longitude')
      .eq('attraction_id', poiId)
      .single();
      
    console.log('🔍 API: Reference coordinate query:', { refCoord, refError });
    
    if (refError || !refCoord) {
      console.log('❌ API: Reference POI not found');
      return NextResponse.json({ error: 'Reference POI not found' }, { status: 404 });
    }
    
    // Bounding box around the reference point (radius in meters -> degrees).
    // Avoids scanning/returning all 640k coordinate rows.
    const dLat = radius / 111320;
    const dLng = radius / (111320 * Math.cos((refCoord.latitude * Math.PI) / 180) || 1);
    const { data: allCoords, error: allError } = await supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('attraction_id, latitude, longitude')
      .gte('latitude', refCoord.latitude - dLat).lte('latitude', refCoord.latitude + dLat)
      .gte('longitude', refCoord.longitude - dLng).lte('longitude', refCoord.longitude + dLng)
      .limit(NEARBY_CANDIDATE_LIMIT);

    console.log('🔍 API: bbox coordinates query:', { allCoords: allCoords?.length, allError });

    if (allError) {
      console.log('❌ API: Failed to fetch POIs');
      return NextResponse.json({ error: 'Failed to fetch POIs' }, { status: 500 });
    }

    // Filter POIs within radius (excluding the reference POI)
    const nearby = (allCoords || []).filter((coord: any) => {
      if (coord.attraction_id === poiId) return false;
      const dist = haversine(refCoord.latitude, refCoord.longitude, coord.latitude, coord.longitude);
      return dist <= radius;
    });
    
    console.log('🔍 API: Filtered nearby POIs:', nearby.length);
    
    // Optionally, fetch POI details for these IDs
    const ids = nearby.map((c: any) => c.attraction_id);
    let details: any[] = [];
    if (ids.length > 0) {
      const { data: pois } = await supabase
        .schema('core')
        .from('attractions')
        .select(`
          id, 
          name, 
          google_types, 
          category,
          coordinates:attraction_coordinate(latitude, longitude)
        `)
        .in('id', ids);
        
      console.log('🔍 API: POI details for radius search:', { pois: pois?.length });
      
      // Transform the data to match expected format
      details = pois?.map((poi: any) => ({
        ...poi,
        coordinates: poi.coordinates?.[0] || null
      })) || [];
    }
    
    console.log('✅ API: Returning nearby POIs (radius):', details.length);
    return NextResponse.json({ nearby: details });
  }
})
import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { withAuth, withRateLimit } from '@/lib/auth-middleware';

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

export const GET = withAuth(withRateLimit(100, 60000)(async function(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
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
      .from('attractions')
      .select('id, name, google_types, category')
      .in('id', ids);
    details = pois || [];
  }

  return NextResponse.json({ nearby: details });
}))

export const POST = withAuth(withRateLimit(50, 60000)(async function(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const body = await req.json();
  const { polygon, poiId, radius = 50 } = body;

  if (polygon && Array.isArray(polygon) && polygon.length >= 3) {
    // Use polygon to find POIs inside
    // Build WKT polygon string
    const wkt = `POLYGON((` + polygon.map((p: any) => `${p.lng} ${p.lat}`).join(', ') + `, ${polygon[0].lng} ${polygon[0].lat}))`;
    console.log('WKT sent to Supabase:', wkt);
    
    // Use the polygon to find POIs inside
    
    const { data: coords, error } = await supabase
      .schema('core')
      .rpc('pois_in_polygon', { wkt_polygon: wkt });
    if (error) {
      console.error('Supabase RPC error:', error);
      return NextResponse.json({ error: 'Failed to fetch POIs in polygon', details: error }, { status: 500 });
    }
    // Fetch POI details for these IDs
    const ids = coords.map((c: any) => c.attraction_id);
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
      if (poisError) {
        console.error('Error fetching POI details:', poisError);
      }
      // Transform the data to match expected format
      details = pois?.map(poi => ({
        ...poi,
        coordinates: poi.coordinates?.[0] || null
      })) || [];
    }
    return NextResponse.json({ nearby: details });
  } else {
    // Fallback to radius logic (same as GET)
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
        .select(`
          id, 
          name, 
          google_types, 
          category,
          coordinates:attraction_coordinate(latitude, longitude)
        `)
        .in('id', ids);
      // Transform the data to match expected format
      details = pois?.map(poi => ({
        ...poi,
        coordinates: poi.coordinates?.[0] || null
      })) || [];
    }
    return NextResponse.json({ nearby: details });
  }
}))
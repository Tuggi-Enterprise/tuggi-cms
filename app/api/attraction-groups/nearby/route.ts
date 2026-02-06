import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
// import { withAuth, withRateLimit } from '@/lib/auth-middleware';

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

export const GET = async function(req: NextRequest) {
  console.log('🔍 API: /api/attraction-groups/nearby GET called (no auth)');
  
  const cookieStore = await cookies();
  const supabase = createRouteHandlerClient({ cookies: () => cookieStore as any });
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
}

export const POST = async function(req: NextRequest) {
  console.log('🔍 API: /api/attraction-groups/nearby POST called (no auth)');
  
  const cookieStore = await cookies();
  const supabase = createRouteHandlerClient({ cookies: () => cookieStore as any });
  const body = await req.json();
  const { polygon, poiId, radius = 50 } = body;

  console.log('🔍 API: Request body:', { polygon: polygon?.length, poiId, radius });

  if (polygon && Array.isArray(polygon) && polygon.length >= 3) {
    console.log('🔍 API: Using polygon search');
    
    // Use polygon to find POIs inside
    // Build WKT polygon string
    const wkt = `POLYGON((` + polygon.map((p: any) => `${p.lng} ${p.lat}`).join(', ') + `, ${polygon[0].lng} ${polygon[0].lat}))`;
    console.log('🔍 API: WKT sent to Supabase:', wkt);
    
    // Use the polygon to find POIs inside
    
    const { data: coords, error } = await supabase
      .schema('core')
      .rpc('pois_in_polygon', { wkt_polygon: wkt });
      
    console.log('🔍 API: RPC result:', { coords: coords?.length, error });
    
    if (error) {
      console.error('❌ API: Supabase RPC error:', error);
      return NextResponse.json({ error: 'Failed to fetch POIs in polygon', details: error }, { status: 500 });
    }
    
    // Fetch POI details for these IDs
    const ids = coords.map((c: any) => c.attraction_id);
    console.log('🔍 API: Found POI IDs:', ids);
    
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
      details = pois?.map(poi => ({
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
    
    // Get all POIs with coordinates
    const { data: allCoords, error: allError } = await supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('attraction_id, latitude, longitude');
      
    console.log('🔍 API: All coordinates query:', { allCoords: allCoords?.length, allError });
    
    if (allError) {
      console.log('❌ API: Failed to fetch POIs');
      return NextResponse.json({ error: 'Failed to fetch POIs' }, { status: 500 });
    }
    
    // Filter POIs within radius (excluding the reference POI)
    const nearby = allCoords.filter((coord: any) => {
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
      details = pois?.map(poi => ({
        ...poi,
        coordinates: poi.coordinates?.[0] || null
      })) || [];
    }
    
    console.log('✅ API: Returning nearby POIs (radius):', details.length);
    return NextResponse.json({ nearby: details });
  }
}
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getPublishableKey } from '../_shared/supabase-client.ts';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * POI Capture Edge Function
 * 
 * Fetches POIs from OpenStreetMap using Overpass API, 
 * filters them with the "Elite" logic, and stores in homolog schema.
 * 
 * SYNCHRONIZED WITH: scripts/test-overpass.ts
 * Geometry Support: geom + center with merging logic
 */

const OVERPASS_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter"
];

const UUID_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

interface RequestBody {
  lat: number;
  lon: number;
  radius?: number;
}

import { shouldFilterPOI } from "../_shared/poi-filter.ts";

async function generateUUID(osmId: number, osmType: string, name: string, lat: number, lon: number): Promise<string> {
  const dataString = `osm:${osmId}:${osmType}:${name || ''}:${lat}:${lon}`;
  const msgUint8 = new TextEncoder().encode(dataString);
  const namespaceUint8 = new Uint8Array(UUID_NAMESPACE.replace(/-/g, "").match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const combined = new Uint8Array(namespaceUint8.length + msgUint8.length);
  combined.set(namespaceUint8);
  combined.set(msgUint8, namespaceUint8.length);
  const hashBuffer = await crypto.subtle.digest("SHA-1", combined);
  const hashArray = new Uint8Array(hashBuffer);
  hashArray[6] = (hashArray[6] & 0x0f) | 0x50;
  hashArray[8] = (hashArray[8] & 0x3f) | 0x80;
  const hex = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing or invalid Authorization header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = getPublishableKey();
    if (!supabaseUrl || !supabaseAnonKey) {
      return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const body = await req.json() as RequestBody;
    const { lat, lon, radius = 1000 } = body;
    const safeRadius = Math.min(Math.max(100, radius), 10000);

    const query = `
      [out:json][timeout:90];
      (
        node["tourism"](around:${safeRadius},${lat},${lon});
        node["historic"](around:${safeRadius},${lat},${lon});
        node["natural"](around:${safeRadius},${lat},${lon});
        node["leisure"](around:${safeRadius},${lat},${lon});
        node["amenity"~"theatre|place_of_worship|marketplace|townhall|courthouse|library"](around:${safeRadius},${lat},${lon});
        node["man_made"~"lighthouse|windmill|tower|water_tower"](around:${safeRadius},${lat},${lon});
        node["aeroway"="aerodrome"](around:${safeRadius},${lat},${lon});
        node["aerialway"](around:${safeRadius},${lat},${lon});

        way["tourism"](around:${safeRadius},${lat},${lon});
        way["historic"](around:${safeRadius},${lat},${lon});
        way["natural"](around:${safeRadius},${lat},${lon});
        way["leisure"](around:${safeRadius},${lat},${lon});
        way["amenity"~"theatre|place_of_worship|marketplace|townhall|courthouse|library"](around:${safeRadius},${lat},${lon});
        way["man_made"~"lighthouse|windmill|tower|water_tower"](around:${safeRadius},${lat},${lon});
        way["aeroway"="aerodrome"](around:${safeRadius},${lat},${lon});
        way["aerialway"](around:${safeRadius},${lat},${lon});

        relation["tourism"](around:${safeRadius},${lat},${lon});
        relation["historic"](around:${safeRadius},${lat},${lon});
        relation["natural"](around:${safeRadius},${lat},${lon});
        relation["leisure"](around:${safeRadius},${lat},${lon});
        relation["amenity"~"theatre|place_of_worship|marketplace|townhall|courthouse|library"](around:${safeRadius},${lat},${lon});
        relation["man_made"~"lighthouse|windmill|tower|water_tower"](around:${safeRadius},${lat},${lon});
        relation["aeroway"="aerodrome"](around:${safeRadius},${lat},${lon});
        relation["aerialway"](around:${safeRadius},${lat},${lon});
      );
      out body center;
      out body geom;
    `;

    let osmData;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "data=" + encodeURIComponent(query)
        });
        if (response.ok) {
          osmData = await response.json();
          break;
        }
      } catch (e) {
        console.warn(`[Capture-POIs] Mirror failed: ${endpoint}`, e);
      }
    }

    if (!osmData || !osmData.elements) throw new Error("Overpass query failed");

    // MERGE GEOMETRY AND CENTER
    const mergedMap = new Map();
    for (const el of osmData.elements) {
      const existing = mergedMap.get(el.id);
      if (existing) {
        mergedMap.set(el.id, { ...existing, ...el });
      } else {
        mergedMap.set(el.id, el);
      }
    }
    const mergedElements = Array.from(mergedMap.values());

    const kept = [];
    let filteredCount = 0;
    let invalidCount = 0;

    for (const el of mergedElements) {
      const poiLat = el.lat || el.center?.lat;
      const poiLon = el.lon || el.center?.lon;
      
      if (!poiLat || !el.tags?.name) {
        invalidCount++;
        continue;
      }

      const filterResult = shouldFilterPOI(el);
      if (filterResult.remove) {
        filteredCount++;
        continue;
      }

      // Flatten geometry first (keep array of {lat, lon})
      let rawPoints: any[] = [];
      if (el.geometry) {
        rawPoints = el.geometry;
      } else if (el.members) {
        rawPoints = el.members.flatMap((m: any) => m.geometry || []).filter((p: any) => p !== null);
      }
      
      // Convert to WKT (Well-Known Text) for PostGIS
      // This is more robust than GeoJSON for Supabase generic inserts
      let boundaryGeom = null;
      if (rawPoints.length > 0) {
        // WKT requires LONGITUDE LATITUDE order
        
        // Check if closed (first point equals last point)
        const isClosed = rawPoints.length >= 4 && 
          rawPoints[0].lat === rawPoints[rawPoints.length-1].lat && 
          rawPoints[0].lon === rawPoints[rawPoints.length-1].lon;

        if (isClosed) {
          // POLYGON((x1 y1, x2 y2, ...))
          const coords = rawPoints.map(p => `${p.lon} ${p.lat}`).join(",");
          boundaryGeom = `POLYGON((${coords}))`;
        } else if (rawPoints.length >= 2) {
          // LINESTRING(x1 y1, x2 y2, ...)
          const coords = rawPoints.map(p => `${p.lon} ${p.lat}`).join(",");
          boundaryGeom = `LINESTRING(${coords})`;
        } else if (rawPoints.length === 1) {
          // POINT(x y)
          boundaryGeom = `POINT(${rawPoints[0].lon} ${rawPoints[0].lat})`;
        }
      } else if (el.type === 'node') {
        boundaryGeom = `POINT(${poiLon} ${poiLat})`;
      }

      const uuid = await generateUUID(el.id, el.type, el.tags.name, poiLat, poiLon);
      
      const poiData = {
        uuid_id: uuid,
        name: el.tags.name,
        osm_id: el.id,
        osm_type: el.type,
        lat: poiLat,
        lon: poiLon,
        osm_properties: el.tags,
        category: el.tags.tourism || el.tags.historic || el.tags.leisure || el.tags.natural || el.tags.amenity || el.tags.aerialway,
        city: el.tags['addr:city'],
        state: el.tags['addr:state'],
        country: el.tags['addr:country'],
        postal_code: el.tags['addr:postcode'],
        street_name: el.tags['addr:street'],
        house_number: el.tags['addr:housenumber'],
        neighborhood: el.tags['addr:suburb'] || el.tags['addr:neighbourhood'],
        website: el.tags.website || el.tags['contact:website'],
        contact_phone: el.tags.phone || el.tags['contact:phone'],
        contact_email: el.tags.email || el.tags['contact:email'],
        wikidata: el.tags.wikidata,
        wikipedia: el.tags.wikipedia,
        brand: el.tags.brand,
        brand_wikidata: el.tags['brand:wikidata'],
        brand_wikipedia: el.tags['brand:wikipedia'],
        operator_name: el.tags.operator,
        amenity: el.tags.amenity,
        building: el.tags.building,
        leisure: el.tags.leisure,
        man_made: el.tags.man_made,
        wheelchair_accessible: el.tags.wheelchair === 'yes' ? true : (el.tags.wheelchair === 'no' ? false : null),
        internet_access: el.tags.internet_access,
        rooms: el.tags.rooms ? parseInt(el.tags.rooms) : null,
        smoking: el.tags.smoking,
        opening_hours: el.tags.opening_hours,
        historic_period: el.tags.historic_period,
        heritage_status: el.tags.heritage || el.tags.listed_status || el.tags['heritage:operator'],
        unesco_status: el.tags.unesco,
        start_date: el.tags.start_date,
        fee: el.tags.fee,
        alt_name: el.tags.alt_name,
        is_historic: !!el.tags.historic,
        is_touristic: !!el.tags.tourism,
        // Novos campos técnicos
        elevation: el.tags.ele ? parseFloat(el.tags.ele) : null,
        building_levels: el.tags['building:levels'] ? parseInt(el.tags['building:levels']) : null,
        denomination: el.tags.denomination,
        source_type: 'osm',
        processing_status: 'pending'
      };

      const coordData = {
        id: crypto.randomUUID(),
        poi_uuid_id: uuid,
        latitude: poiLat,
        longitude: poiLon,
        show_in_map: true,
        boundary_geometry: boundaryGeom
      };

      const { error: poiError } = await supabase.schema("homolog").from("pois").upsert(poiData, { onConflict: 'uuid_id' });
      if (poiError) {
        console.error(`[Capture-POIs] POI upsert error for ${el.tags.name}:`, poiError);
        continue;
      }

      const { error: coordError } = await supabase.schema("homolog").from("coordinates").upsert(coordData, { onConflict: 'poi_uuid_id' });
      if (coordError) {
        console.error(`[Capture-POIs] Coordinates upsert error for ${el.tags.name}:`, JSON.stringify(coordError));
        console.error(`[Capture-POIs] Geometry type: ${typeof boundaryGeom}, length: ${rawPoints?.length}`);
      } else {
        console.log(`[Capture-POIs] Saved: ${el.tags.name} with ${rawPoints?.length || 0} geometry points`);
      }
      kept.push({ id: el.id, name: el.tags.name });
    }

    return new Response(JSON.stringify({
      success: true,
      summary: { total_found: mergedElements.length, kept: kept.length, filtered: filteredCount, invalid: invalidCount },
      data: kept
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

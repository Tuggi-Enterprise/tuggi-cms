import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
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

const FILTER_CONFIG = {
  // Categorias que barramos totalmente a menos que sejam famosos (Wiki/Wikidata)
  TAG_BLOCKLIST: [
    'bench', 'waste_basket', 'trash_can', 'telephone', 'bicycle_parking', 
    'parking', 'path', 'track', 'fence', 'wall', 'hedge', 'pole', 'post',
    'surveillance', 'vending_machine', 'atm', 'recycling', 'toilets', 
    'outdoor_seating', 'waste_disposal', 'picnic_table', 'steps',
    'resort', 'beach_resort',
    'supermarket', 'convenience', 'bakery', 'laundry', 'dry_cleaning',
    'hairdresser', 'beauty', 'dentist', 'veterinary', 'car_repair', 'car_wash',
    'fuel', 'bank', 'pharmacy', 'atm', 'fast_food', 'food_court',
    'restaurant', 'cafe', 'pub', 'bar', 'ice_cream', 'nightclub', 'dance', 'studio',
    'fitness_centre', 'sports_centre', 'swimming_pool', 'camp_site', 'love_hotel',
    'car_rental', 'bicycle_rental', 'fishing', 'public_bath', 'cinema', 'theatre',
    'information', 'chalet', 'events_venue', 'theme_park', 'picnic_site', 'horse_riding',
    'school', 'university', 'college', 'kindergarten', 'childcare', 'language_school', 'driving_school',
    'hospital', 'clinic', 'doctors', 'social_facility', 'community_centre', 'social_centre',
    'police', 'fire_station', 'post_office', 'government', 'office', 'courthouse', 'townhall_legacy', 
    'public_building', 'industrial', 'works', 'wastewater_plant', 'power_plant', 'pumping_station', 
    'prison', 'jail', 'bus_station', 'taxi', 'ferry_terminal', 'airport', 'station', 'stop_position', 
    'bus_stop', 'survey_point', 'funeral_hall', 'dojo', 'slipway', 'pipeline', 'monitoring_station',
    'common', 'vehicle_inspection', 'boundary', 'storage_tank', 'bridge',
    'drinking_water', 'bureau_de_change', 'bbq', 'bandstand',
    'wayside_cross', 'wayside_shrine', 'flagpole', 'service', 'military', 'quarry',
    'studio', 'tunnel', 'mast', 'boundary_stone', 'crematorium', 'reservoir_covered',
    'reservoir', 'water_tower', 'bridge',
    'brothel', 'nursing_home', 'animal_breeding', 'internet_cafe', 'recreation_ground', 'shelter',
    'music_school', 'charity', 'social_centre', 'dormitory', 'nursery', 'prep_school', 'animal_shelter',
    'caravan_site', 'bowling_alley', 'charging_station', 'antenna', 'stripclub', 'animal_boarding',
    'coworking_space', 'clock', 'shipping_company', 'waste_transfer_station', 'emergency_service',
    'wilderness_hut', 'hunting_stand', 'communications_tower', 'mast',
    'breakwater', 'wreck', 'amusement_arcade', 'dancing_school', 'mineshaft', 
    'bicycle_repair_station', 'mortuary', 'parking_entrance', 'water_point',
    'advertising', 'traffic_signals', 'bollard', 'pitch', 'cross', 'parking_space',
    'Matadouro', 'container_terminal', 'embankment', 'water_works', 'boundary', 'multipolygon',
    'conference_centre', 'exhibition_centre', 'rescue_station', 'escape_game', 'route', 'indoor',
    'car_pooling', 'district', 'club', 'pista_de_Kart', 'enforcement', 'farm', 'training_school',
    'gate', 'Fepam', 'kindergarden', 'sport', 'crane', 'spa', 'hangar', 'watering_place',
    'trail_riding_station', 'comun', 'canteen', 'watershed', 'building', 'NDB', 'institutional',
    'site', 'propriedade_particular_-_local_fechado', 'motorcycle_rental', 'Creche', 'stone',
    'events_centre', 'dispõem_de_quadras_de_futebol_para_lazer.', '*', 'no', 'office',
    'house', 'sauna', 'dressing_room', 'courtyard', 'kiln', 'antenna', 'mast', 'ticket_validator',
    'auditorium', 'casino', 'register_office', 'miniature_golf', 'boat_rental', 'street_cabinet',
    'driver_training', 'water_tap', 'payment_centre', 'compressed_air', 'public_bookcase', 'cabin',
    'morgue', 'clearcut', 'goods_conveyor', 'adult_gaming_centre', 'summer_camp', 'Presídio',
    'camp_pitch', 'karaoke_box', 'archive', 'trampoline_park', 'railway', 'cutline', 'training',
    'swimming_area', 'sanitary_dump_station', 'money_transfer', 'lavoir', 'dam', 'substation',
    'pet', 'ship', 'canteen', 'no', 'watershed', 'greenhouse', 'sailing_club', 'cannon_modern',
    'store', 'stock_exchange', 'vacant', 'audiologist', 'post_box', 'bunker_silo', 'gallows',
    'event_center', 'company', 'governament', 'toy_library', 'pastry', 'travel agency', 'civic',
    'protected_area', 'animal_training', 'dive_centre', 'gambling', 'stage', 'wood store',
    'fixme', 'place_of_mourning', 'veterinary_pharmacy', 'internet_service_provider', 'piscina',
    'submarine_cable', 'pat', 'dyke', 'piste:halfpipe', 'gantry',
    'motorcycle_parking', 'dog_toilet', 'motorcycle_taxi',
    'yes', 'building', 'way', 'node'
  ],

  // Categorias que SÓ passam se forem explicitamente históricas (Mesmo com Wiki)
  RESTRICTED_UTILITY_TAGS: [
    'school', 'university', 'college', 'kindergarten', 'childcare',
    'hospital', 'clinic', 'doctors', 'social_facility', 'community_centre', 'social_centre',
    'police', 'fire_station', 'post_office', 'government', 'office', 'courthouse', 'townhall_legacy',
    'public_building', 'bureau_de_change', 'bank', 'pharmacy', 'atm',
    'research_institute', 'golf_course', 'sports_centre', 'monastery',
    'church', 'tomb', 'biergarten', 'village_hall', 'hotel', 'watermill', 'alpine_hut', 
    'guest_house', 'hostel', 'fort', 'battlefield', 'manor', 'windmill', 'bathing_place', 
    'masonic_lodge', 'quilombo', 'heritage', 'protected_building', 'culture_center', 
    'Casa_da_Memória', 'Casa_Histórica', 'railway_station', 'square', 'hackerspace',
    'território_de_práticas_ancestrais_afrogaúchas', 'Araucária_Centenária'
  ],

  // Termos no nome que indicam lixo urbano ou infraestrutura
  NAME_BLOCKLIST: [
    "secretaria", "departamento", "sede comunal", "delegación",
    "clínica", "clinica", "odontologia", "escola", "colégio", "colegio",
    "banco", "caixa", "atm", "lotérica", "loterica", "correio", "post office",
    "academia", "fitness", "crossfit", "estacionamento", "parking",
    "edifício", "edificio", "condomínio", "condominio", "residencial",
    "farmácia", "drogaria", "pharmacy", "oxxo", "7-eleven",
    "mercado", "supermercado", "panificadora", "padaria", "lavanderia",
    "auto center", "borracharia", "oficina",
    "estação tubo", "estacao tubo", "ponto de ônibus", "ponto de onibus",
    "parada de ", "terminal de ", "agência ", "agencia ",
    "centro de saúde", "centro de saude", "posto de saúde", "posto de saude",
    "posto policial", "delegacia", "fórum", "forum",
    "câmara municipal", "camara municipal", "vereadores"
  ],

  // Marcas de igrejas genéricas
  RELIGIOUS_BRANDS: [
    "universal do reino", "igreja universal", "mundial do poder",
    "internacional da graça", "deus é amor", "renascer em cristo",
    "bola de neve", "assembléia de deus", "testemunhas de jeová",
    "salão do reino", "congregacao cristã", "congregacao crista"
  ],

  ACCOMMODATION_TYPES: [
    "hotel", "motel", "guest_house", "hostel", "apartment", "chalet", "alpine_hut"
  ],

  GENERIC_PARK_NAMES: ["praça", "praca", "pça", "pça.", "plaza", "plazoleta", "largo", "jardim", "provincia de ", "provincia das ", "paseo "],

  SINGLE_WORD_WHITELIST: [
    "masp", "pinacoteca", "copan", "catavento", "maracanã", "corcovado", "obelisco", "obelisk", "panteon", "panteão", "louvre", "prado"
  ]
};

function shouldFilterPOI(poi: any): { remove: boolean; reason?: string } {
  const props = poi.tags || {};
  const name = (props.name || "").trim();
  const nameLower = name.toLowerCase();

  const hasWikipedia = !!props.wikipedia;
  const hasHistoric = !!props.historic;
  const hasHeritage = !!props.heritage;
  const hasWikidata = !!props.wikidata;
  
  const isFamous = hasWikipedia || hasHeritage || hasHistoric || hasWikidata;
  const hasReference = hasWikipedia || hasWikidata;

  // --- 1. FILTROS BÁSICOS ---
  if (!name || name.length < 2) return { remove: true, reason: "Strict: Local sem nome" };

  if (props.route || props.type === "route") {
    return { remove: true, reason: "Category: Rota/Trajeto (não é um ponto fixo)" };
  }

  // --- 2. EXCEÇÕES DE ELITE (Isenção total de filtros se for um marco reconhecido) ---
  const isCulturalExemption = (
    props.tourism === "museum" || 
    !!props.museum ||
    props.amenity === "theatre" || 
    props.amenity === "arts_centre" ||
    props.tourism === "gallery" ||
    props.tourism === "information" ||
    nameLower.includes("mercado municipal") ||
    nameLower.includes("museu municipal")
  );

  const isGovernmentExemption = (
    (props.amenity === "townhall" || props.building === "public") &&
    (nameLower.startsWith("prefeitura") || nameLower.includes("paço municipal") || nameLower.includes("paco municipal"))
  );

  const isTransportLandmark = (
    props.aerialway === "chair_lift" || 
    props.aerialway === "cable_car" || 
    props.aerialway === "gondola" ||
    (props.railway === "station" && (props.historic || hasWikipedia))
  );

  // Elite Market Hall pattern
  const isMajorMarket = props.amenity === "marketplace" && ["municipal", "mercadão", "mercadao", "market hall", "público", "publico", "paco", "paço", "mercado de", "mercado da", "mercado do"].some(t => nameLower.includes(t));

  if (isCulturalExemption || isGovernmentExemption || isTransportLandmark || isMajorMarket) {
    return { remove: false };
  }

  // --- 3. TAG_BLOCKLIST (CRÍTICO - BLOQUEIA MESMO COM WIKI SE FOR INFRAESTRUTURA) ---
  const tagKeys = ['amenity', 'tourism', 'leisure', 'man_made', 'historic', 'highway', 'public_transport', 'place', 'office', 'shop'];
  
  for (const key of tagKeys) {
    if (!props[key]) continue;
    const individualTags = String(props[key]).split(';');
    if (individualTags.some(t => FILTER_CONFIG.TAG_BLOCKLIST.includes(t.trim()))) {
      return { remove: true, reason: `TAG_BLOCKLIST: ${key}=${props[key]}` };
    }
  }

  // --- 4. NAME_BLOCKLIST ---
  if (!isFamous) {
    for (const term of FILTER_CONFIG.NAME_BLOCKLIST) {
      if (nameLower.includes(term)) {
        return { remove: true, reason: `NAME_BLOCKLIST: Termo proibido '${term}'` };
      }
    }
  }

  // --- 5. RESTRICTED_UTILITY_TAGS (SÓ passa se for HISTÓRICO/FAMOSO) ---
  const isUtility = tagKeys.some(key => {
    if (!props[key]) return false;
    const individualTags = String(props[key]).split(';');
    return individualTags.some(t => FILTER_CONFIG.RESTRICTED_UTILITY_TAGS.includes(t.trim()));
  });

  if (isUtility && !isFamous) {
    return { remove: true, reason: "RESTRICTED_UTILITY: Requer tag historic/heritage ou wiki para passar" };
  }

  // --- 6. RELIGIÃO E ACOMODAÇÃO ---
  if (props.amenity === "place_of_worship") {
    const denomination = (props.denomination || "").toLowerCase();
    const isCatholic = ["catholic", "roman_catholic"].includes(denomination);
    
    if (FILTER_CONFIG.RELIGIOUS_BRANDS.some((b) => nameLower.includes(b))) {
      if (!isFamous) return { remove: true, reason: "RELIGIOUS_BRAND: Marca religiosa genérica" };
    }

    if (!isCatholic && !isFamous && !hasHistoric) {
       return { remove: true, reason: "Category: Religião local sem relevância histórica" };
    }
  }

  if (FILTER_CONFIG.ACCOMMODATION_TYPES.includes(props.tourism)) {
    if (props.tourism === "apartment") return { remove: true, reason: "ACCOMMODATION: Apartamento" };
    if (!isFamous) return { remove: true, reason: "ACCOMMODATION: Hotel comum sem fama" };
  }

  // --- 7. OUTRAS REGRAS ---
  if (nameLower.startsWith("residência") || nameLower.startsWith("residencia")) {
    if (!isFamous && props.tourism !== "museum") {
      return { remove: true, reason: "RESIDENTIAL: Residência privada sem fama" };
    }
  }

  if (props.boundary === "administrative") {
    const level = parseInt(props.admin_level || "0");
    if (level > 8) return { remove: true, reason: "BOUNDARY: Distrito/Bairro menor" };
  }

  if (["tower", "water_tower"].includes(props.man_made) && !isFamous && !props.tourism && !props.historic && !hasReference) {
    return { remove: true, reason: "INFRASTRUCTURE: Torre/Caixa d'água sem valor" };
  }

  // Nomes de uma palavra - Bloqueio estrito
  const words = name.split(/\s+/).filter((w: string) => w.length > 0);
  if (words.length === 1 && !isFamous && !FILTER_CONFIG.SINGLE_WORD_WHITELIST.includes(nameLower) && !isCulturalExemption) {
    return { remove: true, reason: "STRICT: Nome de palavra única sem referência" };
  }

  return { remove: false };
}

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
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
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

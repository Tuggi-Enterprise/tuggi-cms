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
  GLOBAL_BLOCKLIST: [
    "distrito", "bairro", "comuna", "subúrbio", "suburbio",
    "secretaria", "departamento", "divisão", "divisao", "serviço", "servico", "diretoria", "superintendência", "superintendencia",
    "fundação casa", "poupatempo", "detran", "cartório", "cartorio", "fórum", "forum", "vara do", "tribunal", "procuradoria",
    "prefeitura do campus", "sede comunal", "delegacia",
    "caixa econômica", "caixa economica", "lotérica", "loterica", "câmbio", "cambio", "atm",
    "oxxo", "carrefour", "extra", "pão de açúcar", "pao de acucar", "dia%", "assai", "atacadao", "atacadão",
    "smart fit", "bluefit", "droga", "farma", "hospital", "clínica", "clinica", "unidade de saúde", "upa", "ubs", "posto de saúde", "posto de atendimento", "centro de atendimento", "pat -",
    "estacionamento", "parking", "garage", "banca de", "quiosque", "terminais de ônibus", "terminal de onibus",
    "rotary", "lions club", "maçonaria", "loja maçônica", "loja maçonica",
    "business center", "comercial center", "office", "escritório", "escritorio", "coworking",
    "condomínio", "condominio", "edifício residencial", "edificio residencial", "residencial", "vilagio", "villagio",
    "feira livre", "distribuidora", "depósito", "deposito", "armazém", "armazem", "oficina", "auto pecas", "auto peças",
    "pneus", "lava rapido", "lava rápido", "pet shop", "veterinária", "veterinaria", "escola", "colégio", "colegio", "faculdade", "universidade",
    "academia", "fitness", "crossfit", "correio", "post office", "administrativo", "governo",
    "center", "centro", "horta", "letreiro",
    "recreational area", "green area", "open space", "public space"
  ],

  RELIGIOUS_BRANDS: [
    "igreja universal", "reino de deus", "assembléia de deus",
    "testemunhas de jeová", "salão do reino", "congregacao cristã",
    "reino de dios", "asamblea de dios", "testigos de jehová", "salón del reino", "congregación cristiana"
  ],

  ACCOMMODATION_TYPES: [
    "hotel", "motel", "guest_house", "hostel", "apartment", "chalet", "alpine_hut"
  ],

  GENERIC_PARK_NAMES: ["praça", "praca", "pça", "pça.", "plaza", "plazoleta", "largo", "jardim", "provincia de ", "provincia das ", "paseo "],

  SINGLE_WORD_WHITELIST: [
    "masp", "pinacoteca", "copan", "catavento", "maracanã", "corcovado", "obelisco", "obelisk", "panteon", "panteão", "louvre", "prado"
  ],

  CATEGORY_BLOCKLIST: {
    amenity: [
      "bank", "pharmacy", "school", "hospital", "fuel", "parking", "post_office", "atm", "toilets", 
      "bench", "telephone", "waste_basket", "recycling", "bicycle_parking", "motorcycle_parking", 
      "vending_machine", "drinking_water", "police", "fire_station", "prison", "social_facility", 
      "community_centre", "clinic", "dentist", "doctors", "veterinary", "car_wash", "car_sharing",
      "nightclub", "pub", "bar", "fast_food", "food_court", "biergarten"
    ],
    shop: [
      "supermarket", "convenience", "hairdresser", "car_repair", "laundry", "dry_cleaning", "beauty", 
      "optician", "chemist", "hardware", "butcher", "bakery", "mobile_phone", "boutique", "fashion", 
      "furniture", "kiosk", "mall", "department_store", "clothes", "shoes", "alcohol"
    ],
    office: [
      "yes", "government", "it", "employment_agency", "foundation", "administrative", "estate_agent", 
      "travel_agent", "lawyer", "accountant", "architect", "engineer", "telecommunication"
    ],
    leisure: [
      "pitch", "track", "fitness_station", "playground", "dog_park", "picnic_site", "swimming_pool", 
      "sports_centre", "fitness_centre", "sauna", "adult_gaming_centre", "escape_game"
    ],
    natural: ["tree_row", "hedge", "scrub", "heath", "grassland", "tree"],
    man_made: ["pipeline", "storage_tank", "surveillance", "waste_disposal", "street_cabinet"]
  },

  RELIGIOUS_BLOCKLIST: [
    "pentecostal", "evangelical", "jehovahs_witness", "mormon", "baptist", "methodist", 
    "seventh_day_adventist", "assembly_of_god", "universal_church_of_the_kingdom_of_god"
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

  if (!name) return { remove: true, reason: "Strict: Local sem nome" };

  if (props.route || props.type === "route") {
    return { remove: true, reason: "Category: Rota/Trajeto (não é um ponto fixo)" };
  }

  const isCulturalExemption = (
    props.tourism === "museum" || 
    !!props.museum ||
    props.amenity === "theatre" || 
    props.amenity === "marketplace" ||
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
  
  const isCenterExemption = (nameLower.includes("center") || nameLower.includes("centro")) && (isFamous || isCulturalExemption);
  const isMunicipalExemption = nameLower.includes("municipal") && (isCulturalExemption || isGovernmentExemption);
  const isHortaExemption = nameLower.startsWith("horta") && isFamous;

  if (!isFamous && !isCulturalExemption && !isTransportLandmark) {
    for (const [key, blockedValues] of Object.entries(FILTER_CONFIG.CATEGORY_BLOCKLIST)) {
      if (props[key] && (blockedValues as string[]).includes(props[key])) {
        return { remove: true, reason: `Category Blocklist: ${key}=${props[key]}` };
      }
    }
  }

  if (!isCenterExemption && !isHortaExemption && !isMunicipalExemption && !isTransportLandmark && !isCulturalExemption) {
    for (const term of FILTER_CONFIG.GLOBAL_BLOCKLIST) {
      if (nameLower.includes(term)) {
        if (term === "shopping" && !hasWikipedia) {
           return { remove: true, reason: "Blacklist: Shopping Center genérico" };
        }
        return { remove: true, reason: `Blacklist: Termo proibido '${term}'` };
      }
    }
  }

  if (FILTER_CONFIG.RELIGIOUS_BRANDS.some((b) => nameLower.includes(b)) || nameLower === "universal") {
    if (props.amenity === "place_of_worship" && !isFamous) {
      return { remove: true, reason: "Blacklist: Marca religiosa genérica" };
    }
  }

  if (nameLower.startsWith("residência") || nameLower.startsWith("residencia")) {
    if (!isFamous && props.tourism !== "museum") {
      return { remove: true, reason: "Category: Residência privada sem valor histórico" };
    }
  }

  if (props.boundary) {
    const bureaucratic = ["registrars_district", "statistical", "polling_station", "postal", "census", "political"];
    if (bureaucratic.includes(props.boundary) && !hasWikipedia) {
      return { remove: true, reason: `Category: Limite burocrático (${props.boundary})` };
    }

    if (props.boundary === "administrative") {
      const level = parseInt(props.admin_level || "0");
      if (level > 8) return { remove: true, reason: "Category: Distrito/Bairro (admin_level > 8)" };
    }

    if (props.boundary === "historic_parish" && !isFamous) {
      return { remove: true, reason: "Category: Paróquia histórica sem contexto" };
    }
  }

  if (props.natural === "peak" && !isFamous && !props.tourism) {
    return { remove: true, reason: "Category: Pico geográfico sem relevância (sem Wiki)" };
  }

  const isPrivate = props["operator:type"] === "private" || props.access === "private";
  const isResidential = props.building === "apartments" || props.residential === "yes";
  if ((isPrivate || isResidential) && !isFamous) {
    return { remove: true, reason: "Category: Privado/Residencial sem fama" };
  }

  const isGenericPlace = FILTER_CONFIG.GENERIC_PARK_NAMES.some((t) => nameLower.startsWith(t) || nameLower.includes(" " + t));
  
  if (props.leisure) {
    if (FILTER_CONFIG.CATEGORY_BLOCKLIST.leisure.includes(props.leisure)) {
      return { remove: true, reason: `Category: Lazer utilitário (${props.leisure})` };
    }
    
    if (["sauna", "dance", "adult_gaming_centre"].includes(props.leisure) && !hasWikipedia) {
       return { remove: true, reason: "Category: Lazer adulto/noturno sem fama" };
    }

    const isPark = ["park", "garden", "nature_reserve"].includes(props.leisure);
    if (isPark) {
      if (nameLower.includes("shopping")) return { remove: true, reason: "Blacklist: Shopping tagged as Park" };
      if (isGenericPlace && !isFamous && !props.tourism) {
        return { remove: true, reason: "Category: Praça/Largo/Jardim comum" };
      }
      if (poi.type === "node" && !isFamous && !props.tourism) {
        return { remove: true, reason: "Category: Ponto de lazer menor" };
      }
    }
  }

  if (isGenericPlace && !isFamous && !props.tourism && !props.historic && !isCulturalExemption) {
      return { remove: true, reason: "Category: Local de nome genérico sem relevância" };
  }

  if (FILTER_CONFIG.ACCOMMODATION_TYPES.includes(props.tourism)) {
    if (props.tourism === "apartment") return { remove: true, reason: "Category: Apartamento" };
    if (!isFamous && !hasHistoric) return { remove: true, reason: "Category: Hotel comum (sem Fama/Histórico)" };
  }

  const attractionTypes = ["attraction", "artwork", "gallery", "picnic_site", "viewpoint"];
  if (attractionTypes.includes(props.tourism) || props.historic === "memorial") {
    if (props.memorial === "ghost_bike") return { remove: true, reason: "Category: Memorial Ghost Bike" };
    if (["plaque", "blue_plaque", "bust"].includes(props.memorial) && !hasWikipedia) {
       return { remove: true, reason: "Category: Memorial menor (Busto/Placa)" };
    }
    if (["lighthouse", "windmill"].includes(props.man_made)) return { remove: false };

    if (!isFamous && !["museum", "theme_park", "zoo"].includes(props.tourism)) {
      return { remove: true, reason: "Category: Atração/Arte/Memorial sem Wikipedia/Histórico" };
    }
  }

  if (props.amenity === "place_of_worship") {
    const denomination = (props.denomination || "").toLowerCase();
    const isCatholic = ["catholic", "roman_catholic"].includes(denomination);
    
    if (nameLower.startsWith("comunidade") || nameLower.startsWith("salão") || nameLower.startsWith("salao") || nameLower.startsWith("salon")) {
      if (!isFamous) return { remove: true, reason: "Category: Comunidade/Salão de bairro" };
    }

    if (FILTER_CONFIG.RELIGIOUS_BLOCKLIST.some(d => denomination.includes(d)) && !isFamous) {
      return { remove: true, reason: `Category: Denominação religiosa bloqueada (${denomination})` };
    }

    if (!isCatholic && !isFamous && !props.historic) {
      return { remove: true, reason: "Category: Religião local sem relevância histórica" };
    }
  }

  const otherCommercial = ["shop", "office", "craft", "industrial"];
  if (props.amenity === "marketplace") {
    const isMunicipal = ["municipal", "mercadão", "mercadao", "mercado"].some(t => nameLower.includes(t));
    if (!isFamous && !isMunicipal) return { remove: true, reason: "Category: Mercado local sem fama/municipal" };
    return { remove: false };
  }

  if (otherCommercial.some((t) => !!props[t]) && !isFamous && !isCulturalExemption) {
    return { remove: true, reason: "Category: Comércio/Serviço genérico" };
  }

  if (props.amenity === "townhall") return { remove: false };

  if (props.tourism === "information" && !isFamous) {
    return { remove: true, reason: "Category: Informação turística sem fama" };
  }

  if (["tower", "water_tower"].includes(props.man_made) && !isFamous && !props.tourism && !props.historic && !hasReference) {
    return { remove: true, reason: "Category: Torre/Infraestrutura sem valor" };
  }

  const words = name.split(/\s+/).filter((w: string) => w.length > 0);
  if (words.length === 1) {
    if (hasReference || FILTER_CONFIG.SINGLE_WORD_WHITELIST.includes(nameLower) || isTransportLandmark || isCulturalExemption) return { remove: false };
    return { remove: true, reason: "Strict: Nome de palavra única sem referência" };
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

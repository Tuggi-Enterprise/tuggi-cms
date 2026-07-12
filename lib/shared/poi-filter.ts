/**
 * POI FILTER - SINGLE SOURCE OF TRUTH (Elite Filter)
 * 
 * This file contains the authoritative "Elite" filtering logic used across:
 * 1. PBF Refinement Scripts (Deno)
 * 2. Supabase Edge Functions (Deno)
 * 3. CMS Importer Service (Node.js)
 * 4. Overpass Capture Logic
 */

export interface POIFilterResult {
  remove: boolean;
  reason?: string;
}

export const CATEGORIES = [
  "tourism",
  "historic",
  "natural",
  "leisure",
  "amenity=theatre",
  "amenity=place_of_worship",
  "amenity=marketplace",
  "amenity=townhall",
  "amenity=courthouse",
  "amenity=library",
  "man_made=lighthouse",
  "man_made=windmill",
  "man_made=tower",
  "man_made=water_tower",
  "aeroway=aerodrome",
  "aerialway",
  "historic=city_gate",
  "historic=fort",
  "historic=castle",
  "heritage",
  "place=suburb",
  "place=neighbourhood",
  "place=town",
  "place=village",
  "place=square"
];

export const FILTER_CONFIG = {
  // Categories that are completely blocked unless they are famous (Wiki/Wikidata)
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
    'information', 'waymark', 'guidepost', 'board', 'map', 'signpost', 'notice',
    'chalet', 'events_venue', 'theme_park', 'picnic_site', 'horse_riding',
    'school', 'university', 'college', 'kindergarten', 'childcare', 'language_school', 'driving_school',
    'playground', 'pitch', 'fitness_station', 'sports_centre_legacy',
    'hospital', 'clinic', 'doctors', 'social_facility', 'community_centre', 'social_centre',
    'police', 'fire_station', 'post_office', 'government', 'office', 'courthouse', 'townhall_legacy', 
    'public_building', 'industrial', 'works', 'wastewater_plant', 'power_plant', 'pumping_station', 
    'prison', 'jail', 'bus_station', 'taxi', 'ferry_terminal', 'airport', 'station', 'stop_position', 
    'bus_stop', 'survey_point', 'funeral_hall', 'dojo', 'slipway', 'pipeline', 'monitoring_station',
    'common', 'vehicle_inspection', 'boundary', 'storage_tank', 'bridge',
    'drinking_water', 'bureau_de_change', 'bbq', 'bandstand',
    'wayside_cross', 'wayside_shrine', 'flagpole', 'service', 'military', 'quarry',
    'studio', 'tunnel', 'mast', 'boundary_stone', 'crematorium', 'reservoir_covered',
    'reservoir', 'water_tower', 'bridge', 'gate', 'fence', 'pole', 'post', 'wall', 'hedge',
    'brothel', 'nursing_home', 'animal_breeding', 'internet_cafe', 'recreation_ground', 'shelter',
    'tree', 'tree_row', 'scrub', 'wood', 'peak', 'volcano', 'cave_entrance', 'rock', 'stone', 'islet',
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

  // Categories that ONLY pass if they are explicitly historical (Even with Wiki)
  RESTRICTED_UTILITY_TAGS: [
    'school', 'university', 'college', 'kindergarten', 'childcare',
    'hospital', 'clinic', 'doctors', 'social_facility', 'community_centre', 'social_centre',
    'police', 'fire_station', 'post_office', 'government', 'office', 'courthouse', 'townhall_legacy',
    'townhall', 'marketplace', // prefeituras/mercados comuns não são POI turístico (Mairie/Marché genéricos) — passam só com historic/heritage/wiki/descrição ou via exemção nomeada (isGovernmentExemption/isMajorMarket)
    'public_building', 'bureau_de_change', 'bank', 'pharmacy', 'atm',
    'research_institute', 'golf_course', 'sports_centre', 'monastery',
    'church', 'tomb', 'biergarten', 'village_hall', 'hotel', 'watermill', 'alpine_hut', 
    'guest_house', 'hostel', 'fort', 'battlefield', 'manor', 'windmill', 'bathing_place', 
    'masonic_lodge', 'quilombo', 'heritage', 'protected_building', 'culture_center', 
    'Casa_da_Memória', 'Casa_Histórica', 'railway_station', 'square', 'hackerspace',
    'território_de_práticas_ancestrais_afrogaúchas', 'Araucária_Centenária'
  ],

  // Terms in the name that indicate urban junk or infrastructure
  NAME_BLOCKLIST: [
    "secretaria", "departamento", "sede comunal", "delegación",
    "clínica", "clinica", "odontologia", "escola", "colégio", "colegio",
    "banco", "caixa", "atm", "lotérica", "loterica", "correio", "post office",
    "academia", "fitness", "crossfit", "estacionamento", "parking",
    "edifício", "edificio", "condomínio", "condominio", "residencial",
    "lotissement", "résidence", "residence ", // FR — loteamentos/condomínios (entram como place=neighbourhood)
    "urbanización", "urbanització", "polígono industrial", "polígon industrial", "polígono empresarial", // ES — loteamentos/zonas
    "farmácia", "drogaria", "pharmacy", "oxxo", "7-eleven",
    "mercado", "supermercado", "panificadora", "padaria", "lavanderia",
    "auto center", "borracharia", "oficina",
    "estação tubo", "estacao tubo", "ponto de ônibus", "ponto de onibus",
    "parada de ", "terminal de ", "agência ", "agencia ",
    "centro de saúde", "centro de saude", "posto de saúde", "posto de saude",
    "posto policial", "delegacia", "fórum", "forum",
    "câmara municipal", "camara municipal", "vereadores",
    "path continues", "trailhead", "waymark", "guidepost", "route map", "notice board", "information board", "signpost"
  ],

  RELIGIOUS_BRANDS: [
    "universal do reino", "igreja universal", "mundial do poder",
    "internacional da graça", "deus é amor", "renascer em cristo",
    "bola de neve", "assembléia de deus", "testemunhas de jeová",
    "salão do reino", "congregacao cristã", "congregacao crista",
    "adventista", "iasd", "sétimo dia", "setimo dia"
  ],

  ACCOMMODATION_TYPES: [
    "hotel", "motel", "guest_house", "hostel", "apartment", "chalet", "alpine_hut"
  ],

  GENERIC_PARK_NAMES: [
    "praça", "praca", "pça", "pça.", "largo", "jardim", "praceta", "rotunda", // PT
    "plaza", "plazoleta", "paseo", "alameda", "parque de ", // ES
    "piazza", "piazzale", // IT
    "square", "plaza", "garden", "park of " // EN
  ],

  STREET_KEYWORDS: {
    PREFIXES: [
      "rua ", "avenida ", "av. ", "travessa ", "viela ", "alameda ", "rodovia ", "estrada ", "beira mar ", "beiramar ", // PT
      "calle ", "avenida ", "av. ", "paseo ", "camino ", "carretera ", // ES (castelhano)
      // ES regional — vazavam por só ter castelhano: catalão/galego/asturiano/basco
      "carrer ", "avinguda ", "passeig ", "camí ", "carreró ", "ronda ", "travessera ", "travessia ", // CAT
      "rúa ", "camiño ", "corredoira ", "travesía ", // GAL
      "camín ", // AST
      "kale ", "kalea ", "etorbidea ", "errepidea ", // EUS
      "acceso ", "accés ", // acesso/via de acesso
      "via ", "viale ", "corso ", "strada ", // IT
      // IT extra — endereços/vias que vazavam (via/viale/corso já cobertos acima)
      "contrada ", "rione ", "vicolo ", "salita ", "calata ", "fondamenta ", "traversa ", "largo ", "piazzale ", "ciclovia ", // IT
      // FR — "rue"/"route"/"chemin" respondem por ~24k de ruído sem esses prefixos (boulevard/avenue já cobertos pelo EN)
      "rue ", "route ", "chemin ", "ruelle ", "impasse ", "voie ", "quai ", "cours ", "sentier ", "passage ", "allée ", "allee ", "promenade ", "chaussée ", "chaussee ", "faubourg ", "montée ", "montee ", "rond-point ", "ancienne route ", // FR
      "street ", "avenue ", "st. ", "ave. ", "road ", "rd. ", "lane ", "way ", "drive ", "dr. ", "boulevard ", "blvd. ", "highway " // EN
    ],
    SUFFIXES: [
      " street", " avenue", " st.", " ave", " road", " rd.", " lane", " way", " drive", " dr.", " boulevard", " blvd." // EN
    ]
  },

  SINGLE_WORD_WHITELIST: [
    "masp", "pinacoteca", "copan", "catavento", "maracanã", "corcovado", "obelisco", "obelisk", "panteon", "panteão", "louvre", "prado"
  ]
};

// Marcos sem valor turístico (cippi de fronteira, marcos de km, pontos geodésicos).
// historic=boundary_stone marca hasHistoric=true, então o TAG_BLOCKLIST normal não pega.
export const MARKER_NOISE_TAGS = ['boundary_stone', 'milestone', 'survey_point', 'geodesic', 'distance_marker'];

/**
 * Centered filtering logic.
 * Handles both "tags" (Overpass) and "properties" (GeoJSON) formats.
 */
export function shouldFilterPOI(poi: any): POIFilterResult {
  const props = poi.properties || poi.tags || {};
  const name = (props.name || "").trim();
  const nameLower = name.toLowerCase();

  const hasWikipedia = !!props.wikipedia;
  const hasHistoric = !!props.historic;
  const hasHeritage = !!props.heritage || !!props.listed_status || !!props['ref:bic'] || !!props.unesco;
  const hasWikidata = !!props.wikidata;
  const hasDescription = !!(props.description && props.description.trim().length > 5);
  
  let isFamous = hasWikipedia || hasHeritage || hasHistoric || hasWikidata || hasDescription;
  const hasReference = hasWikipedia || hasWikidata;

  // --- 1. BASIC FILTERS ---
  if (!name || name.length < 2) return { remove: true, reason: "Strict: Local sem nome" };

  // Relevância "dura" p/ ruído estrutural: só wiki/wikidata/heritage contam.
  // (hasHistoric NÃO conta aqui: historic=boundary_stone já marca hasHistoric=true,
  //  então usar isFamous deixaria todo cippi passar.)
  const hasHardReference = hasReference || hasHeritage;

  // Nome sem nenhuma letra (ex.: "16", "1/31", "1797", "40-193-0001-29") = ruído de OSM
  // (cippi de fronteira, marcos de km, anos/códigos soltos). Mantém só se referenciado.
  if (!/[A-Za-zÀ-ÿ]/.test(name) && !hasHardReference) {
    return { remove: true, reason: `NUMERIC_NAME: Nome sem contexto ('${name}')` };
  }

  // Marcos sem valor turístico (cippi de fronteira, marcos de km, pontos geodésicos).
  // historic=boundary_stone marca hasHistoric=true, então o TAG_BLOCKLIST normal não pega.
  const isMarkerNoise = [props.historic, props.man_made, props.highway, props.marker]
    .some(v => v && MARKER_NOISE_TAGS.includes(String(v)));
  if (isMarkerNoise && !hasHardReference) {
    return { remove: true, reason: `MARKER_NOISE: Marco sem valor (${props.historic || props.man_made || props.highway || props.marker})` };
  }

  if (props.route || props.type === "route") {
    return { remove: true, reason: "Category: Rota/Trajeto (não é um ponto fixo)" };
  }

  // --- 2. ELITE EXCEPTIONS (Full exemption if recognized landmark) ---
  const isCulturalExemption = (
    props.tourism === "museum" || 
    !!props.museum ||
    props.amenity === "theatre" || 
    props.amenity === "arts_centre" ||
    props.tourism === "gallery" ||
    (props.tourism === "information" && (props.information === "office" || props.information === "visitor_centre")) ||
    props.historic === "city_gate" ||
    props.historic === "castle" ||
    props.historic === "fort" ||
    nameLower.includes("mercado municipal") ||
    nameLower.includes("mercat municipal") ||
    nameLower.includes("museu municipal") ||
    nameLower.includes("mercado central") ||
    nameLower.includes("mercat central") ||
    nameLower.includes("lonja de la seda") ||
    nameLower.includes("llotja de la seda") ||
    nameLower.includes("torres de serranos") ||
    nameLower.includes("torres de quart")
  );

  const isGovernmentExemption = (
    (props.amenity === "townhall" || props.building === "public") &&
    (nameLower.startsWith("prefeitura") || nameLower.includes("paço municipal") || nameLower.includes("paco municipal") || nameLower.includes("ayuntamiento"))
  );

  const isTransportLandmark = (
    props.aerialway === "chair_lift" || 
    props.aerialway === "cable_car" || 
    props.aerialway === "gondola" ||
    (props.railway === "station" && (props.historic || hasWikipedia))
  );

  const isMajorMarket = props.amenity === "marketplace" && ["municipal", "mercadão", "mercadao", "market hall", "público", "publico", "paco", "paço", "mercado de", "mercado da", "mercado do", "central"].some(t => nameLower.includes(t));

  const isEliteSquare = (props.amenity === "plaza" || props.place === "square") && 
    ["mayor", "real", "ayuntamiento", "virgen", "constitucion", "pau", "reina", "seu"].some(t => nameLower.includes(t));

  // Landmarks explicitamente nomeados (Prefeitura/Paço Municipal/Ayuntamiento, Mercado
  // Municipal/Mercadão, Plaza Mayor/Real…) são mantidos mesmo sem descrição — o nome já é o
  // sinal. Preserva BR/ES agora que townhall/marketplace entraram no RESTRICTED_UTILITY;
  // "Mairie"/"Marché" genéricos (FR) não casam essas exemções e caem no filtro.
  if (isGovernmentExemption || isMajorMarket || isEliteSquare) {
    isFamous = true;
  }

  if (isCulturalExemption || isTransportLandmark || hasHeritage) {
    if (hasDescription && !props.description.includes('http')) {
      isFamous = true;
    }
  }

  // --- 2.5 NAME BLOCKLIST (Technical Noise) ---
  const name_check = props.name || props['name:pt'] || props['name:en'] || props['name:es'];
  if (name_check) {
    const nameLower = name_check.toLowerCase();
    const NAME_BLOCKLIST = ['mojón', 'pilón', 'vértice geodésico', 'hito quilométrico', 'hito de parada', 'poste informativo', 'cartel informativo'];
    
    // Check if name STARTS with any blocklist term (to be safe with things like 'Pilón de la Fuente' if it were important, though usually it's not)
    // Or if it's an exact match for common noise
    if (NAME_BLOCKLIST.some(term => nameLower.includes(term))) {
       // Exceptions: keep if it has wikipedia/wikidata
       if (!hasWikipedia && !hasWikidata && !hasHeritage) {
         return { remove: true, reason: `NAME_BLOCKLIST: Nome técnico irrelevante ('${name_check}')` };
       }
    }
  }

  // --- 3. TAG_BLOCKLIST (CRITICAL) ---
  const tagKeys = ['amenity', 'tourism', 'leisure', 'man_made', 'historic', 'highway', 'public_transport', 'place', 'office', 'shop', 'building', 'natural', 'landuse', 'type', 'class'];
  
  for (const key of tagKeys) {
    if (!props[key]) continue;
    const individualTags = String(props[key]).split(';');
    for (const t of individualTags) {
      const tagValue = t.trim();
      
      // Block ALL shops by default for Elite filter, unless it's a major landmark (handled by isCulturalExemption)
      if (key === 'shop' && !isFamous) {
        return { remove: true, reason: "SHOP: Comércio genérico" };
      }

      if (FILTER_CONFIG.TAG_BLOCKLIST.includes(tagValue)) {
        // Absolute noise is always removed
        const absoluteNoise = ['bench', 'waste_basket', 'trash_can', 'telephone', 'bicycle_parking', 'vending_machine', 'atm', 'surveillance', 'post_box', 'playground', 'pitch', 'fitness_station'];
        if (absoluteNoise.includes(tagValue)) {
          return { remove: true, reason: `ABSOLUTE_NOISE: ${key}=${tagValue}` };
        }

        // For natural features like peaks, trees, caves, etc., we require Wikipedia/Wikidata/Heritage.
        // A simple description is not enough for these categories.
        const naturalNoise = ['peak', 'volcano', 'tree', 'tree_row', 'scrub', 'wood', 'cave_entrance', 'rock', 'stone', 'islet'];
        if (naturalNoise.includes(tagValue)) {
           if (!hasWikipedia && !hasWikidata && !hasHeritage && !hasHistoric) {
             return { remove: true, reason: `NATURAL_NOISE: ${key}=${tagValue} sem fama global` };
           }
        }

        if (!isFamous) {
          return { remove: true, reason: `TAG_BLOCKLIST: ${key}=${tagValue}` };
        }
      }
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

  // --- 5. RESTRICTED_UTILITY_TAGS ---
  const isUtility = tagKeys.some(key => {
    if (!props[key]) return false;
    const individualTags = String(props[key]).split(';');
    return individualTags.some(t => FILTER_CONFIG.RESTRICTED_UTILITY_TAGS.includes(t.trim()));
  });

  if (isUtility && !isFamous) {
    return { remove: true, reason: "RESTRICTED_UTILITY: Requer tag historic/heritage ou wiki/descrição para passar" };
  }

  // --- 6. RELIGION AND ACCOMMODATION ---
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
    // For Elite, accommodation requires Wikipedia, Wikidata or Heritage. Description alone is not enough for hotels.
    if (!hasWikipedia && !hasWikidata && !hasHeritage && !hasHistoric) {
      return { remove: true, reason: "ACCOMMODATION: Hotel/Pousada sem relevância histórica ou fama global" };
    }
  }

  // --- 7. BOUNDARIES AND INFRASTRUCTURE ---
  if (props.boundary === "administrative") {
    const level = parseInt(props.admin_level || "0");
    if (level > 8) return { remove: true, reason: "BOUNDARY: Distrito/Bairro menor" };
  }

  if (nameLower.startsWith("residência") || nameLower.startsWith("residencia")) {
    if (!isFamous && props.tourism !== "museum") {
      return { remove: true, reason: "RESIDENTIAL: Residência privada sem fama" };
    }
  }

  // --- 8. ICONIC NEIGHBOURHOODS, TOWNS AND SQUARES ---
  if (["suburb", "neighbourhood", "town", "village", "square"].includes(props.place)) {
    // If it's a neighborhood/suburb/square, we keep it if it has a name and some importance 
    // or if it's explicitly famous. We are more lenient here to keep urban context.
    if (!name || name.length < 3) return { remove: true, reason: "PLACE: Nome muito curto" };
    return { remove: false };
  }

  if (["tower", "water_tower"].includes(props.man_made) && !isFamous && !props.tourism && !props.historic && !hasReference) {
    return { remove: true, reason: "INFRASTRUCTURE: Torre/Caixa d'água sem valor" };
  }

  // Generic Park Names check - more aggressive for Elite filter
  const isGenericParkName = FILTER_CONFIG.GENERIC_PARK_NAMES.some(p => nameLower.startsWith(p));
  const isParkCategory = props.leisure === "park" || props.amenity === "plaza" || props.place === "square";
  
  if (isGenericParkName && isParkCategory && !isFamous) {
    return { remove: true, reason: "PARK: Praça/Largo genérico sem fama ou histórico" };
  }

  // Generic Street Names check - streets should not be POIs unless they are landmarks
  const isGenericStreet = 
    FILTER_CONFIG.STREET_KEYWORDS.PREFIXES.some(p => nameLower.startsWith(p)) ||
    FILTER_CONFIG.STREET_KEYWORDS.SUFFIXES.some(s => nameLower.endsWith(s));
    
  if (isGenericStreet && !isFamous) {
    return { remove: true, reason: "STREET: Rua/Avenida/Street genérica sem fama ou histórico" };
  }

  // Single word names - Strict block
  const words = name.split(/\s+/).filter((w: string) => w.length > 0);
  if (words.length === 1 && !isFamous && !FILTER_CONFIG.SINGLE_WORD_WHITELIST.includes(nameLower) && !isCulturalExemption) {
    return { remove: true, reason: "STRICT: Nome de palavra única sem referência" };
  }

  return { remove: false };
}

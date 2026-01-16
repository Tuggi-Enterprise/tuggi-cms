#!/usr/bin/env -S deno run --allow-net

/**
 * local test script for Overpass Filtering Logic
 * Mirror of supabase/functions/capture-pois/index.ts
 */

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
    "recreational area", "green area", "open space", "public space",
    "cíles", "ciles", "centro integrado"
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
      "sports_centre", "fitness_centre", "sauna", "adult_gaming_centre", "escape_game", "miniature_golf"
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
    // Elite Market Hall pattern
    const isMajorMarket = ["municipal", "mercadão", "mercadao", "market hall", "público", "publico", "paco", "paço", "mercado de", "mercado da", "mercado do"].some(t => nameLower.includes(t));
    
    if (!isFamous && !isMajorMarket) {
      return { remove: true, reason: "Category: Mercado local sem fama/histórico" };
    }
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

async function runTest() {
  const coords = [
    { lat: -23.1163, lon: -46.5447, radius: 2000, label: "Atibaia/Bragança Region" }
  ];

  const endpoints = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter"
  ];

  for (const c of coords) {
    console.log(`\n--- Testing ${c.label} (${c.lat}, ${c.lon}) ---`);
    const query = `
      [out:json][timeout:90];
      (
        node(around:${c.radius},${c.lat},${c.lon})["tourism"];
        node(around:${c.radius},${c.lat},${c.lon})["historic"];
        node(around:${c.radius},${c.lat},${c.lon})["natural"];
        node(around:${c.radius},${c.lat},${c.lon})["leisure"];
        node(around:${c.radius},${c.lat},${c.lon})["amenity"~"theatre|place_of_worship|marketplace|townhall"];
        
        way(around:${c.radius},${c.lat},${c.lon})["tourism"];
        way(around:${c.radius},${c.lat},${c.lon})["historic"];
        way(around:${c.radius},${c.lat},${c.lon})["natural"];
        way(around:${c.radius},${c.lat},${c.lon})["leisure"];
        way(around:${c.radius},${c.lat},${c.lon})["amenity"~"theatre|place_of_worship|marketplace|townhall"];

        relation(around:${c.radius},${c.lat},${c.lon})["tourism"];
        relation(around:${c.radius},${c.lat},${c.lon})["historic"];
        relation(around:${c.radius},${c.lat},${c.lon})["natural"];
        relation(around:${c.radius},${c.lat},${c.lon})["leisure"];
        relation(around:${c.radius},${c.lat},${c.lon})["amenity"~"theatre|place_of_worship|marketplace|townhall"];
      );
      out body center;
    `;

    let data;
    for (const endpoint of endpoints) {
      try {
        console.log(`  Trying endpoint: ${endpoint}...`);
        const response = await fetch(endpoint, {
          method: "POST",
          body: "data=" + encodeURIComponent(query)
        });
        if (response.ok) {
          data = await response.json();
          break;
        }
        console.warn(`  Warning: Endpoint ${endpoint} returned status ${response.status}`);
      } catch (e) {
        console.warn(`  Warning: Failed to fetch from ${endpoint}`);
      }
    }

    if (!data) {
      console.error("  Error: All Overpass endpoints failed.");
      continue;
    }
    const kept = [];
    const removed = [];

    for (const el of data.elements) {
      const check = shouldFilterPOI(el);
      if (check.remove) {
        removed.push({ name: el.tags?.name || "unnamed", reason: check.reason });
      } else {
        kept.push({ name: el.tags?.name, tags: el.tags });
      }
    }

    console.log(`Total Found: ${data.elements.length}`);
    console.log("Names found:", data.elements.map(e => e.tags?.name).filter(Boolean).join(", "));
    console.log(`KEPT (${kept.length}):`);
    kept.forEach(k => console.log(`  ✅ ${k.name}`));
    
    console.log(`\nREMOVED TARGETS:`);
    const targetRemovalsRegex = /Cíles|ciles|Mercado Santos|Park Golf|Tio Nicola/i;
    removed.forEach(r => {
      if (targetRemovalsRegex.test(r.name)) {
        console.log(`  ❌ ${r.name}: ${r.reason}`);
      }
    });
  }
}

runTest();

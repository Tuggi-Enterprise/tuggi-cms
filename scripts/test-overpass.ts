/**
 * TEST OVERPASS FILTERING LOGIC
 * Useful for validating POI filtering rules against real-world data in different cities.
 * 
 * Usage: deno run --allow-net --allow-read --allow-write scripts/test-overpass.ts [lat] [lon] [radius]
 */

/// <reference lib="deno.ns" />

import { join } from "https://deno.land/std/path/mod.ts";

const LAT = -34.6037; // Buenos Aires default
const LON = -58.3816;
const RADIUS = 1000;

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const FILTER_CONFIG = {
  GLOBAL_BLOCKLIST: [
    "distrito", "bairro", "comuna", "subúrbio", "suburbio",
    "secretaria", "departamento", "sede comunal", "delegación",
    "administrativo", "governo", "municipal",
    "clínica", "clinica", "hospital", "centro médico", "odontologia",
    "escola", "colégio", "faculdade", "universidade",
    "banco", "caixa", "atm", "lotérica",
    "correio", "post office",
    "academia", "fitness", "crossfit",
    "estacionamento", "parking",
    "edifício", "edificio", "condomínio", "condominio", "residencial",
    "centro empresarial", "business center", "office",
    "oxxo", "7-eleven", "smart fit", "raia", "drogasil",
    "farmácia", "drogaria", "pharmacy",
    "center", "centro", "horta"
  ],

  RELIGIOUS_BRANDS: [
    "igreja universal", "reino de deus", "assembléia de deus",
    "testemunhas de jeová", "salão do reino", "congregacao cristã"
  ],

  ACCOMMODATION_TYPES: [
    "hotel", "motel", "guest_house", "hostel", "apartment", "chalet", "alpine_hut"
  ],

  GENERIC_PARK_NAMES: ["praça", "praca", "plaza", "plazoleta", "largo"],

  UTILITARIAN_LEISURE: [
    "pitch", "track", "fitness_station", "playground", "dog_park", "picnic_site", "swimming_pool"
  ],

  SINGLE_WORD_WHITELIST: [
    "masp", "pinacoteca", "copan", "catavento", "maracanã", "corcovado", "obelisco"
  ],
};

async function fetchFromOverpass(lat: number, lon: number, radius: number) {
  const query = `
    [out:json][timeout:90];
    (
      node["tourism"](around:${radius},${lat},${lon});
      node["historic"](around:${radius},${lat},${lon});
      node["natural"](around:${radius},${lat},${lon});
      node["leisure"](around:${radius},${lat},${lon});
      node["amenity"~"theatre|place_of_worship|marketplace|townhall|courthouse|library"](around:${radius},${lat},${lon});
      node["man_made"~"lighthouse|windmill|tower|water_tower"](around:${radius},${lat},${lon});
      node["aeroway"="aerodrome"](around:${radius},${lat},${lon});

      way["tourism"](around:${radius},${lat},${lon});
      way["historic"](around:${radius},${lat},${lon});
      way["natural"](around:${radius},${lat},${lon});
      way["leisure"](around:${radius},${lat},${lon});
      way["amenity"~"theatre|place_of_worship|marketplace|townhall|courthouse|library"](around:${radius},${lat},${lon});
      way["man_made"~"lighthouse|windmill|tower|water_tower"](around:${radius},${lat},${lon});
      way["aeroway"="aerodrome"](around:${radius},${lat},${lon});

      relation["tourism"](around:${radius},${lat},${lon});
      relation["historic"](around:${radius},${lat},${lon});
      relation["natural"](around:${radius},${lat},${lon});
      relation["leisure"](around:${radius},${lat},${lon});
      relation["amenity"~"theatre|place_of_worship|marketplace|townhall|courthouse|library"](around:${radius},${lat},${lon});
      relation["man_made"~"lighthouse|windmill|tower|water_tower"](around:${radius},${lat},${lon});
      relation["aeroway"="aerodrome"](around:${radius},${lat},${lon});
    );
    out center;
  `;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      console.log(`🌐 Trying endpoint: ${endpoint}...`);
      const response = await fetch(endpoint, {
        method: "POST",
        body: "data=" + encodeURIComponent(query),
      });

      if (!response.ok) {
        console.warn(`⚠️ Endpoint ${endpoint} failed: ${response.status} ${response.statusText}`);
        continue;
      }

      return await response.json();
    } catch (e) {
      console.warn(`⚠️ Endpoint ${endpoint} error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error("All Overpass mirrors failed.");
}

function shouldFilterPOI(poi: any): { remove: boolean; reason?: string } {
  const props = poi.tags || {};
  const name = (props.name || "").trim();
  const nameLower = name.toLowerCase();

  const hasWikipedia = !!props.wikipedia;
  const hasHistoric = !!props.historic;
  const hasHeritage = !!props.heritage;
  const hasWikidata = !!props.wikidata;
  
  // Elite Fame Indicator
  const isFamous = hasWikipedia || hasHeritage || hasHistoric || hasWikidata;
  const hasReference = hasWikipedia || hasWikidata;

  if (!name) return { remove: true, reason: "Strict: Local sem nome" };

  // 1. GLOBAL BLOCKLIST WITH EXCEPTIONS
  for (const term of FILTER_CONFIG.GLOBAL_BLOCKLIST) {
    if (nameLower.includes(term)) {
      // Exception: "Center" or "Centro" allowed for Famous or Cultural spots (Museums/Attractions)
      if (term === "center" || term === "centro") {
        const isCultural = props.tourism === "museum" || props.tourism === "attraction";
        if (isFamous || (isCultural && props.tourism !== "information")) continue;
      }

      // Exception: "Horta" allowed if Famous/Attraction
      if (term === "horta" && (isFamous || props.tourism === "attraction")) continue;

      // Special rule for Shopping: Always remove unless it has massive fame (Wikipedia)
      if (term === "shopping" && !hasWikipedia) {
         return { remove: true, reason: "Blacklist: Shopping Center genérico" };
      }

      return { remove: true, reason: `Blacklist: Termo proibido '${term}'` };
    }
  }

  // 2. RELIGIOUS FRANCHISES
  if (FILTER_CONFIG.RELIGIOUS_BRANDS.some((b) => nameLower.includes(b)) || nameLower === "universal") {
    if (props.amenity === "place_of_worship" && !isFamous) {
      return { remove: true, reason: "Blacklist: Marca religiosa genérica" };
    }
  }

  // 3. PRIVATE RESIDENCES
  if (nameLower.startsWith("residência") || nameLower.startsWith("residencia")) {
    if (!isFamous && props.tourism !== "museum") {
      return { remove: true, reason: "Category: Residência privada sem valor histórico" };
    }
  }

  // 4. BOUNDARIES & DISTRICTS
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

  // 5. NATURAL PEAKS
  if (props.natural === "peak" && !isFamous && !props.tourism) {
    return { remove: true, reason: "Category: Pico geográfico sem relevância (sem Wiki)" };
  }

  // 6. PRIVATE / RESIDENTIAL BUILDINGS
  const isPrivate = props["operator:type"] === "private" || props.access === "private";
  const isResidential = props.building === "apartments" || props.residential === "yes";
  if ((isPrivate || isResidential) && !isFamous) {
    return { remove: true, reason: "Category: Privado/Residencial sem fama" };
  }

  // 7. LEISURE & PARKS
  if (props.leisure) {
    if (FILTER_CONFIG.UTILITARIAN_LEISURE.includes(props.leisure)) return { remove: true, reason: "Category: Lazer utilitário" };

    const isPark = ["park", "garden", "nature_reserve"].includes(props.leisure);
    if (isPark) {
      if (nameLower.includes("shopping")) return { remove: true, reason: "Blacklist: Shopping tagged as Park" };

      const hasGenericName = FILTER_CONFIG.GENERIC_PARK_NAMES.some((t) => nameLower.includes(t));
      if (hasGenericName && !isFamous && !props.tourism) {
        return { remove: true, reason: "Category: Praça/Plaza comum" };
      }

      // Small points that are not areas or famous
      if (poi.type === "node" && !isFamous && !props.tourism) {
        return { remove: true, reason: "Category: Ponto de lazer menor" };
      }
    }
  }

  // 8. ACCOMMODATION
  if (FILTER_CONFIG.ACCOMMODATION_TYPES.includes(props.tourism)) {
    if (props.tourism === "apartment") return { remove: true, reason: "Category: Apartamento" };
    if (!isFamous) return { remove: true, reason: "Category: Hotel comum (sem Wiki/Histórico)" };
  }

  // 9. ATTRACTIONS & ART
  const attractionTypes = ["attraction", "artwork", "gallery", "picnic_site", "viewpoint"];
  if (attractionTypes.includes(props.tourism)) {
    if (props.memorial === "ghost_bike") return { remove: true, reason: "Category: Memorial Ghost Bike" };
    if (["lighthouse", "windmill"].includes(props.man_made)) return { remove: false };

    if (!isFamous && !["museum", "theme_park", "zoo"].includes(props.tourism)) {
      return { remove: true, reason: "Category: Atração/Arte/Mirante sem Wikipedia/Histórico" };
    }
  }

  // 10. RELIGION
  if (props.amenity === "place_of_worship") {
    const isCatholic = ["catholic", "roman_catholic"].includes(props.denomination);
    const isAdventist = props.denomination === "adventist" || nameLower.includes("adventista");
    
    if (nameLower.startsWith("comunidade") || nameLower.startsWith("salão") || nameLower.startsWith("salao")) {
      if (!isFamous) return { remove: true, reason: "Category: Comunidade de bairro" };
    }

    if (!isCatholic && !isAdventist && !isFamous) {
      return { remove: true, reason: "Category: Religião local" };
    }
  }

  // 11. COMMERCIAL & SERVICES
  const commercialAmenities = ["bank", "pharmacy", "school", "hospital", "restaurant", "cafe", "bar", "fast_food", "fuel", "parking", "townhall", "courthouse", "library", "post_office"];
  const otherCommercial = ["shop", "office", "craft", "industrial"];

  if (commercialAmenities.includes(props.amenity) || props.amenity === "marketplace" || otherCommercial.some((t) => !!props[t])) {
    if (props.amenity === "marketplace") {
      const isMunicipal = ["municipal", "mercadão", "mercadao"].some(t => nameLower.includes(t));
      if (!isFamous && !isMunicipal) return { remove: true, reason: "Category: Mercado local sem fama/municipal" };
      return { remove: false };
    }
    if (props.amenity === "townhall") return { remove: false };
    if (!isFamous && props.tourism !== "museum") return { remove: true, reason: "Category: Comércio/Serviço sem fama" };
  }

  // 12. TOURIST INFORMATION
  if (props.tourism === "information" && !isFamous) {
    return { remove: true, reason: "Category: Informação turística sem fama" };
  }

  // 13. INFRASTRUCTURE
  if (["tower", "water_tower"].includes(props.man_made) && !isFamous && !props.tourism && !props.historic && !hasReference) {
    return { remove: true, reason: "Category: Torre/Infraestrutura sem valor" };
  }

  // 14. SINGLE WORD CHECK
  const words = name.split(/\s+/).filter((w: string) => w.length > 0);
  if (words.length === 1) {
    if (hasReference || FILTER_CONFIG.SINGLE_WORD_WHITELIST.includes(nameLower)) return { remove: false };
    return { remove: true, reason: "Strict: Nome de palavra única sem referência" };
  }

  return { remove: false };
}

async function main() {
  const args = Deno.args;
  const lat = parseFloat(args[0]) || LAT;
  const lon = parseFloat(args[1]) || LON;
  const radius = parseFloat(args[2]) || RADIUS;

  try {
    const data = await fetchFromOverpass(lat, lon, radius);
    const elements = data.elements || [];

    console.log(`📊 Fetched ${elements.length} elements from Overpass.`);

    const filtered = elements.map((el: any) => {
      const status = shouldFilterPOI(el);
      return {
        id: el.id,
        type: el.type,
        name: el.tags?.name || "Unnamed",
        lat: el.lat || el.center?.lat || 0,
        lon: el.lon || el.center?.lon || 0,
        tags: el.tags,
        ...status,
      };
    }).filter((r: any) => r && !r.remove);

    // Deduplication
    const kept: any[] = [];
    const removedByDeduplication: any[] = [];

    const sorted = filtered.sort((a: any, b: any) => {
      const p: Record<string, number> = { "relation": 1, "way": 2, "node": 3 };
      return p[a.type] - p[b.type];
    });

    for (const current of sorted) {
      const isDuplicate = kept.some((existing: any) => {
        const nameA = current.name.toLowerCase();
        const nameB = existing.name.toLowerCase();
        const isSimilar = nameA.includes(nameB) || nameB.includes(nameA);
        const radiusLimit = (current.tags?.boundary === "administrative" && existing.tags?.boundary === "administrative") ? 0.1 : 0.002;
        
        if (isSimilar) {
          const distLat = Math.abs(current.lat - existing.lat);
          const distLon = Math.abs(current.lon - existing.lon);
          return distLat < radiusLimit && distLon < radiusLimit;
        }
        return false;
      });

      if (isDuplicate) {
        removedByDeduplication.push({ ...current, remove: true, reason: "Deduplicação" });
      } else {
        kept.push(current);
      }
    }

    const removed = elements.map((el: any) => {
      const status = shouldFilterPOI(el);
      if (status.remove) return { name: el.tags?.name || "Unnamed", ...status };
      return null;
    }).filter((r: any): r is { name: string; remove: boolean; reason?: string } => !!r).concat(removedByDeduplication);

    console.log(`\n✅ KEPT: ${kept.length} | ❌ REMOVED: ${removed.length}`);
    kept.slice(0, 10).forEach(r => console.log(` - ${r.name}`));

    const result = {
      timestamp: new Date().toISOString(),
      location: { lat, lon, radius },
      summary: { total: elements.length, kept: kept.length, removed: removed.length },
      kept,
      removed,
    };

    const filename = `output/overpass-test-${Date.now()}.json`;
    await Deno.mkdir("output", { recursive: true });
    await Deno.writeTextFile(filename, JSON.stringify(result, null, 2));
    console.log(`\n💾 Saved to: ${filename}`);
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : String(error));
  }
}

main();

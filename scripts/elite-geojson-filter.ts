import fs from 'fs';
import readline from 'readline';

/**
 * ELITE GEOJSON FILTER
 * 
 * Uma única passada robusta sobre um arquivo GeoJSON Sequence para filtragem de POIs.
 * 
 * Requisitos:
 * - O arquivo de entrada deve ser GeoJSONSeq (um objeto JSON por linha).
 *   (Converter de PBF para GeoJSONSeq usando: osmium export file.pbf -f geojsonseq -o file.geojson)
 */

const FILTER_CONFIG = {
  // Categorias que barramos totalmente a menos que sejam famosos (Wiki/Wikidata)
  TAG_BLOCKLIST: [
    'bench', 'waste_basket', 'trash_can', 'telephone', 'bicycle_parking', 
    'parking', 'path', 'track', 'fence', 'wall', 'hedge', 'pole', 'post',
    'surveillance', 'vending_machine', 'atm', 'recycling', 'toilets', 
    'outdoor_seating', 'waste_disposal', 'picnic_table', 'steps',
    'resort', 'beach_resort',
    // Serviços e Comércio Local (Bloqueio Elite - se não for famoso, sai)
    'supermarket', 'convenience', 'bakery', 'laundry', 'dry_cleaning',
    'hairdresser', 'beauty', 'dentist', 'veterinary', 'car_repair', 'car_wash',
    'fuel', 'bank', 'pharmacy', 'atm', 'fast_food', 'food_court',
    'restaurant', 'cafe', 'pub', 'bar', 'ice_cream', 'nightclub', 'dance', 'studio',
    'fitness_centre', 'sports_centre', 'swimming_pool', 'camp_site', 'love_hotel',
    'car_rental', 'bicycle_rental', 'fishing', 'public_bath', 'cinema', 'theatre',
    'information', 'chalet', 'events_venue', 'theme_park', 'picnic_site', 'horse_riding',
    // Infraestrutura e Administração
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
    // Nível 3 - Residencial/Social/Lixo final
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
    "banco", "caixa", "atm", "lotérica", "correio", "post office",
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
  ]
};

function shouldKeepPOI(poi: any): { keep: boolean; reason?: string } {
  const props = poi.properties || {};
  const name = (props.name || "").trim();
  const nameLower = name.toLowerCase();

  // --- 1. FILTROS DE EXCLUSÃO (CRITICAL BLOCK) ---
  
  // Sem nome? Junk record.
  if (!name || name.length < 2) return { keep: false, reason: "Sem nome" };

  // 1.1 Categoria Proibida (Blacklist técnica - BLOQUEIA MESMO COM WIKI)
  const tagValues = [
    props.amenity, props.tourism, props.leisure, 
    props.man_made, props.historic, props.highway, 
    props.public_transport, props.place, props.office, props.shop
  ];
  
  // Lógica para lidar com tags compostas (ex: park;pitch)
  for (const rawValue of tagValues) {
    if (!rawValue) continue;
    const individualTags = String(rawValue).split(';');
    if (individualTags.some(t => FILTER_CONFIG.TAG_BLOCKLIST.includes(t.trim()))) {
      return { keep: false, reason: `Categoria Blacklist Crítica: ${rawValue}` };
    }
  }

  // 1.2 Nome com termo proibido
  if (FILTER_CONFIG.NAME_BLOCKLIST.some(term => nameLower.includes(term))) {
    return { keep: false, reason: "Nome contém termo proibido" };
  }

  // --- 2. INDICADORES DE ELITE (PROMINÊNCIA) ---
  const hasWikipedia = !!props.wikipedia;
  const hasWikidata = !!props.wikidata;
  const isHistoric = !!props.historic || !!props.heritage;
  const isPlaceOfWorship = props.amenity === 'place_of_worship';
  const hasReference = hasWikipedia || hasWikidata;
  const isFamous = hasReference || isHistoric;

  // 2.1 Verificação de Categoria Restrita (SÓ passa se for HISTÓRICO)
  const primaryTags = [props.amenity, props.tourism, props.leisure, props.man_made, props.historic];
  const isUtility = primaryTags.some(t => FILTER_CONFIG.RESTRICTED_UTILITY_TAGS.includes(t));

  if (isUtility) {
    if (isHistoric) return { keep: true };
    return { keep: false, reason: "Utilitário: Requer tag historic/heritage para passar" };
  }

  // 2.2 REGRA DE OURO
  if (isFamous) return { keep: true };

  // --- 3. FILTROS DE EXCLUSÃO ADICIONAIS ---

  // 3.3 Franquias Religiosas Genéricas (Sem wiki)
  if (isPlaceOfWorship && FILTER_CONFIG.RELIGIOUS_BRANDS.some(b => nameLower.includes(b))) {
    return { keep: false, reason: "Marca religiosa genérica" };
  }

  // 3.4 Acomodações Genéricas (Sem wiki)
  const isAcc = ["hotel", "hostel", "pousada", "albergo", "b&b"].some(k => nameLower.includes(k)) || 
                ["hotel", "hostel", "apartment", "motel", "guest_house"].includes(props.tourism);
  if (isAcc) return { keep: false, reason: "Acomodação comercial sem fama" };

  // 3.5 Termos utilitários no lazer
  if (["pitch", "track", "fitness_station", "playground", "dog_park", "swimming_pool"].includes(props.leisure)) {
    return { keep: false, reason: "Lazer utilitário (quadras/playgrounds)" };
  }

  return { keep: true };
}

async function runEliteFilter(inputPath: string, outputPath: string) {
  console.log(`--- ELITE FILTER START ---`);
  console.log(`Input: ${inputPath}`);
  console.log(`Output: ${outputPath}`);

  const fileStream = fs.createReadStream(inputPath);
  const outStream = fs.createWriteStream(outputPath);
  
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let processed = 0;
  let kept = 0;
  let removed = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    
    try {
      let cleanLine = line.trim();
      // Remove o caractere RS (Record Separator, 0x1e) que o osmium export adiciona no início de cada linha
      if (cleanLine.startsWith('\x1e')) {
        cleanLine = cleanLine.substring(1);
      }
      
      if (!cleanLine) continue;
      
      const poi = JSON.parse(cleanLine);
      const result = shouldKeepPOI(poi);
      
      if (result.keep) {
        outStream.write(JSON.stringify(poi) + '\n');
        kept++;
      } else {
        removed++;
      }
      
      processed++;
      if (processed % 10000 === 0) {
        console.log(`Processed: ${processed} | Kept: ${kept} | Removed: ${removed}`);
      }
    } catch (err) {
      console.error(`Erro ao processar linha ${processed + 1}:`, err);
      // Log only first 100 chars of problematic line
      console.error(`Conteúdo da linha: ${line.substring(0, 100)}...`);
    }
  }

  console.log(`\n--- FINAL REPORT ---`);
  console.log(`Total Processed: ${processed}`);
  console.log(`Total Kept: ${kept}`);
  console.log(`Total Removed: ${removed}`);
  console.log(`Success! File saved at ${outputPath}`);
}

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log("Uso: npx tsx scripts/elite-geojson-filter.ts <input.geojsonseq> <output.geojsonseq>");
} else {
  runEliteFilter(args[0], args[1]);
}

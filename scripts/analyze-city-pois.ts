#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-net

/**
 * Analyze POIs city by city from Phase 1 filtered file
 * 
 * Flow:
 * 1. Run Phase 1 filter (categories) if not already done
 * 2. List cities from Phase 1 filtered file
 * 3. Choose a city
 * 4. Extract POIs from that city
 * 5. Convert to GeoJSON/CSV for POI-by-POI analysis
 * 
 * Usage:
 *   deno run scripts/analyze-city-pois.ts <input-pbf> [--phase1-file <file>] [--city "City Name"] [--list-only]
 * 
 * Examples:
 *   # List cities from Phase 1 filtered file
 *   deno run scripts/analyze-city-pois.ts omsData/sudeste-251012.osm.pbf --phase1-file output/etapa1-categories-*.osm.pbf --list-only
 * 
 *   # Analyze a specific city
 *   deno run scripts/analyze-city-pois.ts omsData/sudeste-251012.osm.pbf --city "Bragança Paulista"
 */

import { PBFProcessor } from "../plugins/osm-geojson-filter/lib/pbf-processor.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";

// ETAPA 1: Categories from filter-pbf-tourism.ts
const ETAPA1_TAGS = [
  // Tourism categories
  "tourism=attraction",
  "tourism=museum",
  "tourism=artwork",
  "tourism=viewpoint",
  "tourism=theme_park",
  "tourism=zoo",
  "tourism=aquarium",
  "tourism=yes",
  // Historic categories
  "historic=monument",
  "historic=castle",
  "historic=church",
  "historic=memorial",
  "historic=ruins",
  "historic=archaeological_site",
  "historic=fort",
  "historic=tomb",
  "historic=wayside_shrine",
  "historic=train_station",
  "historic=building",
  "historic=house",
  "historic=bridge",
  "historic=yes",
  // Natural categories
  "natural=water",
  "natural=wood",
  "natural=beach",
  "natural=cliff",
  "natural=cave",
  "natural=tree",
  "natural=volcano",
  "natural=waterfall",
  "natural=geyser",
  "natural=hot_spring",
  "natural=peak",
  // Leisure categories
  "leisure=park",
  "leisure=stadium",
  // Other categories
  "aeroway=aerodrome",
  "amenity=theatre"
];

interface City {
  name: string;
  place: string;
  state?: string;
  latitude?: number;
  longitude?: number;
}

async function runPhase1(inputPath: string, outputDir: string): Promise<string> {
  console.log("📋 ETAPA 1: Filtrando por Categorias de Interesse");
  console.log("=".repeat(60));
  console.log(`📁 Input: ${inputPath}`);
  console.log(`🎯 Tags: ${ETAPA1_TAGS.length} categorias`);
  console.log("");

  const processor = new PBFProcessor(outputDir);
  
  const hasOsmium = await processor.checkOsmiumTool();
  if (!hasOsmium) {
    throw new Error("osmium-tool não encontrado! Instale com: brew install osmctools");
  }

  // Extract tags
  const etapa1Path = await processor.extractTags(inputPath, ETAPA1_TAGS, true); // true = omitReferenced
  
  // Re-filter for precision
  const reFilteredPath = await processor.extractTags(etapa1Path, ETAPA1_TAGS, true);
  
  const timestamp = Date.now();
  const etapa1FinalPath = join(outputDir, `etapa1-categories-${timestamp}.osm.pbf`);
  await Deno.rename(reFilteredPath, etapa1FinalPath);
  
  console.log(`✅ ETAPA 1 concluída: ${etapa1FinalPath}`);
  console.log("");
  
  // Show file info
  await processor.getFileInfo(etapa1FinalPath);
  console.log("");
  
  return etapa1FinalPath;
}

async function listCities(phase1File: string): Promise<City[]> {
  console.log("📋 Listando cidades do arquivo da Fase 1...");
  console.log(`📁 Arquivo: ${phase1File}`);
  console.log("");
  
  const processor = new PBFProcessor("output");
  
  // Extract cities
  await processor.extractTags(phase1File, [
    "place=city",
    "place=town",
    "place=municipality"
  ], false);

  // Find latest file
  const files = await Array.fromAsync(Deno.readDir("output"));
  const cityFiles = files
    .filter(f => f.name.startsWith("filtered-") && f.name.endsWith(".osm.pbf"))
    .sort((a, b) => b.name.localeCompare(a.name));
  
  if (cityFiles.length === 0) {
    throw new Error("Nenhuma cidade encontrada");
  }

  const latestCityFile = join("output", cityFiles[0].name);
  const tempGeoJSON = join("output", `temp-cities-${Date.now()}.geojson`);
  
  await processor.convertToGeoJSONHighQuality(latestCityFile, tempGeoJSON);
  
  const geojsonContent = await Deno.readTextFile(tempGeoJSON);
  const geojson = JSON.parse(geojsonContent);
  
  const cities: City[] = [];
  const seen = new Set<string>();

  for (const feature of geojson.features) {
    const props = feature.properties || {};
    const name = props.name;
    const place = props.place;

    if (!name || !place) continue;

    const key = `${name}|${place}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let latitude: number | undefined;
    let longitude: number | undefined;

    if (feature.geometry?.type === "Point" && feature.geometry.coordinates) {
      longitude = feature.geometry.coordinates[0];
      latitude = feature.geometry.coordinates[1];
    }

    cities.push({
      name,
      place,
      state: props["addr:state"] || props["is_in:state"],
      latitude,
      longitude
    });
  }

  // Cleanup
  try {
    await Deno.remove(latestCityFile);
    await Deno.remove(tempGeoJSON);
  } catch {
    // Ignore
  }

  cities.sort((a, b) => a.name.localeCompare(b.name));
  return cities;
}

async function getCityBounds(cityName: string, state?: string): Promise<{ north: number; south: number; east: number; west: number } | null> {
  const query = state 
    ? `${cityName}, ${state}, Brasil`
    : `${cityName}, Brasil`;
  
  console.log(`🔍 Buscando coordenadas para: ${query}`);
  
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Tuggi-CMS-OSM-Filter/1.0'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Nominatim API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data || data.length === 0) {
      console.error(`❌ Cidade não encontrada: ${query}`);
      return null;
    }
    
    const place = data[0];
    const bbox = place.boundingbox;
    
    const bounds = {
      south: parseFloat(bbox[0]),
      north: parseFloat(bbox[1]),
      west: parseFloat(bbox[2]),
      east: parseFloat(bbox[3])
    };
    
    console.log(`✅ Cidade encontrada: ${place.display_name}`);
    console.log(`📊 Bounding box: [${bounds.south}, ${bounds.west}] a [${bounds.north}, ${bounds.east}]`);
    
    return bounds;
  } catch (error) {
    console.error(`❌ Erro ao buscar coordenadas: ${error.message}`);
    return null;
  }
}

async function extractCityPOIs(phase1File: string, cityName: string, state?: string): Promise<void> {
  console.log(`🏙️  Extraindo POIs da cidade: ${cityName}`);
  console.log("=".repeat(60));
  
  const processor = new PBFProcessor("output");
  
  // 1. Get city bounds
  const bounds = await getCityBounds(cityName, state);
  if (!bounds) {
    throw new Error(`Não foi possível obter bounds para ${cityName}`);
  }
  
  // 2. Extract city data from Phase 1 file
  console.log("");
  console.log("🔍 Extraindo dados da cidade do arquivo da Fase 1...");
  const cityPBF = await processor.extractByBounds(phase1File, bounds);
  console.log(`✅ Dados extraídos: ${cityPBF}`);
  
  // 3. Convert to GeoJSON
  console.log("");
  console.log("📊 Convertendo para GeoJSON...");
  const cityNameSanitized = cityName.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
  const cityGeoJSON = join("output", `${cityNameSanitized}-pois.geojson`);
  await processor.convertToGeoJSONHighQuality(cityPBF, cityGeoJSON);
  
  // 4. Convert to CSV
  console.log("");
  console.log("📊 Convertendo para CSV...");
  const cityCSV = join("output", `${cityNameSanitized}-pois.csv`);
  
  // Use existing script
  const convertScript = join(Deno.cwd(), "scripts", "geojson-to-csv.ts");
  const convertCmd = new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-write", convertScript, cityGeoJSON, cityCSV]
  });
  
  const { code } = await convertCmd.output();
  if (code !== 0) {
    console.warn("⚠️  Falha ao converter para CSV (continuando...)");
  }
  
  // 5. Show statistics
  console.log("");
  console.log("📊 Estatísticas dos POIs:");
  
  const geojsonContent = await Deno.readTextFile(cityGeoJSON);
  const geojson = JSON.parse(geojsonContent);
  
  if (!geojson.features || !Array.isArray(geojson.features)) {
    throw new Error("Formato GeoJSON inválido");
  }
  
  const totalPOIs = geojson.features.length;
  console.log(`   Total de POIs: ${totalPOIs}`);
  
  // Count by category
  const categoryCounts = new Map<string, number>();
  geojson.features.forEach((feature: any) => {
    const props = feature.properties || {};
    const category = props.tourism || props.historic || props.natural || props.leisure || props.aeroway || props.amenity || "outro";
    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
  });
  
  console.log("");
  console.log("   Por categoria:");
  Array.from(categoryCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([category, count]) => {
      console.log(`     ${category}: ${count}`);
    });
  
  // Count with names
  const withNames = geojson.features.filter((f: any) => f.properties?.name).length;
  console.log("");
  console.log(`   POIs com nome: ${withNames} (${Math.round(withNames / totalPOIs * 100)}%)`);
  
  console.log("");
  console.log("✅ Extração concluída!");
  console.log(`📁 Arquivos gerados:`);
  console.log(`   GeoJSON: ${cityGeoJSON}`);
  console.log(`   CSV: ${cityCSV}`);
  console.log("");
  console.log("💡 Você pode agora:");
  console.log(`   1. Abrir o CSV e analisar POI a POI`);
  console.log(`   2. Verificar quais POIs são realmente turísticos`);
  console.log(`   3. Identificar POIs que devem ser removidos`);
}

async function main() {
  const args = Deno.args;
  
  if (args.length < 1) {
    console.error("❌ Uso incorreto!");
    console.log("");
    console.log("Uso:");
    console.log("  deno run scripts/analyze-city-pois.ts <input-pbf> [--phase1-file <file>] [--city \"City Name\"] [--list-only]");
    console.log("");
    console.log("Exemplos:");
    console.log('  # Executar Fase 1 e listar cidades');
    console.log('  deno run scripts/analyze-city-pois.ts omsData/sudeste-251012.osm.pbf --list-only');
    console.log("");
    console.log('  # Usar arquivo da Fase 1 já existente e listar cidades');
    console.log('  deno run scripts/analyze-city-pois.ts omsData/sudeste-251012.osm.pbf --phase1-file output/etapa1-categories-*.osm.pbf --list-only');
    console.log("");
    console.log('  # Analisar cidade específica');
    console.log('  deno run scripts/analyze-city-pois.ts omsData/sudeste-251012.osm.pbf --city "Bragança Paulista"');
    Deno.exit(1);
  }

  const inputFile = args[0];
  const listOnly = args.includes("--list-only");
  const cityIndex = args.indexOf("--city");
  const cityName = cityIndex >= 0 && cityIndex < args.length - 1 ? args[cityIndex + 1] : null;
  const phase1Index = args.indexOf("--phase1-file");
  const phase1FileArg = phase1Index >= 0 && phase1Index < args.length - 1 ? args[phase1Index + 1] : null;

  // Check if file exists
  try {
    await Deno.stat(inputFile);
  } catch {
    console.error(`❌ Arquivo não encontrado: ${inputFile}`);
    Deno.exit(1);
  }

  const processor = new PBFProcessor("output");
  
  const hasOsmium = await processor.checkOsmiumTool();
  if (!hasOsmium) {
    console.error("❌ osmium-tool não encontrado!");
    processor.printRecommendations();
    Deno.exit(1);
  }

  // Determine Phase 1 file
  let phase1File: string;
  
  if (phase1FileArg) {
    // Use provided file (handle wildcards)
    if (phase1FileArg.includes("*")) {
      // Find latest file matching pattern
      const files = await Array.fromAsync(Deno.readDir("output"));
      const matchingFiles = files
        .filter(f => f.name.startsWith("etapa1-categories-") && f.name.endsWith(".osm.pbf"))
        .sort((a, b) => b.name.localeCompare(a.name));
      
      if (matchingFiles.length === 0) {
        console.error("❌ Nenhum arquivo da Fase 1 encontrado!");
        Deno.exit(1);
      }
      
      phase1File = join("output", matchingFiles[0].name);
      console.log(`📁 Usando arquivo da Fase 1: ${phase1File}`);
    } else {
      phase1File = phase1FileArg;
    }
  } else {
    // Run Phase 1
    console.log("🚀 Executando Fase 1 (filtrando por categorias)...");
    console.log("");
    try {
      phase1File = await runPhase1(inputFile, "output");
    } catch (error) {
      console.error(`❌ Erro na Fase 1: ${error.message}`);
      Deno.exit(1);
    }
  }

  if (listOnly) {
    // Just list cities
    try {
      const cities = await listCities(phase1File);
      console.log("");
      console.log(`✅ ${cities.length} cidades encontradas:`);
      console.log("");
      cities.forEach((city, i) => {
        console.log(`   ${i + 1}. ${city.name}${city.state ? ` (${city.state})` : ""} - ${city.place}`);
      });
    } catch (error) {
      console.error(`❌ Erro: ${error.message}`);
      Deno.exit(1);
    }
  } else if (cityName) {
    // Extract and analyze city POIs
    try {
      await extractCityPOIs(phase1File, cityName);
    } catch (error) {
      console.error(`❌ Erro: ${error.message}`);
      Deno.exit(1);
    }
  } else {
    console.error("❌ Você deve especificar --list-only ou --city \"Nome da Cidade\"");
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}


#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-net

/**
 * Process PBF file city by city
 * 
 * This script:
 * 1. Lists all cities in the PBF file
 * 2. Allows filtering by city name
 * 3. Processes each city individually with tourism filter
 * 
 * Usage:
 *   deno run scripts/process-city-by-city.ts <input-pbf> [--city "City Name"] [--list-only]
 * 
 * Example:
 *   deno run scripts/process-city-by-city.ts omsData/sudeste-251012.osm.pbf --list-only
 *   deno run scripts/process-city-by-city.ts omsData/sudeste-251012.osm.pbf --city "Bragança Paulista"
 */

import { PBFProcessor } from "../plugins/osm-geojson-filter/lib/pbf-processor.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";

interface City {
  name: string;
  place: string;
  state?: string;
  latitude?: number;
  longitude?: number;
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

async function listCities(inputPath: string): Promise<City[]> {
  console.log("📋 Listando cidades do PBF...");
  
  const processor = new PBFProcessor("output");
  
  // Extrair cidades
  await processor.extractTags(inputPath, [
    "place=city",
    "place=town",
    "place=municipality"
  ], false);

  // Encontrar arquivo mais recente
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

  // Limpar temporários
  try {
    await Deno.remove(latestCityFile);
    await Deno.remove(tempGeoJSON);
  } catch {
    // Ignorar
  }

  cities.sort((a, b) => a.name.localeCompare(b.name));
  return cities;
}

async function processCity(inputPath: string, cityName: string, state?: string): Promise<void> {
  console.log(`🏙️  Processando cidade: ${cityName}`);
  console.log("=".repeat(60));
  
  const processor = new PBFProcessor("output");
  
  // 1. Obter bounds da cidade
  const bounds = await getCityBounds(cityName, state);
  if (!bounds) {
    throw new Error(`Não foi possível obter bounds para ${cityName}`);
  }
  
  // 2. Extrair dados da cidade do PBF
  console.log("");
  console.log("🔍 Extraindo dados da cidade do PBF...");
  const cityPBF = await processor.extractByBounds(inputPath, bounds);
  console.log(`✅ Dados extraídos: ${cityPBF}`);
  
  // 3. Remover highways e power
  console.log("");
  console.log("🗑️  Removendo highways e power...");
  const noHighwaysPBF = join("output", `city-${Date.now()}-no-highways.osm.pbf`);
  
  // Inverter match para remover highways e power
  await processor.extractTags(cityPBF, ["highway", "power"], false, true);
  
  // Encontrar arquivo mais recente
  const files = await Array.fromAsync(Deno.readDir("output"));
  const filteredFiles = files
    .filter(f => f.name.startsWith("filtered-") && f.name.endsWith(".osm.pbf"))
    .sort((a, b) => b.name.localeCompare(a.name));
  
  if (filteredFiles.length === 0) {
    throw new Error("Falha ao remover highways/power");
  }
  
  const noHighwaysFile = join("output", filteredFiles[0].name);
  
  // 4. Aplicar filtro de turismo
  console.log("");
  console.log("🎯 Aplicando filtro de turismo...");
  
  const tourismTags = [
    "name",
    "leisure",
    "aeroway",
    "tourism",
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
    "natural",
    "water",
    "waterway"
  ];
  
  const filesToMerge: string[] = [];
  
  // Extrair diferentes categorias
  for (const tag of ["name", "leisure", "aeroway", "tourism"]) {
    const path = await processor.extractTags(noHighwaysFile, [tag], false);
    filesToMerge.push(path);
  }
  
  // Extrair natural importantes
  const naturalTags = ["natural=water", "natural=wood", "natural=beach", "natural"];
  const tempNatural = await processor.extractTags(noHighwaysFile, naturalTags, false);
  const naturalImportant = await processor.extractTags(tempNatural, ["name", "wikipedia", "wikidata", "description", "website", "tourism", "historic"], false);
  filesToMerge.push(naturalImportant);
  
  // Extrair water importantes
  const waterTags = ["water", "waterway"];
  const tempWater = await processor.extractTags(noHighwaysFile, waterTags, false);
  const waterImportant = await processor.extractTags(tempWater, ["name", "wikipedia", "wikidata", "description", "website", "tourism", "historic"], false);
  filesToMerge.push(waterImportant);
  
  // 5. Merge final
  console.log("");
  console.log("🔀 Fazendo merge final...");
  const cityNameSanitized = cityName.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
  const finalPBF = join("output", `${cityNameSanitized}-tourism-${Date.now()}.osm.pbf`);
  await processor.mergeFiles(filesToMerge, finalPBF);
  
  // 6. Converter para GeoJSON e CSV
  console.log("");
  console.log("📊 Convertendo para GeoJSON...");
  const finalGeoJSON = join("output", `${cityNameSanitized}-tourism.geojson`);
  await processor.convertToGeoJSONHighQuality(finalPBF, finalGeoJSON);
  
  console.log("");
  console.log("📊 Convertendo para CSV...");
  const finalCSV = join("output", `${cityNameSanitized}-tourism.csv`);
  
  // Usar script existente para converter
  const convertScript = join(Deno.cwd(), "scripts", "geojson-to-csv.ts");
  const convertCmd = new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-write", convertScript, finalGeoJSON, finalCSV]
  });
  
  const { code } = await convertCmd.output();
  if (code !== 0) {
    console.warn("⚠️  Falha ao converter para CSV (continuando...)");
  }
  
  console.log("");
  console.log("✅ Processamento concluído!");
  console.log(`📁 Arquivos gerados:`);
  console.log(`   PBF: ${finalPBF}`);
  console.log(`   GeoJSON: ${finalGeoJSON}`);
  console.log(`   CSV: ${finalCSV}`);
}

async function main() {
  const args = Deno.args;
  
  if (args.length < 1) {
    console.error("❌ Uso incorreto!");
    console.log("");
    console.log("Uso:");
    console.log("  deno run scripts/process-city-by-city.ts <input-pbf> [--city \"City Name\"] [--list-only]");
    console.log("");
    console.log("Exemplos:");
    console.log('  deno run scripts/process-city-by-city.ts omsData/sudeste-251012.osm.pbf --list-only');
    console.log('  deno run scripts/process-city-by-city.ts omsData/sudeste-251012.osm.pbf --city "Bragança Paulista"');
    Deno.exit(1);
  }

  const inputFile = args[0];
  const listOnly = args.includes("--list-only");
  const cityIndex = args.indexOf("--city");
  const cityName = cityIndex >= 0 && cityIndex < args.length - 1 ? args[cityIndex + 1] : null;

  // Verificar se arquivo existe
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

  if (listOnly) {
    // Apenas listar cidades
    try {
      const cities = await listCities(inputFile);
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
    // Processar cidade específica
    try {
      await processCity(inputFile, cityName);
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


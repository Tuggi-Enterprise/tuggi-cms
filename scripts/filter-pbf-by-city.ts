#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-net

/**
 * Filter PBF file by city boundary
 * 
 * Extracts OSM data for a specific city using bounding box
 * 
 * Usage:
 *   deno run scripts/filter-pbf-by-city.ts <input-pbf> <city-name>
 *   deno run scripts/filter-pbf-by-city.ts <input-pbf> --bbox <west>,<south>,<east>,<north>
 * 
 * Example:
 *   deno run scripts/filter-pbf-by-city.ts omsData/sudeste-251012.osm.pbf "Bragança Paulista, SP, Brasil"
 *   deno run scripts/filter-pbf-by-city.ts omsData/sudeste-251012.osm.pbf --bbox -46.6,-23.2,-46.5,-23.1
 */

import { PBFProcessor } from "../plugins/osm-geojson-filter/lib/pbf-processor.ts";

/**
 * Get city bounding box from Nominatim
 */
async function getCityBounds(cityName: string): Promise<{ north: number; south: number; east: number; west: number } | null> {
  console.log(`🔍 Buscando coordenadas para: ${cityName}`);
  
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityName)}&format=json&limit=1&polygon_geojson=1`;
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
      console.error(`❌ Cidade não encontrada: ${cityName}`);
      return null;
    }
    
    const place = data[0];
    const bbox = place.boundingbox; // [south, north, west, east]
    
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

/**
 * Parse bounding box from string
 */
function parseBbox(bboxString: string): { north: number; south: number; east: number; west: number } | null {
  const parts = bboxString.split(',').map(p => parseFloat(p.trim()));
  
  if (parts.length !== 4 || parts.some(isNaN)) {
    console.error(`❌ Formato de bbox inválido: ${bboxString}`);
    console.log(`   Formato esperado: --bbox west,south,east,north`);
    console.log(`   Exemplo: --bbox -46.6,-23.2,-46.5,-23.1`);
    return null;
  }
  
  return {
    west: parts[0],
    south: parts[1],
    east: parts[2],
    north: parts[3]
  };
}

async function main() {
  const args = Deno.args;
  
  if (args.length < 2) {
    console.error("❌ Uso incorreto!");
    console.log("");
    console.log("Uso:");
    console.log("  deno run scripts/filter-pbf-by-city.ts <input-pbf> <city-name>");
    console.log("  deno run scripts/filter-pbf-by-city.ts <input-pbf> --bbox <west>,<south>,<east>,<north>");
    console.log("");
    console.log("Exemplos:");
    console.log('  deno run scripts/filter-pbf-by-city.ts omsData/sudeste-251012.osm.pbf "Bragança Paulista, SP, Brasil"');
    console.log("  deno run scripts/filter-pbf-by-city.ts omsData/sudeste-251012.osm.pbf --bbox -46.6,-23.2,-46.5,-23.1");
    Deno.exit(1);
  }
  
  const inputFile = args[0];
  
  // Verificar se arquivo existe
  try {
    await Deno.stat(inputFile);
  } catch {
    console.error(`❌ Arquivo não encontrado: ${inputFile}`);
    Deno.exit(1);
  }
  
  console.log("🏙️  Filtro PBF por Cidade");
  console.log("=".repeat(60));
  console.log(`📁 Arquivo de entrada: ${inputFile}`);
  console.log("");
  
  // Determinar bounds
  let bounds: { north: number; south: number; east: number; west: number } | null = null;
  
  if (args[1] === "--bbox") {
    // Usar bbox fornecido
    if (args.length < 3) {
      console.error("❌ Bbox não fornecido após --bbox");
      Deno.exit(1);
    }
    bounds = parseBbox(args[2]);
  } else {
    // Buscar bounds da cidade
    const cityName = args.slice(1).join(" ");
    bounds = await getCityBounds(cityName);
  }
  
  if (!bounds) {
    console.error("❌ Não foi possível determinar o bounding box");
    Deno.exit(1);
  }
  
  console.log("");
  console.log("🔍 Extraindo dados do PBF...");
  console.log(`   Bounding box: [${bounds.south}, ${bounds.west}] a [${bounds.north}, ${bounds.east}]`);
  console.log("");
  
  // Inicializar processor
  const processor = new PBFProcessor("output");
  
  // Verificar osmium
  const hasOsmium = await processor.checkOsmiumTool();
  if (!hasOsmium) {
    console.error("❌ osmium-tool não encontrado!");
    console.log("   Instale com: brew install osmctools (macOS) ou sudo apt-get install osmctools (Linux)");
    Deno.exit(1);
  }
  
  // Extrair por bounds
  try {
    const outputPath = await processor.extractByBounds(inputFile, bounds);
    console.log("");
    console.log("✅ Extração concluída!");
    console.log(`📁 Arquivo gerado: ${outputPath}`);
    console.log("");
    
    // Verificar arquivo gerado
    const fileInfo = await processor.getFileInfo(outputPath);
    console.log("📊 Informações do arquivo:");
    console.log(`   Tamanho: ${(fileInfo.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Nodes: ${fileInfo.objectCounts.nodes.toLocaleString()}`);
    console.log(`   Ways: ${fileInfo.objectCounts.ways.toLocaleString()}`);
    console.log(`   Relations: ${fileInfo.objectCounts.relations.toLocaleString()}`);
    
  } catch (error) {
    console.error(`❌ Erro na extração: ${error.message}`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}


#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-net

/**
 * Filter PBF file for Bragança Paulista POIs and export to CSV
 * 
 * Process:
 * 1. Apply ETAPA 1 filter (categories only)
 * 2. Filter by city (Bragança Paulista) using bounding box
 * 3. Convert to GeoJSON
 * 4. Convert to CSV
 * 
 * Usage:
 *   deno run scripts/filter-pbf-braganca-paulista-csv.ts [input-pbf] [--sem-filtro-categorias]
 * 
 * Examples:
 *   # Com filtro de categorias (apenas turismo/histórico/natural/etc)
 *   deno run scripts/filter-pbf-braganca-paulista-csv.ts omsData/sudeste-251012.osm.pbf
 * 
 *   # Sem filtro de categorias (TODOS os POIs incluindo igrejas)
 *   deno run scripts/filter-pbf-braganca-paulista-csv.ts omsData/sudeste-251012.osm.pbf --sem-filtro-categorias
 */

// @deno-types="https://deno.land/x/types/index.d.ts"
import { PBFProcessor } from "../plugins/osm-geojson-filter/lib/pbf-processor.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";

// ETAPA 1: Categories according to document
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
  "amenity=theatre",
];

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
 * Convert GeoJSON to CSV
 */
interface GeoJSONFeature {
  type: string;
  id?: string | number;
  geometry: {
    type: string;
    coordinates: number[] | number[][] | number[][][];
  };
  properties: Record<string, any>;
}

interface GeoJSON {
  type: string;
  features: GeoJSONFeature[];
}

function extractCoordinates(geometry: GeoJSONFeature['geometry']): string {
  if (!geometry || !geometry.coordinates) {
    return '';
  }

  const coords = geometry.coordinates;
  
  // Point
  if (geometry.type === 'Point' && Array.isArray(coords) && coords.length >= 2) {
    return `${coords[1]},${coords[0]}`; // lat,lng
  }
  
  // Polygon or LineString - get first coordinate
  if (Array.isArray(coords[0])) {
    if (Array.isArray(coords[0][0])) {
      // Polygon: [[[lng, lat], ...]]
      const first = coords[0][0];
      return `${first[1]},${first[0]}`; // lat,lng
    } else {
      // LineString: [[lng, lat], ...]
      const first = coords[0];
      return `${first[1]},${first[0]}`; // lat,lng
    }
  }
  
  return '';
}

function flattenProperties(props: Record<string, any>, prefix = ''): Record<string, string> {
  const flattened: Record<string, string> = {};
  
  for (const [key, value] of Object.entries(props)) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    
    if (value === null || value === undefined) {
      flattened[newKey] = '';
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      // Recursively flatten nested objects
      Object.assign(flattened, flattenProperties(value, newKey));
    } else if (Array.isArray(value)) {
      // Convert arrays to comma-separated string
      flattened[newKey] = value.map(v => String(v)).join(',');
    } else {
      flattened[newKey] = String(value);
    }
  }
  
  return flattened;
}

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

async function convertGeoJSONToCSV(geojsonPath: string, csvPath: string): Promise<void> {
  console.log("📄 Convertendo GeoJSON para CSV");
  console.log(`📁 Input: ${geojsonPath}`);
  console.log(`📁 Output: ${csvPath}`);
  console.log("");
  
  // Ler GeoJSON
  console.log("📖 Lendo arquivo GeoJSON...");
  const geojsonText = await Deno.readTextFile(geojsonPath);
  const geojson: GeoJSON = JSON.parse(geojsonText);
  
  if (!geojson.features || geojson.features.length === 0) {
    console.error("❌ Nenhuma feature encontrada no GeoJSON");
    throw new Error("No features found in GeoJSON");
  }
  
  console.log(`✅ ${geojson.features.length} features encontradas`);
  console.log("");
  
  // Coletar todos os campos possíveis
  console.log("🔍 Analisando propriedades...");
  const allFields = new Set<string>();
  
  for (const feature of geojson.features) {
    const flattened = flattenProperties(feature.properties);
    Object.keys(flattened).forEach(key => allFields.add(key));
  }
  
  // Ordenar campos (colocar campos importantes primeiro)
  const importantFields = ['name', 'tourism', 'historic', 'leisure', 'natural', 'amenity', 'aeroway', 'water', 'wikidata', 'wikipedia', 'description', 'website'];
  const otherFields = Array.from(allFields).filter(f => !importantFields.includes(f));
  const fieldOrder = [...importantFields.filter(f => allFields.has(f)), ...otherFields.sort()];
  
  // Adicionar campos de geometria e ID
  const finalFields = ['id', 'type', 'latitude', 'longitude', ...fieldOrder];
  
  console.log(`✅ ${finalFields.length - 4} propriedades encontradas`);
  console.log("");
  
  // Gerar CSV
  console.log("📝 Gerando CSV...");
  const csvLines: string[] = [];
  
  // Cabeçalho
  csvLines.push(finalFields.map(escapeCsvField).join(','));
  
  // Dados
  for (const feature of geojson.features) {
    const row: string[] = [];
    
    // ID
    const id = feature.id || '';
    row.push(escapeCsvField(String(id)));
    
    // Type
    row.push(escapeCsvField(feature.geometry?.type || ''));
    
    // Coordinates
    const coords = extractCoordinates(feature.geometry);
    const [lat, lng] = coords ? coords.split(',') : ['', ''];
    row.push(escapeCsvField(lat));
    row.push(escapeCsvField(lng));
    
    // Properties
    const flattened = flattenProperties(feature.properties);
    for (const field of fieldOrder) {
      row.push(escapeCsvField(flattened[field] || ''));
    }
    
    csvLines.push(row.join(','));
  }
  
  // Escrever CSV
  console.log("💾 Salvando arquivo CSV...");
  await Deno.writeTextFile(csvPath, csvLines.join('\n'));
  
  console.log("");
  console.log("✅ Conversão concluída!");
  console.log(`📁 Arquivo CSV criado: ${csvPath}`);
  console.log(`📊 Total de linhas: ${csvLines.length} (1 cabeçalho + ${csvLines.length - 1} dados)`);
  console.log(`📋 Total de colunas: ${finalFields.length}`);
}

async function main() {
  const args = Deno.args;
  const skipEtapa1 = args.includes("--sem-filtro-categorias") || args.includes("--all-pois");
  const inputFile = args.find(arg => !arg.startsWith("--")) || "omsData/sudeste-251012.osm.pbf";
  const outputDir = "output";
  const cityName = "Bragança Paulista, SP, Brasil";
  const timestamp = Date.now();
  
  console.log("🏙️  Filtro PBF - Bragança Paulista → CSV");
  console.log("=".repeat(60));
  console.log(`📁 Arquivo de entrada: ${inputFile}`);
  console.log(`🏙️  Cidade: ${cityName}`);
  console.log(`📁 Diretório de saída: ${outputDir}`);
  if (skipEtapa1) {
    console.log(`⚠️  Modo: SEM filtro de categorias (todos os POIs incluindo igrejas)`);
  } else {
    console.log(`📋 Modo: COM filtro de categorias (apenas turismo/histórico/natural/etc)`);
  }
  console.log("");
  
  // Verificar se arquivo existe
  try {
    await Deno.stat(inputFile);
  } catch {
    console.error(`❌ Arquivo não encontrado: ${inputFile}`);
    Deno.exit(1);
  }
  
  // Inicializar processor
  const processor = new PBFProcessor(outputDir);
  
  // Verificar osmium
  const hasOsmium = await processor.checkOsmiumTool();
  if (!hasOsmium) {
    console.error("❌ osmium-tool não encontrado!");
    console.log("   Instale com: brew install osmctools (macOS) ou sudo apt-get install osmctools (Linux)");
    Deno.exit(1);
  }
  
  console.log("✅ osmium-tool disponível\n");
  
  let etapa1File: string;
  
  if (!skipEtapa1) {
    // ============================================
    // ETAPA 1: Filtro Consolidado (Categorias + Igrejas Católicas)
    // ============================================
    console.log("📋 ETAPA 1: Filtro Consolidado");
    console.log("=".repeat(60));
    console.log("🎯 Objetivo:");
    console.log("   1. Filtrar categorias de interesse (tourism, historic, natural, etc.)");
    console.log("   2. Incluir igrejas católicas (amenity=place_of_worship + denomination católica)");
    console.log("");
    
    // ETAPA 1.1: Filtrar categorias principais
    console.log("📋 ETAPA 1.1: Filtrando categorias principais...");
    console.log(`   Tags: ${ETAPA1_TAGS.length} categorias`);
    console.log("");
    
    let etapa1Categorias: string;
    try {
      etapa1Categorias = await processor.extractTags(inputFile, ETAPA1_TAGS, false);
      console.log(`✅ Categorias filtradas: ${etapa1Categorias}`);
      console.log("");
    } catch (error) {
      console.error(`❌ Erro na ETAPA 1.1: ${error.message}`);
      Deno.exit(1);
    }
    
    // ETAPA 1.2: Filtrar igrejas católicas (importante para cidades do interior)
    console.log("📋 ETAPA 1.2: Filtrando igrejas católicas...");
    console.log("   Critério: amenity=place_of_worship + denomination=catholic/roman_catholic");
    console.log("");
    
    let etapa1Igrejas: string | null = null;
    try {
      // Como osmium não suporta AND, fazemos em 2 passos:
      // Passo 1: Filtrar amenity=place_of_worship
      const placeOfWorshipPath = await processor.extractTags(inputFile, ["amenity=place_of_worship"], false);
      
      // Passo 2: Filtrar denomination católica
      const catholicDenominations = [
        "denomination=catholic",
        "denomination=roman_catholic"
      ];
      
      const catholicFiles: string[] = [];
      for (const denom of catholicDenominations) {
        try {
          const catholicPath = await processor.extractTags(placeOfWorshipPath, [denom], false);
          catholicFiles.push(catholicPath);
        } catch (error) {
          // Ignorar se não encontrou
        }
      }
      
      if (catholicFiles.length > 0) {
        etapa1Igrejas = join(outputDir, `temp-catholic-merged-${timestamp}.osm.pbf`);
        await processor.mergeFiles(catholicFiles, etapa1Igrejas);
        console.log(`✅ Igrejas católicas filtradas: ${etapa1Igrejas}`);
        
        // Limpar arquivos temporários
        try {
          await Deno.remove(placeOfWorshipPath);
          for (const f of catholicFiles) {
            await Deno.remove(f).catch(() => {});
          }
        } catch (e) {
          // Ignorar erros
        }
      } else {
        console.log("   ⚠️  Nenhuma igreja católica encontrada");
      }
    } catch (error) {
      console.log(`   ⚠️  Erro ao filtrar igrejas católicas: ${error instanceof Error ? error.message : String(error)}`);
      console.log("   Continuando sem igrejas católicas...");
    }
    
    console.log("");
    
    // ETAPA 1.3: Merge categorias + igrejas
    console.log("📋 ETAPA 1.3: Fazendo merge (categorias + igrejas)...");
    
    const filesToMerge = [etapa1Categorias];
    if (etapa1Igrejas) {
      filesToMerge.push(etapa1Igrejas);
    }
    
    const etapa1Merged = join(outputDir, `temp-etapa1-merged-${timestamp}.osm.pbf`);
    await processor.mergeFiles(filesToMerge, etapa1Merged);
    console.log(`✅ Merge completo: ${etapa1Merged}`);
    console.log("");
    
    // Limpar arquivo temporário de igrejas
    try {
      if (etapa1Igrejas) {
        await Deno.remove(etapa1Igrejas);
      }
    } catch (e) {
      // Ignorar erros
    }
    
    etapa1File = etapa1Merged;
    
    // Verificar arquivo gerado
    const fileInfo = await processor.getFileInfo(etapa1File);
    console.log("📊 Informações do arquivo filtrado:");
    console.log(`   Tamanho: ${(fileInfo.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Nodes: ${fileInfo.objectCounts.nodes.toLocaleString()}`);
    console.log(`   Ways: ${fileInfo.objectCounts.ways.toLocaleString()}`);
    console.log(`   Relations: ${fileInfo.objectCounts.relations.toLocaleString()}`);
    console.log("");
  } else {
    console.log("⏭️  ETAPA 1: PULADA (modo --sem-filtro-categorias)");
    console.log("   Usando arquivo original sem filtro de categorias");
    console.log("   Isso incluirá TODOS os POIs: igrejas, comércios, serviços, etc.");
    console.log("");
    etapa1File = inputFile;
  }
  
  // ============================================
  // ETAPA 2: Filtrar por Cidade (Bragança Paulista)
  // ============================================
  console.log("📋 ETAPA 2: Filtrar por Cidade");
  console.log("=".repeat(60));
  
  const bounds = await getCityBounds(cityName);
  if (!bounds) {
    console.error("❌ Não foi possível obter o bounding box da cidade");
    Deno.exit(1);
  }
  
  console.log("");
  console.log("🔍 Extraindo dados do PBF por região...");
  console.log(`   Bounding box: [${bounds.south}, ${bounds.west}] a [${bounds.north}, ${bounds.east}]`);
  console.log("");
  
  let etapa2File: string;
  try {
    // bounds is guaranteed to be non-null here due to check above
    etapa2File = await processor.extractByBounds(etapa1File, bounds);
    console.log(`✅ ETAPA 2 concluída: ${etapa2File}`);
    
    // Verificar arquivo gerado
    const fileInfo = await processor.getFileInfo(etapa2File);
    console.log("📊 Informações do arquivo filtrado por cidade:");
    console.log(`   Tamanho: ${(fileInfo.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Nodes: ${fileInfo.objectCounts.nodes.toLocaleString()}`);
    console.log(`   Ways: ${fileInfo.objectCounts.ways.toLocaleString()}`);
    console.log(`   Relations: ${fileInfo.objectCounts.relations.toLocaleString()}`);
    console.log("");
  } catch (error) {
    console.error(`❌ Erro na ETAPA 2: ${error.message}`);
    Deno.exit(1);
  }
  
  // ============================================
  // ETAPA 3: Converter para GeoJSON
  // ============================================
  console.log("📋 ETAPA 3: Converter para GeoJSON");
  console.log("=".repeat(60));
  
  const suffix = skipEtapa1 ? "all-pois" : "etapa1";
  const geojsonPath = join(outputDir, `braganca-paulista-${suffix}-${timestamp}.geojson`);
  
  try {
    await processor.convertToGeoJSONHighQuality(etapa2File, geojsonPath);
    console.log(`✅ ETAPA 3 concluída: ${geojsonPath}`);
    
    // Verificar arquivo gerado
    const geojsonInfo = await Deno.stat(geojsonPath);
    console.log(`   Tamanho: ${(geojsonInfo.size / 1024 / 1024).toFixed(2)} MB`);
    console.log("");
  } catch (error) {
    console.error(`❌ Erro na ETAPA 3: ${error.message}`);
    Deno.exit(1);
  }
  
  // ============================================
  // ETAPA 4: Converter para CSV
  // ============================================
  console.log("📋 ETAPA 4: Converter para CSV");
  console.log("=".repeat(60));
  
  const csvPath = join(outputDir, `braganca-paulista-${suffix}-${timestamp}.csv`);
  
  try {
    await convertGeoJSONToCSV(geojsonPath, csvPath);
    console.log(`✅ ETAPA 4 concluída: ${csvPath}`);
    console.log("");
  } catch (error) {
    console.error(`❌ Erro na ETAPA 4: ${error.message}`);
    Deno.exit(1);
  }
  
  // ============================================
  // Resumo Final
  // ============================================
  console.log("=".repeat(60));
  console.log("✅ Processo concluído com sucesso!");
  console.log("");
  console.log("📁 Arquivos gerados:");
  if (!skipEtapa1) {
    console.log(`   1. PBF filtrado (categorias): ${etapa1File}`);
  }
  console.log(`   ${skipEtapa1 ? '1' : '2'}. PBF filtrado (cidade): ${etapa2File}`);
  console.log(`   ${skipEtapa1 ? '2' : '3'}. GeoJSON: ${geojsonPath}`);
  console.log(`   ${skipEtapa1 ? '3' : '4'}. CSV (para importação): ${csvPath}`);
  console.log("");
  console.log("💡 Próximos passos:");
  console.log("   1. Abra o arquivo CSV no Excel ou Google Sheets");
  console.log("   2. Revise os dados");
  console.log("   3. Importe no sistema através da interface de importação OSM");
  console.log("");
}

if (import.meta.main) {
  main();
}


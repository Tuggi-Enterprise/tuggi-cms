#!/usr/bin/env -S deno run --allow-read --allow-write

/**
 * Convert GeoJSON to CSV
 * 
 * Usage:
 *   deno run scripts/geojson-to-csv.ts <input.geojson> <output.csv>
 * 
 * Example:
 *   deno run scripts/geojson-to-csv.ts output/braganca-paulista-tourism.geojson output/braganca-paulista-tourism.csv
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

async function main() {
  const args = Deno.args;
  
  if (args.length < 2) {
    console.error("❌ Uso incorreto!");
    console.log("");
    console.log("Uso:");
    console.log("  deno run scripts/geojson-to-csv.ts <input.geojson> <output.csv>");
    console.log("");
    console.log("Exemplo:");
    console.log("  deno run scripts/geojson-to-csv.ts output/braganca-paulista-tourism.geojson output/braganca-paulista-tourism.csv");
    Deno.exit(1);
  }
  
  const inputFile = args[0];
  const outputFile = args[1];
  
  // Verificar se arquivo existe
  try {
    await Deno.stat(inputFile);
  } catch {
    console.error(`❌ Arquivo não encontrado: ${inputFile}`);
    Deno.exit(1);
  }
  
  console.log("📄 Convertendo GeoJSON para CSV");
  console.log("=".repeat(60));
  console.log(`📁 Input: ${inputFile}`);
  console.log(`📁 Output: ${outputFile}`);
  console.log("");
  
  // Ler GeoJSON
  console.log("📖 Lendo arquivo GeoJSON...");
  const geojsonText = await Deno.readTextFile(inputFile);
  const geojson: GeoJSON = JSON.parse(geojsonText);
  
  if (!geojson.features || geojson.features.length === 0) {
    console.error("❌ Nenhuma feature encontrada no GeoJSON");
    Deno.exit(1);
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
  await Deno.writeTextFile(outputFile, csvLines.join('\n'));
  
  console.log("");
  console.log("✅ Conversão concluída!");
  console.log(`📁 Arquivo CSV criado: ${outputFile}`);
  console.log(`📊 Total de linhas: ${csvLines.length} (1 cabeçalho + ${csvLines.length - 1} dados)`);
  console.log(`📋 Total de colunas: ${finalFields.length}`);
}

if (import.meta.main) {
  main();
}


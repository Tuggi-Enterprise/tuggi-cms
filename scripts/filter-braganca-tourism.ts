#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run

/**
 * Filter Bragança Paulista PBF for tourism POIs
 * 
 * Mantém:
 * - Todos com name (51 POIs)
 * - Todos com leisure (45 parques)
 * - Todos com aeroway (4 aeroportos)
 * - Todos com tourism (2 pontos turísticos)
 * - Todos com natural importantes (com name/wikipedia/wikidata/description/website/tourism/historic)
 * - Todos com water importantes (com name/wikipedia/wikidata/description/website/tourism/historic)
 * 
 * IMPORTANTE: NÃO usa --omit-referenced no final para preservar nodes necessários
 */

import { PBFProcessor } from "../plugins/osm-geojson-filter/lib/pbf-processor.ts";

async function main() {
  const inputFile = Deno.args[0] || "output/braganca-paulista-pois-only.osm.pbf";
  const outputDir = "output";
  
  console.log("🏙️  Filtro de Turismo - Bragança Paulista");
  console.log("=".repeat(60));
  console.log(`📁 Input: ${inputFile}`);
  console.log(`📁 Output: ${outputDir}`);
  console.log("");
  
  // Verificar arquivo
  try {
    await Deno.stat(inputFile);
  } catch {
    console.error(`❌ Arquivo não encontrado: ${inputFile}`);
    Deno.exit(1);
  }
  
  const processor = new PBFProcessor(outputDir);
  
  // Verificar osmium
  const hasOsmium = await processor.checkOsmiumTool();
  if (!hasOsmium) {
    console.error("❌ osmium-tool não encontrado!");
    Deno.exit(1);
  }
  
  console.log("✅ osmium-tool disponível\n");
  
  const timestamp = Date.now();
  const outputFile = `${outputDir}/braganca-tourism-${timestamp}.osm.pbf`;
  
  console.log("📋 PASSO 1: Extraindo objetos com name...");
  const nameFile = await processor.extractTags(
    inputFile,
    ["name"],
    false, // SEM omit-referenced para manter nodes
    false
  );
  console.log(`✅ Arquivo com name: ${nameFile}\n`);
  
  console.log("📋 PASSO 2: Extraindo objetos com leisure...");
  const leisureFile = await processor.extractTags(
    inputFile,
    ["leisure=park", "leisure=stadium"],
    false, // SEM omit-referenced
    false
  );
  console.log(`✅ Arquivo com leisure: ${leisureFile}\n`);
  
  console.log("📋 PASSO 3: Extraindo objetos com aeroway...");
  const aerowayFile = await processor.extractTags(
    inputFile,
    ["aeroway=aerodrome"],
    false, // SEM omit-referenced
    false
  );
  console.log(`✅ Arquivo com aeroway: ${aerowayFile}\n`);
  
  console.log("📋 PASSO 4: Extraindo objetos com tourism...");
  const tourismFile = await processor.extractTags(
    inputFile,
    ["tourism"],
    false, // SEM omit-referenced
    false
  );
  console.log(`✅ Arquivo com tourism: ${tourismFile}\n`);
  
  console.log("📋 PASSO 5: Extraindo natural importantes...");
  // Primeiro extrair natural
  const naturalAllFile = await processor.extractTags(
    inputFile,
    ["natural"],
    false,
    false
  );
  
  // Depois filtrar os que têm indicadores de importância
  const naturalImportantTags = [
    "name",
    "wikipedia",
    "wikidata",
    "description",
    "website",
    "tourism",
    "historic"
  ];
  
  const naturalImportantFiles: string[] = [];
  for (const tag of naturalImportantTags) {
    const file = await processor.extractTags(
      naturalAllFile,
      [tag],
      false,
      false
    );
    naturalImportantFiles.push(file);
  }
  console.log(`✅ Arquivos com natural importantes: ${naturalImportantFiles.length}\n`);
  
  console.log("📋 PASSO 6: Extraindo water importantes...");
  // Primeiro extrair water
  const waterAllFile = await processor.extractTags(
    inputFile,
    ["water"],
    false,
    false
  );
  
  // Depois filtrar os que têm indicadores de importância
  const waterImportantFiles: string[] = [];
  for (const tag of naturalImportantTags) {
    const file = await processor.extractTags(
      waterAllFile,
      [tag],
      false,
      false
    );
    waterImportantFiles.push(file);
  }
  console.log(`✅ Arquivos com water importantes: ${waterImportantFiles.length}\n`);
  
  console.log("📋 PASSO 7: Fazendo merge de todos os arquivos...");
  const allFiles = [
    nameFile,
    leisureFile,
    aerowayFile,
    tourismFile,
    ...naturalImportantFiles,
    ...waterImportantFiles
  ];
  
  const mergeFile = await processor.mergeFiles(allFiles, outputFile);
  console.log(`✅ Merge completo: ${mergeFile}\n`);
  
  console.log("✅ Filtro concluído!");
  console.log(`📁 Arquivo final: ${outputFile}`);
  console.log("");
  console.log("💡 IMPORTANTE: Arquivo criado SEM --omit-referenced no final");
  console.log("   Isso preserva os nodes necessários para converter ways/relations");
}

if (import.meta.main) {
  main();
}


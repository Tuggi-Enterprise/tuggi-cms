#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run

/**
 * Filter PBF file for tourism and historic POIs
 * 
 * Implements 3-stage filtering according to pbf-filtering-logic-final.md:
 * ETAPA 1: Filter by interest categories (tourism, historic, natural, leisure, etc.)
 * ETAPA 2: Remove private POIs (keeping tourism/historic)
 * ETAPA 3: Filter by importance (refinement by category)
 */

import { PBFProcessor } from "../plugins/osm-geojson-filter/lib/pbf-processor.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";

// ETAPA 1: Categories according to document
// Using specific tags as osmium may not handle wildcards correctly
const ETAPA1_TAGS = [
  // Tourism categories
  "tourism=attraction",
  "tourism=museum",
  "tourism=artwork",
  "tourism=viewpoint",
  "tourism=theme_park",
  "tourism=zoo",
  "tourism=aquarium",
  "tourism=yes",  // Generic tourism
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
  "historic=yes",  // Generic historic
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
  "natural=peak",  // Picos (será filtrado na Etapa 3)
  // Leisure categories
  "leisure=park",
  "leisure=stadium",
  // Other categories
  "aeroway=aerodrome",
  "amenity=theatre"
];

async function main() {
  // Check if we have a etapa1 file already, or use the original
  const etapa1File = Deno.args[0] || null;
  const inputFile = etapa1File || "omsData/sudeste-251012.osm.pbf";
  const outputDir = "output";
  const timestamp = Date.now();
  
  const skipEtapa1 = etapa1File !== null;
  
  console.log("🗺️  PBF Tourism Filter - 3 Etapas");
  console.log("=".repeat(60));
  if (skipEtapa1) {
    console.log(`📁 Input file (ETAPA 1 já executada): ${inputFile}`);
  } else {
    console.log(`📁 Input file: ${inputFile}`);
  }
  console.log(`📁 Output directory: ${outputDir}`);
  console.log(`📋 Following logic from: docs/pbf-filtering-logic-final.md`);
  console.log("");
  
  // Initialize processor
  const processor = new PBFProcessor(outputDir);
  
  // Check osmium-tool availability
  const hasOsmium = await processor.checkOsmiumTool();
  if (!hasOsmium) {
    console.log("⚠️  osmium-tool not found. Attempting installation...");
    const installed = await processor.installOsmiumTool();
    if (!installed) {
      console.log("❌ Could not install osmium-tool automatically");
      processor.printRecommendations();
      Deno.exit(1);
    }
  }
  
  console.log("✅ osmium-tool is available\n");
  
  let etapa1FinalPath: string;
  
  if (!skipEtapa1) {
    // ============================================
    // ETAPA 1: Filtro por Categorias de Interesse
    // ============================================
    console.log("📋 ETAPA 1: Filtro por Categorias de Interesse");
    console.log("=".repeat(60));
    console.log(`🎯 Tags: ${ETAPA1_TAGS.join(", ")}`);
    console.log(`⚠️  Using --omit-referenced to exclude related objects`);
    console.log("");
    
    let etapa1Path: string;
    try {
      etapa1Path = await processor.extractTags(inputFile, ETAPA1_TAGS, true); // true = omitReferenced
      console.log(`✅ ETAPA 1 complete: ${etapa1Path}`);
      console.log("");
    } catch (error) {
      console.error(`❌ Error in ETAPA 1: ${error.message}`);
      Deno.exit(1);
    }
    
    // Re-filter to ensure precision (double-pass)
    console.log("📋 ETAPA 1 (re-filter): Ensuring precision...");
    console.log("");
    
    try {
      const reFilteredPath = await processor.extractTags(etapa1Path, ETAPA1_TAGS, true);
      etapa1FinalPath = join(outputDir, `etapa1-categories-${timestamp}.osm.pbf`);
      await Deno.rename(reFilteredPath, etapa1FinalPath);
      console.log(`✅ ETAPA 1 (re-filter) complete: ${etapa1FinalPath}`);
      console.log("");
    } catch (error) {
      console.error(`❌ Error in ETAPA 1 (re-filter): ${error.message}`);
      Deno.exit(1);
    }
    
    // Validation
    console.log("📊 ETAPA 1 Validation:");
    await processor.getFileInfo(etapa1FinalPath);
    console.log("");
    
    try {
      await processor.showAvailableTags(etapa1FinalPath);
      console.log("");
    } catch (error) {
      console.error(`⚠️  Could not show tags: ${error.message}`);
      console.log("");
    }
    
    console.log("✅ ETAPA 1 concluída!");
    console.log("");
  } else {
    etapa1FinalPath = inputFile;
    console.log("⏭️  Pulando ETAPA 1 (usando arquivo fornecido)");
    console.log("");
  }
  
  // ============================================
  // ETAPA 2: Remover POIs com Restrição de Acesso
  // ============================================
  console.log("📋 ETAPA 2: Remover POIs com Restrição de Acesso");
  console.log("=".repeat(60));
  console.log("🎯 Lógica:");
  console.log("   - MANTER: tourism OU historic (mesmo com restrições de acesso)");
  console.log("   - EXCLUIR: SEM tourism/historic E access=no/residential/private OU residential=yes");
  console.log("");
  console.log("📋 Estratégia: Filtrar diretamente do arquivo da ETAPA 1");
  console.log("   Usando --invert-match para remover objetos com access restritivo");
  console.log("   que NÃO têm tourism OU historic");
  console.log("");
  
  // Estratégia simplificada: Filtrar diretamente do arquivo da ETAPA 1
  // Remover objetos que têm access restritivo E não têm tourism/historic
  // Mas como osmium não suporta "E" direto, vamos usar uma abordagem:
  // 1. Extrair objetos que QUEREMOS manter (tourism/historic OU sem access restritivo)
  
  const tourismHistoricTags = [
    "tourism=attraction", "tourism=museum", "tourism=artwork", "tourism=viewpoint",
    "tourism=theme_park", "tourism=zoo", "tourism=aquarium", "tourism=yes",
    "historic=monument", "historic=castle", "historic=church", "historic=memorial",
    "historic=ruins", "historic=archaeological_site", "historic=fort", "historic=tomb",
    "historic=wayside_shrine", "historic=train_station", "historic=building",
    "historic=house", "historic=bridge", "historic=yes"
  ];
  
  const restrictiveAccessTags = [
    "access=no",
    "access=residential", 
    "access=private",
    "residential=yes"
  ];
  
  // Estratégia sequencial (como sugerido pelo usuário):
  // 1. Filtro 1: Filtrar tourism OU historic → arquivo A (mantém todos, mesmo privados)
  // 2. Filtro 2: Do arquivo original, filtrar objetos SEM tourism/historic E SEM access restritivo → arquivo B
  // 3. Merge A + B → arquivo final
  
  // Step 2.1: Filtro 1 - Filtrar tourism OU historic
  // Mantém TODOS os objetos com tourism/historic (mesmo privados)
  console.log("📋 ETAPA 2.1: Filtrando tourism OU historic...");
  console.log("   (Mantém todos com tourism/historic, mesmo privados)");
  console.log("");
  
  let etapa2aPath: string;
  try {
    etapa2aPath = await processor.extractTags(etapa1FinalPath, tourismHistoricTags, true);
    console.log(`✅ ETAPA 2.1 complete: ${etapa2aPath}`);
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 2.1: ${error.message}`);
    Deno.exit(1);
  }
  
  // Step 2.2: Filtro 2 - Filtrar objetos SEM tourism/historic E SEM access restritivo
  // Do arquivo original, mantém objetos que:
  // - NÃO têm tourism/historic E
  // - NÃO têm access restritivo
  // Isso mantém natural/leisure/aeroway/amenity sem restrições
  console.log("📋 ETAPA 2.2: Filtrando objetos SEM tourism/historic E SEM access restritivo...");
  console.log("   (Mantém outras categorias sem restrições de acesso)");
  console.log("");
  
  let etapa2bPath: string;
  try {
    // Primeiro, filtrar objetos SEM access restritivo (do arquivo original)
    const semAccessRestritivo = await processor.extractTags(etapa1FinalPath, restrictiveAccessTags, true, true); // true = invertMatch
    
    // Depois, do arquivo sem access restritivo, remover os que têm tourism/historic
    // Mas como osmium não pode fazer "SEM tourism/historic", precisamos usar uma abordagem diferente
    // Vamos filtrar as outras categorias diretamente:
    const otherCategoryTags = [
      "natural=water", "natural=wood", "natural=beach", "natural=cliff", "natural=cave",
      "natural=tree", "natural=volcano", "natural=waterfall", "natural=geyser",
      "natural=hot_spring", "natural=peak",
      "leisure=park", "leisure=stadium",
      "aeroway=aerodrome", "amenity=theatre"
    ];
    
    // Filtrar outras categorias do arquivo sem access restritivo
    etapa2bPath = await processor.extractTags(semAccessRestritivo, otherCategoryTags, true);
    console.log(`✅ ETAPA 2.2 complete: ${etapa2bPath}`);
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 2.2: ${error.message}`);
    Deno.exit(1);
  }
  
  // Step 2.3: Merge - Combinar tourism/historic + outras categorias sem restrições
  // etapa2aPath = tourism/historic (todos, mesmo privados)
  // etapa2bPath = outras categorias sem access restritivo
  // Resultado = arquivo final
  console.log("📋 ETAPA 2.3: Fazendo merge...");
  console.log("   (Combinando tourism/historic + outras categorias sem restrições)");
  console.log("");
  
  const etapa2MergePath = join(outputDir, `etapa2-merge-${timestamp}.osm.pbf`);
  
  try {
    await processor.mergeFiles([etapa2aPath, etapa2bPath], etapa2MergePath);
    console.log(`✅ ETAPA 2.3 (merge) complete: ${etapa2MergePath}`);
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 2.3: ${error.message}`);
    Deno.exit(1);
  }
  
  // Step 2.4: Re-filter após merge para garantir precisão
  // O merge pode incluir objetos relacionados que não foram explicitamente filtrados
  // Vamos fazer um re-filter para garantir que apenas objetos com as tags corretas estão presentes
  console.log("📋 ETAPA 2.4: Re-filtrando após merge para garantir precisão...");
  console.log("   (Remove objetos relacionados que não têm as tags corretas)");
  console.log("");
  
  // Criar lista de tags que queremos manter
  const tagsToKeep = [
    ...tourismHistoricTags,
    "natural=water", "natural=wood", "natural=beach", "natural=cliff", "natural=cave",
    "natural=tree", "natural=volcano", "natural=waterfall", "natural=geyser",
    "natural=hot_spring", "natural=peak",
    "leisure=park", "leisure=stadium",
    "aeroway=aerodrome", "amenity=theatre"
  ];
  
  const etapa2ReFilteredPath = join(outputDir, `etapa2-refiltered-${timestamp}.osm.pbf`);
  
  try {
    // Re-filter com --omit-referenced para garantir precisão
    const reFilteredPath = await processor.extractTags(etapa2MergePath, tagsToKeep, true);
    await Deno.rename(reFilteredPath, etapa2ReFilteredPath);
    console.log(`✅ ETAPA 2.4 complete: ${etapa2ReFilteredPath}`);
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 2.4: ${error.message}`);
    Deno.exit(1);
  }
  
  // Step 2.5: Remover objetos com access restritivo que NÃO têm tourism/historic
  // O re-filter manteve todos os objetos com as tags corretas, mas não removeu
  // os que têm access restritivo E não têm tourism/historic
  console.log("📋 ETAPA 2.5: Removendo objetos com access restritivo sem tourism/historic...");
  console.log("   (Remove objetos que têm access restritivo E não têm tourism/historic)");
  console.log("");
  
  // Estratégia:
  // 1. Extrair objetos com tourism/historic (mantém todos, mesmo privados)
  // 2. Extrair objetos SEM access restritivo (mantém todos sem restrições)
  // 3. Merge dos dois conjuntos
  // 4. Re-filter após merge para garantir precisão
  
  const etapa2Merge2Path = join(outputDir, `etapa2-merge2-${timestamp}.osm.pbf`);
  
  try {
    // 1. Extrair tourism/historic (mantém todos, mesmo privados)
    const tourismHistoricPath = await processor.extractTags(etapa2ReFilteredPath, tourismHistoricTags, true);
    
    // 2. Extrair objetos SEM access restritivo (mantém todos sem restrições)
    const semAccessRestritivoPath = await processor.extractTags(etapa2ReFilteredPath, restrictiveAccessTags, true, true); // true = invertMatch
    
    // 3. Merge dos dois conjuntos
    await processor.mergeFiles([tourismHistoricPath, semAccessRestritivoPath], etapa2Merge2Path);
    
    console.log(`✅ ETAPA 2.5 (merge) complete: ${etapa2Merge2Path}`);
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 2.5: ${error.message}`);
    Deno.exit(1);
  }
  
  // Step 2.6: Re-filter após merge da ETAPA 2.5 para garantir precisão
  // O merge pode incluir objetos relacionados que não foram explicitamente filtrados
  console.log("📋 ETAPA 2.6: Re-filtrando após merge para garantir precisão...");
  console.log("   (Remove objetos relacionados que não têm as tags corretas)");
  console.log("");
  
  const etapa2FinalPath = join(outputDir, `etapa2-access-filtered-${timestamp}.osm.pbf`);
  
  try {
    // Re-filter com --omit-referenced para garantir precisão
    const reFilteredPath = await processor.extractTags(etapa2Merge2Path, tagsToKeep, true);
    await Deno.rename(reFilteredPath, etapa2FinalPath);
    console.log(`✅ ETAPA 2.6 complete: ${etapa2FinalPath}`);
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 2.6: ${error.message}`);
    Deno.exit(1);
  }
  
  // Validation
  console.log("📊 ETAPA 2 Validation:");
  await processor.getFileInfo(etapa2FinalPath);
  console.log("");
  
  try {
    await processor.showAvailableTags(etapa2FinalPath);
    console.log("");
  } catch (error) {
    console.error(`⚠️  Could not show tags: ${error.message}`);
    console.log("");
  }
  
  console.log("✅ ETAPA 2 concluída!");
  console.log("");
  
  // ============================================
  // ETAPA 3: Filtrar por Importância (Refino por Categoria)
  // ============================================
  console.log("📋 ETAPA 3: Filtrar por Importância (Refino por Categoria)");
  console.log("=".repeat(60));
  console.log("🎯 Objetivo: Manter apenas POIs importantes");
  console.log("   Critérios: tourism/historic OU wikipedia/wikidata OU description/website OU name");
  console.log("   Com regras especiais por categoria");
  console.log("");
  
  // Estratégia: Criar múltiplos filtros e fazer merge
  const filesToMerge: string[] = [];
  
  // 3.1: Tourism e Historic (manter todos)
  console.log("📋 ETAPA 3.1: Filtrando tourism/historic (mantém todos)...");
  console.log("");
  
  try {
    const tourismHistoricPath = await processor.extractTags(etapa2FinalPath, tourismHistoricTags, true);
    filesToMerge.push(tourismHistoricPath);
    console.log(`✅ ETAPA 3.1 complete: ${tourismHistoricPath}`);
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 3.1: ${error.message}`);
    Deno.exit(1);
  }
  
  // 3.2: Natural com indicadores de importância
  console.log("📋 ETAPA 3.2: Filtrando natural com indicadores de importância...");
  console.log("");
  console.log("⚠️  Nota: natural=peak com ele >= 500m será tratado no banco de dados");
  console.log("   (osmium não suporta filtro por valores numéricos)");
  console.log("");
  
  const naturalTags = [
    "natural=water", "natural=wood", "natural=beach", "natural=cliff", "natural=cave",
    "natural=tree", "natural=volcano", "natural=waterfall", "natural=geyser",
    "natural=hot_spring", "natural=peak"
  ];
  
  try {
    // Primeiro, filtrar todos os natural
    const tempNaturalPath = await processor.extractTags(etapa2FinalPath, naturalTags, true);
    
    // Filtrar natural com name (exceto tree/wood/water/waterfall)
    // Nota: natural=peak com ele >= 500m será tratado no banco de dados
    const naturalWithNameTags = [
      "natural=beach", "natural=cliff", "natural=cave", "natural=volcano",
      "natural=geyser", "natural=hot_spring", "natural=peak"
    ];
    const naturalWithNamePath = await processor.extractTags(tempNaturalPath, naturalWithNameTags, true);
    const naturalNamePath = await processor.extractTags(naturalWithNamePath, ["name"], true);
    filesToMerge.push(naturalNamePath);
    
    // Filtrar natural com wikipedia
    const naturalWikipediaPath = await processor.extractTags(tempNaturalPath, ["wikipedia"], true);
    filesToMerge.push(naturalWikipediaPath);
    
    // Filtrar natural com wikidata
    const naturalWikidataPath = await processor.extractTags(tempNaturalPath, ["wikidata"], true);
    filesToMerge.push(naturalWikidataPath);
    
    // Filtrar natural com description
    const naturalDescriptionPath = await processor.extractTags(tempNaturalPath, ["description"], true);
    filesToMerge.push(naturalDescriptionPath);
    
    // Filtrar natural com website
    const naturalWebsitePath = await processor.extractTags(tempNaturalPath, ["website"], true);
    filesToMerge.push(naturalWebsitePath);
    
    console.log(`✅ ETAPA 3.2 complete: ${filesToMerge.length - 1} arquivos criados`);
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 3.2: ${error.message}`);
    Deno.exit(1);
  }
  
  // 3.3: Leisure com indicadores de importância
  console.log("📋 ETAPA 3.3: Filtrando leisure com indicadores de importância...");
  console.log("");
  
  const leisureTags = ["leisure=park", "leisure=stadium"];
  
  try {
    // Primeiro, filtrar todos os leisure
    const tempLeisurePath = await processor.extractTags(etapa2FinalPath, leisureTags, true);
    
    // Filtrar leisure com name
    const leisureNamePath = await processor.extractTags(tempLeisurePath, ["name"], true);
    filesToMerge.push(leisureNamePath);
    
    // Filtrar leisure com wikipedia
    const leisureWikipediaPath = await processor.extractTags(tempLeisurePath, ["wikipedia"], true);
    filesToMerge.push(leisureWikipediaPath);
    
    // Filtrar leisure com wikidata
    const leisureWikidataPath = await processor.extractTags(tempLeisurePath, ["wikidata"], true);
    filesToMerge.push(leisureWikidataPath);
    
    // Filtrar leisure com description
    const leisureDescriptionPath = await processor.extractTags(tempLeisurePath, ["description"], true);
    filesToMerge.push(leisureDescriptionPath);
    
    // Filtrar leisure com website
    const leisureWebsitePath = await processor.extractTags(tempLeisurePath, ["website"], true);
    filesToMerge.push(leisureWebsitePath);
    
    // Filtrar leisure=park com park:type
    const leisureParkPath = await processor.extractTags(tempLeisurePath, ["leisure=park"], true);
    const leisureParkTypePath = await processor.extractTags(leisureParkPath, ["park:type"], true);
    filesToMerge.push(leisureParkTypePath);
    
    // Filtrar leisure=park com operator
    const leisureOperatorPath = await processor.extractTags(leisureParkPath, ["operator"], true);
    filesToMerge.push(leisureOperatorPath);
    
    console.log(`✅ ETAPA 3.3 complete: ${filesToMerge.length - 6} arquivos criados`);
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 3.3: ${error.message}`);
    Deno.exit(1);
  }
  
  // 3.4: Aeroway com indicadores de importância
  console.log("📋 ETAPA 3.4: Filtrando aeroway com indicadores de importância...");
  console.log("");
  
  try {
    // Primeiro, filtrar todos os aeroway
    const tempAerowayPath = await processor.extractTags(etapa2FinalPath, ["aeroway=aerodrome"], true);
    
    // Filtrar aeroway com name
    const aerowayNamePath = await processor.extractTags(tempAerowayPath, ["name"], true);
    filesToMerge.push(aerowayNamePath);
    
    // Filtrar aeroway com wikipedia
    const aerowayWikipediaPath = await processor.extractTags(tempAerowayPath, ["wikipedia"], true);
    filesToMerge.push(aerowayWikipediaPath);
    
    // Filtrar aeroway com wikidata
    const aerowayWikidataPath = await processor.extractTags(tempAerowayPath, ["wikidata"], true);
    filesToMerge.push(aerowayWikidataPath);
    
    // Filtrar aeroway com iata
    const aerowayIataPath = await processor.extractTags(tempAerowayPath, ["iata"], true);
    filesToMerge.push(aerowayIataPath);
    
    // Filtrar aeroway com icao
    const aerowayIcaoPath = await processor.extractTags(tempAerowayPath, ["icao"], true);
    filesToMerge.push(aerowayIcaoPath);
    
    console.log(`✅ ETAPA 3.4 complete: ${filesToMerge.length - 11} arquivos criados`);
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 3.4: ${error.message}`);
    Deno.exit(1);
  }
  
  // 3.5: Amenity=theatre com indicadores de importância
  console.log("📋 ETAPA 3.5: Filtrando amenity=theatre com indicadores de importância...");
  console.log("");
  
  try {
    // Primeiro, filtrar todos os amenity=theatre
    const tempTheatrePath = await processor.extractTags(etapa2FinalPath, ["amenity=theatre"], true);
    
    // Filtrar theatre com historic
    const theatreHistoricPath = await processor.extractTags(tempTheatrePath, ["historic"], true);
    filesToMerge.push(theatreHistoricPath);
    
    // Filtrar theatre com wikipedia
    const theatreWikipediaPath = await processor.extractTags(tempTheatrePath, ["wikipedia"], true);
    filesToMerge.push(theatreWikipediaPath);
    
    // Filtrar theatre com wikidata
    const theatreWikidataPath = await processor.extractTags(tempTheatrePath, ["wikidata"], true);
    filesToMerge.push(theatreWikidataPath);
    
    // Filtrar theatre com name
    const theatreNamePath = await processor.extractTags(tempTheatrePath, ["name"], true);
    filesToMerge.push(theatreNamePath);
    
    // Filtrar theatre com description
    const theatreDescriptionPath = await processor.extractTags(tempTheatrePath, ["description"], true);
    filesToMerge.push(theatreDescriptionPath);
    
    // Filtrar theatre com website
    const theatreWebsitePath = await processor.extractTags(tempTheatrePath, ["website"], true);
    filesToMerge.push(theatreWebsitePath);
    
    console.log(`✅ ETAPA 3.5 complete: ${filesToMerge.length - 16} arquivos criados`);
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 3.5: ${error.message}`);
    Deno.exit(1);
  }
  
  // 3.6: Merge de todos os arquivos filtrados
  console.log("📋 ETAPA 3.6: Fazendo merge de todos os arquivos filtrados...");
  console.log(`   (${filesToMerge.length} arquivos para merge)`);
  console.log("");
  
  const etapa3MergePath = join(outputDir, `etapa3-merge-${timestamp}.osm.pbf`);
  
  try {
    await processor.mergeFiles(filesToMerge, etapa3MergePath);
    console.log(`✅ ETAPA 3.6 (merge) complete: ${etapa3MergePath}`);
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 3.6: ${error.message}`);
    Deno.exit(1);
  }
  
  // 3.7: Re-filter final para garantir precisão
  console.log("📋 ETAPA 3.7: Re-filtrando para garantir precisão...");
  console.log("   (Remove objetos relacionados que não têm as tags corretas)");
  console.log("");
  
  const etapa3FinalPath = join(outputDir, `etapa3-importance-filtered-${timestamp}.osm.pbf`);
  
  // Criar lista de tags que queremos manter (todas as categorias)
  const allCategoryTags = [
    ...tourismHistoricTags,
    ...naturalTags,
    ...leisureTags,
    "aeroway=aerodrome",
    "amenity=theatre"
  ];
  
  try {
    const reFilteredPath = await processor.extractTags(etapa3MergePath, allCategoryTags, true);
    await Deno.rename(reFilteredPath, etapa3FinalPath);
    console.log(`✅ ETAPA 3.7 complete: ${etapa3FinalPath}`);
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 3.7: ${error.message}`);
    Deno.exit(1);
  }
  
  // Validation
  console.log("📊 ETAPA 3 Validation:");
  await processor.getFileInfo(etapa3FinalPath);
  console.log("");
  
  try {
    await processor.showAvailableTags(etapa3FinalPath);
    console.log("");
  } catch (error) {
    console.error(`⚠️  Could not show tags: ${error.message}`);
    console.log("");
  }
  
  console.log("✅ ETAPA 3 concluída!");
  console.log("");
  console.log("📊 Resumo Final:");
  console.log(`   Arquivo ETAPA 1: ${etapa1FinalPath}`);
  console.log(`   Arquivo ETAPA 2: ${etapa2FinalPath}`);
  console.log(`   Arquivo ETAPA 3: ${etapa3FinalPath}`);
  console.log("");
}

// Run the script
if (import.meta.main) {
  await main();
}


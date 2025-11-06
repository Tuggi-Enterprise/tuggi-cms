#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run

/**
 * Filter PBF file for tourism and historic POIs
 * 
 * Implements optimized 4-stage filtering:
 * 
 * ETAPA 1: Filtro Consolidado
 *   - Inclui categorias de interesse (tourism, historic, natural, leisure, etc.)
 *   - Inclui igrejas católicas (amenity=place_of_worship + denomination católica)
 *   - Exclui highways (mesmo com tourism/historic)
 *   Estratégia: 4 operações sequenciais (filtrar categorias → filtrar igrejas → merge → remover highways)
 * 
 * ETAPA 2: Remove private POIs (keeping tourism/historic)
 * ETAPA 3: Filter by importance (refinement by category)
 * 
 * ETAPA 4-5.7 UNIFICADA: Filtros de Valor Turístico (OTIMIZADA)
 *   Esta etapa unifica 8 fases anteriores em uma única passagem sobre os dados:
 *   - ETAPA 4: POIs sem nome E sem referências, fazendas, aeródromos privados
 *   - ETAPA 5: POIs genéricos sem valor (infraestrutura técnica, nomes genéricos, estádios/cemitérios)
 *   - ETAPA 5.1: Bancos e instituições financeiras sem valor turístico
 *   - ETAPA 5.2: Estradas, ruas, avenidas e vias de trâfego
 *   - ETAPA 5.3: Nomes genéricos sem contexto (mirante, monumento, busto, etc.)
 *   - ETAPA 5.4: POIs específicos sem valor (Rotary, SESC, Torre, Trilha, Via de acesso, Vila)
 *   - ETAPA 5.5: Infraestrutura e serviços (aeródromos, escolas, serviços públicos, comércio)
 *   - ETAPA 5.7: POIs com nome de 1 palavra sem valor (sem Wikipedia/Wikidata/descrição)
 *   
 *   Vantagens da unificação:
 *   - Reduz de 8 passagens para 1 passagem sobre os dados
 *   - Melhor performance (menos I/O de arquivos)
 *   - Código mais simples e manutenível
 *   - Resultado final idêntico (filtros independentes)
 * 
 * ETAPA 5.6: Remove duplicate POIs (same name and location, keep only one entry)
 *   - Executada APÓS todos os filtros de valor turístico
 *   - Requer análise de distância entre POIs (algoritmo diferente)
 * 
 * NOTA: A ETAPA 1 foi consolidada para evitar múltiplas etapas complementares.
 * Todas as operações (incluir categorias, incluir igrejas, excluir highways) são feitas
 * em uma única fase lógica, garantindo resultado sólido e confiável.
 * 
 * NOTA: A ETAPA 4-5.7 foi unificada para melhor performance, reduzindo de 8 para 1 passagem
 * sobre os dados sem alterar o resultado final.
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
  "amenity=theatre",
  // Igrejas católicas (importantes para turismo em cidades do interior)
  // Nota: Não podemos adicionar diretamente porque precisa de AND (amenity=place_of_worship AND denomination=catholic)
  // Mas vamos adicionar na ETAPA 1 através de um filtro separado e merge
];

async function main() {
  // Check arguments
  const args = Deno.args;
  const skipEtapa3 = args.includes("--skip-etapa3") || args.includes("--fase-2-only");
  const fase1Only = args.includes("--fase-1-only");
  const fase4Only = args.includes("--fase-4-only");
  const fase5Only = args.includes("--fase-5-only");
  
  // Check if we have a etapa1 file already, or use the original
  // Se tiver --fase-1-only, não considerar arquivo como etapa1 já executada
  const etapa1File = fase1Only ? null : (args.find(arg => !arg.startsWith("--")) || null);
  const inputFile = etapa1File || "omsData/sudeste-251012.osm.pbf";
  const outputDir = "output";
  const timestamp = Date.now();
  
  const skipEtapa1 = etapa1File !== null && !fase1Only && !fase5Only;
  
  // Se for apenas Fase 5, pular tudo e ir direto para ETAPA 5 (e depois 5.1)
  if (fase5Only) {
    const etapa4File = args.find(arg => !arg.startsWith("--"));
    if (!etapa4File) {
      console.error("❌ Erro: --fase-5-only requer um arquivo GeoJSON como argumento");
      console.error("   Exemplo: deno run filter-pbf-tourism.ts arquivo.geojson --fase-5-only");
      Deno.exit(1);
    }
    
    console.log("🗺️  PBF Tourism Filter - ETAPA 5 + 5.1");
    console.log("=".repeat(60));
    console.log(`📁 Input file: ${etapa4File}`);
    console.log(`📁 Output directory: ${outputDir}`);
    console.log("");
    
    // Usar função unificada para melhor performance
    const etapa4_5FinalPath = await executeEtapa4_5_Unified(processor, etapa4File, outputDir, timestamp);
    const etapa5_6FinalPath = await executeEtapa5_6(etapa4_5FinalPath, outputDir, timestamp);
    
    console.log("📊 Resumo Final:");
    console.log(`   Arquivo ETAPA 4-5.7 (UNIFICADA): ${etapa4_5FinalPath}`);
    console.log(`   Arquivo ETAPA 5.6: ${etapa5_6FinalPath}`);
    console.log("");
    console.log("✅ Processo concluído - ETAPA 4-5.7 UNIFICADA e ETAPA 5.6 executadas!");
    console.log("   💡 A ETAPA 4-5.7 unifica 8 fases em uma única passagem para melhor performance");
    return;
  }
  
  console.log("🗺️  PBF Tourism Filter - 5 Etapas");
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
    // ETAPA 1: Filtro Consolidado
    // Objetivo: Filtrar categorias + incluir igrejas católicas + excluir highways
    // ============================================
    console.log("📋 ETAPA 1: Filtro Consolidado");
    console.log("=".repeat(60));
    console.log("🎯 Objetivo:");
    console.log("   1. Incluir categorias de interesse (tourism, historic, natural, etc.)");
    console.log("   2. Incluir igrejas católicas (amenity=place_of_worship + denomination católica)");
    console.log("   3. Excluir highways (mesmo com tourism/historic)");
    console.log("");
    console.log("💡 Estratégia: 3 operações paralelas + merge + remoção de highways");
    console.log("");
    
    // ETAPA 1.1: Filtrar categorias principais (do arquivo original)
    console.log("📋 ETAPA 1.1: Filtrando categorias principais...");
    console.log(`   Tags: ${ETAPA1_TAGS.slice(0, 5).join(", ")}... (${ETAPA1_TAGS.length} total)`);
    
    let etapa1Categorias: string;
    try {
      // IMPORTANTE: Não usar --omit-referenced para preservar geometria de ways/relations
      // (natural=water, leisure=park, etc. geralmente são áreas que precisam dos nodes)
      const categoriasPath = await processor.extractTags(inputFile, ETAPA1_TAGS, false);
      // Re-filter para garantir precisão (também sem omit-referenced)
      etapa1Categorias = await processor.extractTags(categoriasPath, ETAPA1_TAGS, false);
      console.log(`✅ Categorias filtradas: ${etapa1Categorias}`);
      console.log("");
    } catch (error) {
      console.error(`❌ Error in ETAPA 1.1: ${error instanceof Error ? error.message : String(error)}`);
      Deno.exit(1);
    }
    
    // ETAPA 1.2: Filtrar igrejas católicas (do arquivo original, separado)
    console.log("📋 ETAPA 1.2: Filtrando igrejas católicas...");
    console.log("   Critério: amenity=place_of_worship + denomination=catholic/roman_catholic");
    
    let etapa1Igrejas: string | null = null;
    try {
      // Como osmium não suporta AND, fazemos em 2 passos:
      // Passo 1: Filtrar amenity=place_of_worship (sem omit-referenced para manter geometria)
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
          catholicFiles.forEach(f => Deno.remove(f).catch(() => {}));
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
    
    // ETAPA 1.4: Remover highways do resultado final
    console.log("📋 ETAPA 1.4: Removendo highways (mesmo com tourism/historic)...");
    console.log("   Regra: Highways são infraestrutura, não POIs para turistas");
    
    const etapa1SemHighways = await processor.extractTags(
      etapa1Merged, 
      ["highway"], 
      false, // não omitir referenced (mantém nodes necessários)
      true   // invertMatch = excluir objetos COM highway
    );
    
    // Renomear para arquivo final
    etapa1FinalPath = join(outputDir, `etapa1-final-${timestamp}.osm.pbf`);
    await Deno.rename(etapa1SemHighways, etapa1FinalPath);
    
    console.log(`✅ ETAPA 1 complete: ${etapa1FinalPath}`);
    console.log("");
    
    // Limpar arquivo temporário de merge
    try {
      await Deno.remove(etapa1Merged);
      if (etapa1Igrejas) {
        await Deno.remove(etapa1Igrejas);
      }
    } catch (e) {
      // Ignorar erros
    }
    
    // Validation
    console.log("📊 ETAPA 1 Validation:");
    await processor.getFileInfo(etapa1FinalPath);
    console.log("");
    
    try {
      await processor.showAvailableTags(etapa1FinalPath);
      console.log("");
    } catch (error) {
      console.error(`⚠️  Could not show tags: ${error instanceof Error ? error.message : String(error)}`);
      console.log("");
    }
    
    console.log("✅ ETAPA 1 concluída!");
    console.log("");
  } else {
    etapa1FinalPath = inputFile;
    console.log("⏭️  Pulando ETAPA 1 (usando arquivo fornecido)");
    console.log("");
  }
  
  // Se for apenas Fase 1, parar aqui
  if (fase1Only) {
    console.log("📊 Resumo ETAPA 1:");
    console.log(`   Arquivo ETAPA 1 final: ${etapa1FinalPath}`);
    console.log("");
    console.log("✅ Processo concluído - apenas Fase 1 executada!");
    console.log("💡 Para executar Fase 2, rode sem --fase-1-only");
    return;
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
  
  // Usar arquivo final da ETAPA 1 como base
  const etapa2BasePath = etapa1FinalPath;
  
  // Estratégia simplificada: Filtrar diretamente do arquivo da ETAPA 1.6
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
    // IMPORTANTE: Não usar --omit-referenced para preservar geometria de ways/relations
    etapa2aPath = await processor.extractTags(etapa2BasePath, tourismHistoricTags, false);
    console.log(`✅ ETAPA 2.1 complete: ${etapa2aPath}`);
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 2.1: ${error instanceof Error ? error.message : String(error)}`);
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
    // Primeiro, filtrar objetos SEM access restritivo (do arquivo da ETAPA 1.6)
    // IMPORTANTE: Não usar --omit-referenced para preservar geometria de ways/relations
    const semAccessRestritivo = await processor.extractTags(etapa2BasePath, restrictiveAccessTags, false, true); // true = invertMatch
    
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
    // IMPORTANTE: Não usar --omit-referenced para preservar geometria de ways/relations
    etapa2bPath = await processor.extractTags(semAccessRestritivo, otherCategoryTags, false);
    console.log(`✅ ETAPA 2.2 complete: ${etapa2bPath}`);
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 2.2: ${error instanceof Error ? error.message : String(error)}`);
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
    console.error(`❌ Error in ETAPA 2.3: ${error instanceof Error ? error.message : String(error)}`);
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
    // Re-filter SEM --omit-referenced para preservar geometria de ways/relations
    // IMPORTANTE: Não usar --omit-referenced para preservar nodes necessários
    const reFilteredPath = await processor.extractTags(etapa2MergePath, tagsToKeep, false);
    await Deno.rename(reFilteredPath, etapa2ReFilteredPath);
    console.log(`✅ ETAPA 2.4 complete: ${etapa2ReFilteredPath}`);
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 2.4: ${error instanceof Error ? error.message : String(error)}`);
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
    // IMPORTANTE: Não usar --omit-referenced para preservar geometria
    const tourismHistoricPath = await processor.extractTags(etapa2ReFilteredPath, tourismHistoricTags, false);
    
    // 2. Extrair objetos SEM access restritivo (mantém todos sem restrições)
    // IMPORTANTE: Não usar --omit-referenced para preservar geometria
    const semAccessRestritivoPath = await processor.extractTags(etapa2ReFilteredPath, restrictiveAccessTags, false, true); // true = invertMatch
    
    // 3. Merge dos dois conjuntos
    await processor.mergeFiles([tourismHistoricPath, semAccessRestritivoPath], etapa2Merge2Path);
    
    console.log(`✅ ETAPA 2.5 (merge) complete: ${etapa2Merge2Path}`);
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 2.5: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
  
  // Step 2.6: Re-filter após merge da ETAPA 2.5 para garantir precisão
  // O merge pode incluir objetos relacionados que não foram explicitamente filtrados
  console.log("📋 ETAPA 2.6: Re-filtrando após merge para garantir precisão...");
  console.log("   (Remove objetos relacionados que não têm as tags corretas)");
  console.log("");
  
  const etapa2FinalPath = join(outputDir, `etapa2-access-filtered-${timestamp}.osm.pbf`);
  
  try {
    // Re-filter SEM --omit-referenced para preservar geometria de ways/relations
    // IMPORTANTE: Não usar --omit-referenced para preservar nodes necessários
    const reFilteredPath = await processor.extractTags(etapa2Merge2Path, tagsToKeep, false);
    await Deno.rename(reFilteredPath, etapa2FinalPath);
    console.log(`✅ ETAPA 2.6 complete: ${etapa2FinalPath}`);
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 2.6: ${error instanceof Error ? error.message : String(error)}`);
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
    console.error(`⚠️  Could not show tags: ${error instanceof Error ? error.message : String(error)}`);
    console.log("");
  }
  
  console.log("✅ ETAPA 2 concluída!");
  console.log("");
  
  // Se for apenas até Fase 2, parar aqui
  if (skipEtapa3) {
    console.log("📊 Resumo até ETAPA 2:");
    console.log(`   Arquivo ETAPA 1: ${etapa1FinalPath}`);
    console.log(`   Arquivo ETAPA 2: ${etapa2FinalPath}`);
    console.log("");
    console.log("✅ Processo concluído até ETAPA 2!");
    console.log("💡 Execute sem --skip-etapa3 para incluir ETAPA 3");
    return;
  }
  
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
    // IMPORTANTE: Não usar --omit-referenced para preservar geometria de ways/relations
    const tourismHistoricPath = await processor.extractTags(etapa2FinalPath, tourismHistoricTags, false);
    filesToMerge.push(tourismHistoricPath);
    console.log(`✅ ETAPA 3.1 complete: ${tourismHistoricPath}`);
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 3.1: ${error instanceof Error ? error.message : String(error)}`);
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
    // IMPORTANTE: Não usar --omit-referenced para preservar geometria de áreas (ways/relations)
    const tempNaturalPath = await processor.extractTags(etapa2FinalPath, naturalTags, false);
    
    // Filtrar natural com name (exceto tree/wood/waterfall)
    // Nota: natural=peak com ele >= 500m será tratado no banco de dados
    // Nota: natural=water com name é importante para turismo (lagos, lagoas, etc.)
    const naturalWithNameTags = [
      "natural=water", "natural=beach", "natural=cliff", "natural=cave", "natural=volcano",
      "natural=geyser", "natural=hot_spring", "natural=peak"
    ];
    const naturalWithNamePath = await processor.extractTags(tempNaturalPath, naturalWithNameTags, false);
    const naturalNamePath = await processor.extractTags(naturalWithNamePath, ["name"], false);
    filesToMerge.push(naturalNamePath);
    
    // Filtrar natural com wikipedia
    const naturalWikipediaPath = await processor.extractTags(tempNaturalPath, ["wikipedia"], false);
    filesToMerge.push(naturalWikipediaPath);
    
    // Filtrar natural com wikidata
    const naturalWikidataPath = await processor.extractTags(tempNaturalPath, ["wikidata"], false);
    filesToMerge.push(naturalWikidataPath);
    
    // Filtrar natural com description
    const naturalDescriptionPath = await processor.extractTags(tempNaturalPath, ["description"], false);
    filesToMerge.push(naturalDescriptionPath);
    
    // Filtrar natural com website
    const naturalWebsitePath = await processor.extractTags(tempNaturalPath, ["website"], false);
    filesToMerge.push(naturalWebsitePath);
    
    console.log(`✅ ETAPA 3.2 complete: ${filesToMerge.length - 1} arquivos criados`);
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 3.2: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
  
  // 3.3: Leisure com indicadores de importância
  console.log("📋 ETAPA 3.3: Filtrando leisure com indicadores de importância...");
  console.log("");
  
  const leisureTags = ["leisure=park", "leisure=stadium"];
  
  try {
    // Primeiro, filtrar todos os leisure
    // IMPORTANTE: Não usar --omit-referenced para preservar geometria de áreas (ways/relations)
    const tempLeisurePath = await processor.extractTags(etapa2FinalPath, leisureTags, false);
    
    // Filtrar leisure com name (sem omit-referenced para preservar geometria)
    const leisureNamePath = await processor.extractTags(tempLeisurePath, ["name"], false);
    filesToMerge.push(leisureNamePath);
    
    // Filtrar leisure com wikipedia
    const leisureWikipediaPath = await processor.extractTags(tempLeisurePath, ["wikipedia"], false);
    filesToMerge.push(leisureWikipediaPath);
    
    // Filtrar leisure com wikidata
    const leisureWikidataPath = await processor.extractTags(tempLeisurePath, ["wikidata"], false);
    filesToMerge.push(leisureWikidataPath);
    
    // Filtrar leisure com description
    const leisureDescriptionPath = await processor.extractTags(tempLeisurePath, ["description"], false);
    filesToMerge.push(leisureDescriptionPath);
    
    // Filtrar leisure com website
    const leisureWebsitePath = await processor.extractTags(tempLeisurePath, ["website"], false);
    filesToMerge.push(leisureWebsitePath);
    
    // Filtrar leisure=park com park:type
    const leisureParkPath = await processor.extractTags(tempLeisurePath, ["leisure=park"], false);
    const leisureParkTypePath = await processor.extractTags(leisureParkPath, ["park:type"], false);
    filesToMerge.push(leisureParkTypePath);
    
    // Filtrar leisure=park com operator
    const leisureOperatorPath = await processor.extractTags(leisureParkPath, ["operator"], false);
    filesToMerge.push(leisureOperatorPath);
    
    console.log(`✅ ETAPA 3.3 complete: ${filesToMerge.length - 6} arquivos criados`);
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 3.3: ${error instanceof Error ? error.message : String(error)}`);
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
    console.error(`❌ Error in ETAPA 3.4: ${error instanceof Error ? error.message : String(error)}`);
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
    console.error(`❌ Error in ETAPA 3.5: ${error instanceof Error ? error.message : String(error)}`);
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
    console.error(`❌ Error in ETAPA 3.6: ${error instanceof Error ? error.message : String(error)}`);
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
    // Re-filter SEM --omit-referenced para preservar geometria de ways/relations
    // IMPORTANTE: Não usar --omit-referenced para preservar nodes necessários
    const reFilteredPath = await processor.extractTags(etapa3MergePath, allCategoryTags, false);
    await Deno.rename(reFilteredPath, etapa3FinalPath);
    console.log(`✅ ETAPA 3.7 complete: ${etapa3FinalPath}`);
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 3.7: ${error instanceof Error ? error.message : String(error)}`);
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
    console.error(`⚠️  Could not show tags: ${error instanceof Error ? error.message : String(error)}`);
    console.log("");
  }
  
  console.log("✅ ETAPA 3 concluída!");
  console.log("");
  
  // ETAPA 4-5.7 UNIFICADA: Filtros de Valor Turístico
  // Remove POIs sem valor turístico (unifica ETAPAs 4, 5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.7)
  let etapa4_5FinalPath: string | null = null;
  
  if (fase4Only) {
    // Se for apenas Fase 4, usar arquivo fornecido como input
    const etapa3File = args.find(arg => !arg.startsWith("--"));
    if (!etapa3File) {
      console.error("❌ Erro: --fase-4-only requer um arquivo PBF como argumento");
      console.error("   Exemplo: deno run filter-pbf-tourism.ts arquivo.pbf --fase-4-only");
      Deno.exit(1);
    }
    // Usar função antiga para compatibilidade
    etapa4_5FinalPath = await executeEtapa4(processor, etapa3File, outputDir, timestamp);
  } else if (!skipEtapa3 && etapa3FinalPath) {
    etapa4_5FinalPath = await executeEtapa4_5_Unified(processor, etapa3FinalPath, outputDir, timestamp);
  }
  
  // ETAPA 5.6: Remove Duplicate POIs
  // Remove duplicatas reais (mesma localização), mantendo apenas 1 entrada
  // IMPORTANTE: Executar APÓS todos os filtros de valor turístico
  let etapa5_6FinalPath: string | null = null;
  
  if (etapa4_5FinalPath) {
    etapa5_6FinalPath = await executeEtapa5_6(etapa4_5FinalPath, outputDir, timestamp);
  }
  
  console.log("📊 Resumo Final:");
  console.log(`   Arquivo ETAPA 1: ${etapa1FinalPath}`);
  console.log(`   Arquivo ETAPA 2: ${etapa2FinalPath}`);
  if (!skipEtapa3) {
    console.log(`   Arquivo ETAPA 3: ${etapa3FinalPath}`);
    if (etapa4_5FinalPath) {
      console.log(`   Arquivo ETAPA 4-5.7 (UNIFICADA): ${etapa4_5FinalPath}`);
    }
    if (etapa5_6FinalPath) {
      console.log(`   Arquivo ETAPA 5.6: ${etapa5_6FinalPath}`);
    }
  } else {
    console.log(`   ETAPA 3: Pulada (--skip-etapa3 ou --fase-2-only)`);
  }
  console.log("");
  console.log("💡 NOTA: ETAPA 1 agora inclui:");
  console.log("   • Remoção de highways (mesmo com tourism/historic)");
  console.log("   • Adição de igrejas católicas (amenity=place_of_worship + denomination católica)");
  console.log("");
}

/**
 * ETAPA 4-5.7 UNIFICADA: Filtros de Valor Turístico
 * 
 * Esta função unifica as ETAPAs 4, 5, 5.1, 5.2, 5.3, 5.4, 5.5 e 5.7 em uma única passagem,
 * aplicando todos os critérios de filtro de valor turístico de forma eficiente.
 * 
 * Critérios aplicados (em ordem lógica, mas independentes):
 * - ETAPA 4: POIs sem nome E sem referências, fazendas, aeródromos privados
 * - ETAPA 5: POIs genéricos sem valor (infraestrutura técnica, nomes genéricos, estádios/cemitérios)
 * - ETAPA 5.1: Bancos e instituições financeiras sem valor turístico
 * - ETAPA 5.2: Estradas, ruas, avenidas e vias de trâfego
 * - ETAPA 5.3: Nomes genéricos sem contexto (mirante, monumento, busto, etc.)
 * - ETAPA 5.4: POIs específicos sem valor (Rotary, SESC, Torre, Trilha, Via de acesso, Vila)
 * - ETAPA 5.5: Infraestrutura e serviços (aeródromos, escolas, serviços públicos, comércio)
 * - ETAPA 5.7: POIs com nome de 1 palavra sem valor (sem Wikipedia/Wikidata/descrição)
 * 
 * Vantagens da unificação:
 * - Reduz de 8 passagens para 1 passagem sobre os dados
 * - Melhor performance (menos I/O de arquivos)
 * - Código mais simples e manutenível
 * - Resultado final idêntico (filtros independentes)
 */
async function executeEtapa4_5_Unified(
  processor: PBFProcessor,
  inputPath: string,
  outputDir: string,
  timestamp: number
): Promise<string> {
  console.log("=".repeat(60));
  console.log("📋 ETAPA 4-5.7 UNIFICADA: Filtros de Valor Turístico");
  console.log("=".repeat(60));
  console.log("🎯 Objetivo: Remover POIs sem valor turístico identificável");
  console.log("");
  console.log("📊 Critérios aplicados (todos em uma única passagem):");
  console.log("   • ETAPA 4: POIs sem nome E sem refs, fazendas, aeródromos privados");
  console.log("   • ETAPA 5: POIs genéricos sem valor (infraestrutura, nomes genéricos)");
  console.log("   • ETAPA 5.1: Bancos e instituições financeiras");
  console.log("   • ETAPA 5.2: Estradas, ruas, avenidas e vias de trâfego");
  console.log("   • ETAPA 5.3: Nomes genéricos sem contexto");
  console.log("   • ETAPA 5.4: POIs específicos (Rotary, SESC, Torre, etc.)");
  console.log("   • ETAPA 5.5: Infraestrutura e serviços");
  console.log("   • ETAPA 5.7: POIs com nome de 1 palavra sem valor");
  console.log("");
  
  // ============================================
  // FUNÇÕES AUXILIARES DE FILTRO (modulares)
  // ============================================
  
  // ETAPA 4: Critérios básicos
  function shouldRemoveEtapa4(poi: any): { remove: boolean; reason?: string } {
    const props = poi.properties || {};
    const name = (props.name || '').trim().toLowerCase();
    const hasName = name.length > 0;
    const hasWikipedia = !!props.wikipedia;
    const hasWikidata = !!props.wikidata;
    const hasReference = hasWikipedia || hasWikidata;
    const hasTourism = !!props.tourism;
    const hasHistoric = !!props.historic;
    const isTourismOrHistoric = hasTourism || hasHistoric;
    
    const isCatholicChurch = props['amenity'] === 'place_of_worship' && (
      props.denomination === 'catholic' || 
      props.denomination === 'roman_catholic' ||
      (props.religion && (props.religion.toLowerCase() === 'catholic' || props.religion.toLowerCase() === 'roman_catholic'))
    );
    
    // 1. POIs sem nome E sem referências (exceto tourism/historic/igreja)
    if (!hasName && !hasReference && !isTourismOrHistoric && !isCatholicChurch) {
      return { remove: true, reason: 'ETAPA 4: Sem nome e sem referências' };
    }
    
    // 2. Fazendas/propriedades privadas
    const fazendaKeywords = ['fazenda', 'farm', 'sítio', 'chácara', 'propriedade', 'sitio', 'chacara'];
    if (fazendaKeywords.some(kw => name.includes(kw))) {
      return { remove: true, reason: 'ETAPA 4: Fazenda/propriedade privada' };
    }
    
    // 3. Aeródromos privados (sem código IATA/ICAO)
    if (props.aeroway === 'aerodrome') {
      const hasIata = !!props.iata;
      const hasIcao = !!props.icao;
      const isFazenda = fazendaKeywords.some(kw => name.includes(kw));
      
      if (!hasIata && !hasIcao && (!hasName || isFazenda)) {
        return { remove: true, reason: 'ETAPA 4: Aeródromo privado sem código' };
      }
    }
    
    return { remove: false };
  }
  
  // ETAPA 5: Critérios rigorosos (lógica completa da função executeEtapa5)
  function shouldRemoveEtapa5(poi: any): { remove: boolean; reason?: string } {
    const props = poi.properties || {};
    const name = (props.name || '').trim();
    const nameLower = name.toLowerCase();
    
    const hasName = name.length > 0;
    const hasWikipedia = !!props.wikipedia;
    const hasWikidata = !!props.wikidata;
    const hasReference = hasWikipedia || hasWikidata;
    const hasTourism = !!props.tourism;
    const hasHistoric = !!props.historic;
    const hasDescription = !!props.description;
    const hasWebsite = !!props.website;
    
    // CRITÉRIO 1: SEM NOME E SEM REFERÊNCIAS (sem tourism/historic)
    if (!hasName && !hasReference && !hasTourism && !hasHistoric) {
      return { remove: true, reason: 'ETAPA 5: Sem nome e sem referências' };
    }
    
    // CRITÉRIO 2: NOME MUITO CURTO (≤3 caracteres) E SEM REFERÊNCIAS
    if (name.length > 0 && name.length <= 3 && !hasReference) {
      return { remove: true, reason: 'ETAPA 5: Nome muito curto sem referências' };
    }
    
    // CRITÉRIO 3: NOME GENÉRICO SEM CONTEXTO E SEM REFERÊNCIAS
    const genericNames = [
      /^parque$/i, /^praça$/i, /^igreja$/i, /^capela$/i, /^monumento$/i, /^memorial$/i,
      /^lago$/i, /^lagoa$/i, /^cachoeira$/i, /^ponte$/i, /^museu$/i,
      /^estádio$/i, /^estadio$/i, /^cemitério$/i, /^cemiterio$/i,
      /^praça\s+[a-z]$/i, /^parque\s+[a-z]$/i,
    ];
    
    if (genericNames.some(p => p.test(name)) && !hasReference) {
      const isReallyGeneric = name.length <= 10 && !hasDescription && !hasWebsite;
      if (isReallyGeneric) {
        return { remove: true, reason: 'ETAPA 5: Nome genérico sem contexto' };
      }
    }
    
    // CRITÉRIO 4: INFRAESTRUTURA TÉCNICA SEM VALOR TURÍSTICO
    const infrastructure = [
      /usina/i, /represa/i, /barragem/i, /estação de tratamento/i,
      /estação elevatória/i, /estação de água/i, /reservatório/i,
      /captação/i, /subestação/i, /torre de transmissão/i,
      /casa de máquinas/i, /casa de bombas/i,
    ];
    
    if (infrastructure.some(p => p.test(name))) {
      const hasTourismValue = hasTourism || hasHistoric || hasReference;
      if (!hasTourismValue) {
        return { remove: true, reason: 'ETAPA 5: Infraestrutura técnica sem valor turístico' };
      }
    }
    
    // CRITÉRIO 5: CEMITÉRIOS GENÉRICOS
    const cemeteries = [
      /^cemitério municipal$/i, /^cemiterio municipal$/i,
      /^antigo cemiterio$/i, /^antigo cemitério$/i,
    ];
    
    const famousCemeteries = ['consolação', 'são joão batista', 'santa ifigênia'];
    const isFamous = famousCemeteries.some(f => nameLower.includes(f));
    
    if (cemeteries.some(p => p.test(name)) ||
        props.amenity === 'grave_yard' || props.amenity === 'cemetery' || props.landuse === 'cemetery') {
      const hasTourismValue = hasTourism || hasReference || isFamous;
      if (!hasTourismValue) {
        return { remove: true, reason: 'ETAPA 5: Cemitério genérico sem valor turístico' };
      }
    }
    
    // CRITÉRIO 6: ESTÁDIOS GENÉRICOS
    const stadiums = [
      /^campo de futebol$/i, /^ginásio de esportes$/i,
      /^estádio municipal$/i, /^estadio municipal$/i, /^quadra de futebol$/i,
    ];
    
    const famousStadiums = ['maracanã', 'morumbi', 'allianz parque', 'arena corinthians', 'pacaembu', 'mané garrincha', 'mineirão', 'beira-rio'];
    const isFamousStadium = famousStadiums.some(f => nameLower.includes(f));
    
    if (stadiums.some(p => p.test(name)) || props.leisure === 'stadium') {
      const hasTourismValue = hasTourism || hasHistoric || hasReference || isFamousStadium;
      if (!hasTourismValue) {
        return { remove: true, reason: 'ETAPA 5: Estádio genérico sem valor turístico' };
      }
    }
    
    return { remove: false };
  }
  
  // ETAPA 5.1: Bancos (lógica simplificada - manter apenas essencial)
  function shouldRemoveEtapa5_1(poi: any): { remove: boolean; reason?: string } {
    const props = poi.properties || {};
    const name = (props.name || '').trim().toLowerCase();
    const amenity = (props.amenity || '').toLowerCase();
    const tourism = (props.tourism || '').toLowerCase();
    
    const hasTourism = !!props.tourism;
    const hasHistoric = !!props.historic;
    const hasReference = !!props.wikipedia || !!props.wikidata;
    
    // Bancos INSTITUIÇÕES (amenity=bank/atm) - REMOVER SEMPRE (exceto turísticos válidos)
    if (amenity === 'bank' || amenity === 'atm') {
      const padroesNaoBanco = [
        /itaúnas/i, /itaúna/i, /caixa d['\']?água/i, /caixa d['\']?agua/i,
        /caixa dagua/i, /caixa de/i, /banco de areia/i, /banco de pedra/i,
        /banco do parque/i, /bancos do parque/i, /banco da coroa/i,
        /banco da praia/i, /banco do rio/i, /banco memorial/i,
        /praça.*banco/i, /parque.*banco/i,
      ];
      
      const isNotBank = padroesNaoBanco.some(pattern => pattern.test(name));
      if (!isNotBank) {
        const bancosTuristicosValidos = [
          /centro cultural.*banco/i, /farol.*santander/i,
          /museu.*banco/i, /teatro.*bradesco/i, /teatro.*banco/i,
          /casa.*banco/i,
        ];
        
        const isException = bancosTuristicosValidos.some(pattern => pattern.test(name));
        const isRealCultural = amenity === 'museum' || amenity === 'theatre' || amenity === 'arts_centre' ||
                             tourism === 'museum' || tourism === 'theatre';
        
        if (!isException && !isRealCultural) {
          return { remove: true, reason: 'ETAPA 5.1: Banco instituição sem valor turístico' };
        }
      }
    }
    
    // Nomes de bancos conhecidos (sem ser lugar)
    const bancosInstituicoes = [
      'banco do brasil', 'banco bradesco', 'bradesco', 'banco itaú', 'banco itau',
      'itau', 'itaú', 'banco santander', 'santander', 'caixa econômica federal',
      'caixa economica federal', 'caixa econômica', 'caixa economica',
    ];
    
    const matchedBank = bancosInstituicoes.find(banco => {
      if (!name.includes(banco)) return false;
      const padroesNaoBanco = [/itaúnas/i, /itaúna/i, /caixa d['\']?água/i];
      return !padroesNaoBanco.some(pattern => pattern.test(name));
    });
    
    if (matchedBank) {
      const placeKeywords = ['parque', 'praça', 'pedra', 'morro', 'estadual', 'municipal'];
      const isPlace = placeKeywords.some(keyword => name.includes(keyword));
      
      if (!isPlace) {
        const bancosTuristicosValidos = [/centro cultural.*banco/i, /museu.*banco/i];
        const isException = bancosTuristicosValidos.some(pattern => pattern.test(name));
        const isRealCultural = amenity === 'museum' || amenity === 'theatre';
        
        if (!isException && !isRealCultural) {
          return { remove: true, reason: 'ETAPA 5.1: Banco instituição conhecido sem valor turístico' };
        }
      }
    }
    
    return { remove: false };
  }
  
  // ETAPA 5.2: Estradas, ruas, avenidas (lógica simplificada)
  function shouldRemoveEtapa5_2(poi: any): { remove: boolean; reason?: string } {
    const props = poi.properties || {};
    const name = (props.name || '').trim();
    
    if (!name) return { remove: false };
    
    const padroesInicioVia = [
      /^estrada/i, /^rua/i, /^avenida/i, /^av\./i, /^av /i,
      /^rodovia/i, /^rod\./i, /^rod /i, /^via/i, /^alameda/i,
      /^travessa/i, /^beco/i, /^passagem/i, /^ruela/i,
    ];
    
    // Exceções: praças com nomes de vias (ex: "Praça da Avenida")
    if (name.toLowerCase().startsWith('praça')) {
      return { remove: false };
    }
    
    // Verificar se começa com padrão de via
    if (padroesInicioVia.some(pattern => pattern.test(name))) {
      return { remove: true, reason: 'ETAPA 5.2: Estrada/rua/avenida' };
    }
    
    // Verificar padrões no meio (ex: "Av. Paulista")
    const padroesMeioVia = [
      /\s+av\./i, /\s+av\s+/i, /\s+avenida\s+/i,
      /\s+rua\s+/i, /\s+estrada\s+/i, /\s+rodovia\s+/i,
    ];
    
    if (padroesMeioVia.some(pattern => pattern.test(name))) {
      // Verificar se não é praça
      if (!name.toLowerCase().startsWith('praça')) {
        return { remove: true, reason: 'ETAPA 5.2: Nome contém padrão de via' };
      }
    }
    
    return { remove: false };
  }
  
  // ETAPA 5.3: Nomes genéricos sem contexto (lógica simplificada)
  function shouldRemoveEtapa5_3(poi: any): { remove: boolean; reason?: string } {
    const props = poi.properties || {};
    const name = (props.name || '').trim();
    
    if (!name) return { remove: false };
    
    // Verificar se tem valor turístico explícito - sempre manter
    if (props.wikipedia || props.wikidata || props.historic === 'monument' || props.historic === 'memorial') {
      return { remove: false };
    }
    
    const termosGenericos = [
      { termo: 'mirante', minLength: 20 },
      { termo: 'monumento', minLength: 25 },
      { termo: 'busto', minLength: 15 },
      { termo: 'estátua', minLength: 20 },
      { termo: 'estatua', minLength: 20 },
      { termo: 'escultura', minLength: 25 },
      { termo: 'memorial', minLength: 20 },
      { termo: 'marco', minLength: 15 },
      { termo: 'cruzeiro', minLength: 20 },
    ];
    
    const nameLower = name.toLowerCase();
    
    for (const { termo, minLength } of termosGenericos) {
      if (nameLower.includes(termo)) {
        // Verificar se tem contexto (exceções válidas)
        const excecoesValidas = [
          /marco zero/i,
          /cruzeiro.*(santo|santa|são|nossa senhora)/i,
          /cruzeiro.*(praça|bairro)/i,
          /mirante.*(de|do|da|das|dos)\s+[a-záàâãéêíóôõúç]+/i,
          /monumento.*(ao|à|de|do|da|das|dos)\s+[a-záàâãéêíóôõúç]+/i,
        ];
        
        const isException = excecoesValidas.some(pattern => pattern.test(name));
        if (isException) {
          return { remove: false };
        }
        
        // Verificar se nome é muito curto (sem contexto)
        if (name.length < minLength) {
          // Verificar se tem apenas números ou é muito genérico
          if (/^\s*(mirante|monumento|busto|estátua|estatua|escultura|memorial|cruzeiro)\s*(\d+|$)/i.test(name)) {
            return { remove: true, reason: `ETAPA 5.3: ${termo} genérico sem contexto` };
          }
          
          // Se é apenas o termo genérico, remover
          if (nameLower === termo || nameLower === termo + ' 1' || nameLower === termo + ' 2') {
            return { remove: true, reason: `ETAPA 5.3: ${termo} sem contexto` };
          }
          
          // Se tem preposição, pode ter contexto (manter)
          if (nameLower.includes(' de ') || nameLower.includes(' do ') || nameLower.includes(' da ')) {
            return { remove: false };
          }
        }
        
        // Se nome é longo o suficiente, tem contexto
        if (name.length >= minLength) {
          return { remove: false };
        }
      }
    }
    
    // Verificar nomes muito genéricos sem termo específico
    const nomeMuitoGenerico = /^(mirante|monumento|busto|estátua|estatua|escultura|memorial|cruzeiro|marco)(\s+\d+)?$/i;
    if (nomeMuitoGenerico.test(name)) {
      return { remove: true, reason: 'ETAPA 5.3: Nome muito genérico' };
    }
    
    return { remove: false };
  }
  
  // ETAPA 5.4: POIs específicos (Rotary, SESC, Torre, etc.)
  function shouldRemoveEtapa5_4(poi: any): { remove: boolean; reason?: string } {
    const props = poi.properties || {};
    const name = (props.name || '').trim();
    
    if (!name) return { remove: false };
    
    const nameLower = name.toLowerCase();
    
    // Verificar se tem valor turístico explícito - SEMPRE manter
    const temValorTuristico = !!props.tourism || 
                              !!props.historic || 
                              !!props.wikipedia || 
                              !!props.wikidata ||
                              props.historic === 'monument' ||
                              props.historic === 'memorial' ||
                              props.historic === 'building' ||
                              props.historic === 'ruins';
    
    if (temValorTuristico) {
      return { remove: false };
    }
    
    // Termos específicos a remover
    const termosRemover = ['rotary', 'sesc', 'trilha', 'via de acesso', 'vila'];
    
    for (const termo of termosRemover) {
      if (nameLower.includes(termo)) {
        if (termo === 'rotary' || termo === 'sesc') {
          return { remove: true, reason: `ETAPA 5.4: ${termo} sem valor turístico` };
        }
        
        if (termo === 'trilha') {
          if (!nameLower.startsWith('praça')) {
            return { remove: true, reason: 'ETAPA 5.4: Trilha sem valor turístico' };
          }
        }
        
        if (termo === 'via de acesso') {
          return { remove: true, reason: 'ETAPA 5.4: Via de acesso' };
        }
        
        if (termo === 'vila') {
          if (!nameLower.startsWith('praça')) {
            return { remove: true, reason: 'ETAPA 5.4: Vila sem valor turístico' };
          }
        }
      }
    }
    
    // Verificar "torre" separadamente
    if (nameLower.includes('torre')) {
      const excecoesTorre = [
        /torres?\s+(de|do|da|das|dos)\s+/i,
        /torre\s+(telecomunicações|telefonia|televisão|rádio|observatório|mira|relógio|eiffel)/i,
        /torre\s+\d+/i,
        /^torre$/i,
      ];
      
      const isRealTower = excecoesTorre.some(pattern => pattern.test(name));
      if (isRealTower) {
        return { remove: true, reason: 'ETAPA 5.4: Torre genérica sem valor turístico' };
      }
    }
    
    return { remove: false };
  }
  
  // ETAPA 5.5: Infraestrutura e serviços
  function shouldRemoveEtapa5_5(poi: any): { remove: boolean; reason?: string } {
    const props = poi.properties || {};
    const name = (props.name || '').trim().toLowerCase();
    
    // Verificar se tem valor turístico explícito - SEMPRE manter
    const temValorTuristico = !!props.tourism || 
                              !!props.historic || 
                              !!props.wikipedia || 
                              !!props.wikidata ||
                              props.historic === 'monument' ||
                              props.historic === 'memorial' ||
                              props.historic === 'building' ||
                              props.historic === 'ruins';
    
    if (temValorTuristico) {
      return { remove: false };
    }
    
    // 1. Aeródromos/Aeroportos
    if (props.aeroway === 'aerodrome' || props.aeroway === 'airport' || 
        props.aeroway === 'helipad' || props.aeroway === 'heliport') {
      return { remove: true, reason: 'ETAPA 5.5: Aeródromo/aeroporto sem valor turístico' };
    }
    
    if (name.includes('aeródromo') || name.includes('aerodromo') || 
        name.includes('aeroporto') || name.includes('heliponto')) {
      return { remove: true, reason: 'ETAPA 5.5: Aeródromo por nome' };
    }
    
    // 2. Escolas/Universidades
    if (props.amenity === 'school' || props.amenity === 'university' || 
        props.amenity === 'college' || props.amenity === 'kindergarten') {
      return { remove: true, reason: 'ETAPA 5.5: Escola/universidade sem valor turístico' };
    }
    
    if ((name.includes('escola') || name.includes('colégio') || name.includes('colegio') ||
         name.includes('universidade') || name.includes('faculdade')) &&
        !name.includes('escola de samba') && !name.includes('escola de arte')) {
      return { remove: true, reason: 'ETAPA 5.5: Escola por nome sem valor turístico' };
    }
    
    // 3. Serviços Públicos
    if (props.amenity === 'police' || props.amenity === 'fire_station' ||
        props.amenity === 'townhall' || props.amenity === 'courthouse' ||
        props.amenity === 'post_office') {
      return { remove: true, reason: 'ETAPA 5.5: Serviço público sem valor turístico' };
    }
    
    // 4. Serviços de Saúde
    if (props.amenity === 'hospital' || props.amenity === 'clinic' ||
        props.amenity === 'pharmacy' || props.amenity === 'veterinary' ||
        props.amenity === 'dentist') {
      return { remove: true, reason: 'ETAPA 5.5: Serviço de saúde sem valor turístico' };
    }
    
    // 5. Bibliotecas
    if (props.amenity === 'library') {
      return { remove: true, reason: 'ETAPA 5.5: Biblioteca sem valor turístico' };
    }
    
    // 6. Comércio genérico
    if (props.shop) {
      return { remove: true, reason: 'ETAPA 5.5: Comércio genérico sem valor turístico' };
    }
    
    // 7. Infraestrutura
    if (props.amenity === 'parking' || props.amenity === 'charging_station' ||
        props.amenity === 'toilets' || props.amenity === 'bench' ||
        props.amenity === 'waste_basket' || props.amenity === 'drinking_water') {
      return { remove: true, reason: 'ETAPA 5.5: Infraestrutura sem valor turístico' };
    }
    
    if (props.amenity === 'fountain' && name.length <= 10) {
      return { remove: true, reason: 'ETAPA 5.5: Fonte genérica sem valor turístico' };
    }
    
    // 8. Infraestrutura de lazer não turística
    if (props.leisure === 'track' || props.leisure === 'pitch' ||
        props.leisure === 'playground' || props.leisure === 'fitness_centre' ||
        props.leisure === 'gym' || props.leisure === 'sports_centre') {
      return { remove: true, reason: 'ETAPA 5.5: Infraestrutura de lazer sem valor turístico' };
    }
    
    // 9. Transporte público
    if (props.public_transport === 'platform' || 
        props.highway === 'bus_stop' || props.highway === 'platform') {
      return { remove: true, reason: 'ETAPA 5.5: Transporte público sem valor turístico' };
    }
    
    // 10. Escritórios
    if (props.office) {
      return { remove: true, reason: 'ETAPA 5.5: Escritório sem valor turístico' };
    }
    
    // 11. Uso do solo comercial/industrial/residencial
    if (props.landuse === 'commercial' || props.landuse === 'industrial' ||
        props.landuse === 'residential' || props.landuse === 'retail') {
      return { remove: true, reason: 'ETAPA 5.5: Uso do solo não turístico' };
    }
    
    return { remove: false };
  }
  
  // ETAPA 5.7: POIs com nome de 1 palavra sem valor
  function shouldRemoveEtapa5_7(poi: any): { remove: boolean; reason?: string } {
    const props = poi.properties || {};
    const name = props.name;
    
    // Verificar se tem nome de apenas 1 palavra
    function isSingleWord(name: string | undefined): boolean {
      if (!name || !name.trim()) return false;
      const words = name.trim().split(/\s+/).filter(w => w.length > 0);
      return words.length === 1;
    }
    
    if (!isSingleWord(name)) {
      return { remove: false };
    }
    
    // Verificar se tem valor turístico identificável
    const hasWikipedia = !!props.wikipedia;
    const hasWikidata = !!props.wikidata;
    const hasDescription = props.description && props.description.trim().length > 0;
    
    if (hasWikipedia || hasWikidata || hasDescription) {
      return { remove: false };
    }
    
    return { remove: true, reason: 'ETAPA 5.7: Nome de 1 palavra sem valor identificável' };
  }
  
  // ============================================
  // FUNÇÃO PRINCIPAL DE FILTRO UNIFICADA
  // ============================================
  
  function shouldRemovePOI(poi: any): { remove: boolean; reason?: string } {
    // Aplicar todos os critérios em ordem (mas são independentes)
    const checks = [
      shouldRemoveEtapa4(poi),
      shouldRemoveEtapa5(poi),
      shouldRemoveEtapa5_1(poi),
      shouldRemoveEtapa5_2(poi),
      shouldRemoveEtapa5_3(poi),
      shouldRemoveEtapa5_4(poi),
      shouldRemoveEtapa5_5(poi),
      shouldRemoveEtapa5_7(poi),
    ];
    
    // Se qualquer critério indica remoção, remover
    for (const check of checks) {
      if (check.remove) {
        return check;
      }
    }
    
    return { remove: false };
  }
  
  // ============================================
  // PROCESSAMENTO DO ARQUIVO
  // ============================================
  
  // 4.1: Converter para GeoJSONSeq
  console.log("📋 ETAPA 4-5.7.1: Convertendo para GeoJSONSeq...");
  console.log("");
  
  const tempGeoJsonSeqPath = join(outputDir, `temp-etapa4_5_unified-${timestamp}.geojsonseq`);
  
  try {
    const command = new Deno.Command("osmium", {
      args: [
        "export",
        inputPath,
        "-f", "geojsonseq",
        "-o", tempGeoJsonSeqPath,
        "--overwrite"
      ],
      stdout: "piped",
      stderr: "piped"
    });
    
    const { code, stderr } = await command.output();
    
    if (code !== 0) {
      const error = new TextDecoder().decode(stderr);
      throw new Error(`Osmium export failed: ${error}`);
    }
    
    const fileSize = (await Deno.stat(tempGeoJsonSeqPath)).size;
    console.log(`✅ Conversão completa: ${tempGeoJsonSeqPath}`);
    console.log(`   Tamanho: ${(fileSize / 1024 / 1024).toFixed(1)}MB`);
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 4-5.7.1: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
  
  // 4-5.7.2: Filtrar POIs aplicando todos os critérios
  console.log("📋 ETAPA 4-5.7.2: Filtrando POIs (aplicando todos os critérios unificados)...");
  console.log("");
  
  const etapa4_5FinalPath = join(outputDir, `etapa4_5-unified-filtered-${timestamp}.geojson`);
  
  try {
    const file = await Deno.open(tempGeoJsonSeqPath, { read: true });
    const reader = file.readable.getReader();
    const decoder = new TextDecoder();
    
    let totalFeatures = 0;
    let validFeatures: any[] = [];
    let removedFeatures = 0;
    const removalStats: Record<string, number> = {};
    let buffer = "";
    let lineCount = 0;
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.substring(0, newlineIndex).trim();
          buffer = buffer.substring(newlineIndex + 1);
          
          if (line.length > 0) {
            try {
              const feature = JSON.parse(line);
              totalFeatures++;
              lineCount++;
              
              const check = shouldRemovePOI(feature);
              
              if (!check.remove) {
                validFeatures.push(feature);
              } else {
                removedFeatures++;
                const reason = check.reason || 'Desconhecido';
                removalStats[reason] = (removalStats[reason] || 0) + 1;
              }
              
              if (lineCount % 1000 === 0) {
                console.log(`   Processados: ${lineCount.toLocaleString()} features...`);
              }
            } catch (e) {
              // Ignorar linha inválida
            }
          }
        }
      }
      
      // Processar última linha se houver
      if (buffer.trim().length > 0) {
        try {
          const feature = JSON.parse(buffer.trim());
          totalFeatures++;
          lineCount++;
          
          const check = shouldRemovePOI(feature);
          
          if (!check.remove) {
            validFeatures.push(feature);
          } else {
            removedFeatures++;
            const reason = check.reason || 'Desconhecido';
            removalStats[reason] = (removalStats[reason] || 0) + 1;
          }
        } catch (e) {
          // Ignorar
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch (e) {
        // Ignorar
      }
      try {
        file.close();
      } catch (e) {
        // Ignorar
      }
    }
    
    console.log("");
    console.log(`   Total de POIs antes do filtro: ${totalFeatures.toLocaleString()}`);
    console.log(`   POIs removidos: ${removedFeatures.toLocaleString()}`);
    console.log(`   POIs válidos restantes: ${validFeatures.length.toLocaleString()}`);
    console.log(`   Redução: ${Math.round((removedFeatures / totalFeatures) * 100)}%`);
    console.log("");
    
    // Mostrar estatísticas de remoção por critério
    if (Object.keys(removalStats).length > 0) {
      console.log("📊 Remoções por critério:");
      const sortedStats = Object.entries(removalStats)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      
      sortedStats.forEach(([reason, count]) => {
        const percentage = ((count / removedFeatures) * 100).toFixed(1);
        console.log(`   • ${reason}: ${count.toLocaleString()} (${percentage}%)`);
      });
      console.log("");
    }
    
    // Criar novo GeoJSON filtrado
    const filteredGeoJson = {
      type: "FeatureCollection",
      features: validFeatures
    };
    
    await Deno.writeTextFile(etapa4_5FinalPath, JSON.stringify(filteredGeoJson));
    console.log(`✅ ETAPA 4-5.7.2 complete: ${etapa4_5FinalPath}`);
    console.log("");
    
    // Remover arquivo temporário
    try {
      await Deno.remove(tempGeoJsonSeqPath);
    } catch (e) {
      // Ignorar erro se arquivo já foi removido
    }
  } catch (error) {
    console.error(`❌ Error in ETAPA 4-5.7.2: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
  
  console.log("✅ ETAPA 4-5.7 UNIFICADA concluída!");
  console.log("");
  
  return etapa4_5FinalPath;
}

/**
 * ETAPA 4: Business Quality Filter (DEPRECATED - usar executeEtapa4_5_Unified)
 * Remove POIs problemáticos identificados na análise de negócios:
 * - POIs sem nome E sem referências (wikipedia/wikidata)
 * - Fazendas/propriedades privadas
 * - Aerodromos privados (sem código IATA/ICAO)
 * 
 * @deprecated Esta função foi unificada com ETAPA 5-5.7 em executeEtapa4_5_Unified()
 * Mantida apenas para compatibilidade com --fase-4-only
 */
async function executeEtapa4(
  processor: PBFProcessor,
  inputPath: string,
  outputDir: string,
  timestamp: number
): Promise<string> {
  console.log("📋 ETAPA 4: Filtro de Qualidade de Negócios");
  console.log("=".repeat(60));
  console.log("🎯 Objetivo: Remover POIs problemáticos identificados na análise");
  console.log("   - POIs sem nome E sem referências (wikipedia/wikidata)");
  console.log("   - Fazendas/propriedades privadas");
  console.log("   - Aerodromos privados (sem código IATA/ICAO)");
  console.log("");
  
  // 4.1: Converter para GeoJSONSeq (NDJSON) - formato mais leve e eficiente
  // GeoJSONSeq = uma linha por feature, permite processamento streaming
  console.log("📋 ETAPA 4.1: Convertendo para GeoJSONSeq (NDJSON)...");
  console.log("   💡 GeoJSONSeq é mais leve que GeoJSON tradicional");
  console.log("   💡 Permite processamento linha por linha (streaming)");
  console.log("");
  
  const tempGeoJsonSeqPath = join(outputDir, `temp-etapa4-${timestamp}.geojsonseq`);
  
  try {
    // Usar GeoJSONSeq (formato mais leve, uma linha por feature)
    const command = new Deno.Command("osmium", {
      args: [
        "export",
        inputPath,
        "-f", "geojsonseq",  // GeoJSONSeq = NDJSON (Newline Delimited JSON)
        "-o", tempGeoJsonSeqPath,
        "--overwrite"
      ],
      stdout: "piped",
      stderr: "piped"
    });
    
    const { code, stderr } = await command.output();
    
    if (code !== 0) {
      const error = new TextDecoder().decode(stderr);
      throw new Error(`Osmium export failed: ${error}`);
    }
    
    const fileSize = (await Deno.stat(tempGeoJsonSeqPath)).size;
    console.log(`✅ Conversão completa: ${tempGeoJsonSeqPath}`);
    console.log(`   Tamanho: ${(fileSize / 1024 / 1024).toFixed(1)}MB`);
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 4.1: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
  
  // 4.2: Filtrar POIs problemáticos
  console.log("📋 ETAPA 4.2: Filtrando POIs problemáticos...");
  console.log("");
  
  const filteredGeoJsonPath = join(outputDir, `etapa4-filtered-${timestamp}.geojson`);
  
  try {
    // Palavras-chave que indicam fazendas/propriedades
    const fazendaKeywords = [
      'fazenda', 'farm', 'sítio', 'chácara', 'propriedade',
      'sitio', 'chacara'
    ];
    
    // Função de filtro para POIs
    function shouldKeepPOI(poi: any): boolean {
      const props = poi.properties || {};
      const name = (props.name || '').trim().toLowerCase();
      const hasName = name.length > 0;
      const hasWikipedia = !!props.wikipedia;
      const hasWikidata = !!props.wikidata;
      const hasReference = hasWikipedia || hasWikidata;
      
      // IMPORTANTE: Manter POIs com tourism OU historic, mesmo sem nome
      // (são explicitamente marcados como turísticos/históricos)
      const hasTourism = !!props.tourism;
      const hasHistoric = !!props.historic;
      const isTourismOrHistoric = hasTourism || hasHistoric;
      
      // IMPORTANTE: Manter igrejas católicas, mesmo sem nome
      // (são importantes para turismo em cidades do interior)
      const isCatholicChurch = props['amenity'] === 'place_of_worship' && (
        props.denomination === 'catholic' || 
        props.denomination === 'roman_catholic' ||
        (props.religion && (props.religion.toLowerCase() === 'catholic' || props.religion.toLowerCase() === 'roman_catholic'))
      );
      
      // 1. Remover POIs sem nome E sem referências
      // EXCETO se tiver tourism OU historic OU for igreja católica (mantém mesmo sem nome)
      if (!hasName && !hasReference && !isTourismOrHistoric && !isCatholicChurch) {
        return false;
      }
      
      // 2. Remover fazendas/propriedades privadas
      if (fazendaKeywords.some(kw => name.includes(kw))) {
        return false;
      }
      
      // 3. Remover aerodromos privados (sem código IATA/ICAO e sem nome relevante)
      if (props.aeroway === 'aerodrome') {
        const hasIata = !!props.iata;
        const hasIcao = !!props.icao;
        const isFazenda = fazendaKeywords.some(kw => name.includes(kw));
        
        // Se não tem código E não tem nome válido OU é fazenda
        if (!hasIata && !hasIcao && (!hasName || isFazenda)) {
          return false;
        }
      }
      
      return true;
    }
    
    // Processar GeoJSON usando osmium para extrair apenas features necessários
    // Estratégia: Usar osmium para filtrar no PBF antes de converter para GeoJSON
    // Isso evita carregar todo o GeoJSON na memória
    console.log("   Usando osmium para filtrar diretamente no PBF antes da análise...");
    console.log("");
    
    // Processar GeoJSONSeq (NDJSON) linha por linha - muito mais eficiente!
    // GeoJSONSeq = uma linha = uma feature JSON completa
    console.log("   Processando GeoJSONSeq linha por linha (streaming nativo)...");
    console.log("");
    
    const file = await Deno.open(tempGeoJsonSeqPath, { read: true });
    const reader = file.readable.getReader();
    const decoder = new TextDecoder();
    
    let totalFeatures = 0;
    let validFeatures: any[] = [];
    let buffer = "";
    let lineCount = 0;
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        // Processar linhas completas (uma linha = uma feature)
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.substring(0, newlineIndex).trim();
          buffer = buffer.substring(newlineIndex + 1);
          
          if (line.length > 0) {
            try {
              const feature = JSON.parse(line);
              totalFeatures++;
              lineCount++;
              
              if (shouldKeepPOI(feature)) {
                validFeatures.push(feature);
              }
              
              if (lineCount % 1000 === 0) {
                console.log(`   Processados: ${lineCount.toLocaleString()} features...`);
              }
            } catch (e) {
              // Ignorar linha inválida
            }
          }
        }
      }
      
      // Processar última linha se houver
      if (buffer.trim().length > 0) {
        try {
          const feature = JSON.parse(buffer.trim());
          totalFeatures++;
          lineCount++;
          
          if (shouldKeepPOI(feature)) {
            validFeatures.push(feature);
          }
        } catch (e) {
          // Ignorar
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch (e) {
        // Ignorar
      }
      try {
        file.close();
      } catch (e) {
        // Ignorar
      }
    }
    
    console.log(`   Total de POIs antes do filtro: ${totalFeatures.toLocaleString()}`);
    console.log(`   POIs removidos: ${(totalFeatures - validFeatures.length).toLocaleString()}`);
    console.log(`   POIs válidos restantes: ${validFeatures.length.toLocaleString()}`);
    console.log(`   Redução: ${Math.round((totalFeatures - validFeatures.length) / totalFeatures * 100)}%`);
    console.log("");
    
    // Criar novo GeoJSON filtrado
    const filteredGeoJson = {
      type: "FeatureCollection",
      features: validFeatures
    };
    
    await Deno.writeTextFile(filteredGeoJsonPath, JSON.stringify(filteredGeoJson));
    console.log(`✅ ETAPA 4.2 complete: ${filteredGeoJsonPath}`);
    console.log("");
    
    // Remover arquivo temporário
    try {
      await Deno.remove(tempGeoJsonSeqPath);
    } catch (e) {
      // Ignorar erro se arquivo já foi removido
    }
  } catch (error) {
    console.error(`❌ Error in ETAPA 4.2: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
  
  // 4.3: Converter GeoJSON filtrado de volta para PBF
  console.log("📋 ETAPA 4.3: Convertendo GeoJSON filtrado para PBF...");
  console.log("");
  
  const etapa4FinalPath = join(outputDir, `etapa4-business-filtered-${timestamp}.osm.pbf`);
  
  try {
    // osmium não suporta import direto de GeoJSON para PBF de forma confiável
    // Vamos usar uma abordagem alternativa: salvar o GeoJSON e documentar que
    // a conversão para PBF pode ser feita manualmente se necessário
    // Por enquanto, vamos manter como GeoJSON e criar um link simbólico ou renomear
    
    // Nota: Para converter GeoJSON → PBF, seria necessário:
    // 1. Usar uma ferramenta como osmtogeojson reverso (não existe nativamente)
    // 2. Ou usar o GeoJSON diretamente para importação no banco
    
    // Por enquanto, vamos renomear o GeoJSON para indicar que é o resultado final
    // e documentar que pode ser usado diretamente para importação
    const finalGeoJsonPath = join(outputDir, `etapa4-final-${timestamp}.geojson`);
    await Deno.rename(filteredGeoJsonPath, finalGeoJsonPath);
    
    console.log(`✅ ETAPA 4.3 complete: GeoJSON final salvo`);
    console.log(`   Arquivo: ${finalGeoJsonPath}`);
    console.log(`   Nota: Este GeoJSON pode ser usado diretamente para importação no banco`);
    console.log(`   Se precisar de PBF, pode converter manualmente ou usar o GeoJSON diretamente`);
    console.log("");
    
    // Para manter consistência com as outras etapas, vamos criar um arquivo PBF
    // usando osmium export (mesmo que seja menos eficiente)
    // Mas primeiro, vamos tentar uma abordagem: usar o GeoJSON como "final"
    // e documentar que o PBF pode ser gerado se necessário
    
    // Por enquanto, retornamos o caminho do GeoJSON como "final"
    // Mas vamos criar um arquivo vazio ou placeholder para o PBF para manter consistência
    // Na verdade, vamos tentar converter usando uma ferramenta externa se disponível
    
    // Por simplicidade, vamos retornar o GeoJSON path mas documentar claramente
    return finalGeoJsonPath;
  } catch (error) {
    console.error(`❌ Error in ETAPA 4.3: ${error instanceof Error ? error.message : String(error)}`);
    console.log(`   Mantendo GeoJSON filtrado: ${filteredGeoJsonPath}`);
    return filteredGeoJsonPath;
  }
}

/**
 * ETAPA 5: Rigorous Business Filter
 * Remove POIs genéricos sem valor turístico baseado em análise de negócio rigorosa
 * 
 * Critérios de remoção:
 * - Sem nome E sem referências (sem tourism/historic)
 * - Infraestrutura técnica sem valor turístico (usinas, represas, estações)
 * - Viewpoints/artworks/monumentos/ruínas sem contexto
 * - Nomes genéricos sem contexto (Parque, Praça, Lago, etc.)
 * - Estádios e cemitérios genéricos
 * - Nomes muito curtos sem referências
 * - Estações técnicas não turísticas
 * - Aeródromos privados
 */
async function executeEtapa5(
  inputPath: string,
  outputDir: string,
  timestamp: number
): Promise<string> {
  console.log("📋 ETAPA 5: Filtro de Negócio Rigoroso");
  console.log("=".repeat(60));
  console.log("🎯 Objetivo: Remover POIs genéricos sem valor para audioguia turístico");
  console.log("");
  console.log("📊 Critérios de remoção:");
  console.log("   • Sem nome E sem referências (sem tourism/historic)");
  console.log("   • Infraestrutura técnica sem valor turístico");
  console.log("   • Viewpoints/artworks/monumentos/ruínas sem contexto");
  console.log("   • Nomes genéricos sem contexto");
  console.log("   • Estádios e cemitérios genéricos");
  console.log("   • Nomes muito curtos sem referências");
  console.log("   • Estações técnicas não turísticas");
  console.log("   • Aeródromos privados");
  console.log("");
  
  // Padrões genéricos
  const genericPatterns = {
    genericNames: [
      /^parque$/i,
      /^praça$/i,
      /^igreja$/i,
      /^capela$/i,
      /^monumento$/i,
      /^memorial$/i,
      /^lago$/i,
      /^lagoa$/i,
      /^cachoeira$/i,
      /^ponte$/i,
      /^museu$/i,
      /^estádio$/i,
      /^estadio$/i,
      /^cemitério$/i,
      /^cemiterio$/i,
      /^praça\s+[a-z]$/i,
      /^parque\s+[a-z]$/i,
    ],
    administrative: [
      /^(parque|praça|área|zona|setor|quadra|lote|bloco)\s+[0-9]+$/i,
      /^[a-z]\s*[0-9]+$/i,
      /^[0-9]+\s*[a-z]?$/i,
      /^quadra\s+[0-9]+/i,
      /^lote\s+[0-9]+/i,
      /^bloco\s+[0-9]+/i,
    ],
    infrastructure: [
      /usina/i,
      /represa/i,
      /barragem/i,
      /estação de tratamento/i,
      /estação elevatória/i,
      /estação de água/i,
      /reservatório/i,
      /captação/i,
      /subestação/i,
      /torre de transmissão/i,
      /casa de máquinas/i,
      /casa de bombas/i,
    ],
    cemeteries: [
      /^cemitério municipal$/i,
      /^cemiterio municipal$/i,
      /^antigo cemiterio$/i,
      /^antigo cemitério$/i,
    ],
    stadiums: [
      /^campo de futebol$/i,
      /^ginásio de esportes$/i,
      /^estádio municipal$/i,
      /^estadio municipal$/i,
      /^quadra de futebol$/i,
      /^quadra poliesportiva$/i,
      /^quadra$/i,
    ],
  };
  
  const famousNames = {
    cemeteries: ['consolação', 'recoleta', 'vila formosa', 'são paulo', 'da saudade', 'campo santo'],
    stadiums: ['maracanã', 'allianz', 'corinthians', 'morumbi', 'pacaembu', 'mané garrincha', 'mineirão', 'beira-rio'],
  };
  
  // Função de filtro rigorosa
  function shouldRemovePOI(poi: any): boolean {
    const props = poi.properties || {};
    const name = (props.name || '').trim();
    const nameLower = name.toLowerCase();
    
    const hasName = name.length > 0;
    const hasWikipedia = !!props.wikipedia;
    const hasWikidata = !!props.wikidata;
    const hasReference = hasWikipedia || hasWikidata;
    const hasTourism = !!props.tourism;
    const hasHistoric = !!props.historic;
    const hasDescription = !!props.description;
    const hasWebsite = !!props.website;
    
    // CRITÉRIO 1: SEM NOME E SEM REFERÊNCIAS (sem tourism/historic)
    if (!hasName && !hasReference && !hasTourism && !hasHistoric) {
      return true; // CRÍTICO: Remover
    }
    
    // CRITÉRIO 2: NOME MUITO CURTO (≤3 caracteres) E SEM REFERÊNCIAS
    if (name.length > 0 && name.length <= 3 && !hasReference) {
      return true; // Remover
    }
    
    // CRITÉRIO 3: NOME GENÉRICO SEM CONTEXTO E SEM REFERÊNCIAS
    if (genericPatterns.genericNames.some(p => p.test(name)) && !hasReference) {
      const isReallyGeneric = name.length <= 10 && !hasDescription && !hasWebsite;
      if (isReallyGeneric) {
        return true; // Remover
      }
    }
    
    // CRITÉRIO 4: INFRAESTRUTURA TÉCNICA SEM VALOR TURÍSTICO
    if (genericPatterns.infrastructure.some(p => p.test(name))) {
      const hasTourismValue = hasTourism || hasHistoric || hasReference;
      if (!hasTourismValue) {
        return true; // Remover
      }
    }
    
    // CRITÉRIO 5: CEMITÉRIOS GENÉRICOS
    if (genericPatterns.cemeteries.some(p => p.test(name)) ||
        props.amenity === 'grave_yard' || props.amenity === 'cemetery' || props.landuse === 'cemetery') {
      const isFamous = famousNames.cemeteries.some(f => nameLower.includes(f));
      const hasTourismValue = hasTourism || hasReference || isFamous;
      if (!hasTourismValue) {
        return true; // Remover
      }
    }
    
    // CRITÉRIO 6: ESTÁDIOS GENÉRICOS
    if (props.leisure === 'stadium' || genericPatterns.stadiums.some(p => p.test(name))) {
      const isFamous = famousNames.stadiums.some(f => nameLower.includes(f));
      const hasTourismValue = hasTourism || hasHistoric || hasReference || isFamous;
      if (!hasTourismValue) {
        return true; // Remover
      }
    }
    
    // CRITÉRIO 7: VIEWPOINTS SEM CONTEXTO
    if (props.tourism === 'viewpoint' && !hasName && !hasReference) {
      return true; // Remover
    }
    
    // CRITÉRIO 8: ARTWORKS SEM CONTEXTO
    if (props.tourism === 'artwork' && !hasName && !hasReference) {
      return true; // Remover
    }
    
    // CRITÉRIO 9: MONUMENTOS SEM CONTEXTO
    if (props.historic === 'monument' && !hasName && !hasReference) {
      return true; // Remover
    }
    
    // CRITÉRIO 10: RUINAS SEM CONTEXTO
    if (props.historic === 'ruins' && !hasName && !hasReference) {
      return true; // Remover
    }
    
    // CRITÉRIO 11: ESTAÇÕES TÉCNICAS (não turísticas)
    if ((props.railway === 'station' || props.public_transport === 'station') &&
        !props.historic && !hasTourism && !hasReference) {
      const isHistoric = nameLower.includes('antiga') || nameLower.includes('antigo');
      if (!isHistoric) {
        return true; // Remover
      }
    }
    
    // CRITÉRIO 12: AERÓDROMOS PRIVADOS
    if (props.aeroway === 'aerodrome') {
      if (nameLower.includes('usina') || nameLower.includes('fazenda')) {
        return true; // CRÍTICO: Remover
      }
      if (!props.iata && !props.icao && !hasReference && (!hasName || name.length < 5)) {
        return true; // Remover
      }
    }
    
    return false; // Manter
  }
  
  // 5.1: Converter para GeoJSONSeq (se necessário) ou processar diretamente
  console.log("📋 ETAPA 5.1: Preparando arquivo para análise...");
  console.log("");
  
  let tempGeoJsonSeqPath: string;
  
  try {
    // Verificar se é GeoJSON ou PBF
    if (inputPath.endsWith('.geojson')) {
      // Já é GeoJSON, converter para GeoJSONSeq para processamento streaming
      const data = JSON.parse(await Deno.readTextFile(inputPath));
      const features = data.features || [];
      
      tempGeoJsonSeqPath = join(outputDir, `temp-etapa5-${timestamp}.geojsonseq`);
      const file = await Deno.open(tempGeoJsonSeqPath, { write: true, create: true, truncate: true });
      const encoder = new TextEncoder();
      
      for (const feature of features) {
        const line = JSON.stringify(feature) + '\n';
        await file.write(encoder.encode(line));
      }
      
      file.close();
      console.log(`✅ GeoJSON convertido para GeoJSONSeq: ${tempGeoJsonSeqPath}`);
    } else if (inputPath.endsWith('.pbf')) {
      // É PBF, converter para GeoJSONSeq
      tempGeoJsonSeqPath = join(outputDir, `temp-etapa5-${timestamp}.geojsonseq`);
      
      const command = new Deno.Command("osmium", {
        args: [
          "export",
          inputPath,
          "-f", "geojsonseq",
          "-o", tempGeoJsonSeqPath,
          "--overwrite"
        ],
        stdout: "piped",
        stderr: "piped"
      });
      
      const { code, stderr } = await command.output();
      
      if (code !== 0) {
        const error = new TextDecoder().decode(stderr);
        throw new Error(`Osmium export failed: ${error}`);
      }
      
      console.log(`✅ PBF convertido para GeoJSONSeq: ${tempGeoJsonSeqPath}`);
    } else {
      throw new Error(`Formato de arquivo não suportado: ${inputPath}`);
    }
    
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 5.1: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
  
  // 5.2: Filtrar POIs genéricos
  console.log("📋 ETAPA 5.2: Filtrando POIs genéricos sem valor turístico...");
  console.log("");
  
  const etapa5FinalPath = join(outputDir, `etapa5-rigorous-filtered-${timestamp}.geojson`);
  
  try {
    console.log("   Processando GeoJSONSeq linha por linha (streaming)...");
    console.log("");
    
    const file = await Deno.open(tempGeoJsonSeqPath, { read: true });
    const reader = file.readable.getReader();
    const decoder = new TextDecoder();
    
    let totalFeatures = 0;
    let validFeatures: any[] = [];
    let removedFeatures = 0;
    let buffer = "";
    let lineCount = 0;
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.substring(0, newlineIndex).trim();
          buffer = buffer.substring(newlineIndex + 1);
          
          if (line.length > 0) {
            try {
              const feature = JSON.parse(line);
              totalFeatures++;
              lineCount++;
              
              if (!shouldRemovePOI(feature)) {
                validFeatures.push(feature);
              } else {
                removedFeatures++;
              }
              
              if (lineCount % 1000 === 0) {
                console.log(`   Processados: ${lineCount.toLocaleString()} features...`);
              }
            } catch (e) {
              // Ignorar linha inválida
            }
          }
        }
      }
      
      // Processar última linha se houver
      if (buffer.trim().length > 0) {
        try {
          const feature = JSON.parse(buffer.trim());
          totalFeatures++;
          lineCount++;
          
          if (!shouldRemovePOI(feature)) {
            validFeatures.push(feature);
          } else {
            removedFeatures++;
          }
        } catch (e) {
          // Ignorar
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch (e) {
        // Ignorar
      }
      try {
        file.close();
      } catch (e) {
        // Ignorar
      }
    }
    
    console.log("");
    console.log(`   Total de POIs antes do filtro: ${totalFeatures.toLocaleString()}`);
    console.log(`   POIs removidos: ${removedFeatures.toLocaleString()}`);
    console.log(`   POIs válidos restantes: ${validFeatures.length.toLocaleString()}`);
    console.log(`   Redução: ${Math.round((removedFeatures / totalFeatures) * 100)}%`);
    console.log("");
    
    // Criar novo GeoJSON filtrado
    const filteredGeoJson = {
      type: "FeatureCollection",
      features: validFeatures
    };
    
    await Deno.writeTextFile(etapa5FinalPath, JSON.stringify(filteredGeoJson));
    console.log(`✅ ETAPA 5.2 complete: ${etapa5FinalPath}`);
    console.log("");
    
    // Remover arquivo temporário
    try {
      await Deno.remove(tempGeoJsonSeqPath);
    } catch (e) {
      // Ignorar erro se arquivo já foi removido
    }
  } catch (error) {
    console.error(`❌ Error in ETAPA 5.2: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
  
  console.log("✅ ETAPA 5 concluída!");
  console.log("");
  
  return etapa5FinalPath;
}

/**
 * ETAPA 5.1: Remove Banks and Financial Institutions
 * Remove POIs de bancos e instituições financeiras sem valor turístico
 * 
 * Critérios de remoção:
 * - Bancos reais sem valor turístico (amenity=bank/atm sem tourism/historic/referências)
 * - Clubes esportivos de bancos (AABB, Associação Atlética do Banco do Brasil)
 * - POIs genéricos com "bank" no nome sem contexto
 */
async function executeEtapa5_1(
  inputPath: string,
  outputDir: string,
  timestamp: number
): Promise<string> {
  console.log("📋 ETAPA 5.1: Remover Bancos e Instituições Financeiras");
  console.log("=".repeat(60));
  console.log("🎯 Objetivo: Remover POIs de bancos sem valor turístico");
  console.log("");
  console.log("📊 Critérios de remoção:");
  console.log("   • Bancos reais (amenity=bank/atm) sem valor turístico");
  console.log("   • Clubes esportivos de bancos (AABB, Associação Atlética)");
  console.log("   • POIs genéricos com 'bank' no nome sem contexto");
  console.log("");
  
  // Lista de bancos INSTITUIÇÕES FINANCEIRAS conhecidas (não lugares)
  const bancosInstituicoes = [
    // Principais bancos brasileiros
    'banco do brasil',
    'banco bradesco',
    'bradesco',
    'banco itaú',
    'banco itau',
    'itau',
    'itaú',
    'banco santander',
    'santander',
    'caixa econômica federal',
    'caixa economica federal',
    'caixa econômica',
    'caixa economica',
    // Outros bancos conhecidos
    'banrisul',
    'banco real',
    'hsbc',
    'citibank',
    'banco pan',
    'banco inter',
    'banco original',
    'banco safra',
    'banco nubank',
    'banco next',
    'banco digio',
    'banco picpay',
    'banco c6',
    'banco btg',
    'banco modal',
    'banco votorantim',
    'banco bv',
    'unibanco',
  ];
  
  // Padrões que indicam que NÃO é um banco instituição (são lugares geográficos)
  const padroesNaoBanco = [
    /itaúnas/i,           // Parque Estadual de Itaúnas
    /itaúna/i,            // Cidade de Itaúna
    /caixa d['\']?água/i,  // Caixa d'água (infraestrutura)
    /caixa d['\']?agua/i,  // Caixa d'agua
    /caixa dagua/i,       // Caixa dagua
    /caixa de/i,          // Caixa de algo (não banco)
    /banco de areia/i,    // Banco de areia (geográfico)
    /banco de pedra/i,    // Banco de pedra (geográfico)
    /banco do parque/i,   // Banco do parque (assento)
    /bancos do parque/i,  // Bancos do parque (assentos)
    /banco da coroa/i,    // Banco da Coroa (lugar)
    /banco da praia/i,    // Banco da praia (lugar)
    /banco do rio/i,      // Banco do rio (lugar)
    /banco memorial/i,    // Banco memorial (assento)
    /praça.*banco/i,      // Praça com bancos (assentos)
    /parque.*banco/i,     // Parque com bancos (assentos)
  ];
  
  // Verificar se é um lugar (não um banco instituição)
  function isPlaceNotBank(name: string): boolean {
    // Se contém palavras que indicam lugar geográfico
    const placeKeywords = [
      'parque', 'praça', 'pedra', 'morro', 'estadual', 'municipal',
      'torre', 'ruínas', 'ruinas', 'centro cultural', 'teatro', 'museu',
      'praia', 'rio', 'lago', 'lagoa', 'cachoeira', 'monumento',
      'memorial', 'bosque', 'gruta', 'campo', 'quadra',
    ];
    
    const nameLower = name.toLowerCase();
    return placeKeywords.some(keyword => nameLower.includes(keyword));
  }
  
  // Padrões de clubes esportivos de bancos
  const clubesBancos = [
    /aabb/i,
    /associação atlética do banco do brasil/i,
    /associação atlética.*banco/i,
    /clube.*banco/i,
  ];
  
  // Exceções válidas: bancos que são realmente pontos turísticos
  const bancosTuristicosValidos = [
    /centro cultural.*banco/i,
    /farol.*santander/i,
    /museu.*banco/i,
    /teatro.*bradesco/i,
    /teatro.*banco/i,
    /casa.*banco/i,  // Casa do Banco (edifício histórico)
  ];
  
  // Função para verificar se é banco turístico válido
  function isBankTouristicValid(name: string, amenity: string, tourism: string): boolean {
    // Verificar se é uma exceção válida
    const isException = bancosTuristicosValidos.some(pattern => pattern.test(name));
    
    // Se é museu, teatro ou centro cultural REAL, é válido
    const isRealCultural = amenity === 'museum' || amenity === 'theatre' || amenity === 'arts_centre' ||
                           tourism === 'museum' || tourism === 'theatre';
    
    // Se tem referências externas (wikipedia/wikidata), provavelmente é turístico real
    // Mas vamos ser rigorosos: só manter se for exceção OU se for realmente cultural
    
    return isException || isRealCultural;
  }
  
  // Função de filtro para bancos INSTITUIÇÕES FINANCEIRAS
  function shouldRemoveBankPOI(poi: any): boolean {
    const props = poi.properties || {};
    const name = (props.name || '').trim();
    const nameLower = name.toLowerCase();
    const amenity = (props.amenity || '').toLowerCase();
    const tourism = (props.tourism || '').toLowerCase();
    
    const hasTourism = !!props.tourism;
    const hasHistoric = !!props.historic;
    const hasReference = !!props.wikipedia || !!props.wikidata;
    
    // CRITÉRIO 1: Bancos INSTITUIÇÕES (amenity=bank/atm) - REMOVER SEMPRE (exceto turísticos válidos)
    if (amenity === 'bank' || amenity === 'atm') {
      // Verificar se não é falso positivo (não é lugar geográfico)
      const isNotBank = padroesNaoBanco.some(pattern => pattern.test(name));
      if (!isNotBank) {
        // Verificar se é banco turístico válido (ex: Centro Cultural)
        if (!isBankTouristicValid(name, amenity, tourism)) {
          return true; // Remover banco INSTITUIÇÃO (mesmo com tourism=artwork é falso)
        }
      }
    }
    
    // CRITÉRIO 2: Nomes de BANCOS INSTITUIÇÕES conhecidos (sem ser lugar)
    const matchedBank = bancosInstituicoes.find(banco => {
      if (!nameLower.includes(banco)) return false;
      // Verificar se não é falso positivo (lugar geográfico)
      return !padroesNaoBanco.some(pattern => pattern.test(name));
    });
    
    if (matchedBank) {
      // Se é um banco INSTITUIÇÃO conhecido, verificar se não é um lugar
      const isPlace = isPlaceNotBank(name);
      
      // Se NÃO é um lugar → É banco instituição
      if (!isPlace) {
        // Verificar se é banco turístico válido
        if (!isBankTouristicValid(name, amenity, tourism)) {
          return true; // Remover banco instituição (mesmo com tourism=artwork é falso)
        }
      }
      
      // Se é um lugar (ex: "Parque Estadual de Itaúnas"), não é banco instituição
      // Manter (já foi filtrado pelos padroesNaoBanco)
    }
    
    // CRITÉRIO 3: Clubes esportivos de bancos (AABB, Associação Atlética)
    if (clubesBancos.some(pattern => pattern.test(name))) {
      // Verificar se é realmente turístico (ex: AABB com theme_park pode ser válido)
      const isReallyTouristic = tourism === 'theme_park' || tourism === 'zoo' || 
                                amenity === 'theme_park' || amenity === 'zoo' ||
                                hasReference;
      if (!isReallyTouristic) {
        return true; // Remover clube esportivo de banco
      }
    }
    
    // CRITÉRIO 4: Nomes genéricos com "bank" (em inglês)
    if (nameLower.includes('bank') && !nameLower.includes('banco')) {
      // Verificar se não é falso positivo
      const isNotBank = padroesNaoBanco.some(pattern => pattern.test(name));
      const isPlace = isPlaceNotBank(name);
      if (!isNotBank && !isPlace) {
        // Verificar se é banco turístico válido
        if (!isBankTouristicValid(name, amenity, tourism)) {
          return true; // Remover POI com "bank" (banco instituição)
        }
      }
    }
    
    return false; // Manter
  }
  
  // 5.1.1: Converter para GeoJSONSeq (se necessário)
  console.log("📋 ETAPA 5.1.1: Preparando arquivo para análise...");
  console.log("");
  
  let tempGeoJsonSeqPath: string;
  
  try {
    if (inputPath.endsWith('.geojson')) {
      const data = JSON.parse(await Deno.readTextFile(inputPath));
      const features = data.features || [];
      
      tempGeoJsonSeqPath = join(outputDir, `temp-etapa5_1-${timestamp}.geojsonseq`);
      const file = await Deno.open(tempGeoJsonSeqPath, { write: true, create: true, truncate: true });
      const encoder = new TextEncoder();
      
      for (const feature of features) {
        const line = JSON.stringify(feature) + '\n';
        await file.write(encoder.encode(line));
      }
      
      file.close();
      console.log(`✅ GeoJSON convertido para GeoJSONSeq: ${tempGeoJsonSeqPath}`);
    } else if (inputPath.endsWith('.pbf')) {
      tempGeoJsonSeqPath = join(outputDir, `temp-etapa5_1-${timestamp}.geojsonseq`);
      
      const command = new Deno.Command("osmium", {
        args: [
          "export",
          inputPath,
          "-f", "geojsonseq",
          "-o", tempGeoJsonSeqPath,
          "--overwrite"
        ],
        stdout: "piped",
        stderr: "piped"
      });
      
      const { code, stderr } = await command.output();
      
      if (code !== 0) {
        const error = new TextDecoder().decode(stderr);
        throw new Error(`Osmium export failed: ${error}`);
      }
      
      console.log(`✅ PBF convertido para GeoJSONSeq: ${tempGeoJsonSeqPath}`);
    } else {
      throw new Error(`Formato de arquivo não suportado: ${inputPath}`);
    }
    
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 5.1.1: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
  
  // 5.1.2: Filtrar POIs de bancos
  console.log("📋 ETAPA 5.1.2: Filtrando POIs de bancos sem valor turístico...");
  console.log("");
  
  const etapa5_1FinalPath = join(outputDir, `etapa5_1-banks-filtered-${timestamp}.geojson`);
  
  try {
    console.log("   Processando GeoJSONSeq linha por linha (streaming)...");
    console.log("");
    
    const file = await Deno.open(tempGeoJsonSeqPath, { read: true });
    const reader = file.readable.getReader();
    const decoder = new TextDecoder();
    
    let totalFeatures = 0;
    let validFeatures: any[] = [];
    let removedFeatures = 0;
    let buffer = "";
    let lineCount = 0;
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.substring(0, newlineIndex).trim();
          buffer = buffer.substring(newlineIndex + 1);
          
          if (line.length > 0) {
            try {
              const feature = JSON.parse(line);
              totalFeatures++;
              lineCount++;
              
              if (!shouldRemoveBankPOI(feature)) {
                validFeatures.push(feature);
              } else {
                removedFeatures++;
              }
              
              if (lineCount % 1000 === 0) {
                console.log(`   Processados: ${lineCount.toLocaleString()} features...`);
              }
            } catch (e) {
              // Ignorar linha inválida
            }
          }
        }
      }
      
      // Processar última linha se houver
      if (buffer.trim().length > 0) {
        try {
          const feature = JSON.parse(buffer.trim());
          totalFeatures++;
          lineCount++;
          
          if (!shouldRemoveBankPOI(feature)) {
            validFeatures.push(feature);
          } else {
            removedFeatures++;
          }
        } catch (e) {
          // Ignorar
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch (e) {
        // Ignorar
      }
      try {
        file.close();
      } catch (e) {
        // Ignorar
      }
    }
    
    console.log("");
    console.log(`   Total de POIs antes do filtro: ${totalFeatures.toLocaleString()}`);
    console.log(`   POIs removidos: ${removedFeatures.toLocaleString()}`);
    console.log(`   POIs válidos restantes: ${validFeatures.length.toLocaleString()}`);
    console.log(`   Redução: ${Math.round((removedFeatures / totalFeatures) * 100)}%`);
    console.log("");
    
    // Criar novo GeoJSON filtrado
    const filteredGeoJson = {
      type: "FeatureCollection",
      features: validFeatures
    };
    
    await Deno.writeTextFile(etapa5_1FinalPath, JSON.stringify(filteredGeoJson));
    console.log(`✅ ETAPA 5.1.2 complete: ${etapa5_1FinalPath}`);
    console.log("");
    
    // Remover arquivo temporário
    try {
      await Deno.remove(tempGeoJsonSeqPath);
    } catch (e) {
      // Ignorar erro se arquivo já foi removido
    }
  } catch (error) {
    console.error(`❌ Error in ETAPA 5.1.2: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
  
  console.log("✅ ETAPA 5.1 concluída!");
  console.log("");
  
  return etapa5_1FinalPath;
}

/**
 * ETAPA 5.2: Remove Roads, Streets, Avenues
 * Remove estradas, ruas, avenidas e outras vias de trâfego
 * 
 * Critérios de remoção:
 * - Nomes que começam com "Estrada", "Rua", "Avenida", "Rodovia", etc.
 * - Nomes que contêm padrões de vias (ex: "Av. Paulista", "Rua das Flores")
 * - Mesmo que tenham tags tourism/historic (estradas não são POIs para audioguia)
 */
async function executeEtapa5_2(
  inputPath: string,
  outputDir: string,
  timestamp: number
): Promise<string> {
  console.log("📋 ETAPA 5.2: Remover Estradas, Ruas e Avenidas");
  console.log("=".repeat(60));
  console.log("🎯 Objetivo: Remover vias de trâfego (não são POIs para audioguia)");
  console.log("");
  console.log("📊 Critérios de remoção:");
  console.log("   • Nomes que começam com: Estrada, Rua, Avenida, Rodovia, Via, etc.");
  console.log("   • Nomes que contêm padrões de vias (ex: Av., R., Est., Rod.)");
  console.log("   • Mesmo com tags tourism/historic (estradas não são POIs)");
  console.log("");
  
  // Padrões de início de nome que indicam vias (EXCETO praças)
  const padroesInicioVia = [
    /^estrada/i,
    /^rua/i,
    /^avenida/i,
    /^av\./i,
    /^av /i,
    /^rodovia/i,
    /^rod\./i,
    /^rod /i,
    /^via/i,
    /^alameda/i,
    /^travessa/i,
    /^beco/i,
    /^ladeira/i,
    /^largo/i,
    /^boulevard/i,
    /^boul\./i,
    /^boul /i,
    /^estrada real/i,
    /^estrada união/i,
  ];
  
  // Padrões que indicam vias (no meio ou fim do nome)
  const padroesVia = [
    /\b(estrada|rua|avenida|av\.|av |rodovia|rod\.|rod |via|alameda|travessa|beco|ladeira|largo|boulevard|boul\.|boul )\b/i,
    /^(sp|br|rj|mg|pr|sc|rs|go|ba|pe|ce|df)-\d+/i,  // Rodovias: SP-123, BR-101
    /\b(km|quilômetro|quilometro)\s+\d+/i,  // Rodovias: km 123
  ];
  
  // Função para verificar se praça é realmente um POI (não apenas via)
  function isPracaPOI(name: string, props: any): boolean {
    if (!name || !name.toLowerCase().startsWith('praça')) return false;
    
    const nameLower = name.toLowerCase().trim();
    
    // Praças com valor turístico explícito são POIs
    if (props.tourism || props.historic || props.wikipedia || props.wikidata) {
      return true; // Manter (tem valor turístico)
    }
    
    // Praças com nomes específicos (santos, lugares históricos) são POIs
    const isSpecificPraca = nameLower.includes('são') || 
                           nameLower.includes('santo') ||
                           nameLower.includes('santa') ||
                           nameLower.includes('nossa senhora') ||
                           nameLower.includes('da república') ||
                           nameLower.includes('da independência') ||
                           nameLower.includes('tiradentes') ||
                           nameLower.includes('da liberdade') ||
                           nameLower.includes('da matriz') ||
                           nameLower.includes('da sé') ||
                           nameLower.includes('do sol') ||
                           nameLower.includes('da lua') ||
                           nameLower.includes('da paz') ||
                           nameLower.includes('centro') ||
                           nameLower.includes('histórico') ||
                           nameLower.includes('histórica');
    
    if (isSpecificPraca) {
      return true; // Manter (praça com nome específico)
    }
    
    // Praças com números de endereço são vias, não POIs
    if (/\d+/.test(name)) {
      return false; // Remover (é via com endereço)
    }
    
    // Outras praças: manter por padrão (pode ser POI)
    return true; // Manter (praça pode ser POI)
  }
  
  // Função para verificar se é realmente uma via (não um POI)
  // REMOVER TODOS os POIs com nomes de rodovia/via, SEM EXCEÇÕES
  function isRoad(name: string, props: any): boolean {
    if (!name || name.trim().length === 0) return false;
    
    const nameLower = name.toLowerCase().trim();
    
    // Verificar se tem tag highway - SEMPRE é via
    if (props.highway) {
      return true; // Remover (tem tag highway)
    }
    
    // Praças: lógica especial (pode ser POI ou via)
    if (nameLower.startsWith('praça')) {
      return !isPracaPOI(name, props); // Remover se NÃO for POI
    }
    
    // Verificar padrões de início de via (rodovia, estrada, rua, avenida, etc.)
    const startsWithVia = padroesInicioVia.some(pattern => pattern.test(name));
    if (startsWithVia) {
      return true; // É uma via - REMOVER SEMPRE
    }
    
    // Verificar padrões gerais de via (no meio ou fim do nome)
    const hasViaPattern = padroesVia.some(pattern => pattern.test(name));
    if (hasViaPattern) {
      return true; // É uma via - REMOVER SEMPRE
    }
    
    return false; // Não é via
  }
  
  // Função de filtro
  function shouldRemoveRoadPOI(poi: any): boolean {
    const props = poi.properties || {};
    const name = (props.name || '').trim();
    
    // Verificar se é uma via pelo nome
    if (isRoad(name, props)) {
      return true; // Remover (é via de trâfego, não POI)
    }
    
    return false; // Manter
  }
  
  // 5.2.1: Converter para GeoJSONSeq (se necessário)
  console.log("📋 ETAPA 5.2.1: Preparando arquivo para análise...");
  console.log("");
  
  let tempGeoJsonSeqPath: string;
  
  try {
    if (inputPath.endsWith('.geojson')) {
      const data = JSON.parse(await Deno.readTextFile(inputPath));
      const features = data.features || [];
      
      tempGeoJsonSeqPath = join(outputDir, `temp-etapa5_2-${timestamp}.geojsonseq`);
      const file = await Deno.open(tempGeoJsonSeqPath, { write: true, create: true, truncate: true });
      const encoder = new TextEncoder();
      
      for (const feature of features) {
        const line = JSON.stringify(feature) + '\n';
        await file.write(encoder.encode(line));
      }
      
      file.close();
      console.log(`✅ GeoJSON convertido para GeoJSONSeq: ${tempGeoJsonSeqPath}`);
    } else if (inputPath.endsWith('.pbf')) {
      tempGeoJsonSeqPath = join(outputDir, `temp-etapa5_2-${timestamp}.geojsonseq`);
      
      const command = new Deno.Command("osmium", {
        args: [
          "export",
          inputPath,
          "-f", "geojsonseq",
          "-o", tempGeoJsonSeqPath,
          "--overwrite"
        ],
        stdout: "piped",
        stderr: "piped"
      });
      
      const { code, stderr } = await command.output();
      
      if (code !== 0) {
        const error = new TextDecoder().decode(stderr);
        throw new Error(`Osmium export failed: ${error}`);
      }
      
      console.log(`✅ PBF convertido para GeoJSONSeq: ${tempGeoJsonSeqPath}`);
    } else {
      throw new Error(`Formato de arquivo não suportado: ${inputPath}`);
    }
    
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 5.2.1: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
  
  // 5.2.2: Filtrar POIs que são vias
  console.log("📋 ETAPA 5.2.2: Filtrando estradas, ruas e avenidas...");
  console.log("");
  
  const etapa5_2FinalPath = join(outputDir, `etapa5_2-roads-filtered-${timestamp}.geojson`);
  
  try {
    console.log("   Processando GeoJSONSeq linha por linha (streaming)...");
    console.log("");
    
    const file = await Deno.open(tempGeoJsonSeqPath, { read: true });
    const reader = file.readable.getReader();
    const decoder = new TextDecoder();
    
    let totalFeatures = 0;
    let validFeatures: any[] = [];
    let removedFeatures = 0;
    let buffer = "";
    let lineCount = 0;
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.substring(0, newlineIndex).trim();
          buffer = buffer.substring(newlineIndex + 1);
          
          if (line.length > 0) {
            try {
              const feature = JSON.parse(line);
              totalFeatures++;
              lineCount++;
              
              if (!shouldRemoveRoadPOI(feature)) {
                validFeatures.push(feature);
              } else {
                removedFeatures++;
              }
              
              if (lineCount % 1000 === 0) {
                console.log(`   Processados: ${lineCount.toLocaleString()} features...`);
              }
            } catch (e) {
              // Ignorar linha inválida
            }
          }
        }
      }
      
      // Processar última linha se houver
      if (buffer.trim().length > 0) {
        try {
          const feature = JSON.parse(buffer.trim());
          totalFeatures++;
          lineCount++;
          
          if (!shouldRemoveRoadPOI(feature)) {
            validFeatures.push(feature);
          } else {
            removedFeatures++;
          }
        } catch (e) {
          // Ignorar
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch (e) {
        // Ignorar
      }
      try {
        file.close();
      } catch (e) {
        // Ignorar
      }
    }
    
    console.log("");
    console.log(`   Total de POIs antes do filtro: ${totalFeatures.toLocaleString()}`);
    console.log(`   POIs removidos (vias): ${removedFeatures.toLocaleString()}`);
    console.log(`   POIs válidos restantes: ${validFeatures.length.toLocaleString()}`);
    console.log(`   Redução: ${Math.round((removedFeatures / totalFeatures) * 100)}%`);
    console.log("");
    
    // Criar novo GeoJSON filtrado
    const filteredGeoJson = {
      type: "FeatureCollection",
      features: validFeatures
    };
    
    await Deno.writeTextFile(etapa5_2FinalPath, JSON.stringify(filteredGeoJson));
    console.log(`✅ ETAPA 5.2.2 complete: ${etapa5_2FinalPath}`);
    console.log("");
    
    // Remover arquivo temporário
    try {
      await Deno.remove(tempGeoJsonSeqPath);
    } catch (e) {
      // Ignorar erro se arquivo já foi removido
    }
  } catch (error) {
    console.error(`❌ Error in ETAPA 5.2.2: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
  
  console.log("✅ ETAPA 5.2 concluída!");
  console.log("");
  
  return etapa5_2FinalPath;
}

/**
 * ETAPA 5.3: Remove Generic POI Names
 * Remove POIs com nomes genéricos sem contexto (mirante, monumento, busto, etc.)
 * 
 * Critérios de remoção:
 * - Nomes apenas genéricos (ex: "Mirante", "Monumento", "Busto")
 * - Nomes genéricos sem contexto adicional (ex: "Mirante 1", "Estátua")
 * - Mantém POIs com contexto (ex: "Mirante de Buenos Aires", "Monumento ao Almirante Negro")
 */
async function executeEtapa5_3(
  inputPath: string,
  outputDir: string,
  timestamp: number
): Promise<string> {
  console.log("📋 ETAPA 5.3: Remover POIs com Nomes Genéricos sem Contexto");
  console.log("=".repeat(60));
  console.log("🎯 Objetivo: Remover POIs genéricos que não adicionam valor ao audioguia");
  console.log("");
  console.log("📊 Critérios de remoção:");
  console.log("   • Nomes apenas genéricos: 'Mirante', 'Monumento', 'Busto', etc.");
  console.log("   • Nomes genéricos sem contexto: 'Mirante 1', 'Estátua', 'Cruzeiro'");
  console.log("   • Mantém POIs com contexto: 'Mirante de Buenos Aires', 'Monumento ao Almirante Negro'");
  console.log("");
  
  // Termos genéricos a verificar
  const termosGenericos = [
    { termo: 'mirante', minLength: 20 }, // Nome deve ter pelo menos 20 caracteres para ter contexto
    { termo: 'monumento', minLength: 25 },
    { termo: 'busto', minLength: 15 },
    { termo: 'estátua', minLength: 20 },
    { termo: 'estatua', minLength: 20 },
    { termo: 'escultura', minLength: 25 },
    { termo: 'memorial', minLength: 20 },
    { termo: 'marco', minLength: 15 }, // Exceto "Marco Zero" que pode ser turístico
    { termo: 'cruzeiro', minLength: 20 }, // Exceto cruzeiros com contexto
  ];
  
  // Exceções válidas: nomes genéricos que são realmente turísticos
  const excecoesValidas = [
    /marco zero/i, // Marco Zero é turístico
    /cruzeiro.*(santo|santa|são|nossa senhora)/i, // Cruzeiros religiosos
    /cruzeiro.*(praça|bairro)/i, // Cruzeiros de praças/bairros
    /mirante.*(de|do|da|das|dos)\s+[a-záàâãéêíóôõúç]+/i, // Mirante com preposição indica contexto
    /monumento.*(ao|à|de|do|da|das|dos)\s+[a-záàâãéêíóôõúç]+/i, // Monumento com preposição
    /busto.*(de|do|da|das|dos)\s+[a-záàâãéêíóôõúç]+/i, // Busto com preposição
    /estátua.*(de|do|da|das|dos)\s+[a-záàâãéêíóôõúç]+/i, // Estátua com preposição
    /estatua.*(de|do|da|das|dos)\s+[a-záàâãéêíóôõúç]+/i,
    /escultura.*(de|do|da|das|dos|em homenagem)\s+[a-záàâãéêíóôõúç]+/i,
    /memorial.*(de|do|da|das|dos|em homenagem)\s+[a-záàâãéêíóôõúç]+/i,
  ];
  
  // Função para verificar se nome genérico tem contexto
  function hasGenericContext(name: string, termo: string, minLength: number): boolean {
    if (!name || name.trim().length === 0) return false;
    
    const nameLower = name.toLowerCase().trim();
    
    // Verificar se é exceção válida
    const isException = excecoesValidas.some(pattern => pattern.test(name));
    if (isException) {
      return true; // Manter (é exceção válida)
    }
    
    // Verificar se nome é muito curto (sem contexto)
    if (name.length < minLength) {
      // Verificar se tem apenas números ou é muito genérico
      if (/^\s*(mirante|monumento|busto|estátua|estatua|escultura|memorial|cruzeiro)\s*(\d+|$)/i.test(name)) {
        return false; // Remover (é genérico sem contexto)
      }
      
      // Se é apenas o termo genérico, remover
      if (nameLower === termo || nameLower === termo + ' 1' || nameLower === termo + ' 2' || nameLower === termo + ' 3') {
        return false; // Remover
      }
      
      // Se tem preposição, pode ter contexto (manter)
      if (nameLower.includes(' de ') || nameLower.includes(' do ') || nameLower.includes(' da ') || 
          nameLower.includes(' das ') || nameLower.includes(' dos ') || nameLower.includes(' ao ') ||
          nameLower.includes(' em ') || nameLower.includes(' na ') || nameLower.includes(' no ')) {
        return true; // Manter (tem contexto)
      }
    }
    
    // Se nome é longo o suficiente, tem contexto
    if (name.length >= minLength) {
      return true; // Manter (tem contexto)
    }
    
    return false; // Remover (sem contexto suficiente)
  }
  
  // Função de filtro
  function shouldRemoveGenericPOI(poi: any): boolean {
    const props = poi.properties || {};
    const name = (props.name || '').trim();
    
    if (!name) return false;
    
    // Verificar se tem valor turístico explícito (wikipedia/wikidata) - sempre manter
    if (props.wikipedia || props.wikidata || props.historic === 'monument' || props.historic === 'memorial') {
      return false; // Manter (tem valor turístico)
    }
    
    // Verificar cada termo genérico
    for (const { termo, minLength } of termosGenericos) {
      const nameLower = name.toLowerCase();
      
      if (nameLower.includes(termo)) {
        // Verificar se tem contexto
        if (!hasGenericContext(name, termo, minLength)) {
          return true; // Remover (genérico sem contexto)
        }
      }
    }
    
    // Verificar nomes muito genéricos sem termo específico
    const nomeMuitoGenerico = /^(mirante|monumento|busto|estátua|estatua|escultura|memorial|cruzeiro|marco)(\s+\d+)?$/i;
    if (nomeMuitoGenerico.test(name)) {
      return true; // Remover (muito genérico)
    }
    
    return false; // Manter
  }
  
  // 5.3.1: Converter para GeoJSONSeq (se necessário)
  console.log("📋 ETAPA 5.3.1: Preparando arquivo para análise...");
  console.log("");
  
  let tempGeoJsonSeqPath: string;
  
  try {
    if (inputPath.endsWith('.geojson')) {
      const data = JSON.parse(await Deno.readTextFile(inputPath));
      const features = data.features || [];
      
      tempGeoJsonSeqPath = join(outputDir, `temp-etapa5_3-${timestamp}.geojsonseq`);
      const file = await Deno.open(tempGeoJsonSeqPath, { write: true, create: true, truncate: true });
      const encoder = new TextEncoder();
      
      for (const feature of features) {
        const line = JSON.stringify(feature) + '\n';
        await file.write(encoder.encode(line));
      }
      
      file.close();
      console.log(`✅ GeoJSON convertido para GeoJSONSeq: ${tempGeoJsonSeqPath}`);
    } else if (inputPath.endsWith('.pbf')) {
      tempGeoJsonSeqPath = join(outputDir, `temp-etapa5_3-${timestamp}.geojsonseq`);
      
      const command = new Deno.Command("osmium", {
        args: [
          "export",
          inputPath,
          "-f", "geojsonseq",
          "-o", tempGeoJsonSeqPath,
          "--overwrite"
        ],
        stdout: "piped",
        stderr: "piped"
      });
      
      const { code, stderr } = await command.output();
      
      if (code !== 0) {
        const error = new TextDecoder().decode(stderr);
        throw new Error(`Osmium export failed: ${error}`);
      }
      
      console.log(`✅ PBF convertido para GeoJSONSeq: ${tempGeoJsonSeqPath}`);
    } else {
      throw new Error(`Formato de arquivo não suportado: ${inputPath}`);
    }
    
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 5.3.1: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
  
  // 5.3.2: Filtrar POIs genéricos sem contexto
  console.log("📋 ETAPA 5.3.2: Filtrando POIs genéricos sem contexto...");
  console.log("");
  
  const etapa5_3FinalPath = join(outputDir, `etapa5_3-generic-filtered-${timestamp}.geojson`);
  
  try {
    console.log("   Processando GeoJSONSeq linha por linha (streaming)...");
    console.log("");
    
    const file = await Deno.open(tempGeoJsonSeqPath, { read: true });
    const reader = file.readable.getReader();
    const decoder = new TextDecoder();
    
    let totalFeatures = 0;
    let validFeatures: any[] = [];
    let removedFeatures = 0;
    let buffer = "";
    let lineCount = 0;
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.substring(0, newlineIndex).trim();
          buffer = buffer.substring(newlineIndex + 1);
          
          if (line.length > 0) {
            try {
              const feature = JSON.parse(line);
              totalFeatures++;
              lineCount++;
              
              if (!shouldRemoveGenericPOI(feature)) {
                validFeatures.push(feature);
              } else {
                removedFeatures++;
              }
              
              if (lineCount % 1000 === 0) {
                console.log(`   Processados: ${lineCount.toLocaleString()} features...`);
              }
            } catch (e) {
              // Ignorar linha inválida
            }
          }
        }
      }
      
      // Processar última linha se houver
      if (buffer.trim().length > 0) {
        try {
          const feature = JSON.parse(buffer.trim());
          totalFeatures++;
          lineCount++;
          
          if (!shouldRemoveGenericPOI(feature)) {
            validFeatures.push(feature);
          } else {
            removedFeatures++;
          }
        } catch (e) {
          // Ignorar
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch (e) {
        // Ignorar
      }
      try {
        file.close();
      } catch (e) {
        // Ignorar
      }
    }
    
    console.log("");
    console.log(`   Total de POIs antes do filtro: ${totalFeatures.toLocaleString()}`);
    console.log(`   POIs removidos (genéricos sem contexto): ${removedFeatures.toLocaleString()}`);
    console.log(`   POIs válidos restantes: ${validFeatures.length.toLocaleString()}`);
    console.log(`   Redução: ${Math.round((removedFeatures / totalFeatures) * 100)}%`);
    console.log("");
    
    // Criar novo GeoJSON filtrado
    const filteredGeoJson = {
      type: "FeatureCollection",
      features: validFeatures
    };
    
    await Deno.writeTextFile(etapa5_3FinalPath, JSON.stringify(filteredGeoJson));
    console.log(`✅ ETAPA 5.3.2 complete: ${etapa5_3FinalPath}`);
    console.log("");
    
    // Remover arquivo temporário
    try {
      await Deno.remove(tempGeoJsonSeqPath);
    } catch (e) {
      // Ignorar erro se arquivo já foi removido
    }
  } catch (error) {
    console.error(`❌ Error in ETAPA 5.3.2: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
  
  console.log("✅ ETAPA 5.3 concluída!");
  console.log("");
  
  return etapa5_3FinalPath;
}

/**
 * ETAPA 5.4: Remove Specific Non-Touristic POIs
 * Remove POIs específicos sem valor turístico (Rotary, SESC, Torre, Trilha, Via de acesso, Vila)
 * 
 * Critérios de remoção:
 * - Rotary: clubes de serviço sem valor turístico
 * - SESC: centros culturais sem valor turístico
 * - Torre: torres genéricas sem valor turístico (exceto torres turísticas)
 * - Trilha: trilhas sem valor turístico
 * - Via de acesso: vias de acesso (infraestrutura)
 * - Vila: vilas sem valor turístico ou histórico
 */
async function executeEtapa5_4(
  inputPath: string,
  outputDir: string,
  timestamp: number
): Promise<string> {
  console.log("📋 ETAPA 5.4: Remover POIs Específicos sem Valor Turístico");
  console.log("=".repeat(60));
  console.log("🎯 Objetivo: Remover POIs específicos que não adicionam valor ao audioguia");
  console.log("");
  console.log("📊 Critérios de remoção:");
  console.log("   • Rotary: clubes de serviço sem valor turístico");
  console.log("   • SESC: centros culturais sem valor turístico");
  console.log("   • Torre: torres genéricas sem valor turístico");
  console.log("   • Trilha: trilhas sem valor turístico");
  console.log("   • Via de acesso: vias de acesso (infraestrutura)");
  console.log("   • Vila: vilas sem valor turístico ou histórico");
  console.log("");
  
  // Termos específicos a remover (sem valor turístico)
  const termosRemover = [
    { termo: 'rotary', descricao: 'Rotary' },
    { termo: 'sesc', descricao: 'SESC' },
    { termo: 'trilha', descricao: 'Trilha' },
    { termo: 'via de acesso', descricao: 'Via de acesso' },
    { termo: 'vila', descricao: 'Vila' },
  ];
  
  // Exceções para "torre" - verificar se é realmente uma torre (não pessoa)
  const excecoesTorre = [
    /torres?\s+(de|do|da|das|dos)\s+/i, // Torre de X (torre real)
    /torre\s+(telecomunicações|telefonia|televisão|rádio|observatório|mira|relógio|eiffel)/i,
    /torre\s+\d+/i, // Torre 1, Torre 2
    /^torre$/i, // Apenas "Torre"
  ];
  
  // Função para verificar se "torre" é realmente uma torre (não pessoa)
  function isRealTower(name: string): boolean {
    const nameLower = name.toLowerCase();
    
    // Se não contém "torre", não é torre
    if (!nameLower.includes('torre')) return false;
    
    // Verificar se é exceção válida (torre real)
    const isException = excecoesTorre.some(pattern => pattern.test(name));
    if (isException) {
      return true; // É torre real
    }
    
    // Se contém "torre" mas parece ser nome de pessoa (ex: "Geraldo Torres", "Mozart Torres")
    // Verificar se tem padrão de nome de pessoa (apenas duas palavras, uma é "Torres")
    const words = name.trim().split(/\s+/);
    if (words.length === 2 && nameLower.includes('torres')) {
      // Provavelmente é nome de pessoa, não torre
      return false;
    }
    
    // Se contém "torre" no meio ou fim, provavelmente é torre
    if (nameLower.includes('torre') && nameLower !== 'torre') {
      // Verificar se não é nome de praça (ex: "Praça Coronel Torres")
      if (nameLower.startsWith('praça') || nameLower.startsWith('teatro')) {
        return false; // É nome de praça/teatro, não torre
      }
    }
    
    return false; // Não é torre real
  }
  
  // Função de filtro
  function shouldRemoveSpecificPOI(poi: any): boolean {
    const props = poi.properties || {};
    const name = (props.name || '').trim();
    
    if (!name) return false;
    
    const nameLower = name.toLowerCase();
    
    // Verificar se tem valor turístico explícito - SEMPRE manter
    const temValorTuristico = !!props.tourism || 
                              !!props.historic || 
                              !!props.wikipedia || 
                              !!props.wikidata ||
                              props.historic === 'monument' ||
                              props.historic === 'memorial' ||
                              props.historic === 'building' ||
                              props.historic === 'ruins';
    
    if (temValorTuristico) {
      return false; // Manter (tem valor turístico)
    }
    
    // Verificar cada termo específico
    for (const { termo, descricao } of termosRemover) {
      if (nameLower.includes(termo)) {
        // Rotary: remover sempre (exceto se tiver valor turístico, já verificado acima)
        if (termo === 'rotary') {
          return true; // Remover
        }
        
        // SESC: remover sempre (exceto se tiver valor turístico)
        if (termo === 'sesc') {
          return true; // Remover
        }
        
        // Trilha: remover sempre (exceto se tiver valor turístico)
        if (termo === 'trilha') {
          // Verificar se é praça com "trilha" no nome (ex: "Praça da Trilha")
          if (nameLower.startsWith('praça')) {
            return false; // Manter (é praça, não trilha)
          }
          return true; // Remover
        }
        
        // Via de acesso: remover sempre
        if (termo === 'via de acesso') {
          return true; // Remover
        }
        
        // Vila: remover sempre (exceto se tiver valor turístico)
        if (termo === 'vila') {
          // Verificar se é praça com "vila" no nome (ex: "Praça Vila X")
          if (nameLower.startsWith('praça')) {
            return false; // Manter (é praça, não vila)
          }
          return true; // Remover
        }
      }
    }
    
    // Verificar "torre" separadamente (lógica especial)
    if (nameLower.includes('torre')) {
      // Se é torre real E não tem valor turístico, remover
      if (isRealTower(name)) {
        return true; // Remover (torre sem valor turístico)
      }
      // Se não é torre real, manter (pode ser nome de pessoa, praça, etc.)
    }
    
    return false; // Manter
  }
  
  // 5.4.1: Converter para GeoJSONSeq (se necessário)
  console.log("📋 ETAPA 5.4.1: Preparando arquivo para análise...");
  console.log("");
  
  let tempGeoJsonSeqPath: string;
  
  try {
    if (inputPath.endsWith('.geojson')) {
      const data = JSON.parse(await Deno.readTextFile(inputPath));
      const features = data.features || [];
      
      tempGeoJsonSeqPath = join(outputDir, `temp-etapa5_4-${timestamp}.geojsonseq`);
      const file = await Deno.open(tempGeoJsonSeqPath, { write: true, create: true, truncate: true });
      const encoder = new TextEncoder();
      
      for (const feature of features) {
        const line = JSON.stringify(feature) + '\n';
        await file.write(encoder.encode(line));
      }
      
      file.close();
      console.log(`✅ GeoJSON convertido para GeoJSONSeq: ${tempGeoJsonSeqPath}`);
    } else if (inputPath.endsWith('.pbf')) {
      tempGeoJsonSeqPath = join(outputDir, `temp-etapa5_4-${timestamp}.geojsonseq`);
      
      const command = new Deno.Command("osmium", {
        args: [
          "export",
          inputPath,
          "-f", "geojsonseq",
          "-o", tempGeoJsonSeqPath,
          "--overwrite"
        ],
        stdout: "piped",
        stderr: "piped"
      });
      
      const { code, stderr } = await command.output();
      
      if (code !== 0) {
        const error = new TextDecoder().decode(stderr);
        throw new Error(`Osmium export failed: ${error}`);
      }
      
      console.log(`✅ PBF convertido para GeoJSONSeq: ${tempGeoJsonSeqPath}`);
    } else {
      throw new Error(`Formato de arquivo não suportado: ${inputPath}`);
    }
    
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 5.4.1: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
  
  // 5.4.2: Filtrar POIs específicos sem valor turístico
  console.log("📋 ETAPA 5.4.2: Filtrando POIs específicos sem valor turístico...");
  console.log("");
  
  const etapa5_4FinalPath = join(outputDir, `etapa5_4-specific-filtered-${timestamp}.geojson`);
  
  try {
    console.log("   Processando GeoJSONSeq linha por linha (streaming)...");
    console.log("");
    
    const file = await Deno.open(tempGeoJsonSeqPath, { read: true });
    const reader = file.readable.getReader();
    const decoder = new TextDecoder();
    
    let totalFeatures = 0;
    let validFeatures: any[] = [];
    let removedFeatures = 0;
    let buffer = "";
    let lineCount = 0;
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.substring(0, newlineIndex).trim();
          buffer = buffer.substring(newlineIndex + 1);
          
          if (line.length > 0) {
            try {
              const feature = JSON.parse(line);
              totalFeatures++;
              lineCount++;
              
              if (!shouldRemoveSpecificPOI(feature)) {
                validFeatures.push(feature);
              } else {
                removedFeatures++;
              }
              
              if (lineCount % 1000 === 0) {
                console.log(`   Processados: ${lineCount.toLocaleString()} features...`);
              }
            } catch (e) {
              // Ignorar linha inválida
            }
          }
        }
      }
      
      // Processar última linha se houver
      if (buffer.trim().length > 0) {
        try {
          const feature = JSON.parse(buffer.trim());
          totalFeatures++;
          lineCount++;
          
          if (!shouldRemoveSpecificPOI(feature)) {
            validFeatures.push(feature);
          } else {
            removedFeatures++;
          }
        } catch (e) {
          // Ignorar
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch (e) {
        // Ignorar
      }
      try {
        file.close();
      } catch (e) {
        // Ignorar
      }
    }
    
    console.log("");
    console.log(`   Total de POIs antes do filtro: ${totalFeatures.toLocaleString()}`);
    console.log(`   POIs removidos (específicos sem valor turístico): ${removedFeatures.toLocaleString()}`);
    console.log(`   POIs válidos restantes: ${validFeatures.length.toLocaleString()}`);
    console.log(`   Redução: ${Math.round((removedFeatures / totalFeatures) * 100)}%`);
    console.log("");
    
    // Criar novo GeoJSON filtrado
    const filteredGeoJson = {
      type: "FeatureCollection",
      features: validFeatures
    };
    
    await Deno.writeTextFile(etapa5_4FinalPath, JSON.stringify(filteredGeoJson));
    console.log(`✅ ETAPA 5.4.2 complete: ${etapa5_4FinalPath}`);
    console.log("");
    
    // Remover arquivo temporário
    try {
      await Deno.remove(tempGeoJsonSeqPath);
    } catch (e) {
      // Ignorar erro se arquivo já foi removido
    }
  } catch (error) {
    console.error(`❌ Error in ETAPA 5.4.2: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
  
  console.log("✅ ETAPA 5.4 concluída!");
  console.log("");
  
  return etapa5_4FinalPath;
}

/**
 * ETAPA 5.5: Remove Infrastructure and Service POIs
 * Remove POIs de infraestrutura e serviços sem valor turístico
 * 
 * Critérios de remoção:
 * - Aeródromos/Aeroportos sem valor turístico
 * - Escolas/Universidades sem valor histórico
 * - Serviços públicos sem valor turístico (polícia, bombeiros, prefeituras)
 * - Comércio genérico sem valor turístico
 * - Infraestrutura sem valor turístico (estacionamentos, banheiros, etc.)
 */
async function executeEtapa5_5(
  inputPath: string,
  outputDir: string,
  timestamp: number
): Promise<string> {
  console.log("📋 ETAPA 5.5: Remover POIs de Infraestrutura e Serviços");
  console.log("=".repeat(60));
  console.log("🎯 Objetivo: Remover POIs de infraestrutura e serviços que não são turísticos");
  console.log("");
  console.log("📊 Critérios de remoção:");
  console.log("   • Aeródromos/Aeroportos sem valor turístico");
  console.log("   • Escolas/Universidades sem valor histórico");
  console.log("   • Serviços públicos sem valor turístico");
  console.log("   • Comércio genérico sem valor turístico");
  console.log("   • Infraestrutura sem valor turístico");
  console.log("");
  
  // Função de filtro
  function shouldRemoveInfrastructurePOI(poi: any): boolean {
    const props = poi.properties || {};
    const name = (props.name || '').trim().toLowerCase();
    
    // Verificar se tem valor turístico explícito - SEMPRE manter
    const temValorTuristico = !!props.tourism || 
                              !!props.historic || 
                              !!props.wikipedia || 
                              !!props.wikidata ||
                              props.historic === 'monument' ||
                              props.historic === 'memorial' ||
                              props.historic === 'building' ||
                              props.historic === 'ruins';
    
    if (temValorTuristico) {
      return false; // Manter (tem valor turístico)
    }
    
    // 1. Aeródromos/Aeroportos
    if (props.aeroway === 'aerodrome' || props.aeroway === 'airport' || 
        props.aeroway === 'helipad' || props.aeroway === 'heliport') {
      return true; // Remover
    }
    
    // Verificar por nome também
    if (name.includes('aeródromo') || name.includes('aerodromo') || 
        name.includes('aeroporto') || name.includes('heliponto')) {
      return true; // Remover
    }
    
    // 2. Escolas/Universidades
    if (props.amenity === 'school' || props.amenity === 'university' || 
        props.amenity === 'college' || props.amenity === 'kindergarten') {
      return true; // Remover
    }
    
    // Verificar por nome também
    if ((name.includes('escola') || name.includes('colégio') || name.includes('colegio') ||
         name.includes('universidade') || name.includes('faculdade')) &&
        !name.includes('escola de samba') && !name.includes('escola de arte')) {
      // Exceção: escolas de samba e arte podem ser turísticas
      return true; // Remover
    }
    
    // 3. Serviços Públicos
    if (props.amenity === 'police' || props.amenity === 'fire_station' ||
        props.amenity === 'townhall' || props.amenity === 'courthouse' ||
        props.amenity === 'post_office') {
      return true; // Remover
    }
    
    // 4. Serviços de Saúde (sem valor turístico)
    if (props.amenity === 'hospital' || props.amenity === 'clinic' ||
        props.amenity === 'pharmacy' || props.amenity === 'veterinary' ||
        props.amenity === 'dentist') {
      return true; // Remover
    }
    
    // 5. Bibliotecas (sem valor turístico)
    if (props.amenity === 'library') {
      return true; // Remover
    }
    
    // 6. Comércio genérico
    if (props.shop) {
      // Manter apenas se tiver valor turístico (já verificado acima)
      return true; // Remover
    }
    
    // 7. Infraestrutura
    if (props.amenity === 'parking' || props.amenity === 'charging_station' ||
        props.amenity === 'toilets' || props.amenity === 'bench' ||
        props.amenity === 'waste_basket' || props.amenity === 'drinking_water' ||
        props.amenity === 'fountain') {
      // Exceção: fontes podem ser turísticas se tiverem nome específico
      if (props.amenity === 'fountain' && name.length > 10) {
        return false; // Manter (fonte com nome específico pode ser turística)
      }
      return true; // Remover
    }
    
    // 8. Infraestrutura de lazer não turística
    if (props.leisure === 'track' || props.leisure === 'pitch' ||
        props.leisure === 'playground' || props.leisure === 'fitness_centre' ||
        props.leisure === 'gym' || props.leisure === 'sports_centre') {
      return true; // Remover
    }
    
    // 9. Transporte público (sem valor turístico)
    if (props.public_transport === 'platform' || 
        props.highway === 'bus_stop' || props.highway === 'platform') {
      return true; // Remover
    }
    
    // 10. Escritórios (sem valor turístico)
    if (props.office) {
      return true; // Remover
    }
    
    // 11. Uso do solo comercial/industrial/residencial (sem valor turístico)
    if (props.landuse === 'commercial' || props.landuse === 'industrial' ||
        props.landuse === 'residential' || props.landuse === 'retail') {
      return true; // Remover
    }
    
    return false; // Manter
  }
  
  // 5.5.1: Converter para GeoJSONSeq (se necessário)
  console.log("📋 ETAPA 5.5.1: Preparando arquivo para análise...");
  console.log("");
  
  let tempGeoJsonSeqPath: string;
  
  try {
    if (inputPath.endsWith('.geojson')) {
      const data = JSON.parse(await Deno.readTextFile(inputPath));
      const features = data.features || [];
      
      tempGeoJsonSeqPath = join(outputDir, `temp-etapa5_5-${timestamp}.geojsonseq`);
      const file = await Deno.open(tempGeoJsonSeqPath, { write: true, create: true, truncate: true });
      const encoder = new TextEncoder();
      
      for (const feature of features) {
        const line = JSON.stringify(feature) + '\n';
        await file.write(encoder.encode(line));
      }
      
      file.close();
      console.log(`✅ GeoJSON convertido para GeoJSONSeq: ${tempGeoJsonSeqPath}`);
    } else if (inputPath.endsWith('.pbf')) {
      tempGeoJsonSeqPath = join(outputDir, `temp-etapa5_5-${timestamp}.geojsonseq`);
      
      const command = new Deno.Command("osmium", {
        args: [
          "export",
          inputPath,
          "-f", "geojsonseq",
          "-o", tempGeoJsonSeqPath,
          "--overwrite"
        ],
        stdout: "piped",
        stderr: "piped"
      });
      
      const { code, stderr } = await command.output();
      
      if (code !== 0) {
        const error = new TextDecoder().decode(stderr);
        throw new Error(`Osmium export failed: ${error}`);
      }
      
      console.log(`✅ PBF convertido para GeoJSONSeq: ${tempGeoJsonSeqPath}`);
    } else {
      throw new Error(`Formato de arquivo não suportado: ${inputPath}`);
    }
    
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 5.5.1: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
  
  // 5.5.2: Filtrar POIs de infraestrutura e serviços
  console.log("📋 ETAPA 5.5.2: Filtrando POIs de infraestrutura e serviços...");
  console.log("");
  
  const etapa5_5FinalPath = join(outputDir, `etapa5_5-infrastructure-filtered-${timestamp}.geojson`);
  
  try {
    console.log("   Processando GeoJSONSeq linha por linha (streaming)...");
    console.log("");
    
    const file = await Deno.open(tempGeoJsonSeqPath, { read: true });
    const reader = file.readable.getReader();
    const decoder = new TextDecoder();
    
    let totalFeatures = 0;
    let validFeatures: any[] = [];
    let removedFeatures = 0;
    let buffer = "";
    let lineCount = 0;
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.substring(0, newlineIndex).trim();
          buffer = buffer.substring(newlineIndex + 1);
          
          if (line.length > 0) {
            try {
              const feature = JSON.parse(line);
              totalFeatures++;
              lineCount++;
              
              if (!shouldRemoveInfrastructurePOI(feature)) {
                validFeatures.push(feature);
              } else {
                removedFeatures++;
              }
              
              if (lineCount % 1000 === 0) {
                console.log(`   Processados: ${lineCount.toLocaleString()} features...`);
              }
            } catch (e) {
              // Ignorar linha inválida
            }
          }
        }
      }
      
      // Processar última linha se houver
      if (buffer.trim().length > 0) {
        try {
          const feature = JSON.parse(buffer.trim());
          totalFeatures++;
          lineCount++;
          
          if (!shouldRemoveInfrastructurePOI(feature)) {
            validFeatures.push(feature);
          } else {
            removedFeatures++;
          }
        } catch (e) {
          // Ignorar
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch (e) {
        // Ignorar
      }
      try {
        file.close();
      } catch (e) {
        // Ignorar
      }
    }
    
    console.log("");
    console.log(`   Total de POIs antes do filtro: ${totalFeatures.toLocaleString()}`);
    console.log(`   POIs removidos (infraestrutura/serviços): ${removedFeatures.toLocaleString()}`);
    console.log(`   POIs válidos restantes: ${validFeatures.length.toLocaleString()}`);
    console.log(`   Redução: ${Math.round((removedFeatures / totalFeatures) * 100)}%`);
    console.log("");
    
    // Criar novo GeoJSON filtrado
    const filteredGeoJson = {
      type: "FeatureCollection",
      features: validFeatures
    };
    
    await Deno.writeTextFile(etapa5_5FinalPath, JSON.stringify(filteredGeoJson));
    console.log(`✅ ETAPA 5.5.2 complete: ${etapa5_5FinalPath}`);
    console.log("");
    
    // Remover arquivo temporário
    try {
      await Deno.remove(tempGeoJsonSeqPath);
    } catch (e) {
      // Ignorar erro se arquivo já foi removido
    }
  } catch (error) {
    console.error(`❌ Error in ETAPA 5.5.2: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
  
  console.log("✅ ETAPA 5.5 concluída!");
  console.log("");
  
  return etapa5_5FinalPath;
}

/**
 * ETAPA 5.6: Remove Duplicate POIs
 * Remove duplicatas reais (mesma localização), mantendo apenas 1 entrada por POI
 * 
 * Critérios:
 * - POIs com mesmo nome E mesma localização (< 500m de distância) = duplicata real
 * - POIs com mesmo nome mas localizações diferentes (> 500m) = POIs diferentes (manter todos)
 * - Para duplicatas reais, manter apenas 1 entrada (a que tem mais informações)
 */
async function executeEtapa5_6(
  inputPath: string,
  outputDir: string,
  timestamp: number
): Promise<string> {
  console.log("📋 ETAPA 5.6: Remover POIs Duplicados");
  console.log("=".repeat(60));
  console.log("🎯 Objetivo: Remover duplicatas reais (mesma localização)");
  console.log("");
  console.log("📊 Critérios:");
  console.log("   • POIs com mesmo nome E mesma localização (< 500m) = duplicata real");
  console.log("   • POIs com mesmo nome mas localizações diferentes (> 500m) = POIs diferentes (manter todos)");
  console.log("   • Para duplicatas reais, manter apenas 1 entrada (com mais informações)");
  console.log("");
  
  // Função para calcular distância entre duas coordenadas (Haversine)
  function distanciaKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Raio da Terra em km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }
  
  // Função para extrair coordenadas de um POI
  function getCoordenadas(f: any): { lat: number, lon: number } | null {
    if (f.geometry?.type === 'Point' && f.geometry.coordinates) {
      return { lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
    }
    if (f.geometry?.type === 'Polygon' && f.geometry.coordinates?.[0]?.[0]) {
      // Usar primeiro ponto do polígono
      return { lon: f.geometry.coordinates[0][0][0], lat: f.geometry.coordinates[0][0][1] };
    }
    if (f.geometry?.type === 'LineString' && f.geometry.coordinates?.[0]) {
      // Usar primeiro ponto da linha
      return { lon: f.geometry.coordinates[0][0], lat: f.geometry.coordinates[0][1] };
    }
    return null;
  }
  
  // Função para calcular score de informações (qual POI tem mais dados)
  function getInfoScore(f: any): number {
    const props = f.properties || {};
    let score = 0;
    
    // Propriedades importantes
    if (props.name) score += 10;
    if (props.wikipedia) score += 5;
    if (props.wikidata) score += 5;
    if (props.description) score += 3;
    if (props.website) score += 2;
    if (props.tourism) score += 2;
    if (props.historic) score += 2;
    
    // Contar número de propriedades
    const numProps = Object.keys(props).length;
    score += numProps;
    
    return score;
  }
  
  // 5.6.1: Converter para GeoJSONSeq (se necessário)
  console.log("📋 ETAPA 5.6.1: Preparando arquivo para análise...");
  console.log("");
  
  let tempGeoJsonSeqPath: string;
  
  try {
    if (inputPath.endsWith('.geojson')) {
      const data = JSON.parse(await Deno.readTextFile(inputPath));
      const features = data.features || [];
      
      tempGeoJsonSeqPath = join(outputDir, `temp-etapa5_6-${timestamp}.geojsonseq`);
      const file = await Deno.open(tempGeoJsonSeqPath, { write: true, create: true, truncate: true });
      const encoder = new TextEncoder();
      
      for (const feature of features) {
        const line = JSON.stringify(feature) + '\n';
        await file.write(encoder.encode(line));
      }
      
      file.close();
      console.log(`✅ GeoJSON convertido para GeoJSONSeq: ${tempGeoJsonSeqPath}`);
    } else if (inputPath.endsWith('.pbf')) {
      tempGeoJsonSeqPath = join(outputDir, `temp-etapa5_6-${timestamp}.geojsonseq`);
      
      const command = new Deno.Command("osmium", {
        args: [
          "export",
          inputPath,
          "-f", "geojsonseq",
          "-o", tempGeoJsonSeqPath,
          "--overwrite"
        ],
        stdout: "piped",
        stderr: "piped"
      });
      
      const { code, stderr } = await command.output();
      
      if (code !== 0) {
        const error = new TextDecoder().decode(stderr);
        throw new Error(`Osmium export failed: ${error}`);
      }
      
      console.log(`✅ PBF convertido para GeoJSONSeq: ${tempGeoJsonSeqPath}`);
    } else {
      throw new Error(`Formato de arquivo não suportado: ${inputPath}`);
    }
    
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 5.6.1: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
  
  // 5.6.2: Processar e remover duplicatas
  console.log("📋 ETAPA 5.6.2: Processando e removendo duplicatas...");
  console.log("");
  
  const etapa5_6FinalPath = join(outputDir, `etapa5_6-deduped-${timestamp}.geojson`);
  
  try {
    console.log("   Carregando POIs para análise...");
    console.log("");
    
    // Carregar todos os POIs
    const file = await Deno.open(tempGeoJsonSeqPath, { read: true });
    const reader = file.readable.getReader();
    const decoder = new TextDecoder();
    
    let allFeatures: any[] = [];
    let buffer = "";
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.substring(0, newlineIndex).trim();
          buffer = buffer.substring(newlineIndex + 1);
          
          if (line.length > 0) {
            try {
              const feature = JSON.parse(line);
              allFeatures.push(feature);
            } catch (e) {
              // Ignorar linha inválida
            }
          }
        }
      }
      
      // Processar última linha se houver
      if (buffer.trim().length > 0) {
        try {
          const feature = JSON.parse(buffer.trim());
          allFeatures.push(feature);
        } catch (e) {
          // Ignorar
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch (e) {
        // Ignorar
      }
      try {
        file.close();
      } catch (e) {
        // Ignorar
      }
    }
    
    console.log(`   Total de POIs carregados: ${allFeatures.length.toLocaleString()}`);
    console.log("");
    
    // Agrupar POIs por nome
    const porNome: Map<string, any[]> = new Map();
    
    allFeatures.forEach(f => {
      const name = (f.properties?.name || '').trim();
      if (!name) {
        // POIs sem nome: adicionar diretamente
        return;
      }
      
      if (!porNome.has(name)) {
        porNome.set(name, []);
      }
      porNome.get(name)!.push(f);
    });
    
    // Processar duplicatas
    const validFeatures: any[] = [];
    const removedFeatures: any[] = [];
    let duplicatesRemoved = 0;
    
    // Adicionar POIs sem nome primeiro
    allFeatures.forEach(f => {
      const name = (f.properties?.name || '').trim();
      if (!name) {
        validFeatures.push(f);
      }
    });
    
    // Processar POIs com nome
    porNome.forEach((pois, name) => {
      if (pois.length === 1) {
        // Sem duplicatas, adicionar diretamente
        validFeatures.push(pois[0]);
        return;
      }
      
      // Múltiplas entradas com mesmo nome - verificar localização
      const comCoordenadas = pois.filter(p => getCoordenadas(p) !== null);
      
      if (comCoordenadas.length < 2) {
        // Sem coordenadas suficientes, considerar como diferentes
        pois.forEach(p => validFeatures.push(p));
        return;
      }
      
      // Agrupar por localização (duplicatas reais)
      const grupos: any[][] = [];
      
      comCoordenadas.forEach(poi => {
        const coord = getCoordenadas(poi)!;
        let grupoEncontrado = false;
        
        for (const grupo of grupos) {
          const coordGrupo = getCoordenadas(grupo[0])!;
          const dist = distanciaKm(coord.lat, coord.lon, coordGrupo.lat, coordGrupo.lon);
          
          // Ajustar threshold para 500m (mais rigoroso)
          // POIs com mesmo nome a menos de 500m são considerados duplicatas
          if (dist <= 0.5) { // 500m
            grupo.push(poi);
            grupoEncontrado = true;
            break;
          }
        }
        
        if (!grupoEncontrado) {
          grupos.push([poi]);
        }
      });
      
      // Processar cada grupo
      grupos.forEach(grupo => {
        if (grupo.length === 1) {
          // Sem duplicatas neste grupo, adicionar
          validFeatures.push(grupo[0]);
        } else {
          // Duplicatas reais - manter apenas 1 (com mais informações)
          grupo.sort((a, b) => getInfoScore(b) - getInfoScore(a));
          validFeatures.push(grupo[0]);
          removedFeatures.push(...grupo.slice(1));
          duplicatesRemoved += grupo.length - 1;
        }
      });
      
      // Adicionar POIs sem coordenadas (não podem ser comparados)
      pois.filter(p => getCoordenadas(p) === null).forEach(p => validFeatures.push(p));
    });
    
    console.log(`   Total de POIs antes da deduplicação: ${allFeatures.length.toLocaleString()}`);
    console.log(`   Duplicatas removidas: ${duplicatesRemoved.toLocaleString()}`);
    console.log(`   POIs válidos restantes: ${validFeatures.length.toLocaleString()}`);
    console.log(`   Redução: ${Math.round((duplicatesRemoved / allFeatures.length) * 100)}%`);
    console.log("");
    
    // Criar novo GeoJSON filtrado
    const filteredGeoJson = {
      type: "FeatureCollection",
      features: validFeatures
    };
    
    await Deno.writeTextFile(etapa5_6FinalPath, JSON.stringify(filteredGeoJson));
    console.log(`✅ ETAPA 5.6.2 complete: ${etapa5_6FinalPath}`);
    console.log("");
    
    // Remover arquivo temporário
    try {
      await Deno.remove(tempGeoJsonSeqPath);
    } catch (e) {
      // Ignorar erro se arquivo já foi removido
    }
  } catch (error) {
    console.error(`❌ Error in ETAPA 5.6.2: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
  
  console.log("✅ ETAPA 5.6 concluída!");
  console.log("");
  
  return etapa5_6FinalPath;
}

/**
 * ETAPA 5.7: Remove Generic Single-Word POIs
 * 
 * Remove POIs com nomes de apenas 1 palavra que não têm valor turístico identificável.
 * 
 * Critérios para REMOVER:
 * - POI com nome de apenas 1 palavra
 * - E sem referências externas (Wikipedia/Wikidata)
 * - E sem descrição
 * 
 * Critérios para MANTER (exceções):
 * - POIs com Wikipedia ou Wikidata (têm valor identificável)
 * - POIs com descrição (têm contexto)
 * - POIs históricos ou turísticos específicos (já filtrados nas etapas anteriores)
 */
async function executeEtapa5_7(
  inputPath: string,
  outputDir: string,
  timestamp: number
): Promise<string> {
  console.log("=".repeat(60));
  console.log("📋 ETAPA 5.7: Remover POIs Genéricos com Nome de 1 Palavra");
  console.log("=".repeat(60));
  console.log("🎯 Objetivo: Remover POIs genéricos sem valor turístico identificável");
  console.log("");
  console.log("📊 Critérios:");
  console.log("   • REMOVER: POIs com nome de 1 palavra SEM referências externas E SEM descrição");
  console.log("   • MANTER: POIs com Wikipedia/Wikidata (têm valor identificável)");
  console.log("   • MANTER: POIs com descrição (têm contexto)");
  console.log("   • MANTER: POIs históricos/turísticos específicos");
  console.log("");
  
  // Função para verificar se o nome tem apenas 1 palavra
  function isSingleWord(name: string | undefined): boolean {
    if (!name || !name.trim()) return false;
    const words = name.trim().split(/\s+/).filter(w => w.length > 0);
    return words.length === 1;
  }
  
  // Função para verificar se o POI tem valor identificável
  function hasTourismValue(poi: any): boolean {
    const props = poi.properties || {};
    
    // Tem referências externas
    if (props.wikipedia || props.wikidata) {
      return true;
    }
    
    // Tem descrição
    if (props.description && props.description.trim().length > 0) {
      return true;
    }
    
    // É explicitamente histórico ou turístico (mas isso já foi filtrado nas etapas anteriores)
    // Vamos manter apenas se tiver referências ou descrição
    
    return false;
  }
  
  // 5.7.1: Converter para GeoJSONSeq (se necessário)
  console.log("📋 ETAPA 5.7.1: Preparando arquivo para análise...");
  console.log("");
  
  let tempGeoJsonSeqPath: string;
  
  try {
    if (inputPath.endsWith('.geojson')) {
      const data = JSON.parse(await Deno.readTextFile(inputPath));
      const features = data.features || [];
      
      tempGeoJsonSeqPath = join(outputDir, `temp-etapa5_7-${timestamp}.geojsonseq`);
      const file = await Deno.open(tempGeoJsonSeqPath, { write: true, create: true, truncate: true });
      const encoder = new TextEncoder();
      
      for (const feature of features) {
        const line = JSON.stringify(feature) + '\n';
        await file.write(encoder.encode(line));
      }
      
      file.close();
      console.log(`✅ GeoJSON convertido para GeoJSONSeq: ${tempGeoJsonSeqPath}`);
    } else if (inputPath.endsWith('.pbf')) {
      tempGeoJsonSeqPath = join(outputDir, `temp-etapa5_7-${timestamp}.geojsonseq`);
      
      const command = new Deno.Command("osmium", {
        args: [
          "export",
          inputPath,
          "-f", "geojsonseq",
          "-o", tempGeoJsonSeqPath,
          "--overwrite"
        ],
        stdout: "piped",
        stderr: "piped"
      });
      
      const { code, stderr } = await command.output();
      
      if (code !== 0) {
        const error = new TextDecoder().decode(stderr);
        throw new Error(`Osmium export failed: ${error}`);
      }
      
      console.log(`✅ PBF convertido para GeoJSONSeq: ${tempGeoJsonSeqPath}`);
    } else {
      throw new Error(`Formato de arquivo não suportado: ${inputPath}`);
    }
    
    console.log("");
  } catch (error) {
    console.error(`❌ Error in ETAPA 5.7.1: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
  
  // 5.7.2: Processar e remover POIs genéricos
  console.log("📋 ETAPA 5.7.2: Processando e removendo POIs genéricos...");
  console.log("");
  
  const etapa5_7FinalPath = join(outputDir, `etapa5_7-single-word-filtered-${timestamp}.geojson`);
  
  try {
    console.log("   Carregando POIs para análise...");
    console.log("");
    
    // Carregar todos os POIs
    const file = await Deno.open(tempGeoJsonSeqPath, { read: true });
    const reader = file.readable.getReader();
    const decoder = new TextDecoder();
    
    let allFeatures: any[] = [];
    let buffer = "";
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.substring(0, newlineIndex).trim();
          buffer = buffer.substring(newlineIndex + 1);
          
          if (line.length > 0) {
            try {
              const feature = JSON.parse(line);
              allFeatures.push(feature);
            } catch (e) {
              // Ignorar linha inválida
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
      file.close();
    }
    
    console.log(`   Total de POIs carregados: ${allFeatures.length.toLocaleString()}`);
    console.log("");
    
    // Filtrar POIs
    let removedCount = 0;
    let keptCount = 0;
    const keptWithValue: any[] = [];
    const removedPOIs: any[] = [];
    
    for (const poi of allFeatures) {
      const props = poi.properties || {};
      const name = props.name;
      
      // Verificar se tem nome de apenas 1 palavra
      if (isSingleWord(name)) {
        // Verificar se tem valor turístico identificável
        if (hasTourismValue(poi)) {
          // MANTER: tem valor identificável
          keptCount++;
          keptWithValue.push(poi);
        } else {
          // REMOVER: genérico sem valor
          removedCount++;
          removedPOIs.push(poi);
        }
      } else {
        // MANTER: não é nome de 1 palavra
        keptCount++;
        keptWithValue.push(poi);
      }
    }
    
    console.log("📊 Resultados da filtragem:");
    console.log(`   POIs analisados: ${allFeatures.length.toLocaleString()}`);
    console.log(`   POIs mantidos: ${keptCount.toLocaleString()} (${((keptCount / allFeatures.length) * 100).toFixed(2)}%)`);
    console.log(`   POIs removidos: ${removedCount.toLocaleString()} (${((removedCount / allFeatures.length) * 100).toFixed(2)}%)`);
    console.log("");
    
    // Mostrar alguns exemplos de POIs removidos
    if (removedPOIs.length > 0) {
      console.log("📋 Exemplos de POIs removidos (primeiros 10):");
      removedPOIs.slice(0, 10).forEach((poi, index) => {
        const props = poi.properties || {};
        console.log(`   ${index + 1}. "${props.name || 'sem nome'}" - ${props.tourism || props.historic || props.leisure || props.natural || 'sem categoria'}`);
      });
      console.log("");
    }
    
    // Mostrar alguns exemplos de POIs mantidos (com valor)
    const keptWithValueExamples = keptWithValue.filter(poi => {
      const props = poi.properties || {};
      return isSingleWord(props.name) && hasTourismValue(poi);
    });
    
    if (keptWithValueExamples.length > 0) {
      console.log("✅ Exemplos de POIs mantidos (com valor identificável):");
      keptWithValueExamples.slice(0, 5).forEach((poi, index) => {
        const props = poi.properties || {};
        const reasons: string[] = [];
        if (props.wikipedia) reasons.push("Wikipedia");
        if (props.wikidata) reasons.push("Wikidata");
        if (props.description) reasons.push("Descrição");
        console.log(`   ${index + 1}. "${props.name || 'sem nome'}" - Mantido por: ${reasons.join(", ")}`);
      });
      console.log("");
    }
    
    // Criar GeoJSON final
    const filteredGeoJson = {
      type: "FeatureCollection",
      features: keptWithValue
    };
    
    await Deno.writeTextFile(etapa5_7FinalPath, JSON.stringify(filteredGeoJson));
    console.log(`✅ ETAPA 5.7.2 complete: ${etapa5_7FinalPath}`);
    console.log("");
    
    // Remover arquivo temporário
    try {
      await Deno.remove(tempGeoJsonSeqPath);
    } catch (e) {
      // Ignorar erro se arquivo já foi removido
    }
  } catch (error) {
    console.error(`❌ Error in ETAPA 5.7.2: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
  
  console.log("✅ ETAPA 5.7 concluída!");
  console.log("");
  
  return etapa5_7FinalPath;
}

// Run the script
if (import.meta.main) {
  await main();
}


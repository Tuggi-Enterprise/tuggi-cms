/**
 * Análise de POIs com nomes de apenas 1 palavra
 * 
 * Objetivo: Identificar POIs com nomes genéricos (ex: "açude", "bosque", "mirante")
 * e avaliar se têm valor para o projeto de audioguia turístico
 */

import { readLines } from "https://deno.land/std@0.208.0/io/mod.ts";

interface POIProperties {
  name?: string;
  tourism?: string;
  historic?: string;
  leisure?: string;
  natural?: string;
  amenity?: string;
  wikipedia?: string;
  wikidata?: string;
  description?: string;
  [key: string]: any;
}

interface POIFeature {
  type: string;
  geometry: {
    type: string;
    coordinates: [number, number];
  };
  properties: POIProperties;
}

interface AnalysisResult {
  total: number;
  percentage: number;
  byCategory: Record<string, number>;
  withReferences: number;
  withDescription: number;
  commonNames: Array<{ name: string; count: number; examples: POIFeature[] }>;
  examples: POIFeature[];
}

async function analyzeSingleWordPOIs(filePath: string): Promise<AnalysisResult> {
  console.log("📊 Analisando POIs com nomes de apenas 1 palavra...\n");

  const file = await Deno.open(filePath);
  const fileContent = await Deno.readTextFile(filePath);
  const data: { type: string; features: POIFeature[] } = JSON.parse(fileContent);
  
  const allPOIs = data.features || [];
  const totalPOIs = allPOIs.length;

  // Filtrar POIs com nome de apenas 1 palavra
  const singleWordPOIs = allPOIs.filter(poi => {
    const name = poi.properties?.name?.trim();
    if (!name) return false;
    
    // Contar palavras (separadas por espaços)
    const words = name.split(/\s+/).filter(w => w.length > 0);
    return words.length === 1;
  });

  console.log(`✅ Total de POIs analisados: ${totalPOIs.toLocaleString()}`);
  console.log(`📌 POIs com nome de 1 palavra: ${singleWordPOIs.length.toLocaleString()} (${((singleWordPOIs.length / totalPOIs) * 100).toFixed(2)}%)\n`);

  // Análise por categoria
  const byCategory: Record<string, number> = {};
  let withReferences = 0;
  let withDescription = 0;

  singleWordPOIs.forEach(poi => {
    const props = poi.properties || {};
    
    // Categorias
    if (props.tourism) {
      byCategory['tourism'] = (byCategory['tourism'] || 0) + 1;
    }
    if (props.historic) {
      byCategory['historic'] = (byCategory['historic'] || 0) + 1;
    }
    if (props.leisure) {
      byCategory['leisure'] = (byCategory['leisure'] || 0) + 1;
    }
    if (props.natural) {
      byCategory['natural'] = (byCategory['natural'] || 0) + 1;
    }
    if (props.amenity) {
      byCategory['amenity'] = (byCategory['amenity'] || 0) + 1;
    }

    // Referências externas
    if (props.wikipedia || props.wikidata) {
      withReferences++;
    }

    // Descrição
    if (props.description && props.description.trim().length > 0) {
      withDescription++;
    }
  });

  // Agrupar por nome para identificar os mais comuns
  const nameGroups: Record<string, POIFeature[]> = {};
  singleWordPOIs.forEach(poi => {
    const name = (poi.properties?.name || '').toLowerCase().trim();
    if (!nameGroups[name]) {
      nameGroups[name] = [];
    }
    nameGroups[name].push(poi);
  });

  // Ordenar por frequência
  const commonNames = Object.entries(nameGroups)
    .map(([name, pois]) => ({
      name,
      count: pois.length,
      examples: pois.slice(0, 3) // Primeiros 3 exemplos
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50); // Top 50

  // Exemplos diversos para análise
  const examples = singleWordPOIs
    .filter(poi => poi.properties?.wikipedia || poi.properties?.wikidata || poi.properties?.description)
    .slice(0, 20);

  return {
    total: singleWordPOIs.length,
    percentage: (singleWordPOIs.length / totalPOIs) * 100,
    byCategory,
    withReferences,
    withDescription,
    commonNames,
    examples
  };
}

async function generateReport(result: AnalysisResult, outputPath: string) {
  const report = {
    summary: {
      total: result.total,
      percentage: result.percentage.toFixed(2),
      withReferences: result.withReferences,
      withDescription: result.withDescription,
      withReferencesPercentage: ((result.withReferences / result.total) * 100).toFixed(2),
      withDescriptionPercentage: ((result.withDescription / result.total) * 100).toFixed(2)
    },
    byCategory: result.byCategory,
    commonNames: result.commonNames.map(n => ({
      name: n.name,
      count: n.count,
      examples: n.examples.map(e => ({
        name: e.properties?.name,
        tourism: e.properties?.tourism,
        historic: e.properties?.historic,
        leisure: e.properties?.leisure,
        natural: e.properties?.natural,
        wikipedia: e.properties?.wikipedia,
        wikidata: e.properties?.wikidata,
        description: e.properties?.description?.substring(0, 100)
      }))
    })),
    examples: result.examples.map(e => ({
      name: e.properties?.name,
      tourism: e.properties?.tourism,
      historic: e.properties?.historic,
      leisure: e.properties?.leisure,
      natural: e.properties?.natural,
      amenity: e.properties?.amenity,
      wikipedia: e.properties?.wikipedia,
      wikidata: e.properties?.wikidata,
      description: e.properties?.description,
      coordinates: e.geometry.coordinates
    }))
  };

  await Deno.writeTextFile(outputPath, JSON.stringify(report, null, 2));
  console.log(`\n✅ Relatório JSON salvo em: ${outputPath}`);
}

async function printReport(result: AnalysisResult) {
  console.log("\n" + "=".repeat(60));
  console.log("📊 RELATÓRIO DE ANÁLISE - POIs COM NOME DE 1 PALAVRA");
  console.log("=".repeat(60) + "\n");

  console.log("📈 RESUMO GERAL:");
  console.log(`   Total: ${result.total.toLocaleString()} POIs (${result.percentage.toFixed(2)}% do total)`);
  console.log(`   Com referências externas (Wikipedia/Wikidata): ${result.withReferences.toLocaleString()} (${((result.withReferences / result.total) * 100).toFixed(2)}%)`);
  console.log(`   Com descrição: ${result.withDescription.toLocaleString()} (${((result.withDescription / result.total) * 100).toFixed(2)}%)\n`);

  console.log("📋 DISTRIBUIÇÃO POR CATEGORIA:");
  const sortedCategories = Object.entries(result.byCategory)
    .sort((a, b) => b[1] - a[1]);
  
  sortedCategories.forEach(([cat, count]) => {
    const percentage = ((count / result.total) * 100).toFixed(1);
    console.log(`   • ${cat}: ${count.toLocaleString()} (${percentage}%)`);
  });

  console.log("\n🔤 NOMES MAIS COMUNS (Top 20):");
  result.commonNames.slice(0, 20).forEach((item, index) => {
    const percentage = ((item.count / result.total) * 100).toFixed(1);
    console.log(`   ${(index + 1).toString().padStart(2)}. "${item.name}": ${item.count.toLocaleString()} POIs (${percentage}%)`);
  });

  console.log("\n💡 EXEMPLOS DE POIs COM VALOR (com referências/descrição):");
  result.examples.slice(0, 10).forEach((poi, index) => {
    const props = poi.properties || {};
    console.log(`\n   ${index + 1}. "${props.name}"`);
    if (props.tourism) console.log(`      Categoria: tourism=${props.tourism}`);
    if (props.historic) console.log(`      Categoria: historic=${props.historic}`);
    if (props.leisure) console.log(`      Categoria: leisure=${props.leisure}`);
    if (props.natural) console.log(`      Categoria: natural=${props.natural}`);
    if (props.wikipedia) console.log(`      Wikipedia: ${props.wikipedia}`);
    if (props.wikidata) console.log(`      Wikidata: ${props.wikidata}`);
    if (props.description) {
      const desc = props.description.length > 150 
        ? props.description.substring(0, 150) + "..." 
        : props.description;
      console.log(`      Descrição: ${desc}`);
    }
  });

  console.log("\n" + "=".repeat(60));
  console.log("💭 ANÁLISE E RECOMENDAÇÕES:");
  console.log("=".repeat(60) + "\n");

  const genericNames = ['mirante', 'bosque', 'açude', 'lago', 'praia', 'cachoeira', 'trilha', 'parque', 'monumento', 'estátua', 'busto', 'escultura', 'memorial', 'marco', 'cruzeiro'];
  const genericCount = result.commonNames
    .filter(n => genericNames.includes(n.name.toLowerCase()))
    .reduce((sum, n) => sum + n.count, 0);

  console.log(`📌 POIs com nomes genéricos comuns: ${genericCount.toLocaleString()} (${((genericCount / result.total) * 100).toFixed(1)}%)`);
  console.log(`📌 POIs com referências externas: ${result.withReferences.toLocaleString()} (${((result.withReferences / result.total) * 100).toFixed(1)}%)`);
  console.log(`📌 POIs com descrição: ${result.withDescription.toLocaleString()} (${((result.withDescription / result.total) * 100).toFixed(1)}%)\n`);

  const withValue = result.withReferences + result.withDescription;
  const withoutValue = result.total - withValue;
  
  console.log("💡 RECOMENDAÇÕES:");
  console.log(`   • POIs com valor identificável: ${withValue.toLocaleString()} (${((withValue / result.total) * 100).toFixed(1)}%)`);
  console.log(`   • POIs sem valor identificável: ${withoutValue.toLocaleString()} (${((withoutValue / result.total) * 100).toFixed(1)}%)\n`);
  
  if (withoutValue > result.total * 0.5) {
    console.log("   ⚠️  ATENÇÃO: Mais de 50% dos POIs com nome de 1 palavra");
    console.log("      não têm referências externas ou descrição.");
    console.log("      Considere remover POIs genéricos sem contexto.\n");
  } else {
    console.log("   ✅ A maioria dos POIs tem algum valor identificável.\n");
  }
}

async function main() {
  const inputFile = "output/pois-turisticos-final.geojson";
  const outputJson = "output/analise-pois-nome-simples.json";
  const outputTxt = "output/analise-pois-nome-simples.txt";

  try {
    const result = await analyzeSingleWordPOIs(inputFile);
    
    // Salvar relatório JSON
    await generateReport(result, outputJson);
    
    // Imprimir relatório no console e salvar em TXT
    const originalLog = console.log;
    let txtOutput = "";
    console.log = (...args: any[]) => {
      txtOutput += args.join(" ") + "\n";
      originalLog(...args);
    };
    
    await printReport(result);
    
    console.log = originalLog;
    await Deno.writeTextFile(outputTxt, txtOutput);
    console.log(`✅ Relatório TXT salvo em: ${outputTxt}\n`);

  } catch (error) {
    console.error("❌ Erro:", error);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}


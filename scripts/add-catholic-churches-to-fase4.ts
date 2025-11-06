#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run

/**
 * Adiciona igrejas católicas ao arquivo final da Fase 4
 * 
 * Filtra igrejas católicas do arquivo original e faz merge com o GeoJSON final da Fase 4
 * 
 * Usage:
 *   deno run scripts/add-catholic-churches-to-fase4.ts <fase4-geojson> [original-pbf]
 */

import { PBFProcessor } from "../plugins/osm-geojson-filter/lib/pbf-processor.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";

const args = Deno.args;
const fase4GeoJson = args[0];
const originalPbf = args[1] || "omsData/sudeste-251012.osm.pbf";

if (!fase4GeoJson) {
  console.error("❌ Erro: Arquivo GeoJSON da Fase 4 é obrigatório");
  console.error("   Usage: deno run scripts/add-catholic-churches-to-fase4.ts <fase4-geojson> [original-pbf]");
  Deno.exit(1);
}

console.log("🏛️  Adicionando Igrejas Católicas ao Arquivo Final da Fase 4");
console.log("=".repeat(60));
console.log("");
console.log(`📁 Arquivo Fase 4: ${fase4GeoJson}`);
console.log(`📁 Arquivo original: ${originalPbf}`);
console.log("");

const processor = new PBFProcessor("output");
const timestamp = Date.now();

try {
  // 1. Filtrar igrejas católicas do arquivo original
  console.log("📋 ETAPA 1: Filtrando igrejas católicas do arquivo original...");
  console.log("   Critério: denomination=catholic/roman_catholic + amenity=place_of_worship");
  console.log("   (Ordem: primeiro denomination, depois amenity para capturar todas)");
  console.log("");
  
  // 1.1: Filtrar denomination católica primeiro (mais específico)
  console.log("📋 1.1: Filtrando denomination católica...");
  const catholicDenominations = [
    "denomination=catholic",
    "denomination=roman_catholic"
  ];
  
  const denominationFiles: string[] = [];
  for (const denom of catholicDenominations) {
    try {
      // Não usar --omit-referenced para não perder ways/relations
      const denomPath = await processor.extractTags(originalPbf, [denom], false);
      denominationFiles.push(denomPath);
      console.log(`   ✅ ${denom}: encontrado`);
    } catch (error) {
      console.log(`   ⚠️  ${denom}: não encontrado`);
    }
  }
  
  if (denominationFiles.length === 0) {
    console.error("❌ Nenhuma igreja católica encontrada!");
    Deno.exit(1);
  }
  
  console.log("");
  
  // 1.2: Merge das denominações católicas
  console.log("📋 1.2: Fazendo merge das denominações católicas...");
  const mergedDenomPath = join("output", `temp-catholic-denom-${timestamp}.osm.pbf`);
  await processor.mergeFiles(denominationFiles, mergedDenomPath);
  console.log(`✅ 1.2 complete`);
  console.log("");
  
  // 1.3: Filtrar amenity=place_of_worship do resultado
  console.log("📋 1.3: Filtrando amenity=place_of_worship...");
  const mergedCatholicPath = join("output", `catholic-churches-${timestamp}.osm.pbf`);
  // Não usar --omit-referenced para não perder ways/relations
  const finalCatholicPath = await processor.extractTags(mergedDenomPath, ["amenity=place_of_worship"], false);
  await Deno.rename(finalCatholicPath, mergedCatholicPath);
  console.log(`✅ 1.3 complete: ${mergedCatholicPath}`);
  console.log("");
  
  // Limpar arquivo temporário
  try {
    await Deno.remove(mergedDenomPath);
    denominationFiles.forEach(f => Deno.remove(f).catch(() => {}));
  } catch (e) {
    // Ignorar erros de limpeza
  }
  
  // 2. Converter igrejas católicas para GeoJSON
  console.log("📋 ETAPA 2: Convertendo igrejas católicas para GeoJSON...");
  const catholicGeoJsonPath = join("output", `catholic-churches-${timestamp}.geojson`);
  await processor.convertToGeoJSONHighQuality(mergedCatholicPath, catholicGeoJsonPath);
  console.log(`✅ ETAPA 2 complete: ${catholicGeoJsonPath}`);
  console.log("");
  
  // 3. Ler arquivos GeoJSON
  console.log("📋 ETAPA 3: Lendo arquivos GeoJSON...");
  const fase4Data = JSON.parse(await Deno.readTextFile(fase4GeoJson));
  const catholicData = JSON.parse(await Deno.readTextFile(catholicGeoJsonPath));
  
  const fase4Features = fase4Data.features || [];
  const catholicFeatures = catholicData.features || [];
  
  console.log(`   Fase 4: ${fase4Features.length} POIs`);
  console.log(`   Igrejas católicas: ${catholicFeatures.length} POIs`);
  console.log("");
  
  // 4. Filtrar igrejas católicas que já estão na Fase 4 (evitar duplicatas)
  console.log("📋 ETAPA 4: Removendo duplicatas...");
  const fase4Ids = new Set(fase4Features.map((f: any) => f.id));
  
  // Criar um mapa de features da Fase 4 por coordenadas aproximadas (para detectar duplicatas mesmo sem ID)
  const fase4ByLocation = new Map<string, any[]>();
  fase4Features.forEach((f: any) => {
    const coords = f.geometry?.coordinates;
    if (coords && Array.isArray(coords) && coords.length >= 2) {
      // Arredondar coordenadas para ~10 metros de precisão
      const lat = Math.round(coords[1] * 10000) / 10000;
      const lon = Math.round(coords[0] * 10000) / 10000;
      const key = `${lat},${lon}`;
      if (!fase4ByLocation.has(key)) {
        fase4ByLocation.set(key, []);
      }
      fase4ByLocation.get(key)!.push(f);
    }
  });
  
  // Filtrar apenas features que são realmente igrejas (amenity=place_of_worship)
  const igrejasCatolicas = catholicFeatures.filter((f: any) => {
    const props = f.properties || {};
    return props['amenity'] === 'place_of_worship' &&
           (props.denomination === 'catholic' || props.denomination === 'roman_catholic');
  });
  
  console.log(`   Igrejas católicas filtradas (amenity=place_of_worship): ${igrejasCatolicas.length}`);
  console.log("");
  
  // Adicionar TODAS as igrejas católicas que não estão na Fase 4
  // (mesmo sem nome, são importantes para turismo em cidades do interior)
  const novasIgrejas = igrejasCatolicas.filter((f: any) => {
    // Verificar se já existe na Fase 4 pelo ID
    if (fase4Ids.has(f.id)) {
      return false;
    }
    
    // Verificar se já existe na Fase 4 com mesmo nome e localização
    const props = f.properties || {};
    const name = props.name;
    const coords = f.geometry?.coordinates;
    
    if (coords && Array.isArray(coords) && coords.length >= 2) {
      const lat = Math.round(coords[1] * 10000) / 10000;
      const lon = Math.round(coords[0] * 10000) / 10000;
      const key = `${lat},${lon}`;
      
      if (fase4ByLocation.has(key)) {
        const existing = fase4ByLocation.get(key)!;
        
        // Se tem nome, verificar se existe uma com o mesmo nome
        if (name) {
          const sameName = existing.some((e: any) => {
            const eProps = e.properties || {};
            return eProps.name === name && 
                   (eProps['amenity'] === 'place_of_worship' || 
                    eProps.historic === 'church' ||
                    eProps.tourism);
          });
          if (sameName) {
            return false; // É duplicata (mesmo nome e mesma localização)
          }
        }
        
        // Se não tem nome mas já existe uma igreja católica na mesma localização
        if (!name && existing.length > 0) {
          const isSameChurch = existing.some((e: any) => {
            const eProps = e.properties || {};
            return (eProps['amenity'] === 'place_of_worship' &&
                   (eProps.denomination === 'catholic' || eProps.denomination === 'roman_catholic')) ||
                   (eProps.historic === 'church' && 
                    (eProps.denomination === 'catholic' || eProps.denomination === 'roman_catholic'));
          });
          if (isSameChurch) {
            return false; // É duplicata (mesma igreja sem nome)
          }
        }
      }
    }
    
    return true; // Adicionar (não é duplicata)
  });
  
  console.log(`   Duplicatas removidas: ${catholicFeatures.length - novasIgrejas.length}`);
  console.log(`   Igrejas novas a adicionar: ${novasIgrejas.length}`);
  console.log("");
  
  // Estatísticas das novas igrejas
  const novasComNome = novasIgrejas.filter((f: any) => f.properties?.name);
  const novasSemNome = novasIgrejas.filter((f: any) => !f.properties?.name);
  console.log(`   📝 Novas igrejas com nome: ${novasComNome.length} (${Math.round(novasComNome.length/novasIgrejas.length*100 || 0)}%)`);
  console.log(`   📝 Novas igrejas sem nome: ${novasSemNome.length}`);
  console.log("");
  
  // 5. Fazer merge
  console.log("📋 ETAPA 5: Fazendo merge dos arquivos...");
  const mergedFeatures = [...fase4Features, ...novasIgrejas];
  
  const mergedGeoJson = {
    type: "FeatureCollection",
    features: mergedFeatures
  };
  
  const outputPath = join("output", `fase4-with-catholic-churches-${timestamp}.geojson`);
  await Deno.writeTextFile(outputPath, JSON.stringify(mergedGeoJson, null, 2));
  
  console.log(`✅ ETAPA 5 complete: ${outputPath}`);
  console.log("");
  
  // 6. Resumo final
  console.log("📊 RESUMO FINAL:");
  console.log("=".repeat(60));
  console.log(`   POIs na Fase 4 original: ${fase4Features.length}`);
  console.log(`   Igrejas católicas encontradas: ${catholicFeatures.length}`);
  console.log(`   Duplicatas removidas: ${catholicFeatures.length - novasIgrejas.length}`);
  console.log(`   Igrejas novas adicionadas: ${novasIgrejas.length}`);
  console.log(`   Total final: ${mergedFeatures.length}`);
  console.log("");
  console.log(`📁 Arquivo final: ${outputPath}`);
  console.log("");
  console.log("✅ Processo concluído!");
  
  // Limpar arquivos temporários
  try {
    await Deno.remove(placeOfWorshipPath);
    await Deno.remove(mergedCatholicPath);
    await Deno.remove(catholicGeoJsonPath);
    catholicFiles.forEach(f => Deno.remove(f).catch(() => {}));
  } catch (e) {
    // Ignorar erros de limpeza
  }
  
} catch (error) {
  console.error(`❌ Erro: ${error.message}`);
  Deno.exit(1);
}


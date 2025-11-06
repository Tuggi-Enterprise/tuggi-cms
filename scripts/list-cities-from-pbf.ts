#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run

/**
 * List all cities from a PBF file
 * 
 * Extracts cities using place=city, place=town, place=municipality
 * and optionally administrative boundaries (type=boundary, admin_level=8)
 * 
 * Usage:
 *   deno run scripts/list-cities-from-pbf.ts <input-pbf> [--output output.json]
 * 
 * Example:
 *   deno run scripts/list-cities-from-pbf.ts omsData/sudeste-251012.osm.pbf
 */

import { PBFProcessor } from "../plugins/osm-geojson-filter/lib/pbf-processor.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";

interface City {
  name: string;
  place: string;
  state?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  osm_id?: string;
  osm_type?: string;
}

async function listCitiesFromPBF(inputPath: string, outputPath?: string): Promise<City[]> {
  console.log("🏙️  Listando cidades do arquivo PBF");
  console.log("=".repeat(60));
  console.log(`📁 Arquivo: ${inputPath}`);
  console.log("");

  // Verificar se arquivo existe
  try {
    await Deno.stat(inputPath);
  } catch {
    throw new Error(`Arquivo não encontrado: ${inputPath}`);
  }

  const processor = new PBFProcessor("output");

  // Verificar osmium
  const hasOsmium = await processor.checkOsmiumTool();
  if (!hasOsmium) {
    throw new Error("osmium-tool não encontrado! Instale com: brew install osmctools");
  }

  // Extrair cidades usando place tags
  console.log("🔍 Extraindo cidades (place=city, place=town, place=municipality)...");
  const tempPBF = join("output", `temp-cities-${Date.now()}.osm.pbf`);
  
  try {
    await processor.extractTags(inputPath, [
      "place=city",
      "place=town", 
      "place=municipality"
    ], false); // Não omit referenced para manter geometria

    // Encontrar o arquivo mais recente gerado
    const files = await Array.fromAsync(Deno.readDir("output"));
    const cityFiles = files
      .filter(f => f.name.startsWith("filtered-") && f.name.endsWith(".osm.pbf"))
      .sort((a, b) => b.name.localeCompare(a.name));
    
    if (cityFiles.length === 0) {
      throw new Error("Nenhum arquivo de cidades foi gerado");
    }

    const latestCityFile = join("output", cityFiles[0].name);
    
    // Converter para GeoJSON
    console.log("📊 Convertendo para GeoJSON...");
    const tempGeoJSON = join("output", `temp-cities-${Date.now()}.geojson`);
    await processor.convertToGeoJSONHighQuality(latestCityFile, tempGeoJSON);

    // Ler e processar GeoJSON
    console.log("📖 Processando dados...");
    const geojsonContent = await Deno.readTextFile(tempGeoJSON);
    const geojson = JSON.parse(geojsonContent);

    if (!geojson.features || !Array.isArray(geojson.features)) {
      throw new Error("Formato GeoJSON inválido");
    }

    const cities: City[] = [];
    const seen = new Set<string>();

    for (const feature of geojson.features) {
      const props = feature.properties || {};
      const name = props.name || props["name:pt"] || props["name:en"];
      const place = props.place;

      if (!name || !place) continue;

      // Evitar duplicatas (mesmo nome na mesma cidade)
      const key = `${name}|${place}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Extrair coordenadas
      let latitude: number | undefined;
      let longitude: number | undefined;

      if (feature.geometry?.type === "Point" && feature.geometry.coordinates) {
        longitude = feature.geometry.coordinates[0];
        latitude = feature.geometry.coordinates[1];
      } else if (feature.geometry?.type === "Polygon" && feature.geometry.coordinates?.[0]?.[0]) {
        // Usar primeiro ponto do polígono como referência
        longitude = feature.geometry.coordinates[0][0][0];
        latitude = feature.geometry.coordinates[0][0][1];
      }

      // Extrair ID do OSM
      let osm_id: string | undefined;
      let osm_type: string | undefined;
      
      if (feature.id) {
        const idStr = String(feature.id);
        if (idStr.startsWith("w")) {
          osm_type = "way";
          osm_id = idStr.substring(1);
        } else if (idStr.startsWith("r")) {
          osm_type = "relation";
          osm_id = idStr.substring(1);
        } else {
          osm_type = "node";
          osm_id = idStr;
        }
      }

      cities.push({
        name,
        place,
        state: props["addr:state"] || props["is_in:state"] || props["addr:province"],
        country: props["addr:country"] || props["is_in:country"] || "Brasil",
        latitude,
        longitude,
        osm_id,
        osm_type
      });
    }

    // Ordenar por nome
    cities.sort((a, b) => a.name.localeCompare(b.name));

    // Limpar arquivos temporários
    try {
      await Deno.remove(latestCityFile);
      await Deno.remove(tempGeoJSON);
    } catch {
      // Ignorar erros de limpeza
    }

    console.log(`✅ ${cities.length} cidades encontradas`);
    console.log("");

    // Mostrar estatísticas
    const byPlace = new Map<string, number>();
    cities.forEach(city => {
      byPlace.set(city.place, (byPlace.get(city.place) || 0) + 1);
    });

    console.log("📊 Estatísticas:");
    console.log(`   Total: ${cities.length}`);
    Array.from(byPlace.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([place, count]) => {
        console.log(`   ${place}: ${count}`);
      });

    // Salvar em arquivo JSON se solicitado
    if (outputPath) {
      await Deno.writeTextFile(outputPath, JSON.stringify(cities, null, 2));
      console.log("");
      console.log(`💾 Lista salva em: ${outputPath}`);
    }

    return cities;
  } catch (error) {
    // Limpar arquivos temporários em caso de erro
    try {
      const files = await Array.fromAsync(Deno.readDir("output"));
      for (const file of files) {
        if (file.name.startsWith("temp-cities-") || file.name.startsWith("filtered-")) {
          await Deno.remove(join("output", file.name));
        }
      }
    } catch {
      // Ignorar erros de limpeza
    }
    throw error;
  }
}

async function main() {
  const args = Deno.args;
  
  if (args.length < 1) {
    console.error("❌ Uso incorreto!");
    console.log("");
    console.log("Uso:");
    console.log("  deno run scripts/list-cities-from-pbf.ts <input-pbf> [--output output.json]");
    console.log("");
    console.log("Exemplos:");
    console.log('  deno run scripts/list-cities-from-pbf.ts omsData/sudeste-251012.osm.pbf');
    console.log('  deno run scripts/list-cities-from-pbf.ts omsData/sudeste-251012.osm.pbf --output cities.json');
    Deno.exit(1);
  }

  const inputFile = args[0];
  let outputFile: string | undefined;

  const outputIndex = args.indexOf("--output");
  if (outputIndex >= 0 && outputIndex < args.length - 1) {
    outputFile = args[outputIndex + 1];
  }

  try {
    const cities = await listCitiesFromPBF(inputFile, outputFile);

    console.log("");
    console.log("📋 Primeiras 20 cidades:");
    cities.slice(0, 20).forEach((city, i) => {
      console.log(`   ${i + 1}. ${city.name} (${city.place})${city.state ? ` - ${city.state}` : ""}`);
    });

    if (cities.length > 20) {
      console.log(`   ... e mais ${cities.length - 20} cidades`);
    }

    console.log("");
    console.log("✅ Processo concluído!");
  } catch (error) {
    console.error(`❌ Erro: ${error.message}`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}


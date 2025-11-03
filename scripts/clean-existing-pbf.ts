#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run

/**
 * Clean existing filtered PBF file
 * Re-filters the already filtered PBF to remove objects without expected tags
 * Uses only PBF operations (no GeoJSON conversion)
 */

import { PBFProcessor } from "../plugins/osm-geojson-filter/lib/pbf-processor.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";

const inputFile = Deno.args[0] || "output/filtered-tourism-final-1762208716497.osm.pbf";
const outputDir = "output";
const timestamp = Date.now();

// Expected tags - same as original filter
const expectedTags = [
  "tourism=attraction", "tourism=museum", "tourism=artwork", "tourism=viewpoint",
  "tourism=theme_park", "tourism=zoo", "tourism=aquarium", "tourism=yes",
  "historic=monument", "historic=castle", "historic=church", "historic=memorial",
  "historic=ruins", "historic=archaeological_site", "historic=fort", "historic=tomb",
  "historic=wayside_shrine", "historic=yes",
  "natural=water", "natural=wood", "natural=beach", "natural=cliff", "natural=cave",
  "natural=tree", "natural=volcano", "natural=waterfall", "natural=geyser", "natural=hot_spring",
  "leisure=park", "leisure=stadium",
  "railway=station",
  "aeroway=aerodrome"
];

console.log("🧹 Cleaning existing filtered PBF file");
console.log("=".repeat(60));
console.log(`📁 Input: ${inputFile}`);
console.log(`📁 Output directory: ${outputDir}`);
console.log(`🎯 Filtering to keep only objects with ${expectedTags.length} expected tags`);
console.log(`⚠️  Using --omit-referenced to exclude related objects`);
console.log("");

const processor = new PBFProcessor(outputDir);

// Re-filter the already filtered file using --omit-referenced
// This will keep only objects that have the expected tags
// and exclude nodes/ways that are referenced but don't have the tags
const outputPath = join(outputDir, `filtered-tourism-cleaned-${timestamp}.osm.pbf`);

console.log("📋 Re-filtering PBF file with strict tag matching...");
console.log("   This will remove objects that don't have expected tags\n");

try {
  const cleanedPath = await processor.extractTags(inputFile, expectedTags, true); // true = omitReferenced
  
  // Rename to desired output name
  await Deno.rename(cleanedPath, outputPath);
  
  console.log(`✅ Cleaned PBF created: ${outputPath}\n`);
  
  // Show file info
  console.log("📊 Final file information:");
  await processor.getFileInfo(outputPath);
  console.log("");
  
  console.log("✅ Cleaning complete!");
  console.log(`📁 Final cleaned file: ${outputPath}`);
  
} catch (error) {
  console.error(`❌ Error: ${error.message}`);
  Deno.exit(1);
}


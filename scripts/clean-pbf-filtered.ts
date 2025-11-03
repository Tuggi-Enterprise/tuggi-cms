#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run

/**
 * Clean filtered PBF file - remove objects that don't have expected tags
 * 
 * This script ensures only POIs with the expected tourism/historic/natural/etc tags remain
 */

import { PBFProcessor } from "../plugins/osm-geojson-filter/lib/pbf-processor.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";

const inputFile = Deno.args[0] || "output/filtered-tourism-final-1762208716497.osm.pbf";
const outputDir = "output";
const timestamp = Date.now();

// Expected tags that should be present in objects
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

console.log("🧹 Cleaning PBF File");
console.log("=".repeat(60));
console.log(`📁 Input: ${inputFile}`);
console.log(`📁 Output directory: ${outputDir}`);
console.log(`🎯 Expected tags: ${expectedTags.length}`);
console.log("");

// Step 1: Convert to GeoJSON
console.log("📋 Step 1: Converting PBF to GeoJSON...");
const tempGeoJson = join(outputDir, `temp-clean-${timestamp}.geojson`);
const processor = new PBFProcessor(outputDir);

try {
  await processor.convertToGeoJSON(inputFile, tempGeoJson);
  console.log(`✅ Conversion complete: ${tempGeoJson}\n`);
} catch (error) {
  console.error(`❌ Error converting to GeoJSON: ${error.message}`);
  Deno.exit(1);
}

// Step 2: Read and filter GeoJSON
console.log("📋 Step 2: Filtering features...");
const geoJsonContent = await Deno.readTextFile(tempGeoJson);
const geoJson = JSON.parse(geoJsonContent);

const features = geoJson.features || [];
console.log(`   Total features: ${features.length}`);

const filteredFeatures: any[] = [];
let removedCount = 0;

for (const feature of features) {
  const props = feature.properties || {};
  
  // Check if has any expected tag
  let hasExpected = false;
  
  for (const expectedTag of expectedTags) {
    const [key, value] = expectedTag.split("=");
    
    // Check exact match
    if (props[key] === value) {
      hasExpected = true;
      break;
    }
    
    // Special case for tourism=yes and historic=yes
    if ((key === "tourism" || key === "historic") && value === "yes" && props[key] === "yes") {
      hasExpected = true;
      break;
    }
  }
  
  // Also check for railway=station and aeroway=aerodrome
  if (props.railway === "station" || props.aeroway === "aerodrome") {
    hasExpected = true;
  }
  
  if (hasExpected) {
    filteredFeatures.push(feature);
  } else {
    removedCount++;
  }
}

console.log(`   ✅ Features kept: ${filteredFeatures.length} (${((filteredFeatures.length/features.length)*100).toFixed(1)}%)`);
console.log(`   ❌ Features removed: ${removedCount} (${((removedCount/features.length)*100).toFixed(1)}%)\n`);

// Step 3: Save filtered GeoJSON
console.log("📋 Step 3: Saving filtered GeoJSON...");
const filteredGeoJson = {
  ...geoJson,
  features: filteredFeatures
};

const filteredGeoJsonPath = join(outputDir, `cleaned-${timestamp}.geojson`);
await Deno.writeTextFile(filteredGeoJsonPath, JSON.stringify(filteredGeoJson, null, 2));
console.log(`✅ Filtered GeoJSON saved: ${filteredGeoJsonPath}\n`);

// Step 4: Convert back to PBF
console.log("📋 Step 4: Converting filtered GeoJSON back to PBF...");
const finalPbfPath = join(outputDir, `filtered-tourism-cleaned-${timestamp}.osm.pbf`);

// Use osmium to convert GeoJSON to PBF
const convertCmd = new Deno.Command("osmium", {
  args: [
    "import",
    filteredGeoJsonPath,
    "-o", finalPbfPath
  ],
  stdout: "piped",
  stderr: "piped"
});

const { code: convertCode, stderr: convertStderr } = await convertCmd.output();

if (convertCode !== 0) {
  const error = new TextDecoder().decode(convertStderr);
  console.error(`❌ Error converting to PBF: ${error}`);
  console.log("   Trying alternative method...");
  
  // Alternative: use osmium export with format
  const altCmd = new Deno.Command("osmium", {
    args: [
      "export",
      "-f", "pbf",
      filteredGeoJsonPath,
      "-o", finalPbfPath
    ],
    stdout: "piped",
    stderr: "piped"
  });
  
  const { code: altCode, stderr: altStderr } = await altCmd.output();
  
  if (altCode !== 0) {
    const altError = new TextDecoder().decode(altStderr);
    console.error(`❌ Alternative conversion also failed: ${altError}`);
    console.log("\n💡 You can manually convert using:");
    console.log(`   osmium export -f pbf ${filteredGeoJsonPath} -o ${finalPbfPath}`);
    Deno.exit(1);
  }
}

console.log(`✅ Final cleaned PBF created: ${finalPbfPath}\n`);

// Step 5: Show file info
console.log("📋 Step 5: Final file information...");
await processor.getFileInfo(finalPbfPath);
console.log("");

// Cleanup temp files
console.log("🧹 Cleaning up temporary files...");
try {
  await Deno.remove(tempGeoJson);
  await Deno.remove(filteredGeoJsonPath);
  console.log("✅ Temporary files removed\n");
} catch (error) {
  console.log(`⚠️  Could not remove all temp files: ${error.message}\n`);
}

console.log("✅ Cleaning complete!");
console.log("");
console.log("📊 Summary:");
console.log(`   Original features: ${features.length}`);
console.log(`   Filtered features: ${filteredFeatures.length}`);
console.log(`   Removed features: ${removedCount}`);
console.log(`   Final PBF file: ${finalPbfPath}`);


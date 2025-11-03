#!/usr/bin/env -S deno run --allow-read --allow-run

/**
 * Verify if objects with unexpected tags also have expected tags
 * This ensures we're not keeping objects that shouldn't be there
 */

const filePath = Deno.args[0] || "output/filtered-tourism-cleaned-1762210050159.osm.pbf";

console.log(`🔍 Verifying cleaned PBF file: ${filePath}\n`);

// Expected tags
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

// Convert to GeoJSON for analysis
const tempGeoJson = "output/temp-verify-cleaned.geojson";

console.log("📥 Converting PBF to GeoJSON for analysis...");
const convertCmd = new Deno.Command("osmium", {
  args: ["export", filePath, "--output-format=geojson", "--output", tempGeoJson],
  stdout: "piped",
  stderr: "piped"
});

const { code: convertCode } = await convertCmd.output();
if (convertCode !== 0) {
  console.error("❌ Failed to convert PBF to GeoJSON");
  Deno.exit(1);
}

console.log("✅ Conversion complete\n");

// Read and analyze
const geoJsonContent = await Deno.readTextFile(tempGeoJson);
const geoJson = JSON.parse(geoJsonContent);
const features = geoJson.features || [];

console.log(`📊 Analyzing ${features.length} features...\n`);

let hasExpectedTag = 0;
let hasOnlyUnexpectedTags = 0;
const unexpectedOnlyExamples: Array<{properties: any}> = [];

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
    hasExpectedTag++;
  } else {
    hasOnlyUnexpectedTags++;
    
    // Check what unexpected tags it has
    const unexpectedTags: string[] = [];
    if (props.highway) unexpectedTags.push(`highway=${props.highway}`);
    if (props.amenity) unexpectedTags.push(`amenity=${props.amenity}`);
    if (props.shop) unexpectedTags.push(`shop=${props.shop}`);
    if (props.office) unexpectedTags.push(`office=${props.office}`);
    
    if (unexpectedOnlyExamples.length < 10) {
      unexpectedOnlyExamples.push({
        properties: {
          ...props,
          unexpectedTags: unexpectedTags.join(", ")
        }
      });
    }
  }
}

console.log("📊 RESULTS:\n");
console.log(`   ✅ Features with expected tags: ${hasExpectedTag} (${((hasExpectedTag/features.length)*100).toFixed(1)}%)`);
console.log(`   ❌ Features with ONLY unexpected tags: ${hasOnlyUnexpectedTags} (${((hasOnlyUnexpectedTags/features.length)*100).toFixed(1)}%)\n`);

if (hasOnlyUnexpectedTags > 0) {
  console.log("⚠️  PROBLEM: Found features with ONLY unexpected tags!\n");
  console.log("📋 Examples (first 10):\n");
  
  for (const example of unexpectedOnlyExamples) {
    console.log(`   Unexpected tags: ${example.properties.unexpectedTags}`);
    console.log(`   All tags: ${Object.keys(example.properties).filter(k => !k.startsWith('@') && k !== 'unexpectedTags').slice(0, 10).join(", ")}`);
    console.log("");
  }
  
  console.log(`\n❌ Total: ${hasOnlyUnexpectedTags} features should be removed!`);
  
  // Cleanup
  try {
    await Deno.remove(tempGeoJson);
  } catch {}
  
  Deno.exit(1);
} else {
  console.log("✅ All features have at least one expected tag!");
  console.log("   The objects with unexpected tags (highway, amenity, etc.)");
  console.log("   also have expected tags (tourism, historic, etc.), so they are valid.\n");
}

// Cleanup
try {
  await Deno.remove(tempGeoJson);
} catch {}


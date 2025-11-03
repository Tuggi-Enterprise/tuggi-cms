#!/usr/bin/env -S deno run --allow-read --allow-run

/**
 * Check for objects in PBF that don't have expected tags
 */

const filePath = Deno.args[0] || "output/filtered-tourism-final-1762208716497.osm.pbf";

console.log(`🔍 Checking for unexpected objects in: ${filePath}\n`);

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
const tempGeoJson = "output/temp-analysis.geojson";

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

// Read and analyze GeoJSON
const geoJsonContent = await Deno.readTextFile(tempGeoJson);
const geoJson = JSON.parse(geoJsonContent);

const features = geoJson.features || [];
console.log(`📊 Analyzing ${features.length} features...\n`);

let hasExpectedTag = 0;
let hasOnlyUnexpectedTags = 0;
const unexpectedExamples: Array<{properties: any, reason: string}> = [];

for (const feature of features) {
  const props = feature.properties || {};
  
  // Check if has any expected tag
  let hasExpected = false;
  for (const expectedTag of expectedTags) {
    const [key, value] = expectedTag.split("=");
    if (props[key] === value || (key === "tourism" && value === "yes" && props[key] === "yes")) {
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
    if (props.highway && !props.tourism && !props.historic && !props.natural && !props.leisure) {
      unexpectedTags.push(`highway=${props.highway}`);
    }
    if (props.amenity && !props.tourism && !props.historic && !props.natural && !props.leisure) {
      unexpectedTags.push(`amenity=${props.amenity}`);
    }
    if (props.shop && !props.tourism && !props.historic) {
      unexpectedTags.push(`shop=${props.shop}`);
    }
    if (props.office && !props.tourism && !props.historic) {
      unexpectedTags.push(`office=${props.office}`);
    }
    
    if (unexpectedTags.length > 0 && unexpectedExamples.length < 10) {
      unexpectedExamples.push({
        properties: props,
        reason: unexpectedTags.join(", ")
      });
    }
  }
}

console.log("📊 RESULTS:\n");
console.log(`   ✅ Features with expected tags: ${hasExpectedTag} (${((hasExpectedTag/features.length)*100).toFixed(1)}%)`);
console.log(`   ❌ Features with ONLY unexpected tags: ${hasOnlyUnexpectedTags} (${((hasOnlyUnexpectedTags/features.length)*100).toFixed(1)}%)`);

if (unexpectedExamples.length > 0) {
  console.log("\n⚠️  EXAMPLES OF UNEXPECTED FEATURES:\n");
  for (const example of unexpectedExamples) {
    console.log(`   Reason: ${example.reason}`);
    console.log(`   Properties: ${JSON.stringify(example.properties).substring(0, 200)}...`);
    console.log("");
  }
}

// Cleanup
try {
  await Deno.remove(tempGeoJson);
} catch {
  // Ignore cleanup errors
}

if (hasOnlyUnexpectedTags > 0) {
  console.log(`\n⚠️  WARNING: ${hasOnlyUnexpectedTags} features have only unexpected tags!`);
  console.log("   These should be removed from the filtered file.");
  Deno.exit(1);
} else {
  console.log("\n✅ All features have at least one expected tag!");
}


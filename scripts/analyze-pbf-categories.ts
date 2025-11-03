#!/usr/bin/env -S deno run --allow-read --allow-run

/**
 * Analyze categories in a PBF file
 */

const filePath = Deno.args[0] || "output/filtered-tourism-final-1762208716497.osm.pbf";

console.log(`📊 Analyzing categories in: ${filePath}\n`);

// Run osmium tags-count
const command = new Deno.Command("osmium", {
  args: ["tags-count", filePath],
  stdout: "piped",
  stderr: "piped"
});

const { code, stdout, stderr } = await command.output();

if (code !== 0) {
  const error = new TextDecoder().decode(stderr);
  console.error(`❌ Error: ${error}`);
  Deno.exit(1);
}

const output = new TextDecoder().decode(stdout);
const lines = output.split('\n').filter(l => l.trim());

// Categories we expect
const expectedCategories = [
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

// Categories we should NOT have
const unexpectedMainCategories = ["highway", "amenity", "shop", "office", "craft", "landuse"];

// Parse tags
const tagCounts: Map<string, number> = new Map();

for (const line of lines) {
  const match = line.match(/^\s*(\d+)\s+"([^"]+)"/);
  if (match) {
    const count = parseInt(match[1]);
    const tag = match[2];
    tagCounts.set(tag, count);
  }
}

// Analyze main category tags
const mainCategories = ["tourism", "historic", "natural", "leisure", "railway", "aeroway", "highway", "amenity", "shop", "building", "waterway"];

console.log("📋 MAIN CATEGORY TAGS (tags that define POI types):\n");

const foundMainCategories: string[] = [];
const foundSpecificCategories: string[] = [];

for (const category of mainCategories) {
  const count = tagCounts.get(category);
  if (count) {
    foundMainCategories.push(category);
    console.log(`   ${category}: ${count} occurrences`);
  }
}

console.log("\n📋 SPECIFIC CATEGORY VALUES:\n");

// Check tourism values
const tourismValues: string[] = [];
for (const [tag, count] of tagCounts.entries()) {
  if (tag === "tourism" || tag.startsWith("tourism=")) {
    tourismValues.push(tag);
    if (tag.startsWith("tourism=")) {
      foundSpecificCategories.push(tag);
    }
    console.log(`   ${tag}: ${count} occurrences`);
  }
}

// Check historic values
const historicValues: string[] = [];
for (const [tag, count] of tagCounts.entries()) {
  if (tag.startsWith("historic=")) {
    historicValues.push(tag);
    foundSpecificCategories.push(tag);
    console.log(`   ${tag}: ${count} occurrences`);
  }
}

// Check natural values
const naturalValues: string[] = [];
for (const [tag, count] of tagCounts.entries()) {
  if (tag.startsWith("natural=")) {
    naturalValues.push(tag);
    foundSpecificCategories.push(tag);
    console.log(`   ${tag}: ${count} occurrences`);
  }
}

// Check leisure values
const leisureValues: string[] = [];
for (const [tag, count] of tagCounts.entries()) {
  if (tag.startsWith("leisure=")) {
    leisureValues.push(tag);
    foundSpecificCategories.push(tag);
    console.log(`   ${tag}: ${count} occurrences`);
  }
}

// Check railway values
const railwayValues: string[] = [];
for (const [tag, count] of tagCounts.entries()) {
  if (tag.startsWith("railway=")) {
    railwayValues.push(tag);
    foundSpecificCategories.push(tag);
    console.log(`   ${tag}: ${count} occurrences`);
  }
}

// Check aeroway values
const aerowayValues: string[] = [];
for (const [tag, count] of tagCounts.entries()) {
  if (tag.startsWith("aeroway=")) {
    aerowayValues.push(tag);
    foundSpecificCategories.push(tag);
    console.log(`   ${tag}: ${count} occurrences`);
  }
}

console.log("\n⚠️  UNEXPECTED CATEGORIES (should not be in filtered file):\n");

const unexpectedFound: string[] = [];
for (const category of unexpectedMainCategories) {
  const count = tagCounts.get(category);
  if (count) {
    unexpectedFound.push(category);
    console.log(`   ❌ ${category}: ${count} occurrences (UNEXPECTED!)`);
  }
}

// Show all values for unexpected categories
console.log("\n🔍 VALUES IN UNEXPECTED CATEGORIES:\n");

if (unexpectedFound.includes("highway")) {
  console.log("   Highway values:");
  for (const [tag, count] of tagCounts.entries()) {
    if (tag.startsWith("highway=")) {
      console.log(`      ${tag}: ${count} occurrences`);
    }
  }
}

if (unexpectedFound.includes("amenity")) {
  console.log("   Amenity values:");
  for (const [tag, count] of tagCounts.entries()) {
    if (tag.startsWith("amenity=")) {
      console.log(`      ${tag}: ${count} occurrences`);
    }
  }
}

if (unexpectedFound.includes("shop")) {
  console.log("   Shop values:");
  for (const [tag, count] of tagCounts.entries()) {
    if (tag.startsWith("shop=")) {
      console.log(`      ${tag}: ${count} occurrences`);
    }
  }
}

// Check for unexpected values in expected categories
console.log("\n🔍 UNEXPECTED VALUES IN EXPECTED CATEGORIES:\n");

const unexpectedTourism = tourismValues.filter(v => !expectedCategories.includes(v));
const unexpectedHistoric = historicValues.filter(v => !expectedCategories.includes(v));
const unexpectedNatural = naturalValues.filter(v => !expectedCategories.includes(v));
const unexpectedLeisure = leisureValues.filter(v => !expectedCategories.includes(v));
const unexpectedRailway = railwayValues.filter(v => !expectedCategories.includes(v));
const unexpectedAeroway = aerowayValues.filter(v => !expectedCategories.includes(v));

if (unexpectedTourism.length > 0) {
  console.log("   ❌ Unexpected tourism values:");
  for (const val of unexpectedTourism) {
    console.log(`      ${val}: ${tagCounts.get(val)} occurrences`);
  }
}

if (unexpectedHistoric.length > 0) {
  console.log("   ❌ Unexpected historic values:");
  for (const val of unexpectedHistoric) {
    console.log(`      ${val}: ${tagCounts.get(val)} occurrences`);
  }
}

if (unexpectedNatural.length > 0) {
  console.log("   ❌ Unexpected natural values:");
  for (const val of unexpectedNatural) {
    console.log(`      ${val}: ${tagCounts.get(val)} occurrences`);
  }
}

if (unexpectedLeisure.length > 0) {
  console.log("   ❌ Unexpected leisure values:");
  for (const val of unexpectedLeisure) {
    console.log(`      ${val}: ${tagCounts.get(val)} occurrences`);
  }
}

if (unexpectedRailway.length > 0) {
  console.log("   ❌ Unexpected railway values:");
  for (const val of unexpectedRailway) {
    console.log(`      ${val}: ${tagCounts.get(val)} occurrences`);
  }
}

if (unexpectedAeroway.length > 0) {
  console.log("   ❌ Unexpected aeroway values:");
  for (const val of unexpectedAeroway) {
    console.log(`      ${val}: ${tagCounts.get(val)} occurrences`);
  }
}

if (unexpectedFound.length === 0 && 
    unexpectedTourism.length === 0 && 
    unexpectedHistoric.length === 0 && 
    unexpectedNatural.length === 0 && 
    unexpectedLeisure.length === 0 && 
    unexpectedRailway.length === 0 && 
    unexpectedAeroway.length === 0) {
  console.log("   ✅ No unexpected categories found!");
}

console.log("\n📊 SUMMARY:\n");
console.log(`   Total main category tags found: ${foundMainCategories.length}`);
console.log(`   Total specific category values found: ${foundSpecificCategories.length}`);
console.log(`   Unexpected main categories: ${unexpectedFound.length}`);
console.log(`   Unexpected specific values: ${unexpectedTourism.length + unexpectedHistoric.length + unexpectedNatural.length + unexpectedLeisure.length + unexpectedRailway.length + unexpectedAeroway.length}`);


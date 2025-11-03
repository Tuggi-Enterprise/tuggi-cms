#!/usr/bin/env -S deno run --allow-read --allow-write

/**
 * Filter PBF file for tourism and historic POIs
 * 
 * Creates two filtered PBF files:
 * 1. POIs matching specific category tags
 * 2. POIs with historic=yes or tourism=yes (excluding categories from file 1)
 * 
 * Then merges both into a final filtered PBF file
 */

import { PBFProcessor } from "../plugins/osm-geojson-filter/lib/pbf-processor.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";

// Define specific category tags to filter
const SPECIFIC_CATEGORY_TAGS = [
  "tourism=attraction",
  "tourism=museum",
  "tourism=artwork",
  "tourism=viewpoint",
  "tourism=theme_park",
  "tourism=zoo",
  "tourism=aquarium",
  "historic=monument",
  "historic=castle",
  "historic=church",
  "historic=memorial",
  "historic=ruins",
  "historic=archaeological_site",
  "historic=fort",
  "historic=tomb",
  "historic=wayside_shrine",
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
  "leisure=park",
  "leisure=stadium",
  "railway=station",
  "aeroway=aerodrome"
];

async function main() {
  const inputFile = "omsData/sudeste-251012.osm.pbf";
  const outputDir = "output";
  const timestamp = Date.now();
  
  // Combine all expected tags (30 specific + historic=yes + tourism=yes)
  const allExpectedTags = [...SPECIFIC_CATEGORY_TAGS, "historic=yes", "tourism=yes"];
  
  console.log("🗺️  PBF Tourism Filter (Precision Mode)");
  console.log("=".repeat(60));
  console.log(`📁 Input file: ${inputFile}`);
  console.log(`📁 Output directory: ${outputDir}`);
  console.log(`🎯 Expected tags: ${allExpectedTags.length} (${SPECIFIC_CATEGORY_TAGS.length} specific + historic=yes + tourism=yes)`);
  console.log(`⚠️  Using --omit-referenced to exclude related objects`);
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
  
  // Step 1: Initial filter with --omit-referenced
  console.log("📋 Step 1: Initial filtering (with --omit-referenced)...");
  console.log(`   Filtering by ${allExpectedTags.length} expected tags`);
  console.log(`   This will exclude related objects (highway, etc.)`);
  console.log("");
  
  let step1Path: string;
  try {
    step1Path = await processor.extractTags(inputFile, allExpectedTags, true); // true = omitReferenced
    console.log(`✅ Step 1 complete: ${step1Path}`);
    console.log("");
  } catch (error) {
    console.error(`❌ Error in step 1: ${error.message}`);
    Deno.exit(1);
  }
  
  // Step 2: Re-filter to ensure only objects with expected tags remain
  console.log("📋 Step 2: Re-filtering to ensure precision...");
  console.log("   Re-applying the same filter to remove any objects");
  console.log("   that don't have at least one expected tag");
  console.log("");
  
  const step2Path = join(outputDir, `filtered-tourism-step2-${timestamp}.osm.pbf`);
  
  try {
    const reFilteredPath = await processor.extractTags(step1Path, allExpectedTags, true);
    // Rename to step2Path
    await Deno.rename(reFilteredPath, step2Path);
    console.log(`✅ Step 2 complete: ${step2Path}`);
    console.log("");
  } catch (error) {
    console.error(`❌ Error in step 2: ${error.message}`);
    Deno.exit(1);
  }
  
  // Step 3: Validation with tags-count
  console.log("📋 Step 3: Validating result...");
  console.log("   Checking which tags are present in the filtered file");
  console.log("");
  
  try {
    await processor.showAvailableTags(step2Path);
    console.log("");
  } catch (error) {
    console.error(`⚠️  Could not show tags: ${error.message}`);
    console.log("");
  }
  
  // Step 4: Final file info
  console.log("📊 Final file information:");
  await processor.getFileInfo(step2Path);
  console.log("");
  
  console.log("✅ Filtering complete!");
  console.log("");
  console.log("📊 Summary:");
  console.log(`   Step 1 (initial filter): ${step1Path}`);
  console.log(`   Step 2 (re-filtered): ${step2Path}`);
  console.log(`   Final file: ${step2Path}`);
  console.log("");
  console.log("💡 Next steps:");
  console.log("   - Review the tags-count output above");
  console.log("   - Verify that only expected categories are present");
  console.log("   - If unexpected tags appear, they should be secondary tags");
  console.log("     (e.g., highway on a tourism=attraction object is OK)");
}

// Run the script
if (import.meta.main) {
  await main();
}


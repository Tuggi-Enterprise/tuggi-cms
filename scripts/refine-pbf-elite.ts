#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run

/**
 * REFINED PBF UNIFIED FILTER (ELITE)
 * 
 * Implements the centralized filtering logic used in the CMS and Edge Functions.
 * 
 * Workflow:
 * 1. Stage 1: Fast PBF extraction using osmium tags-filter (Categories)
 * 2. Stage 2: Convert to GeoJSON Sequence (Line-by-line)
 * 3. Stage 3: Unified "Elite" Filtering (shouldFilterPOI)
 * 4. Stage 4: Final GeoJSON output
 */

import { PBFProcessor } from "../plugins/osm-geojson-filter/lib/pbf-processor.ts";
import { join, basename } from "https://deno.land/std@0.208.0/path/mod.ts";
import { readLines } from "https://deno.land/std@0.208.0/io/mod.ts";

import { shouldFilterPOI, CATEGORIES } from "../lib/shared/poi-filter.ts";

async function main() {
  const args = Deno.args;
  const inputPath = args[0] || "data/geofabrik/thailand-260302.osm.pbf";
  const outputDir = "output";
  const timestamp = Date.now();
  const fileName = basename(inputPath, '.osm.pbf');
  const finalOutputPath = join(outputDir, `${fileName}-elite-${timestamp}.geojson`);

  console.log("🌏 REFINED PBF UNIFIED FILTER (ELITE)");
  console.log("=".repeat(60));
  console.log(`📁 Input: ${inputPath}`);
  console.log(`📁 Output: ${finalOutputPath}`);
  console.log("");

  const processor = new PBFProcessor(outputDir);

  // 1. Stage 1: Categorical Filter
  console.log("🚀 Stage 1: Fast Categorical Filter (osmium)...");
  const filteredPbf = await processor.extractTags(inputPath, CATEGORIES, false);
  console.log(`✅ Stage 1 complete: ${filteredPbf}`);

  // 2. Stage 2: Convert to GeoJSON Seq
  console.log("\n🚀 Stage 2: Converting to GeoJSON Sequence...");
  const geojsonSeqPath = join(outputDir, `temp-${timestamp}.geojsonseq`);
  
  const convertCommand = new Deno.Command("osmium", {
    args: ["export", filteredPbf, "-f", "geojsonseq", "-o", geojsonSeqPath, "--overwrite", "--attributes", "type,id,version,timestamp"],
  });
  const { code: convertCode, stderr } = await convertCommand.output();
  if (convertCode !== 0) {
    console.error("❌ Osmium export failed:", new TextDecoder().decode(stderr));
    Deno.exit(1);
  }
  console.log(`✅ Stage 2 complete: ${geojsonSeqPath}`);

  // 3. Stage 3: Unified Elite Filtering
  console.log("\n🚀 Stage 3: Unified Elite Filtering (line-by-line)...");
  const file = await Deno.open(geojsonSeqPath);
  const outFile = await Deno.open(finalOutputPath, { write: true, create: true, truncate: true });
  
  await outFile.write(new TextEncoder().encode('{"type":"FeatureCollection","features":[\n'));

  let processed = 0;
  let kept = 0;
  let first = true;

  for await (const line of readLines(file)) {
    if (!line.trim()) continue;
    
    try {
      let cleanLine = line.trim();
      if (cleanLine.startsWith('\x1e')) cleanLine = cleanLine.substring(1);
      if (!cleanLine) continue;

      const feature = JSON.parse(cleanLine);
      const filterResult = shouldFilterPOI(feature);

      if (!filterResult.remove) {
        if (!first) await outFile.write(new TextEncoder().encode(',\n'));
        await outFile.write(new TextEncoder().encode(JSON.stringify(feature)));
        kept++;
        first = false;
      }
      
      processed++;
      if (processed % 10000 === 0) {
        console.log(`   Processed: ${processed.toLocaleString()} | Kept: ${kept.toLocaleString()}`);
      }
    } catch (e) {
      // Skip errors
    }
  }

  await outFile.write(new TextEncoder().encode('\n]}'));
  
  file.close();
  outFile.close();

  console.log(`\n✅ Stage 3 complete!`);
  console.log(`📊 Results:`);
  console.log(`   Total Processed: ${processed.toLocaleString()}`);
  console.log(`   Total Kept: ${kept.toLocaleString()}`);
  console.log(`   Filter Rate: ${((1 - kept/processed) * 100).toFixed(1)}%`);

  // Cleanup
  await Deno.remove(filteredPbf);
  await Deno.remove(geojsonSeqPath);

  console.log(`\n🏁 SUCCESS! Final file: ${finalOutputPath}`);
}

if (import.meta.main) {
  await main();
}

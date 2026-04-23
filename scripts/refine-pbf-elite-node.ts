import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { shouldFilterPOI, CATEGORIES } from '../lib/shared/poi-filter';

async function main() {
  const args = process.argv.slice(2);
  const inputPath = args[0];
  const country = args[1] || 'Spain';
  
  if (!inputPath) {
    console.error('❌ Please provide the PBF file path');
    process.exit(1);
  }

  const outputDir = 'output';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = Date.now();
  const fileName = path.basename(inputPath, '.osm.pbf');
  const finalOutputPath = path.join(outputDir, `${fileName}-elite-${timestamp}.geojson`);

  console.log('🌏 REFINED PBF UNIFIED FILTER (ELITE) - NODE VERSION');
  console.log('='.repeat(60));
  console.log(`📁 Input: ${inputPath}`);
  console.log(`📁 Output: ${finalOutputPath}`);
  console.log(`🌍 Country: ${country}`);
  console.log('');

  // 1. Stage 1: Categorical Filter
  console.log('🚀 Stage 1: Fast Categorical Filter (osmium)...');
  const filteredPbf = path.join(outputDir, `filtered-${timestamp}.osm.pbf`);
  const expressionsPath = path.join(outputDir, `expressions-${timestamp}.txt`);
  
  const expressions = CATEGORIES.map(tag => `nwr/${tag}`).join('\n');
  fs.writeFileSync(expressionsPath, expressions);

  const stage1 = spawnSync('osmium', ['tags-filter', inputPath, '--expressions', expressionsPath, '-o', filteredPbf, '--overwrite']);
  
  if (stage1.status !== 0) {
    console.error('❌ Stage 1 failed:', stage1.stderr.toString());
    process.exit(1);
  }
  
  const stage1Stats = fs.statSync(filteredPbf);
  console.log(`✅ Stage 1 complete: ${filteredPbf} (${stage1Stats.size} bytes)`);

  if (stage1Stats.size < 500) {
    console.warn('⚠️  Filtered PBF is suspiciously small. It might be empty.');
  }
  
  fs.unlinkSync(expressionsPath);

  // 2. Stage 2: Convert to GeoJSON Seq
  console.log('\n🚀 Stage 2: Converting to GeoJSON Sequence...');
  const geojsonSeqPath = path.join(outputDir, `temp-${timestamp}.geojsonseq`);
  
  const stage2 = spawnSync('osmium', [
    'export', filteredPbf, 
    '-f', 'geojsonseq', 
    '-o', geojsonSeqPath, 
    '--overwrite', 
    '--attributes', 'type,id,version,timestamp'
  ]);
  
  if (stage2.status !== 0) {
    console.error('❌ Stage 2 failed:', stage2.stderr.toString());
    process.exit(1);
  }
  
  const stage2Stats = fs.statSync(geojsonSeqPath);
  console.log(`✅ Stage 2 complete: ${geojsonSeqPath} (${stage2Stats.size} bytes)`);

  // 3. Stage 3: Unified Elite Filtering
  console.log('\n🚀 Stage 3: Unified Elite Filtering (line-by-line)...');
  
  const fileStream = fs.createReadStream(geojsonSeqPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const outFile = fs.createWriteStream(finalOutputPath);
  outFile.write('{"type":"FeatureCollection","features":[\n');

  let processed = 0;
  let kept = 0;
  let first = true;

  for await (const line of rl) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    
    processed++;
    try {
      let cleanLine = trimmedLine;
      // Handle RS (Record Separator) character if present in geojsonseq
      if (cleanLine.startsWith('\x1e')) cleanLine = cleanLine.substring(1);
      cleanLine = cleanLine.trim();
      if (!cleanLine) continue;

      const feature = JSON.parse(cleanLine);
      const filterResult = shouldFilterPOI(feature);

      if (!filterResult.remove) {
        if (!first) outFile.write(',\n');
        outFile.write(JSON.stringify(feature));
        kept++;
        first = false;
      }
      
      if (processed % 1000 === 0) {
        process.stdout.write(`\r   Processed: ${processed.toLocaleString()} | Kept: ${kept.toLocaleString()}`);
      }
    } catch (e: any) {
      console.error(`\n❌ Error parsing line ${processed}:`, e.message);
    }
  }

  outFile.write('\n]}');
  outFile.end();

  // Wait for outFile to finish writing
  await new Promise((resolve) => outFile.on('finish', resolve));

  console.log(`\n\n✅ Stage 3 complete!`);
  console.log(`📊 Results:`);
  console.log(`   Total Processed: ${processed.toLocaleString()}`);
  console.log(`   Total Kept: ${kept.toLocaleString()}`);
  console.log(`   Filter Rate: ${((1 - kept/processed) * 100).toFixed(1)}%`);

  // Cleanup
  fs.unlinkSync(filteredPbf);
  fs.unlinkSync(geojsonSeqPath);

  console.log(`\n🏁 SUCCESS! Final file: ${finalOutputPath}`);
  
  // Return the path for the next step
  return finalOutputPath;
}

if (require.main === module || process.argv[1].includes('refine-pbf-elite-node')) {
  main().catch(console.error);
}

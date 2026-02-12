import fs from 'fs';
import readline from 'readline';

async function analyzeFilteredFile(inputPath: string) {
  console.log(`--- Analyzing Filtered GeoJSON: ${inputPath} ---`);

  const fileStream = fs.createReadStream(inputPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const categories: Record<string, number> = {};
  const sample: any[] = [];
  let count = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const poi = JSON.parse(line);
      const props = poi.properties || {};
      
      // Determine primary category for stats
      const type = props.tourism || props.amenity || props.historic || props.leisure || props.man_made || props.type || 'undefined';
      categories[type] = (categories[type] || 0) + 1;

      if (count < 50) {
        sample.push({
          name: props.name,
          category: type,
          wiki: !!(props.wikipedia || props.wikidata),
          historic: !!props.historic
        });
      }
      
      count++;
      if (count % 100000 === 0) console.log(`Scanned ${count} records...`);
    } catch (e) {
      // skip
    }
  }

  console.log('\n--- Category Distribution (FULL LIST) ---');
  Object.entries(categories)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, n]) => {
      console.log(`${cat.padEnd(25)} | ${n}`);
    });

  console.log('\n--- Sample Records (First 50) ---');
  sample.forEach((s, i) => {
    console.log(`${i+1}. ${s.name || 'UNNAMED'} [${s.category}] | Wiki: ${s.wiki ? 'Y' : 'N'} | Hist: ${s.historic ? 'Y' : 'N'}`);
  });

  console.log(`\nTotal records analyzed: ${count}`);
}

const args = process.argv.slice(2);
analyzeFilteredFile(args[0] || 'data/temp_elite/sul_elite_filtered.geojsonseq');

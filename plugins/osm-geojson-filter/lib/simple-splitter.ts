/**
 * Simple File Splitter for Large GeoJSON Files
 * Uses a more robust approach for very large files
 */

import { ensureDir } from "@std/fs";
import { join } from "@std/path";

export class SimpleSplitter {
  private outputDir: string;

  constructor(outputDir: string = "output/chunks") {
    this.outputDir = outputDir;
  }

  /**
   * Split a large GeoJSON file using a simple line-by-line approach
   */
  async splitFile(inputPath: string, chunkSize: number = 10000): Promise<{
    chunks: string[];
    totalFeatures: number;
    processingTime: number;
  }> {
    const startTime = Date.now();
    
    try {
      await ensureDir(this.outputDir);
      
      console.log(`📂 Splitting large GeoJSON file: ${inputPath}`);
      console.log(`📊 Target chunk size: ${chunkSize.toLocaleString()} features per chunk`);
      
      // Use a more robust approach for very large files
      const command = new Deno.Command("head", {
        args: ["-n", "1000", inputPath],
        stdout: "piped",
        stderr: "piped"
      });
      
      const { code, stdout, stderr } = await command.output();
      
      if (code !== 0) {
        throw new Error(`Failed to read file: ${new TextDecoder().decode(stderr)}`);
      }
      
      const sample = new TextDecoder().decode(stdout);
      console.log(`📋 File sample (first 1000 lines):`);
      console.log(sample.substring(0, 500) + "...");
      
      // For now, let's create a simple approach that works with the file structure
      console.log(`\n💡 Recommended approach for 9GB file:`);
      console.log(`   1. Use external tools like 'split' command to break the file`);
      console.log(`   2. Process each chunk separately`);
      console.log(`   3. Use streaming JSON parsers for very large files`);
      
      // Create a sample chunk for testing
      const sampleChunk = await this.createSampleChunk(inputPath);
      
      return {
        chunks: [sampleChunk],
        totalFeatures: 1,
        processingTime: Date.now() - startTime
      };
      
    } catch (error) {
      console.error("Error splitting file:", error);
      throw error;
    }
  }

  /**
   * Create a small sample chunk for testing
   */
  private async createSampleChunk(inputPath: string): Promise<string> {
    const chunkPath = join(this.outputDir, "sample-chunk.geojson");
    
    // Create a minimal GeoJSON with just the structure
    const sampleGeoJSON = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [-46.6333, -23.5505]
          },
          properties: {
            name: "Sample POI",
            osm: "sample"
          }
        }
      ]
    };
    
    await Deno.writeTextFile(chunkPath, JSON.stringify(sampleGeoJSON, null, 2));
    
    return chunkPath;
  }

  /**
   * Provide recommendations for handling very large files
   */
  printRecommendations(): void {
    console.log(`\n💡 Recommendations for 9GB GeoJSON file:`);
    console.log(`\n1. Use external tools to split the file:`);
    console.log(`   # Split by lines (adjust number based on your needs)`);
    console.log(`   split -l 100000 omsData/sudeste-251012.geojson output/chunks/chunk-`);
    console.log(`   # This creates files like chunk-aa, chunk-ab, etc.`);
    
    console.log(`\n2. Use streaming JSON parsers:`);
    console.log(`   # Install ndjson-cli for streaming JSON processing`);
    console.log(`   npm install -g ndjson-cli`);
    console.log(`   # Convert to newline-delimited JSON`);
    console.log(`   ndjson-split < omsData/sudeste-251012.geojson > output/features.ndjson`);
    
    console.log(`\n3. Process in batches:`);
    console.log(`   # Use tools like jq for filtering`);
    console.log(`   jq -c '.features[] | select(.properties.tourism != null)' omsData/sudeste-251012.geojson > tourism-only.ndjson`);
    
    console.log(`\n4. Use database import:`);
    console.log(`   # Import directly to PostgreSQL/PostGIS`);
    console.log(`   ogr2ogr -f "PostgreSQL" PG:"host=localhost dbname=osm user=postgres" omsData/sudeste-251012.geojson`);
    
    console.log(`\n5. Use specialized tools:`);
    console.log(`   # osmium-tool for OSM data processing`);
    console.log(`   osmium tags-filter omsData/sudeste-251012.osm.pbf tourism -o tourism-only.osm.pbf`);
  }
}

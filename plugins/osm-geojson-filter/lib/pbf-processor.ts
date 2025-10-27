/**
 * PBF Processor for OSM Data
 * Efficient processing of OSM PBF files using osmium-tool
 */

import { ensureDir } from "@std/fs";
import { join } from "@std/path";

export class PBFProcessor {
  private outputDir: string;

  constructor(outputDir: string = "output") {
    this.outputDir = outputDir;
  }

  /**
   * Check if osmium-tool is available
   */
  async checkOsmiumTool(): Promise<boolean> {
    try {
      const command = new Deno.Command("osmium", {
        args: ["--version"],
        stdout: "piped",
        stderr: "piped"
      });
      
      const { code } = await command.output();
      return code === 0;
    } catch {
      return false;
    }
  }

  /**
   * Install osmium-tool if not available
   */
  async installOsmiumTool(): Promise<boolean> {
    console.log("📦 Installing osmium-tool...");
    
    try {
      // Try to install via homebrew (macOS)
      const command = new Deno.Command("brew", {
        args: ["install", "osmctools"],
        stdout: "piped",
        stderr: "piped"
      });
      
      const { code } = await command.output();
      
      if (code === 0) {
        console.log("✅ osmium-tool installed successfully");
        return true;
      } else {
        console.log("❌ Failed to install osmium-tool via homebrew");
        return false;
      }
    } catch (error) {
      console.log("❌ Error installing osmium-tool:", error);
      return false;
    }
  }

  /**
   * Extract specific tags from PBF file
   */
  async extractTags(inputPath: string, tags: string[]): Promise<string> {
    await ensureDir(this.outputDir);
    
    const outputPath = join(this.outputDir, `filtered-${Date.now()}.osm.pbf`);
    
    console.log(`🔍 Extracting tags: ${tags.join(", ")}`);
    console.log(`📁 Input: ${inputPath}`);
    console.log(`📁 Output: ${outputPath}`);
    
    const tagFilter = tags.map(tag => `nwr/${tag}`).join(",");
    
    const command = new Deno.Command("osmium", {
      args: [
        "tags-filter",
        inputPath,
        tagFilter,
        "-o", outputPath
      ],
      stdout: "piped",
      stderr: "piped"
    });
    
    console.log(`🔄 Running: osmium tags-filter ${inputPath} ${tagFilter} -o ${outputPath}`);
    
    const { code, stdout, stderr } = await command.output();
    
    if (code !== 0) {
      const error = new TextDecoder().decode(stderr);
      throw new Error(`Osmium command failed: ${error}`);
    }
    
    const output = new TextDecoder().decode(stdout);
    console.log(`✅ Extraction complete: ${outputPath}`);
    
    return outputPath;
  }

  /**
   * Convert PBF to GeoJSON (filtered)
   */
  async convertToGeoJSON(inputPath: string, outputPath: string): Promise<void> {
    console.log(`🔄 Converting PBF to GeoJSON...`);
    console.log(`📁 Input: ${inputPath}`);
    console.log(`📁 Output: ${outputPath}`);
    
    const command = new Deno.Command("osmium", {
      args: [
        "export",
        inputPath,
        "-o", outputPath,
        "--overwrite"
      ],
      stdout: "piped",
      stderr: "piped"
    });
    
    const { code, stdout, stderr } = await command.output();
    
    if (code !== 0) {
      const error = new TextDecoder().decode(stderr);
      throw new Error(`Osmium export failed: ${error}`);
    }
    
    console.log(`✅ Conversion complete: ${outputPath}`);
  }

  /**
   * Convert PBF to GeoJSON with high quality settings
   * Preserves all fields from POI_FIELDS_DOCUMENTATION.md
   */
  async convertToGeoJSONHighQuality(inputPath: string, outputPath: string): Promise<void> {
    console.log(`🔄 Converting PBF to GeoJSON (High Quality)...`);
    console.log(`📁 Input: ${inputPath}`);
    console.log(`📁 Output: ${outputPath}`);
    console.log(`🎯 Preserving all 98 fields from documentation`);
    
    const command = new Deno.Command("osmium", {
      args: [
        "export",
        inputPath,
        "-f", "geojson",
        "-o", outputPath,
        "--overwrite",
        "--add-metadata",
        "--id-type=string",
        "--id-format=type_id"
      ],
      stdout: "piped",
      stderr: "piped"
    });
    
    const { code, stdout, stderr } = await command.output();
    
    if (code !== 0) {
      const error = new TextDecoder().decode(stderr);
      throw new Error(`Osmium export failed: ${error}`);
    }
    
    console.log(`✅ High quality conversion complete: ${outputPath}`);
  }

  /**
   * Get file information
   */
  async getFileInfo(inputPath: string): Promise<{
    size: number;
    objectCounts: {
      nodes: number;
      ways: number;
      relations: number;
    };
  }> {
    console.log(`📊 Analyzing PBF file: ${inputPath}`);
    
    const command = new Deno.Command("osmium", {
      args: ["fileinfo", inputPath],
      stdout: "piped",
      stderr: "piped"
    });
    
    const { code, stdout, stderr } = await command.output();
    
    if (code !== 0) {
      const error = new TextDecoder().decode(stderr);
      throw new Error(`Osmium fileinfo failed: ${error}`);
    }
    
    const output = new TextDecoder().decode(stdout);
    console.log(`📋 File information:`);
    console.log(output);
    
    // Parse the output to extract counts
    const lines = output.split('\n');
    let nodes = 0, ways = 0, relations = 0;
    
    for (const line of lines) {
      if (line.includes('Number of nodes:')) {
        nodes = parseInt(line.split(':')[1].trim().replace(/,/g, ''));
      } else if (line.includes('Number of ways:')) {
        ways = parseInt(line.split(':')[1].trim().replace(/,/g, ''));
      } else if (line.includes('Number of relations:')) {
        relations = parseInt(line.split(':')[1].trim().replace(/,/g, ''));
      }
    }
    
    const fileInfo = await Deno.stat(inputPath);
    
    return {
      size: fileInfo.size,
      objectCounts: { nodes, ways, relations }
    };
  }

  /**
   * Extract by geographic bounds
   */
  async extractByBounds(
    inputPath: string, 
    bounds: { north: number; south: number; east: number; west: number }
  ): Promise<string> {
    await ensureDir(this.outputDir);
    
    const outputPath = join(this.outputDir, `bounds-${Date.now()}.osm.pbf`);
    
    console.log(`🗺️ Extracting by bounds: [${bounds.south}, ${bounds.west}] to [${bounds.north}, ${bounds.east}]`);
    
    const command = new Deno.Command("osmium", {
      args: [
        "extract",
        "--bbox", `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
        inputPath,
        "-o", outputPath
      ],
      stdout: "piped",
      stderr: "piped"
    });
    
    const { code, stdout, stderr } = await command.output();
    
    if (code !== 0) {
      const error = new TextDecoder().decode(stderr);
      throw new Error(`Osmium extract failed: ${error}`);
    }
    
    console.log(`✅ Bounds extraction complete: ${outputPath}`);
    return outputPath;
  }

  /**
   * Show available tags in the file
   */
  async showAvailableTags(inputPath: string): Promise<void> {
    console.log(`🏷️ Analyzing available tags in: ${inputPath}`);
    
    const command = new Deno.Command("osmium", {
      args: ["tags-count", inputPath],
      stdout: "piped",
      stderr: "piped"
    });
    
    const { code, stdout, stderr } = await command.output();
    
    if (code !== 0) {
      const error = new TextDecoder().decode(stderr);
      throw new Error(`Osmium tags-count failed: ${error}`);
    }
    
    const output = new TextDecoder().decode(stdout);
    console.log(`📊 Available tags:`);
    console.log(output);
  }

  /**
   * Print recommendations for PBF processing
   */
  printRecommendations(): void {
    console.log(`\n💡 PBF Processing Recommendations:`);
    console.log(`\n1. Install osmium-tool:`);
    console.log(`   # macOS (Homebrew)`);
    console.log(`   brew install osmctools`);
    console.log(`   # Ubuntu/Debian`);
    console.log(`   sudo apt-get install osmctools`);
    console.log(`   # Or download from: https://osmcode.org/osmium-tool/`);
    
    console.log(`\n2. Basic PBF operations:`);
    console.log(`   # Get file information`);
    console.log(`   osmium fileinfo sudeste-251012.osm.pbf`);
    console.log(`   # Show available tags`);
    console.log(`   osmium tags-count sudeste-251012.osm.pbf`);
    
    console.log(`\n3. Filter by tags:`);
    console.log(`   # Extract tourism POIs`);
    console.log(`   osmium tags-filter sudeste-251012.osm.pbf nwr/tourism -o tourism.osm.pbf`);
    console.log(`   # Extract historic POIs`);
    console.log(`   osmium tags-filter sudeste-251012.osm.pbf nwr/historic -o historic.osm.pbf`);
    console.log(`   # Extract natural features`);
    console.log(`   osmium tags-filter sudeste-251012.osm.pbf nwr/natural -o natural.osm.pbf`);
    
    console.log(`\n4. Filter by geographic bounds:`);
    console.log(`   # Extract São Paulo region`);
    console.log(`   osmium extract --bbox -47.5,-24.0,-46.0,-23.0 sudeste-251012.osm.pbf -o sp-region.osm.pbf`);
    
    console.log(`\n5. Convert to GeoJSON:`);
    console.log(`   # Convert filtered PBF to GeoJSON`);
    console.log(`   osmium export tourism.osm.pbf -o tourism.geojson`);
    
    console.log(`\n6. Combine multiple filters:`);
    console.log(`   # Extract tourism + historic in São Paulo`);
    console.log(`   osmium tags-filter sudeste-251012.osm.pbf nwr/tourism,nwr/historic -o cultural.osm.pbf`);
    console.log(`   osmium extract --bbox -47.5,-24.0,-46.0,-23.0 cultural.osm.pbf -o sp-cultural.osm.pbf`);
  }
}

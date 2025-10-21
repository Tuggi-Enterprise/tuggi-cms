/**
 * File Splitter for Large GeoJSON Files
 * Breaks large GeoJSON files into manageable chunks for processing
 */

import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { GeoJSONFeature, GeoJSONCollection } from "./types.ts";

export class FileSplitter {
  private chunkSize: number;
  private outputDir: string;

  constructor(chunkSize: number = 10000, outputDir: string = "output/chunks") {
    this.chunkSize = chunkSize;
    this.outputDir = outputDir;
  }

  /**
   * Split a large GeoJSON file into smaller chunks
   */
  async splitFile(inputPath: string, maxChunkSize?: number): Promise<{
    chunks: string[];
    totalFeatures: number;
    processingTime: number;
  }> {
    const startTime = Date.now();
    
    try {
      await ensureDir(this.outputDir);
      
      console.log(`📂 Splitting large GeoJSON file: ${inputPath}`);
      console.log(`📊 Target chunk size: ${this.chunkSize.toLocaleString()} features per chunk`);
      
      // Read file in streaming fashion
      const file = await Deno.open(inputPath, { read: true });
      const reader = file.readable.getReader();
      const decoder = new TextDecoder();
      
      let buffer = "";
      let features: GeoJSONFeature[] = [];
      let chunks: string[] = [];
      let currentChunk = 0;
      let totalFeatures = 0;
      
      console.log(`🔄 Reading file in chunks...`);
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          
          // Try to parse complete JSON objects
          const lines = buffer.split('\n');
          buffer = lines.pop() || ""; // Keep incomplete line in buffer
          
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && (trimmed.startsWith('{"type":"Feature"') || trimmed.includes('"type":"Feature"'))) {
              try {
                const feature = JSON.parse(trimmed);
                if (feature.type === "Feature") {
                  features.push(feature);
                  totalFeatures++;
                  
                  // Write chunk when it reaches target size
                  if (features.length >= this.chunkSize) {
                    const chunkPath = await this.writeChunk(features, currentChunk);
                    chunks.push(chunkPath);
                    currentChunk++;
                    features = [];
                    
                    console.log(`📝 Written chunk ${currentChunk}: ${features.length.toLocaleString()} features`);
                  }
                }
              } catch (e) {
                // Skip invalid JSON lines
                continue;
              }
            }
          }
        }
        
        // Write remaining features as final chunk
        if (features.length > 0) {
          const chunkPath = await this.writeChunk(features, currentChunk);
          chunks.push(chunkPath);
          console.log(`📝 Written final chunk ${currentChunk + 1}: ${features.length.toLocaleString()} features`);
        }
        
      } finally {
        try {
          file.close();
        } catch (e) {
          // File might already be closed
        }
      }
      
      const processingTime = Date.now() - startTime;
      
      console.log(`✅ File splitting complete:`);
      console.log(`   Total features: ${totalFeatures.toLocaleString()}`);
      console.log(`   Chunks created: ${chunks.length}`);
      console.log(`   Processing time: ${processingTime}ms`);
      
      return {
        chunks,
        totalFeatures,
        processingTime
      };
      
    } catch (error) {
      console.error("Error splitting file:", error);
      throw error;
    }
  }

  /**
   * Write a chunk of features to a file
   */
  private async writeChunk(features: GeoJSONFeature[], chunkIndex: number): Promise<string> {
    const chunkPath = join(this.outputDir, `chunk-${chunkIndex.toString().padStart(4, '0')}.geojson`);
    
    const geojson: GeoJSONCollection = {
      type: "FeatureCollection",
      features
    };
    
    await Deno.writeTextFile(chunkPath, JSON.stringify(geojson, null, 2));
    
    return chunkPath;
  }

  /**
   * Process chunks with a given function
   */
  async processChunks(
    chunks: string[],
    processor: (chunkPath: string, chunkIndex: number) => Promise<any>
  ): Promise<any[]> {
    const results: any[] = [];
    
    console.log(`🔄 Processing ${chunks.length} chunks...`);
    
    for (let i = 0; i < chunks.length; i++) {
      const chunkPath = chunks[i];
      console.log(`📊 Processing chunk ${i + 1}/${chunks.length}: ${chunkPath}`);
      
      try {
        const result = await processor(chunkPath, i);
        results.push(result);
        
        console.log(`✅ Chunk ${i + 1} processed successfully`);
      } catch (error) {
        console.error(`❌ Error processing chunk ${i + 1}:`, error);
        results.push({ error: error.message, chunkIndex: i });
      }
    }
    
    return results;
  }

  /**
   * Merge processed chunks back into a single file
   */
  async mergeChunks(
    chunkPaths: string[],
    outputPath: string,
    filter?: (feature: GeoJSONFeature) => boolean
  ): Promise<{
    totalFeatures: number;
    filteredFeatures: number;
    processingTime: number;
  }> {
    const startTime = Date.now();
    const allFeatures: GeoJSONFeature[] = [];
    
    console.log(`🔄 Merging ${chunkPaths.length} chunks...`);
    
    for (let i = 0; i < chunkPaths.length; i++) {
      const chunkPath = chunkPaths[i];
      console.log(`📖 Reading chunk ${i + 1}/${chunkPaths.length}: ${chunkPath}`);
      
      try {
        const chunkContent = await Deno.readTextFile(chunkPath);
        const chunk: GeoJSONCollection = JSON.parse(chunkContent);
        
        if (filter) {
          const filteredFeatures = chunk.features.filter(filter);
          allFeatures.push(...filteredFeatures);
        } else {
          allFeatures.push(...chunk.features);
        }
        
        console.log(`✅ Chunk ${i + 1} merged (${chunk.features.length} features)`);
      } catch (error) {
        console.error(`❌ Error reading chunk ${i + 1}:`, error);
      }
    }
    
    // Write merged file
    const mergedGeoJSON: GeoJSONCollection = {
      type: "FeatureCollection",
      features: allFeatures
    };
    
    await Deno.writeTextFile(outputPath, JSON.stringify(mergedGeoJSON, null, 2));
    
    const processingTime = Date.now() - startTime;
    
    console.log(`✅ Merge complete:`);
    console.log(`   Total features: ${allFeatures.length.toLocaleString()}`);
    console.log(`   Output file: ${outputPath}`);
    console.log(`   Processing time: ${processingTime}ms`);
    
    return {
      totalFeatures: allFeatures.length,
      filteredFeatures: allFeatures.length,
      processingTime
    };
  }

  /**
   * Clean up chunk files
   */
  async cleanupChunks(chunkPaths: string[]): Promise<void> {
    console.log(`🧹 Cleaning up ${chunkPaths.length} chunk files...`);
    
    for (const chunkPath of chunkPaths) {
      try {
        await Deno.remove(chunkPath);
      } catch (error) {
        console.warn(`⚠️ Could not remove chunk file ${chunkPath}:`, error);
      }
    }
    
    console.log(`✅ Cleanup complete`);
  }

  /**
   * Get file size in human readable format
   */
  private formatFileSize(bytes: number): string {
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }
}

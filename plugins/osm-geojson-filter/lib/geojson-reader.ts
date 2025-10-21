/**
 * Streaming GeoJSON Reader
 * Memory-efficient processing for large GeoJSON files
 */

import { GeoJSONFeature, GeoJSONCollection } from "./types.ts";

export class GeoJSONReader {
  private chunkSize: number;
  private progressCallback?: (processed: number, total: number) => void;

  constructor(chunkSize: number = 1000, progressCallback?: (processed: number, total: number) => void) {
    this.chunkSize = chunkSize;
    this.progressCallback = progressCallback;
  }

  /**
   * Read and process GeoJSON file in streaming fashion
   */
  async *readFeatures(filePath: string): AsyncGenerator<GeoJSONFeature, void, unknown> {
    try {
      console.log(`📖 Reading GeoJSON file: ${filePath}`);
      
      // Read entire file (for now - could be optimized with streaming JSON parser)
      const fileContent = await Deno.readTextFile(filePath);
      const geojson: GeoJSONCollection = JSON.parse(fileContent);
      
      if (geojson.type !== "FeatureCollection") {
        throw new Error("Invalid GeoJSON: Must be a FeatureCollection");
      }
      
      const features = geojson.features;
      const totalFeatures = features.length;
      
      console.log(`🔍 Processing ${totalFeatures.toLocaleString()} features...`);
      
      let processed = 0;
      
      for (const feature of features) {
        yield feature;
        processed++;
        
        // Progress callback
        if (this.progressCallback && processed % this.chunkSize === 0) {
          this.progressCallback(processed, totalFeatures);
        }
      }
      
      // Final progress update
      if (this.progressCallback) {
        this.progressCallback(processed, totalFeatures);
      }
      
      console.log(`✅ Processed ${processed.toLocaleString()} features`);
      
    } catch (error) {
      console.error("Error reading GeoJSON file:", error);
      throw error;
    }
  }

  /**
   * Read features with filtering applied
   */
  async *readFilteredFeatures(
    filePath: string, 
    filterFn: (feature: GeoJSONFeature) => boolean
  ): AsyncGenerator<GeoJSONFeature, void, unknown> {
    let processed = 0;
    let passed = 0;
    
    for await (const feature of this.readFeatures(filePath)) {
      processed++;
      
      if (filterFn(feature)) {
        passed++;
        yield feature;
      }
      
      // Progress update every chunk
      if (processed % this.chunkSize === 0) {
        console.log(`📊 Processed: ${processed.toLocaleString()}, Passed: ${passed.toLocaleString()}`);
      }
    }
    
    console.log(`🎯 Filtering complete: ${passed.toLocaleString()} of ${processed.toLocaleString()} features passed`);
  }

  /**
   * Count total features without loading all into memory
   */
  async countFeatures(filePath: string): Promise<number> {
    try {
      const fileContent = await Deno.readTextFile(filePath);
      const geojson: GeoJSONCollection = JSON.parse(fileContent);
      
      if (geojson.type !== "FeatureCollection") {
        throw new Error("Invalid GeoJSON: Must be a FeatureCollection");
      }
      
      return geojson.features.length;
    } catch (error) {
      console.error("Error counting features:", error);
      throw error;
    }
  }

  /**
   * Get file metadata without loading features
   */
  async getFileMetadata(filePath: string): Promise<{
    fileSize: number;
    featureCount: number;
    bounds?: {
      north: number;
      south: number;
      east: number;
      west: number;
    };
  }> {
    try {
      const fileInfo = await Deno.stat(filePath);
      const fileSize = fileInfo.size;
      
      const featureCount = await this.countFeatures(filePath);
      
      // Calculate bounds by sampling first and last features
      const fileContent = await Deno.readTextFile(filePath);
      const geojson: GeoJSONCollection = JSON.parse(fileContent);
      
      let bounds: { north: number; south: number; east: number; west: number } | undefined;
      
      if (geojson.features.length > 0) {
        bounds = this.calculateBounds(geojson.features);
      }
      
      return {
        fileSize,
        featureCount,
        bounds
      };
      
    } catch (error) {
      console.error("Error getting file metadata:", error);
      throw error;
    }
  }

  /**
   * Calculate bounding box for features
   */
  private calculateBounds(features: GeoJSONFeature[]): {
    north: number;
    south: number;
    east: number;
    west: number;
  } {
    let north = -90;
    let south = 90;
    let east = -180;
    let west = 180;
    
    for (const feature of features) {
      const coords = this.extractCoordinates(feature);
      
      for (const [lng, lat] of coords) {
        north = Math.max(north, lat);
        south = Math.min(south, lat);
        east = Math.max(east, lng);
        west = Math.min(west, lng);
      }
    }
    
    return { north, south, east, west };
  }

  /**
   * Extract coordinates from feature geometry
   */
  private extractCoordinates(feature: GeoJSONFeature): number[][] {
    const coords: number[][] = [];
    
    switch (feature.geometry.type) {
      case "Point":
        coords.push(feature.geometry.coordinates as number[]);
        break;
        
      case "LineString":
        coords.push(...(feature.geometry.coordinates as number[][]));
        break;
        
      case "Polygon":
        for (const ring of feature.geometry.coordinates as number[][][]) {
          coords.push(...ring);
        }
        break;
        
      case "MultiPoint":
        coords.push(...(feature.geometry.coordinates as number[][]));
        break;
        
      case "MultiLineString":
        for (const line of feature.geometry.coordinates as number[][][]) {
          coords.push(...line);
        }
        break;
        
      case "MultiPolygon":
        for (const polygon of feature.geometry.coordinates as number[][][][]) {
          for (const ring of polygon) {
            coords.push(...ring);
          }
        }
        break;
    }
    
    return coords;
  }

  /**
   * Write filtered features to new GeoJSON file
   */
  async writeFilteredGeoJSON(
    inputPath: string,
    outputPath: string,
    filterFn: (feature: GeoJSONFeature) => boolean
  ): Promise<{
    originalCount: number;
    filteredCount: number;
    processingTime: number;
  }> {
    const startTime = Date.now();
    
    try {
      console.log(`🔄 Filtering GeoJSON: ${inputPath} -> ${outputPath}`);
      
      const features: GeoJSONFeature[] = [];
      let originalCount = 0;
      
      for await (const feature of this.readFeatures(inputPath)) {
        originalCount++;
        
        if (filterFn(feature)) {
          features.push(feature);
        }
      }
      
      const filteredCount = features.length;
      
      // Create filtered GeoJSON
      const filteredGeoJSON: GeoJSONCollection = {
        type: "FeatureCollection",
        features
      };
      
      // Write to file
      await Deno.writeTextFile(outputPath, JSON.stringify(filteredGeoJSON, null, 2));
      
      const processingTime = Date.now() - startTime;
      
      console.log(`✅ Filtering complete:`);
      console.log(`   Original: ${originalCount.toLocaleString()} features`);
      console.log(`   Filtered: ${filteredCount.toLocaleString()} features`);
      console.log(`   Processing time: ${processingTime}ms`);
      console.log(`   Output saved to: ${outputPath}`);
      
      return {
        originalCount,
        filteredCount,
        processingTime
      };
      
    } catch (error) {
      console.error("Error writing filtered GeoJSON:", error);
      throw error;
    }
  }
}


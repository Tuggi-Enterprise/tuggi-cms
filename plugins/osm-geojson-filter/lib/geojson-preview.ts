/**
 * GeoJSON Preview and Validation Tool
 * Analyzes file structure and validates data quality
 */

import { GeoJSONFeature, PreviewStats, ValidationResult } from "./types.ts";

export class GeoJSONPreview {
  private sampleSize: number;

  constructor(sampleSize: number = 20) {
    this.sampleSize = sampleSize;
  }

  /**
   * Preview GeoJSON file structure and validate data
   */
  async previewFile(filePath: string): Promise<PreviewStats> {
    const startTime = Date.now();
    
    try {
      const fileInfo = await Deno.stat(filePath);
      const fileSize = fileInfo.size;
      
      console.log(`📁 Analyzing file: ${filePath}`);
      console.log(`📊 File size: ${this.formatFileSize(fileSize)}`);
      
      // Read and parse GeoJSON
      const fileContent = await Deno.readTextFile(filePath);
      const geojson = JSON.parse(fileContent);
      
      if (geojson.type !== "FeatureCollection") {
        throw new Error("Invalid GeoJSON: Must be a FeatureCollection");
      }
      
      const features = geojson.features as GeoJSONFeature[];
      const totalFeatures = features.length;
      
      console.log(`🔍 Total features: ${totalFeatures.toLocaleString()}`);
      
      // Get sample features
      const sampleFeatures = features.slice(0, this.sampleSize);
      
      // Analyze data quality
      const dataQuality = this.analyzeDataQuality(features);
      
      // Extract available tags
      const availableTags = this.extractAvailableTags(features);
      
      // Find duplicates
      const duplicates = this.findDuplicates(features);
      
      const processingTime = Date.now() - startTime;
      
      const stats: PreviewStats = {
        totalFeatures,
        sampleFeatures,
        availableTags,
        dataQuality: {
          ...dataQuality,
          duplicates
        },
        fileSize,
        processingTime
      };
      
      this.printPreviewReport(stats);
      
      return stats;
      
    } catch (error) {
      console.error("Error previewing file:", error);
      throw error;
    }
  }

  /**
   * Analyze data quality metrics
   */
  private analyzeDataQuality(features: GeoJSONFeature[]): {
    withNames: number;
    withoutNames: number;
    validCoordinates: number;
    invalidCoordinates: number;
  } {
    let withNames = 0;
    let withoutNames = 0;
    let validCoordinates = 0;
    let invalidCoordinates = 0;
    
    for (const feature of features) {
      // Check for names
      if (feature.properties.name && feature.properties.name.trim()) {
        withNames++;
      } else {
        withoutNames++;
      }
      
      // Check coordinate validity
      if (this.isValidCoordinates(feature.geometry.coordinates)) {
        validCoordinates++;
      } else {
        invalidCoordinates++;
      }
    }
    
    return {
      withNames,
      withoutNames,
      validCoordinates,
      invalidCoordinates
    };
  }

  /**
   * Extract all available OSM tags from features
   */
  private extractAvailableTags(features: GeoJSONFeature[]): string[] {
    const tagSet = new Set<string>();
    
    for (const feature of features) {
      for (const key in feature.properties) {
        if (key.startsWith("osm:") || key.includes("=")) {
          tagSet.add(key);
        }
      }
    }
    
    return Array.from(tagSet).sort();
  }

  /**
   * Find potential duplicate features
   */
  private findDuplicates(features: GeoJSONFeature[]): number {
    const coordinateMap = new Map<string, number>();
    let duplicates = 0;
    
    for (const feature of features) {
      if (feature.geometry.type === "Point") {
        const coords = feature.geometry.coordinates as number[];
        const key = `${coords[0].toFixed(6)},${coords[1].toFixed(6)}`;
        
        if (coordinateMap.has(key)) {
          duplicates++;
        } else {
          coordinateMap.set(key, 1);
        }
      }
    }
    
    return duplicates;
  }

  /**
   * Validate coordinates
   */
  private isValidCoordinates(coordinates: any): boolean {
    if (!Array.isArray(coordinates)) return false;
    
    if (coordinates.length === 2 && typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
      // Point coordinates
      const [lng, lat] = coordinates;
      return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
    }
    
    return true; // For complex geometries, assume valid for now
  }

  /**
   * Print preview report to console
   */
  private printPreviewReport(stats: PreviewStats): void {
    console.log("\n" + "=".repeat(60));
    console.log("📋 GEOJSON PREVIEW REPORT");
    console.log("=".repeat(60));
    
    console.log(`\n📊 File Statistics:`);
    console.log(`   Total Features: ${stats.totalFeatures.toLocaleString()}`);
    console.log(`   File Size: ${this.formatFileSize(stats.fileSize)}`);
    console.log(`   Processing Time: ${stats.processingTime}ms`);
    
    console.log(`\n🔍 Data Quality:`);
    console.log(`   Features with names: ${stats.dataQuality.withNames.toLocaleString()} (${this.getPercentage(stats.dataQuality.withNames, stats.totalFeatures)}%)`);
    console.log(`   Features without names: ${stats.dataQuality.withoutNames.toLocaleString()} (${this.getPercentage(stats.dataQuality.withoutNames, stats.totalFeatures)}%)`);
    console.log(`   Valid coordinates: ${stats.dataQuality.validCoordinates.toLocaleString()} (${this.getPercentage(stats.dataQuality.validCoordinates, stats.totalFeatures)}%)`);
    console.log(`   Invalid coordinates: ${stats.dataQuality.invalidCoordinates.toLocaleString()} (${this.getPercentage(stats.dataQuality.invalidCoordinates, stats.totalFeatures)}%)`);
    console.log(`   Potential duplicates: ${stats.dataQuality.duplicates.toLocaleString()}`);
    
    console.log(`\n🏷️ Available OSM Tags (${stats.availableTags.length}):`);
    stats.availableTags.slice(0, 20).forEach(tag => {
      console.log(`   - ${tag}`);
    });
    if (stats.availableTags.length > 20) {
      console.log(`   ... and ${stats.availableTags.length - 20} more`);
    }
    
    console.log(`\n📝 Sample Features (first ${Math.min(this.sampleSize, stats.sampleFeatures.length)}):`);
    stats.sampleFeatures.forEach((feature, index) => {
      const name = feature.properties.name || "Unnamed";
      const coords = feature.geometry.type === "Point" 
        ? feature.geometry.coordinates as number[]
        : null;
      const coordStr = coords ? `[${coords[1].toFixed(4)}, ${coords[0].toFixed(4)}]` : "Complex geometry";
      
      console.log(`   ${index + 1}. ${name} (${coordStr})`);
    });
    
    console.log("\n" + "=".repeat(60));
  }

  /**
   * Save preview report to file
   */
  async savePreviewReport(stats: PreviewStats, outputPath: string): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const reportPath = `${outputPath}/preview-${timestamp}.txt`;
    
    let report = "GEOJSON PREVIEW REPORT\n";
    report += "=".repeat(60) + "\n\n";
    
    report += `File Statistics:\n`;
    report += `  Total Features: ${stats.totalFeatures.toLocaleString()}\n`;
    report += `  File Size: ${this.formatFileSize(stats.fileSize)}\n`;
    report += `  Processing Time: ${stats.processingTime}ms\n\n`;
    
    report += `Data Quality:\n`;
    report += `  Features with names: ${stats.dataQuality.withNames.toLocaleString()} (${this.getPercentage(stats.dataQuality.withNames, stats.totalFeatures)}%)\n`;
    report += `  Features without names: ${stats.dataQuality.withoutNames.toLocaleString()} (${this.getPercentage(stats.dataQuality.withoutNames, stats.totalFeatures)}%)\n`;
    report += `  Valid coordinates: ${stats.dataQuality.validCoordinates.toLocaleString()} (${this.getPercentage(stats.dataQuality.validCoordinates, stats.totalFeatures)}%)\n`;
    report += `  Invalid coordinates: ${stats.dataQuality.invalidCoordinates.toLocaleString()} (${this.getPercentage(stats.dataQuality.invalidCoordinates, stats.totalFeatures)}%)\n`;
    report += `  Potential duplicates: ${stats.dataQuality.duplicates.toLocaleString()}\n\n`;
    
    report += `Available OSM Tags (${stats.availableTags.length}):\n`;
    stats.availableTags.forEach(tag => {
      report += `  - ${tag}\n`;
    });
    
    report += `\nSample Features:\n`;
    stats.sampleFeatures.forEach((feature, index) => {
      const name = feature.properties.name || "Unnamed";
      const coords = feature.geometry.type === "Point" 
        ? feature.geometry.coordinates as number[]
        : null;
      const coordStr = coords ? `[${coords[1].toFixed(4)}, ${coords[0].toFixed(4)}]` : "Complex geometry";
      
      report += `  ${index + 1}. ${name} (${coordStr})\n`;
    });
    
    await Deno.writeTextFile(reportPath, report);
    console.log(`\n💾 Preview report saved to: ${reportPath}`);
  }

  /**
   * Format file size in human readable format
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

  /**
   * Calculate percentage
   */
  private getPercentage(value: number, total: number): string {
    return ((value / total) * 100).toFixed(1);
  }
}


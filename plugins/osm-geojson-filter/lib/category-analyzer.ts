/**
 * Enhanced Category Analysis Tool
 * Comprehensive OSM category exploration with detailed statistics
 */

import { GeoJSONFeature, CategoryStats } from "./types.ts";
import { GeoJSONReader } from "./geojson-reader.ts";

export class CategoryAnalyzer {
  private reader: GeoJSONReader;

  constructor() {
    this.reader = new GeoJSONReader(1000, (processed, total) => {
      const percentage = ((processed / total) * 100).toFixed(1);
      console.log(`📊 Analyzing categories: ${processed.toLocaleString()}/${total.toLocaleString()} (${percentage}%)`);
    });
  }

  /**
   * Analyze all categories in the GeoJSON file
   */
  async analyzeCategories(filePath: string): Promise<CategoryStats[]> {
    console.log(`🔍 Starting category analysis for: ${filePath}`);
    
    const categoryMap = new Map<string, {
      count: number;
      sampleNames: string[];
      tags: Set<string>;
      locations: Map<string, number>;
      withNames: number;
      withoutNames: number;
      validCoordinates: number;
      invalidCoordinates: number;
    }>();

    let totalProcessed = 0;

    // Process all features
    for await (const feature of this.reader.readFeatures(filePath)) {
      totalProcessed++;
      
      const categories = this.extractCategories(feature);
      
      for (const category of categories) {
        if (!categoryMap.has(category)) {
          categoryMap.set(category, {
            count: 0,
            sampleNames: [],
            tags: new Set(),
            locations: new Map(),
            withNames: 0,
            withoutNames: 0,
            validCoordinates: 0,
            invalidCoordinates: 0
          });
        }
        
        const stats = categoryMap.get(category)!;
        stats.count++;
        
        // Collect sample names (up to 5)
        if (stats.sampleNames.length < 5 && feature.properties.name) {
          stats.sampleNames.push(feature.properties.name);
        }
        
        // Collect tags
        for (const key in feature.properties) {
          if (key.startsWith("osm:") || key.includes("=")) {
            stats.tags.add(key);
          }
        }
        
        // Geographic distribution
        const location = this.extractLocation(feature);
        if (location) {
          const currentCount = stats.locations.get(location) || 0;
          stats.locations.set(location, currentCount + 1);
        }
        
        // Data quality metrics
        if (feature.properties.name && feature.properties.name.trim()) {
          stats.withNames++;
        } else {
          stats.withoutNames++;
        }
        
        if (this.isValidCoordinates(feature.geometry.coordinates)) {
          stats.validCoordinates++;
        } else {
          stats.invalidCoordinates++;
        }
      }
    }

    console.log(`✅ Analysis complete: ${totalProcessed.toLocaleString()} features processed`);

    // Convert to CategoryStats array and sort by count
    const categoryStats: CategoryStats[] = Array.from(categoryMap.entries())
      .map(([category, stats]) => ({
        category,
        count: stats.count,
        sampleNames: stats.sampleNames,
        tags: Array.from(stats.tags).sort(),
        geographicDistribution: Object.fromEntries(stats.locations),
        dataQuality: {
          withNames: stats.withNames,
          withoutNames: stats.withoutNames,
          validCoordinates: stats.validCoordinates,
          invalidCoordinates: stats.invalidCoordinates
        }
      }))
      .sort((a, b) => b.count - a.count);

    return categoryStats;
  }

  /**
   * Extract OSM categories from feature properties
   */
  private extractCategories(feature: GeoJSONFeature): string[] {
    const categories: string[] = [];
    const properties = feature.properties;
    
    // Common OSM tag patterns
    const tagPatterns = [
      "tourism", "historic", "natural", "leisure", "amenity", "shop", 
      "craft", "office", "healthcare", "education", "sport", "highway",
      "railway", "waterway", "aeroway", "barrier", "man_made", "landuse",
      "military", "power", "emergency", "public_transport", "route"
    ];
    
    for (const pattern of tagPatterns) {
      if (properties[pattern]) {
        categories.push(`${pattern}=${properties[pattern]}`);
      }
    }
    
    // Check for osm: prefixed tags
    for (const key in properties) {
      if (key.startsWith("osm:")) {
        const tag = key.replace("osm:", "");
        if (properties[key]) {
          categories.push(`${tag}=${properties[key]}`);
        }
      }
    }
    
    // If no specific categories found, use generic type
    if (categories.length === 0) {
      categories.push("uncategorized");
    }
    
    return categories;
  }

  /**
   * Extract location information from feature
   */
  private extractLocation(feature: GeoJSONFeature): string | null {
    const properties = feature.properties;
    
    // Try different location fields
    const locationFields = ["addr:city", "city", "addr:state", "state", "addr:country", "country"];
    
    for (const field of locationFields) {
      if (properties[field]) {
        return properties[field];
      }
    }
    
    // Try osm: prefixed location fields
    for (const key in properties) {
      if (key.startsWith("osm:") && locationFields.some(field => key.includes(field))) {
        return properties[key];
      }
    }
    
    return null;
  }

  /**
   * Validate coordinates
   */
  private isValidCoordinates(coordinates: any): boolean {
    if (!Array.isArray(coordinates)) return false;
    
    if (coordinates.length === 2 && typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
      const [lng, lat] = coordinates;
      return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
    }
    
    return true; // For complex geometries, assume valid
  }

  /**
   * Print category analysis report
   */
  printCategoryReport(categoryStats: CategoryStats[]): void {
    console.log("\n" + "=".repeat(80));
    console.log("📊 CATEGORY ANALYSIS REPORT");
    console.log("=".repeat(80));
    
    console.log(`\n📈 Summary:`);
    console.log(`   Total categories found: ${categoryStats.length}`);
    console.log(`   Total POIs: ${categoryStats.reduce((sum, cat) => sum + cat.count, 0).toLocaleString()}`);
    
    console.log(`\n🏆 Top 20 Categories:`);
    categoryStats.slice(0, 20).forEach((stats, index) => {
      const percentage = ((stats.count / categoryStats.reduce((sum, cat) => sum + cat.count, 0)) * 100).toFixed(1);
      console.log(`   ${(index + 1).toString().padStart(2)}. ${stats.category.padEnd(30)} ${stats.count.toLocaleString().padStart(8)} POIs (${percentage}%)`);
    });
    
    console.log(`\n🌍 Geographic Distribution (Top Locations):`);
    const allLocations = new Map<string, number>();
    categoryStats.forEach(stats => {
      Object.entries(stats.geographicDistribution).forEach(([location, count]) => {
        const current = allLocations.get(location) || 0;
        allLocations.set(location, current + count);
      });
    });
    
    const topLocations = Array.from(allLocations.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);
    
    topLocations.forEach(([location, count], index) => {
      console.log(`   ${(index + 1).toString().padStart(2)}. ${location.padEnd(30)} ${count.toLocaleString().padStart(8)} POIs`);
    });
    
    console.log(`\n🏷️ Most Common OSM Tags:`);
    const allTags = new Map<string, number>();
    categoryStats.forEach(stats => {
      stats.tags.forEach(tag => {
        const current = allTags.get(tag) || 0;
        allTags.set(tag, current + 1);
      });
    });
    
    const topTags = Array.from(allTags.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    
    topTags.forEach(([tag, count], index) => {
      console.log(`   ${(index + 1).toString().padStart(2)}. ${tag.padEnd(40)} ${count.toLocaleString().padStart(6)} occurrences`);
    });
    
    console.log(`\n📝 Sample POIs by Category:`);
    categoryStats.slice(0, 10).forEach(stats => {
      console.log(`\n   ${stats.category} (${stats.count.toLocaleString()} POIs):`);
      stats.sampleNames.forEach(name => {
        console.log(`     - ${name}`);
      });
      if (stats.sampleNames.length === 0) {
        console.log(`     - No named POIs in this category`);
      }
    });
    
    console.log("\n" + "=".repeat(80));
  }

  /**
   * Save category analysis report to file
   */
  async saveCategoryReport(categoryStats: CategoryStats[], outputPath: string): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const reportPath = `${outputPath}/category-analysis-${timestamp}.txt`;
    
    let report = "CATEGORY ANALYSIS REPORT\n";
    report += "=".repeat(80) + "\n\n";
    
    report += `Summary:\n`;
    report += `  Total categories found: ${categoryStats.length}\n`;
    report += `  Total POIs: ${categoryStats.reduce((sum, cat) => sum + cat.count, 0).toLocaleString()}\n\n`;
    
    report += `Top Categories:\n`;
    categoryStats.forEach((stats, index) => {
      const percentage = ((stats.count / categoryStats.reduce((sum, cat) => sum + cat.count, 0)) * 100).toFixed(1);
      report += `  ${(index + 1).toString().padStart(3)}. ${stats.category.padEnd(30)} ${stats.count.toLocaleString().padStart(8)} POIs (${percentage}%)\n`;
    });
    
    report += `\nGeographic Distribution (Top Locations):\n`;
    const allLocations = new Map<string, number>();
    categoryStats.forEach(stats => {
      Object.entries(stats.geographicDistribution).forEach(([location, count]) => {
        const current = allLocations.get(location) || 0;
        allLocations.set(location, current + count);
      });
    });
    
    const topLocations = Array.from(allLocations.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    
    topLocations.forEach(([location, count], index) => {
      report += `  ${(index + 1).toString().padStart(3)}. ${location.padEnd(30)} ${count.toLocaleString().padStart(8)} POIs\n`;
    });
    
    report += `\nMost Common OSM Tags:\n`;
    const allTags = new Map<string, number>();
    categoryStats.forEach(stats => {
      stats.tags.forEach(tag => {
        const current = allTags.get(tag) || 0;
        allTags.set(tag, current + 1);
      });
    });
    
    const topTags = Array.from(allTags.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30);
    
    topTags.forEach(([tag, count], index) => {
      report += `  ${(index + 1).toString().padStart(3)}. ${tag.padEnd(40)} ${count.toLocaleString().padStart(6)} occurrences\n`;
    });
    
    report += `\nDetailed Category Information:\n`;
    categoryStats.forEach(stats => {
      report += `\n${stats.category} (${stats.count.toLocaleString()} POIs):\n`;
      report += `  Sample names: ${stats.sampleNames.join(", ")}\n`;
      report += `  Data quality: ${stats.dataQuality.withNames} with names, ${stats.dataQuality.withoutNames} without names\n`;
      report += `  Coordinates: ${stats.dataQuality.validCoordinates} valid, ${stats.dataQuality.invalidCoordinates} invalid\n`;
      report += `  Top locations: ${Object.entries(stats.geographicDistribution)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([loc, count]) => `${loc} (${count})`)
        .join(", ")}\n`;
    });
    
    await Deno.writeTextFile(reportPath, report);
    console.log(`\n💾 Category analysis report saved to: ${reportPath}`);
  }
}


/**
 * Filtering Logic for OSM GeoJSON Data
 * Modular filter functions for regions, categories, and bounds
 */

import { GeoJSONFeature, FilterConfig, ProcessingStats } from "./types.ts";

export class FilterEngine {
  private config: FilterConfig;
  private stats: ProcessingStats;

  constructor(config: FilterConfig) {
    this.config = config;
    this.stats = {
      originalCount: 0,
      filteredCount: 0,
      excludedByCategory: 0,
      excludedByRegion: 0,
      excludedByBounds: 0,
      excludedByUnnamed: 0,
      processingTime: 0
    };
  }

  /**
   * Main filter function that applies all configured filters
   */
  filterFeature(feature: GeoJSONFeature): boolean {
    this.stats.originalCount++;

    // 1. Category exclusion (highest priority)
    if (this.isExcludedByCategory(feature)) {
      this.stats.excludedByCategory++;
      return false;
    }

    // 2. Category inclusion (if specified)
    if (this.config.includedCategories && this.config.includedCategories.length > 0) {
      if (!this.isIncludedByCategory(feature)) {
        this.stats.excludedByCategory++;
        return false;
      }
    }

    // 3. Unnamed POI exclusion (if enabled)
    if (this.config.excludeUnnamed && this.isUnnamed(feature)) {
      this.stats.excludedByUnnamed++;
      return false;
    }

    // 4. Region filtering
    if (!this.matchesRegion(feature)) {
      this.stats.excludedByRegion++;
      return false;
    }

    // 5. Bounds filtering (if specified)
    if (this.config.bounds && !this.isWithinBounds(feature)) {
      this.stats.excludedByBounds++;
      return false;
    }

    this.stats.filteredCount++;
    return true;
  }

  /**
   * Check if feature should be excluded by category patterns
   */
  private isExcludedByCategory(feature: GeoJSONFeature): boolean {
    if (this.config.excludedCategories.length === 0) {
      return false;
    }

    const featureCategories = this.extractFeatureCategories(feature);

    for (const excludedPattern of this.config.excludedCategories) {
      if (this.matchesCategoryPattern(featureCategories, excludedPattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if feature should be included by category patterns
   */
  private isIncludedByCategory(feature: GeoJSONFeature): boolean {
    if (!this.config.includedCategories || this.config.includedCategories.length === 0) {
      return true; // No inclusion filter means include all
    }

    const featureCategories = this.extractFeatureCategories(feature);

    for (const includedPattern of this.config.includedCategories) {
      if (this.matchesCategoryPattern(featureCategories, includedPattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Extract all categories from feature properties
   */
  private extractFeatureCategories(feature: GeoJSONFeature): string[] {
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
        categories.push(pattern); // Also add base pattern
      }
    }

    // Check for osm: prefixed tags
    for (const key in properties) {
      if (key.startsWith("osm:")) {
        const tag = key.replace("osm:", "");
        if (properties[key]) {
          categories.push(`${tag}=${properties[key]}`);
          categories.push(tag);
        }
      }
    }

    return categories;
  }

  /**
   * Check if feature categories match a pattern
   */
  private matchesCategoryPattern(featureCategories: string[], pattern: string): boolean {
    // Exact match
    if (featureCategories.includes(pattern)) {
      return true;
    }

    // Prefix match (e.g., "shop:*" matches "shop=bakery", "shop=supermarket")
    if (pattern.endsWith(":*")) {
      const prefix = pattern.slice(0, -2);
      return featureCategories.some(cat => cat.startsWith(prefix + "=") || cat === prefix);
    }

    // Tag-value match (e.g., "amenity=parking")
    if (pattern.includes("=")) {
      return featureCategories.includes(pattern);
    }

    // Multiple tags separated by comma (e.g., "tourism=hotel,tourism=motel")
    if (pattern.includes(",")) {
      const patterns = pattern.split(",").map(p => p.trim());
      return patterns.some(p => this.matchesCategoryPattern(featureCategories, p));
    }

    return false;
  }

  /**
   * Check if feature matches region criteria
   */
  private matchesRegion(feature: GeoJSONFeature): boolean {
    const regions = this.config.regions;
    
    // If no region filters specified, include all
    if ((!regions.states || regions.states.length === 0) && 
        (!regions.cities || regions.cities.length === 0)) {
      return true;
    }

    const properties = feature.properties;
    let matchesState = false;
    let matchesCity = false;

    // Check state match
    if (regions.states && regions.states.length > 0) {
      const stateFields = ["addr:state", "state", "addr:region", "region"];
      for (const field of stateFields) {
        if (properties[field]) {
          const value = properties[field].toLowerCase();
          if (regions.states.some(state => state.toLowerCase() === value)) {
            matchesState = true;
            break;
          }
        }
      }
    } else {
      matchesState = true; // No state filter
    }

    // Check city match
    if (regions.cities && regions.cities.length > 0) {
      const cityFields = ["addr:city", "city", "addr:town", "town", "addr:village", "village"];
      for (const field of cityFields) {
        if (properties[field]) {
          const value = properties[field].toLowerCase();
          if (regions.cities.some(city => city.toLowerCase() === value)) {
            matchesCity = true;
            break;
          }
        }
      }
    } else {
      matchesCity = true; // No city filter
    }

    return matchesState && matchesCity;
  }

  /**
   * Check if feature is within specified bounds
   */
  private isWithinBounds(feature: GeoJSONFeature): boolean {
    if (!this.config.bounds) {
      return true;
    }

    const bounds = this.config.bounds;
    const coordinates = this.extractCoordinates(feature);

    for (const [lng, lat] of coordinates) {
      if (lat >= bounds.south && lat <= bounds.north && 
          lng >= bounds.west && lng <= bounds.east) {
        return true;
      }
    }

    return false;
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
   * Check if feature is unnamed (no name property or empty name)
   */
  private isUnnamed(feature: GeoJSONFeature): boolean {
    const name = feature.properties?.name;
    return !name || name.trim() === '' || name === 'Unnamed';
  }

  /**
   * Get processing statistics
   */
  getStats(): ProcessingStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      originalCount: 0,
      filteredCount: 0,
      excludedByCategory: 0,
      excludedByRegion: 0,
      excludedByBounds: 0,
      excludedByUnnamed: 0,
      processingTime: 0
    };
  }

  /**
   * Set processing time
   */
  setProcessingTime(time: number): void {
    this.stats.processingTime = time;
  }

  /**
   * Print filter statistics
   */
  printStats(): void {
    console.log("\n" + "=".repeat(60));
    console.log("📊 FILTERING STATISTICS");
    console.log("=".repeat(60));
    
    console.log(`\n📈 Processing Results:`);
    console.log(`   Original features: ${this.stats.originalCount.toLocaleString()}`);
    console.log(`   Filtered features: ${this.stats.filteredCount.toLocaleString()}`);
    console.log(`   Excluded by category: ${this.stats.excludedByCategory.toLocaleString()}`);
    console.log(`   Excluded by region: ${this.stats.excludedByRegion.toLocaleString()}`);
    console.log(`   Excluded by bounds: ${this.stats.excludedByBounds.toLocaleString()}`);
    console.log(`   Excluded by unnamed: ${this.stats.excludedByUnnamed.toLocaleString()}`);
    console.log(`   Processing time: ${this.stats.processingTime}ms`);
    
    if (this.stats.originalCount > 0) {
      const filterRate = ((this.stats.filteredCount / this.stats.originalCount) * 100).toFixed(1);
      console.log(`   Filter rate: ${filterRate}%`);
    }
    
    console.log("\n" + "=".repeat(60));
  }
}


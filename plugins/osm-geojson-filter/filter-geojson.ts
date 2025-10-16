#!/usr/bin/env -S deno run --allow-read --allow-write

/**
 * OSM GeoJSON Filter - Main CLI Script
 * A standalone Deno plugin for filtering large OpenStreetMap GeoJSON files
 */

import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { ConfigManager } from "./lib/config-manager.ts";
import { GeoJSONPreview } from "./lib/geojson-preview.ts";
import { CategoryAnalyzer } from "./lib/category-analyzer.ts";
import { FilterEngine } from "./lib/filters.ts";
import { GeoJSONReader } from "./lib/geojson-reader.ts";
import { FilterConfig, FilterMode } from "./lib/types.ts";

class OSMGeoJSONFilter {
  private configManager: ConfigManager;
  private outputDir: string;

  constructor() {
    this.configManager = new ConfigManager();
    this.outputDir = "output";
  }

  /**
   * Main entry point
   */
  async run(): Promise<void> {
    const args = Deno.args;
    
    if (args.length === 0) {
      this.showHelp();
      return;
    }

    const mode = args[0] as FilterMode;
    
    try {
      await ensureDir(this.outputDir);
      
      switch (mode) {
        case "preview":
          await this.previewMode(args.slice(1));
          break;
        case "analyze":
          await this.analyzeMode(args.slice(1));
          break;
        case "filter":
          await this.filterMode(args.slice(1));
          break;
        case "config":
          await this.configMode(args.slice(1));
          break;
        default:
          console.error(`❌ Unknown mode: ${mode}`);
          this.showHelp();
          Deno.exit(1);
      }
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
      Deno.exit(1);
    }
  }

  /**
   * Preview mode - analyze file structure and validate data
   */
  private async previewMode(args: string[]): Promise<void> {
    const filePath = args[0];
    
    if (!filePath) {
      console.error("❌ Please provide a GeoJSON file path");
      console.log("Usage: deno run filter-geojson.ts preview <file-path>");
      Deno.exit(1);
    }

    console.log("🔍 Preview Mode - Analyzing GeoJSON file structure...\n");
    
    const preview = new GeoJSONPreview();
    const stats = await preview.previewFile(filePath);
    await preview.savePreviewReport(stats, this.outputDir);
  }

  /**
   * Analyze mode - explore all categories and generate statistics
   */
  private async analyzeMode(args: string[]): Promise<void> {
    const filePath = args[0];
    
    if (!filePath) {
      console.error("❌ Please provide a GeoJSON file path");
      console.log("Usage: deno run filter-geojson.ts analyze <file-path>");
      Deno.exit(1);
    }

    console.log("📊 Analyze Mode - Exploring OSM categories...\n");
    
    const analyzer = new CategoryAnalyzer();
    const categoryStats = await analyzer.analyzeCategories(filePath);
    
    analyzer.printCategoryReport(categoryStats);
    await analyzer.saveCategoryReport(categoryStats, this.outputDir);
  }

  /**
   * Filter mode - apply filters and generate filtered output
   */
  private async filterMode(args: string[]): Promise<void> {
    const filePath = args[0];
    const configName = args[1];
    
    if (!filePath) {
      console.error("❌ Please provide a GeoJSON file path");
      console.log("Usage: deno run filter-geojson.ts filter <file-path> [config-name]");
      Deno.exit(1);
    }

    console.log("🎯 Filter Mode - Applying filters to GeoJSON...\n");
    
    // Load or create configuration
    let config: FilterConfig;
    
    if (configName) {
      config = await this.configManager.getConfiguration(configName);
      if (!config) {
        console.error(`❌ Configuration '${configName}' not found`);
        console.log("Available configurations:");
        const configs = await this.configManager.listConfigurationNames();
        configs.forEach(name => console.log(`  - ${name}`));
        Deno.exit(1);
      }
      console.log(`📋 Using configuration: ${config.name}`);
    } else {
      // Create default configuration
      config = this.configManager.createDefaultConfig("default");
      console.log("📋 Using default configuration");
    }
    
    this.printConfiguration(config);
    
    // Apply filters
    const filterEngine = new FilterEngine(config);
    const reader = new GeoJSONReader();
    
    const startTime = Date.now();
    
    const outputPath = join(this.outputDir, `filtered-${config.name}-${Date.now()}.geojson`);
    
    const result = await reader.writeFilteredGeoJSON(
      filePath,
      outputPath,
      (feature) => filterEngine.filterFeature(feature)
    );
    
    filterEngine.setProcessingTime(result.processingTime);
    filterEngine.printStats();
  }

  /**
   * Config mode - manage saved configurations
   */
  private async configMode(args: string[]): Promise<void> {
    const action = args[0] || "list";
    
    switch (action) {
      case "list":
        await this.listConfigurations();
        break;
      case "create":
        await this.createConfiguration(args.slice(1));
        break;
      case "show":
        await this.showConfiguration(args[1]);
        break;
      case "delete":
        await this.deleteConfiguration(args[1]);
        break;
      default:
        console.error(`❌ Unknown config action: ${action}`);
        this.showConfigHelp();
        Deno.exit(1);
    }
  }

  /**
   * List all saved configurations
   */
  private async listConfigurations(): Promise<void> {
    const configs = await this.configManager.loadConfigurations();
    
    console.log("📋 Saved Configurations:\n");
    
    if (configs.length === 0) {
      console.log("  No configurations found.");
      console.log("  Use 'deno run filter-geojson.ts config create <name>' to create one.");
      return;
    }
    
    configs.forEach((config, index) => {
      console.log(`  ${index + 1}. ${config.name}`);
      console.log(`     States: ${config.regions.states?.join(", ") || "Any"}`);
      console.log(`     Cities: ${config.regions.cities?.join(", ") || "Any"}`);
      console.log(`     Excluded categories: ${config.excludedCategories.length}`);
      console.log(`     Included categories: ${config.includedCategories?.length || "Any"}`);
      console.log("");
    });
  }

  /**
   * Create a new configuration
   */
  private async createConfiguration(args: string[]): Promise<void> {
    const name = args[0];
    
    if (!name) {
      console.error("❌ Please provide a configuration name");
      console.log("Usage: deno run filter-geojson.ts config create <name>");
      Deno.exit(1);
    }
    
    // Check if configuration already exists
    const existing = await this.configManager.getConfiguration(name);
    if (existing) {
      console.error(`❌ Configuration '${name}' already exists`);
      Deno.exit(1);
    }
    
    // Create default configuration
    const config = this.configManager.createDefaultConfig(name);
    await this.configManager.saveConfiguration(config);
    
    console.log(`✅ Configuration '${name}' created successfully`);
    this.printConfiguration(config);
  }

  /**
   * Show a specific configuration
   */
  private async showConfiguration(name: string): Promise<void> {
    if (!name) {
      console.error("❌ Please provide a configuration name");
      console.log("Usage: deno run filter-geojson.ts config show <name>");
      Deno.exit(1);
    }
    
    const config = await this.configManager.getConfiguration(name);
    if (!config) {
      console.error(`❌ Configuration '${name}' not found`);
      Deno.exit(1);
    }
    
    console.log(`📋 Configuration: ${config.name}\n`);
    this.printConfiguration(config);
  }

  /**
   * Delete a configuration
   */
  private async deleteConfiguration(name: string): Promise<void> {
    if (!name) {
      console.error("❌ Please provide a configuration name");
      console.log("Usage: deno run filter-geojson.ts config delete <name>");
      Deno.exit(1);
    }
    
    const deleted = await this.configManager.deleteConfiguration(name);
    if (deleted) {
      console.log(`✅ Configuration '${name}' deleted successfully`);
    } else {
      console.error(`❌ Configuration '${name}' not found`);
      Deno.exit(1);
    }
  }

  /**
   * Print configuration details
   */
  private printConfiguration(config: FilterConfig): void {
    console.log(`\n📋 Configuration: ${config.name}`);
    console.log(`   States: ${config.regions.states?.join(", ") || "Any"}`);
    console.log(`   Cities: ${config.regions.cities?.join(", ") || "Any"}`);
    console.log(`   Excluded categories (${config.excludedCategories.length}):`);
    config.excludedCategories.forEach(cat => console.log(`     - ${cat}`));
    
    if (config.includedCategories && config.includedCategories.length > 0) {
      console.log(`   Included categories (${config.includedCategories.length}):`);
      config.includedCategories.forEach(cat => console.log(`     - ${cat}`));
    } else {
      console.log(`   Included categories: Any`);
    }
    
    if (config.bounds) {
      console.log(`   Bounds: [${config.bounds.south}, ${config.bounds.west}] to [${config.bounds.north}, ${config.bounds.east}]`);
    }
    console.log("");
  }

  /**
   * Show help information
   */
  private showHelp(): void {
    console.log(`
🗺️  OSM GeoJSON Filter Plugin

A standalone Deno tool for filtering large OpenStreetMap GeoJSON files.

USAGE:
  deno run --allow-read --allow-write filter-geojson.ts <mode> [options]

MODES:
  preview <file-path>           Preview file structure and validate data
  analyze <file-path>           Analyze all categories and generate statistics  
  filter <file-path> [config]   Apply filters and generate filtered output
  config <action> [options]     Manage saved configurations

EXAMPLES:
  # Preview a GeoJSON file
  deno run --allow-read --allow-write filter-geojson.ts preview data.geojson

  # Analyze categories in a file
  deno run --allow-read --allow-write filter-geojson.ts analyze data.geojson

  # Filter with default configuration
  deno run --allow-read --allow-write filter-geojson.ts filter data.geojson

  # Filter with specific configuration
  deno run --allow-read --allow-write filter-geojson.ts filter data.geojson my-config

  # List saved configurations
  deno run --allow-read --allow-write filter-geojson.ts config list

  # Create new configuration
  deno run --allow-read --allow-write filter-geojson.ts config create sp-tourism

For more information, see README.md
`);
  }

  /**
   * Show configuration help
   */
  private showConfigHelp(): void {
    console.log(`
📋 Configuration Management

ACTIONS:
  list                        List all saved configurations
  create <name>               Create a new configuration with default values
  show <name>                 Show details of a specific configuration
  delete <name>               Delete a configuration

EXAMPLES:
  deno run --allow-read --allow-write filter-geojson.ts config list
  deno run --allow-read --allow-write filter-geojson.ts config create my-config
  deno run --allow-read --allow-write filter-geojson.ts config show my-config
  deno run --allow-read --allow-write filter-geojson.ts config delete my-config
`);
  }
}

// Run the application
if (import.meta.main) {
  const app = new OSMGeoJSONFilter();
  await app.run();
}

/**
 * Configuration Manager for OSM GeoJSON Filter Plugin
 * Handles loading, saving, and managing filter configurations
 */

import { ensureDir, exists } from "@std/fs";
import { join } from "@std/path";
import { FilterConfig } from "./types.ts";

export class ConfigManager {
  private configDir: string;
  private configFile: string;

  constructor(configDir: string = "config") {
    this.configDir = configDir;
    this.configFile = join(configDir, "filter-config.json");
  }

  /**
   * Load all saved configurations
   */
  async loadConfigurations(): Promise<FilterConfig[]> {
    try {
      await ensureDir(this.configDir);
      
      if (!(await exists(this.configFile))) {
        return [];
      }

      const configText = await Deno.readTextFile(this.configFile);
      const configs = JSON.parse(configText);
      
      return Array.isArray(configs) ? configs : [];
    } catch (error) {
      console.error("Error loading configurations:", error);
      return [];
    }
  }

  /**
   * Save configurations to file
   */
  async saveConfigurations(configs: FilterConfig[]): Promise<void> {
    try {
      await ensureDir(this.configDir);
      await Deno.writeTextFile(this.configFile, JSON.stringify(configs, null, 2));
    } catch (error) {
      console.error("Error saving configurations:", error);
      throw error;
    }
  }

  /**
   * Get a specific configuration by name
   */
  async getConfiguration(name: string): Promise<FilterConfig | null> {
    const configs = await this.loadConfigurations();
    return configs.find(config => config.name === name) || null;
  }

  /**
   * Save a new configuration or update existing one
   */
  async saveConfiguration(config: FilterConfig): Promise<void> {
    const configs = await this.loadConfigurations();
    const existingIndex = configs.findIndex(c => c.name === config.name);
    
    if (existingIndex >= 0) {
      configs[existingIndex] = config;
    } else {
      configs.push(config);
    }
    
    await this.saveConfigurations(configs);
  }

  /**
   * Delete a configuration by name
   */
  async deleteConfiguration(name: string): Promise<boolean> {
    const configs = await this.loadConfigurations();
    const initialLength = configs.length;
    const filteredConfigs = configs.filter(config => config.name !== name);
    
    if (filteredConfigs.length < initialLength) {
      await this.saveConfigurations(filteredConfigs);
      return true;
    }
    
    return false;
  }

  /**
   * List all configuration names
   */
  async listConfigurationNames(): Promise<string[]> {
    const configs = await this.loadConfigurations();
    return configs.map(config => config.name);
  }

  /**
   * Create a default configuration template
   */
  createDefaultConfig(name: string): FilterConfig {
    return {
      name,
      regions: {
        states: [],
        cities: []
      },
      excludedCategories: [
        "shop",
        "amenity:parking",
        "amenity:toilets",
        "highway:residential",
        "highway:service"
      ],
      includedCategories: [
        "tourism",
        "historic",
        "natural",
        "leisure"
      ]
    };
  }

  /**
   * Validate configuration structure
   */
  validateConfiguration(config: any): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.name || typeof config.name !== "string") {
      errors.push("Configuration must have a valid name");
    }

    if (!config.regions || typeof config.regions !== "object") {
      errors.push("Configuration must have regions object");
    } else {
      if (!Array.isArray(config.regions.states)) {
        errors.push("regions.states must be an array");
      }
      if (!Array.isArray(config.regions.cities)) {
        errors.push("regions.cities must be an array");
      }
    }

    if (!Array.isArray(config.excludedCategories)) {
      errors.push("excludedCategories must be an array");
    }

    if (config.includedCategories && !Array.isArray(config.includedCategories)) {
      errors.push("includedCategories must be an array");
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}


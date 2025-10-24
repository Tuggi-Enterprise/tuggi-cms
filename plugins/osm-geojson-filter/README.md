# OSM GeoJSON Filter Plugin

A standalone Deno TypeScript plugin for filtering large OpenStreetMap GeoJSON files.

## Features

- 🔍 **Preview Mode**: Analyze file structure and validate data quality
- 📊 **Category Analysis**: Comprehensive OSM category exploration with statistics
- 🎯 **Smart Filtering**: Filter by cities, states, and exclude unwanted categories
- 🏷️ **Name Filtering**: Exclude POIs without names (configurable)
- ⚙️ **Configuration Management**: Save and reuse filter configurations
- 🚀 **Memory Efficient**: Streaming processing for large files (>200MB)
- 📈 **Data Quality Reports**: Identify invalid coordinates, duplicates, missing data

## Quick Start

```bash
# Preview the GeoJSON file structure
deno run --allow-read --allow-write filter-geojson.ts preview

# Analyze all categories and generate statistics
deno run --allow-read --allow-write filter-geojson.ts analyze

# Apply filters and generate filtered output
deno run --allow-read --allow-write filter-geojson.ts filter

# Manage saved configurations
deno run --allow-read --allow-write filter-geojson.ts config
```

## Installation

This is a standalone plugin. Simply copy the folder to your project and run with Deno.

### Prerequisites

- Deno 1.40+ installed
- Large GeoJSON file from OpenStreetMap data

## Usage

### 1. Preview Mode
```bash
deno run --allow-read --allow-write filter-geojson.ts preview
```
- Shows first 10-20 POIs to understand data structure
- Displays available OSM tags and properties
- Reports data quality issues
- Identifies potential duplicates

### 2. Analyze Mode
```bash
deno run --allow-read --allow-write filter-geojson.ts analyze
```
- Scans entire GeoJSON and catalogs all categories
- Generates comprehensive statistics report
- Shows geographic distribution
- Identifies most common OSM tags

### 3. Filter Mode
```bash
deno run --allow-read --allow-write filter-geojson.ts filter
```
- Load or create filter configuration
- Apply region and category filters
- Generate filtered GeoJSON output
- Show processing statistics

### 4. Config Mode
```bash
deno run --allow-read --allow-write filter-geojson.ts config
```
- List saved configurations
- Create/edit/delete configurations
- Manage filter presets

## Configuration

Filter configurations are saved in `config/filter-config.json`:

```json
{
  "name": "sp-tourism",
  "regions": {
    "states": ["São Paulo"],
    "cities": ["Bragança Paulista", "Atibaia"]
  },
  "excludedCategories": ["shop", "amenity:parking", "shop:*"],
  "includedCategories": ["tourism", "historic", "natural"]
}
```

## Output Files

- `output/preview-{timestamp}.txt` - File structure preview
- `output/category-analysis-{timestamp}.txt` - Category statistics
- `output/filtered-{config-name}-{timestamp}.geojson` - Filtered GeoJSON

## Architecture

```
plugins/osm-geojson-filter/
├── filter-geojson.ts          # Main CLI script
├── lib/
│   ├── geojson-reader.ts      # Streaming GeoJSON parser
│   ├── geojson-preview.ts     # File preview and validation
│   ├── category-analyzer.ts   # Enhanced category analysis
│   ├── filters.ts             # Filtering logic
│   └── config-manager.ts      # Configuration management
├── config/
│   └── filter-config.json     # Saved configurations
└── output/                    # Generated reports and files
```

## License

MIT License - Feel free to use and modify.


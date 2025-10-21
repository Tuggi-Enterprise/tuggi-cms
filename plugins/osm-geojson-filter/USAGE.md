# OSM GeoJSON Filter - Usage Guide

## Quick Start

### 1. Preview Your GeoJSON File
```bash
# From project root
npm run osm:preview omsData/sudeste-251012.geojson

# Or directly with Deno
deno run --allow-read --allow-write filter-geojson.ts preview omsData/sudeste-251012.geojson
```

### 2. Analyze Categories
```bash
# Analyze all categories and generate statistics
npm run osm:analyze omsData/sudeste-251012.geojson
```

### 3. Create Filter Configuration
```bash
# Create a new configuration
npm run osm:config create sp-tourism

# List existing configurations
npm run osm:config list

# Show configuration details
npm run osm:config show sp-tourism
```

### 4. Apply Filters
```bash
# Filter with default configuration
npm run osm:filter omsData/sudeste-251012.geojson

# Filter with specific configuration
npm run osm:filter omsData/sudeste-251012.geojson sp-tourism
```

## Configuration Examples

### Tourism Focus (São Paulo)
```json
{
  "name": "sp-tourism",
  "regions": {
    "states": ["São Paulo"],
    "cities": ["Bragança Paulista", "Atibaia", "São Paulo"]
  },
  "excludedCategories": [
    "shop",
    "amenity:parking",
    "amenity:toilets",
    "highway:residential",
    "highway:service"
  ],
  "includedCategories": [
    "tourism",
    "historic",
    "natural",
    "leisure"
  ]
}
```

### Historic Sites Only
```json
{
  "name": "historic-only",
  "regions": {
    "states": ["São Paulo", "Rio de Janeiro", "Minas Gerais"]
  },
  "excludedCategories": [
    "shop:*",
    "amenity:*",
    "highway:*",
    "natural:*"
  ],
  "includedCategories": [
    "historic"
  ]
}
```

### Natural Features
```json
{
  "name": "natural-features",
  "regions": {
    "states": ["São Paulo"]
  },
  "excludedCategories": [
    "shop:*",
    "amenity:*",
    "highway:*",
    "tourism:*"
  ],
  "includedCategories": [
    "natural"
  ]
}
```

## Category Patterns

### Exact Match
```
"tourism=museum"     # Matches only tourism=museum
"amenity=parking"    # Matches only amenity=parking
```

### Prefix Match
```
"shop:*"             # Matches shop=bakery, shop=supermarket, etc.
"tourism:*"          # Matches tourism=museum, tourism=hotel, etc.
```

### Multiple Tags
```
"tourism=hotel,tourism=motel"  # Matches either tourism=hotel OR tourism=motel
```

### Base Category
```
"shop"               # Matches any shop-related POI
"tourism"            # Matches any tourism-related POI
```

## Output Files

All output files are saved in the `output/` directory:

- `preview-{timestamp}.txt` - File structure preview
- `category-analysis-{timestamp}.txt` - Detailed category statistics
- `filtered-{config-name}-{timestamp}.geojson` - Filtered GeoJSON output

## Performance Tips

1. **Start with Preview**: Always preview your file first to understand the data structure
2. **Analyze Categories**: Use analyze mode to see what categories exist before filtering
3. **Test with Small Files**: Test your configurations with smaller GeoJSON files first
4. **Memory Usage**: The tool is optimized for large files (>200MB) with streaming processing

## Troubleshooting

### Common Issues

1. **File Not Found**: Make sure the GeoJSON file path is correct
2. **Permission Denied**: Ensure Deno has read/write permissions
3. **Invalid GeoJSON**: The tool validates GeoJSON structure and will report errors
4. **Memory Issues**: For very large files, the streaming approach should handle them efficiently

### Getting Help

```bash
# Show help
deno run --allow-read --allow-write filter-geojson.ts

# Show configuration help
deno run --allow-read --allow-write filter-geojson.ts config
```

## Integration with Tuggi CMS

This plugin is designed to work alongside your existing Tuggi CMS project:

1. **Filter OSM Data**: Use this tool to filter large OSM GeoJSON files
2. **Review Results**: Check the filtered output before importing
3. **Import to Database**: Use your existing POI import services to load filtered data
4. **Process with AI**: Use your existing description and trigger points services

The filtered GeoJSON files can be processed by your existing `POIImportService` and other services in the Tuggi CMS project.


# GeoJSON OSM Data Filter Tool

## Overview

Create a modular Deno TypeScript tool to process the large `sudeste-251012.geojson` file (>200MB), enabling filtering by cities/states, category exploration, and selective exclusion of POI categories.

## Implementation Steps

### 1. Project Structure Setup

Create organized folder structure in `scripts/osm-data-processing/`:

```
scripts/osm-data-processing/
├── filter-geojson.ts          # Main CLI script
├── lib/
│   ├── geojson-reader.ts      # Streaming GeoJSON parser
│   ├── geojson-preview.ts     # File preview and validation
│   ├── category-analyzer.ts   # Enhanced category discovery and stats
│   ├── filters.ts             # City/state/category filtering logic
│   └── config-manager.ts      # Config file persistence
├── config/
│   └── filter-config.json     # Saved filter configurations
└── output/                    # Filtered GeoJSON outputs and reports
```

### 2. Configuration Management

Create `config-manager.ts` to handle persistent configuration:

- Load/save filter configurations (cities, states, excluded categories)
- Support multiple named configurations
- JSON-based storage for easy modification

Configuration structure:

```typescript
{
  "name": "sp-tourism",
  "regions": {
    "states": ["São Paulo"],
    "cities": ["Bragança Paulista", "Atibaia"]
  },
  "excludedCategories": ["shop", "amenity:parking"],
  "includedCategories": ["tourism", "historic", "natural"]
}
```

### 3. GeoJSON Preview & Validation

Create `geojson-preview.ts` to analyze file structure before processing:

- **Preview Mode**: Show first 10-20 POIs to understand data structure
- **Structure Analysis**: Identify available OSM tags and properties
- **Data Validation**: Detect POIs with invalid coordinates, missing names, or incomplete data
- **Duplicate Detection**: Find POIs with identical coordinates or names within the file

Key files to reference:

- `omsData/sudeste-251012.geojson` (input file)

### 4. Streaming GeoJSON Reader

Implement `geojson-reader.ts` for memory-efficient processing:

- Use streaming API to handle 200MB+ file without loading entirely into memory
- Parse features incrementally
- Yield features one-by-one for filtering
- Include validation checks during streaming

### 5. Enhanced Category Analysis Tool

Create `category-analyzer.ts` to explore OSM categories with detailed statistics:

- Scan entire GeoJSON and catalog all unique categories
- Count POIs per category
- **Geographic Distribution**: Count POIs per city/state
- **Tag Analysis**: Most common OSM tags and their frequency
- **Data Quality Metrics**: POIs with/without names, valid coordinates
- Generate comprehensive statistics report showing:
  - Category name and POI count
  - Sample POI names (first 3-5)
  - OSM tags present
  - Geographic distribution (top cities/states)
  - Data quality indicators

Output example:

```
Category Analysis Report
========================
tourism=museum: 145 POIs
 - Museu Histórico de Bragança Paulista
 - Museu do Café
  ...
 Geographic Distribution:
   - São Paulo: 89 POIs
   - Rio de Janeiro: 34 POIs
   - Minas Gerais: 22 POIs
 Data Quality: 98% have names, 100% valid coordinates

historic=monument: 89 POIs
natural=peak: 234 POIs

Most Common OSM Tags:
- tourism: 1,234 POIs
- amenity: 987 POIs
- historic: 456 POIs
```

### 6. Filtering Logic

Implement `filters.ts` with modular filter functions:

**Core Functions:**

- `filterByRegion()`: Match city or state from OSM tags
- `filterByCategory()`: Include/exclude based on category rules
- `excludePOIsByCategory()`: **Main exclusion function** - Remove POIs matching excluded categories
- `filterByBounds()`: Optional geographic boundary filtering
- Composable filter chain for flexibility

**Category Exclusion Logic:**

The `excludePOIsByCategory()` function will support multiple exclusion patterns:

```typescript
// Exact match: "shop"
// Prefix match: "shop:*" (excludes shop:bakery, shop:supermarket, etc)
// Tag-value match: "amenity=parking"
// Multiple tags: "tourism=hotel,tourism=motel"
```

**Exclusion Priority:**

1. Check if POI matches any excluded category pattern
2. If excluded, skip POI completely
3. If not excluded, check against included categories (if specified)
4. Apply region filters last

This ensures maximum flexibility for filtering out unwanted POI categories like parking lots, generic shops, etc.

### 7. Main CLI Script

Create `filter-geojson.ts` with interactive workflow:

1. **Mode Selection**:
   - "preview" - **NEW**: Preview file structure and validate data
   - "analyze" - Explore all categories with enhanced statistics
   - "filter" - Apply filters and generate output
   - "config" - Manage saved configurations

2. **Preview Mode** (NEW):
   - Show first 10-20 POIs to understand data structure
   - Display available OSM tags and properties
   - Report data quality issues (invalid coordinates, missing names)
   - Identify potential duplicates
   - Save preview report to `output/preview-{timestamp}.txt`

3. **Analyze Mode** (Enhanced):
   - Scan GeoJSON and generate comprehensive category report
   - Include geographic distribution and data quality metrics
   - Save detailed report to `output/category-analysis-{timestamp}.txt`

4. **Filter Mode**:
   - Load or create configuration
   - Apply filters with progress indicator
   - Generate filtered GeoJSON output
   - Show statistics (original count vs filtered count)

5. **Config Mode**:
   - List saved configurations
   - Create/edit/delete configurations

### 8. NPM Script Integration

Add to `package.json`:

```json
"osm:preview": "deno run --allow-read --allow-write scripts/osm-data-processing/filter-geojson.ts preview",
"osm:analyze": "deno run --allow-read --allow-write scripts/osm-data-processing/filter-geojson.ts analyze",
"osm:filter": "deno run --allow-read --allow-write scripts/osm-data-processing/filter-geojson.ts filter",
"osm:config": "deno run --allow-read --allow-write scripts/osm-data-processing/filter-geojson.ts config"
```

### 9. Testing & Validation

- Test with small GeoJSON sample first
- Validate output GeoJSON structure
- Verify category analysis accuracy
- Test configuration persistence

## Key Technical Decisions

1. **Deno over Node.js**: 

                                                                                                - Native TypeScript support
                                                                                                - Built-in streaming APIs
                                                                                                - Consistent with Supabase Edge Functions
                                                                                                - Better performance for large file processing

2. **Streaming over full load**:

                                                                                                - Memory-efficient for 200MB+ files
                                                                                                - Enables progress tracking
                                                                                                - Faster startup time

3. **JSON config files**:

                                                                                                - Easy to edit manually if needed
                                                                                                - Version control friendly
                                                                                                - Human-readable

## Future Extensions (Not in this phase)

- Database upload to `core.attractions` and `core.attraction_coordinate`
- Duplicate detection against existing POIs
- Batch import with review workflow
- OSM enrichment integration with existing services

## Files to Reference

- `omsData/sudeste-251012.geojson` - Source data
- `lib/services/poi-import-service.ts` - For future database integration patterns
- `scripts/poi-name-validation.ts` - Example CLI structure
- `supabase/migrations/add-osm-enrichment-fields.sql` - Target database schema

## Success Criteria

- Can preview and validate 200MB+ GeoJSON file structure
- Can analyze 200MB+ GeoJSON file and generate comprehensive category report
- Can filter by cities/states dynamically
- Can exclude specific categories with flexible patterns
- Configurations persist between runs
- Output is valid GeoJSON ready for review
- Memory usage remains reasonable (<500MB)
- Data quality issues are identified and reported
- Geographic distribution analysis is available
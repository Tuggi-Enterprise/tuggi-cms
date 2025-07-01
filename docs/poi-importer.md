# POI Importer Documentation

## Overview

The POI Importer is a comprehensive tool for searching and importing Points of Interest (POIs) into the Tuggi CMS using Google Maps polygon area definition and Google Places API integration.

## Enhanced Features (v2.0)

### 🎨 **Enhanced User Experience**
- **70% Map Focus**: Main map takes 75% of the screen width for better polygon drawing experience
- **Summary Dashboard**: Real-time statistics showing saved polygons, POIs found, and import count
- **Smart Color Coding**: 
  - 🟠 Orange markers for new/unselected POIs 
  - 🔵 Blue markers for selected POIs
  - ⚫ Gray markers for already imported POIs
- **First-time User Guidance**: Interactive tooltip with step-by-step instructions
- **Enhanced Results Panel**: Dedicated 25% width panel with thumbnail previews

### 🗺️ **Advanced Polygon Management**
- **Dropdown Selector**: Streamlined saved polygons access via dropdown instead of sidebar
- **Polygon Statistics**: Real-time display of vertices count and area in km²
- **Country Selection**: Optional country selector for better import metadata
- **Visual Feedback**: Polygon area calculation and vertex count display

### 🔍 **Enhanced Search & Import Workflow**

#### Step 1: Area Definition
1. **Draw Polygon**: Use Google Maps drawing tools to define search area
2. **Save Polygon**: Name your polygon and optionally specify country
3. **Load Existing**: Select from previously saved polygons via dropdown

#### Step 2: POI Search
1. **Select POI Type**: Choose from 15 different POI categories
2. **Search Within Polygon**: Click "Search POIs" to find places within the area
3. **View Results**: Results appear in the dedicated panel with thumbnails and metadata

#### Step 3: Import Management
1. **Select POIs**: Click on POIs in the results panel to select/deselect
2. **Visual Feedback**: Selected POIs highlighted in blue, existing ones grayed out
3. **Bulk Import**: Import all selected POIs with enhanced metadata

### 📊 **POI Types Supported**
- Tourist Attractions
- Museums
- Churches & Religious Sites
- Parks & Recreation
- Restaurants
- Shopping Centers
- Art Galleries
- Amusement Parks
- Zoos & Aquariums
- Libraries & Universities
- Stadiums & Sports Venues
- Spas & Wellness
- General Points of Interest

## Technical Implementation

### Database Integration
- **Saved Polygons**: `core.saved_polygons` table with GeoJSON geometry
- **POI Storage**: `core.attractions` with enhanced metadata
- **Coordinates**: `core.attraction_coordinate` for precise location data
- **Images**: Photo proxy integration for thumbnail and main images

### Google Services Integration
- **Maps JavaScript API**: For interactive map and polygon drawing
- **Places API**: For POI search within polygon areas
- **Places Details API**: For comprehensive POI metadata
- **Photo Proxy**: Supabase Edge Function for image processing

### Enhanced Data Flow
1. **Polygon Creation**: User draws polygon → Calculate area/vertices → Save to database
2. **POI Search**: Google Places API search within polygon bounds
3. **Duplicate Prevention**: Check existing POIs using `google_place_id`
4. **Enhanced Import**: Places Details API + Photo Proxy + Metadata enrichment

## Advanced Features

### 🎯 **Smart Search Results**
- **Thumbnail Previews**: Google Places photos displayed as thumbnails
- **Existing POI Detection**: Prevents duplicate imports with visual indicators
- **Enhanced Metadata**: Ratings, addresses, categories, and descriptions
- **Selection Management**: Multi-select with visual feedback

### 🛠️ **Developer Features**
- **Mock Service**: Fallback service when API key is not available
- **Error Handling**: Comprehensive error management and user feedback
- **Loading States**: Visual feedback during search and import operations
- **TypeScript Support**: Full type safety with enhanced interfaces

### 🎨 **Tuggi Branding**
- **Primary Color**: `#00A8E8` (Tuggi Blue) for main actions
- **Secondary Color**: `#FF6F00` (Tuggi Orange) for highlights and markers
- **Background**: `#F7F9FA` for optimal contrast
- **Consistent Typography**: Tuggi brand font and styling throughout

## Environment Setup

```bash
# Required environment variables
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_api_key

# Required Google APIs
- Maps JavaScript API
- Places API
- Places Details API (optional for enhanced metadata)

# Required Permissions
- Geometry Library
- Drawing Library
- Places Library
```

## Usage Examples

### Basic Workflow
1. Navigate to `/poi-importer`
2. Draw a polygon on the map around your desired area
3. Enter a polygon name and optionally select a country
4. Click "Save Polygon" to store for future use
5. Select a POI type from the dropdown
6. Click "Search POIs" to find places within the polygon
7. Review results in the side panel with thumbnails
8. Select desired POIs by clicking on them
9. Click "Import Selected" to add them to your database

### Advanced Features
- **Load Saved Polygons**: Use the dropdown to quickly load previously saved areas
- **Bulk Operations**: Select multiple POIs and import them all at once
- **Visual Filtering**: Easily identify new vs. existing POIs through color coding
- **Metadata Enrichment**: Automatic city/country detection and photo integration

## Troubleshooting

### Common Issues
1. **Map Not Loading**: Verify `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is set
2. **POI Search Failing**: Check Google Places API quota and permissions
3. **Photo Import Issues**: Verify Supabase Edge Function is deployed
4. **Polygon Save Errors**: Check Supabase connection and database permissions

### Performance Optimization
- Search results are limited to prevent API quota exhaustion
- Existing POI checks are performed efficiently with database indexing
- Photo thumbnails are cached for better loading performance
- Polygon area calculations use optimized algorithms

## API Reference

### Enhanced Interfaces
```typescript
interface EnhancedPlaceResult extends PlaceSearchResult {
  thumbnail?: string
  isSelected: boolean
  alreadyExists: boolean
}

interface PolygonStats {
  vertices: number
  area: number // in km²
}
```

### Enhanced Functions
- `calculatePolygonArea()`: Real-time area calculation
- `checkExistingPOIs()`: Duplicate detection
- `getSelectedPlaces()`: Selection management
- `loadPolygon()`: Enhanced polygon loading with stats

## Future Enhancements
- **AI-Generated Descriptions**: Automatic POI descriptions using OpenAI
- **Batch Processing**: Import from CSV/Excel files
- **Advanced Filtering**: Filter POIs by rating, distance, or custom criteria
- **Export Functionality**: Export search results to various formats
- **Analytics Dashboard**: POI import statistics and insights

---

*Last Updated: June 2025 - Version 2.0 with Enhanced UX* 
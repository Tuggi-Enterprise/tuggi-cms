# Trigger Points - Generation Process

## 🔄 Complete Generation Flow

The trigger point generation process consists of several interconnected steps that work together to create optimal trigger points for POIs.

## 📋 Step-by-Step Process

### 1. POI Selection & Filtering

**Input**: User-selected filters and POIs
**Process**:
```javascript
// Filter criteria
const filters = {
  country: "Brazil",
  state: "São Paulo", // Optional
  city: "Campinas",   // Optional
  processing_type: "without_trigger_points",
  limit: 50
}
```

**Output**: List of POIs ready for processing

### 2. Boundary Detection

**Objective**: Determine the physical boundaries of each POI

#### 2.1 OpenStreetMap Boundary Search
```javascript
// Primary search strategies
1. OSM Nominatim Search (by name + coordinates)
2. OSM Reverse Geocoding (by coordinates)
3. OSM Nearby Features (within radius)
4. Unified Overpass Query (boundaries + streets)
```

#### 2.2 Boundary Processing
- **Validation**: Ensure boundary matches POI location
- **Simplification**: Reduce complexity for performance
- **Area Calculation**: Determine POI size for strategy selection

#### 2.3 Fallback Strategy
If OSM boundary not found:
```javascript
// Create estimated circular boundary
const estimatedRadius = calculateEstimatedRadius(poiType, urbanDensity);
const boundary = createCircularBoundary(lat, lng, estimatedRadius);
```

### 3. Street Analysis

**Objective**: Find accessible streets around the POI

#### 3.1 Unified Overpass Query
Single API call to get:
- POI boundaries
- Major streets (within 1.5km)
- Medium streets (within 1km)  
- Minor streets (within 800m)
- Immediate streets (within 80m)

#### 3.2 Street Processing
```javascript
// Street confidence calculation
const streetConfidence = calculateStreetConfidence({
  roadType: street.highway,
  accessibility: street.access,
  distanceFromPOI: distance,
  streetWidth: estimatedWidth
});
```

#### 3.3 Strategic Point Selection
- **Closest Points**: Find nearest accessible points on each street
- **Bearing Analysis**: Calculate viewing angles to POI
- **Distance Optimization**: Balance visibility and accessibility

### 4. Trigger Point Generation

**Objective**: Create optimal trigger points on selected streets

#### 4.1 Point Calculation
```javascript
// For each strategic street location
const triggerPoint = {
  lat: streetPoint.lat,
  lng: streetPoint.lng,
  radius_meters: calculateOptimalRadius(distance, poiType),
  expected_bearing: calculateBearing(streetPoint, poiCenter),
  bearing_threshold: 30,
  type: determineTriggerType(confidence, priority),
  confidence: streetConfidence,
  distance_from_poi: distanceToPoI
};
```

#### 4.2 Type Assignment
- **Primary**: Best viewpoints, highest confidence (>0.8)
- **Secondary**: Good alternatives, medium confidence (0.6-0.8)
- **Fallback**: Backup options, lower confidence (0.4-0.6)

### 5. Quality Scoring

**Objective**: Assess overall quality of generated trigger points

#### 5.1 POI Confidence Score Calculation
```javascript
const poiConfidence = calculatePOIConfidenceScore({
  boundaryQuality: boundary.confidence * 0.4,
  dataSourceBonus: getSourceBonus(boundarySource) * 0.2,
  triggerPointsQuality: avgTriggerConfidence * 0.3,
  coverageScore: calculateCoverage(triggerPoints, boundary) * 0.1
});
```

#### 5.2 Individual Trigger Point Scoring
```javascript
const triggerScore = {
  street_confidence: streetAccessibilityScore,
  distance_optimization: distanceOptimizationScore,
  visibility_score: visibilityAnalysisScore,
  bearing_quality: bearingOptimizationScore
};
```

### 6. Validation & Deduplication

**Objective**: Ensure quality and prevent duplicates

#### 6.1 Duplicate Detection
```javascript
// Check for existing trigger points within radius
const isDuplicate = existingTPs.some(tp => 
  calculateDistance(newTP, tp) < DUPLICATE_THRESHOLD
);
```

#### 6.2 Quality Validation
- **Minimum Confidence**: Remove triggers below threshold (0.3)
- **Accessibility Check**: Ensure points are on accessible streets
- **Safety Validation**: Avoid highways, restricted areas

#### 6.3 Coverage Analysis
- **Area Coverage**: Ensure adequate spatial distribution
- **Approach Diversity**: Cover multiple approach routes
- **Redundancy Removal**: Remove unnecessary overlapping points

### 7. Database Storage

**Objective**: Save validated trigger points to database

#### 7.1 Data Preparation
```javascript
const triggerPointData = {
  attraction_id: poiId,
  location: `POINT(${tp.lng} ${tp.lat})`,
  radius_meters: tp.radius_meters,
  expected_bearing: tp.expected_bearing,
  bearing_threshold: 30,
  type: tp.type,
  priority: getPriority(tp.type),
  confidence_score: tp.confidence,
  auto_status: calculateAutoStatus(tp.confidence),
  manual_status: 'pending',
  final_status: calculateFinalStatus(auto_status, manual_status),
  score_factors: tp.score_factors,
  generation_method: 'boundary_offset_strategy',
  validation_notes: tp.reasoning,
  access: 'both',
  is_active: true
};
```

#### 7.2 Batch Insert
```javascript
// Insert all trigger points for POI in single transaction
const { data, error } = await supabase
  .schema('core')
  .from('attraction_trigger_points')
  .insert(triggerPointsData);
```

#### 7.3 Metadata Update
```javascript
// Update POI with generation metadata
await updateAttractionMetadata(poiId, {
  poi_height: heightData,
  urban_density: densityData,
  boundary_source: boundarySource,
  generation_strategy: strategy,
  last_tp_generation_at: new Date(),
  tp_generation_metadata: processingMetadata
});
```

## 🔧 Configuration Parameters

### Distance Thresholds
```javascript
const DISTANCE_THRESHOLDS = {
  DUPLICATE_DETECTION: 25,        // meters
  MIN_STREET_DISTANCE: 10,       // meters
  MAX_TRIGGER_DISTANCE: 500,     // meters
  OPTIMAL_VIEWING_DISTANCE: 100  // meters
};
```

### Quality Thresholds
```javascript
const QUALITY_THRESHOLDS = {
  AUTO_APPROVE: 0.75,    // Auto-approve threshold
  MANUAL_REVIEW: 0.50,   // Manual review threshold
  AUTO_REJECT: 0.30,     // Auto-reject threshold
  MIN_CONFIDENCE: 0.20   // Minimum to save
};
```

### Processing Limits
```javascript
const PROCESSING_LIMITS = {
  MAX_BATCH_SIZE: 50,           // POIs per batch
  MAX_TRIGGERS_PER_POI: 20,     // Trigger points per POI
  API_DELAY: 3000,              // ms between API calls
  TIMEOUT_DURATION: 30000       // ms per POI processing
};
```

## 🚨 Error Handling

### API Failures
- **OpenStreetMap API**: Retry with exponential backoff
- **Rate Limiting**: Respect API limits, queue requests
- **Network Errors**: Graceful degradation to fallback methods

### Data Validation Errors
- **Invalid Coordinates**: Skip POI, log error
- **Boundary Issues**: Fall back to estimated boundary
- **Street Data Missing**: Use basic circular triggers

### Database Errors
- **Constraint Violations**: Validate data before insert
- **Connection Issues**: Retry with connection pooling
- **Transaction Failures**: Rollback and retry

## 📊 Performance Optimization

### Caching Strategy
- **OSM Data**: Cache boundary and street data
- **Elevation Data**: Cache height calculations
- **Urban Density**: Cache density classifications

### Batch Processing
- **Parallel Processing**: Process multiple POIs simultaneously
- **API Batching**: Combine multiple requests where possible
- **Database Batching**: Insert multiple trigger points together

### Memory Management
- **Stream Processing**: Process large datasets in chunks
- **Garbage Collection**: Clean up temporary data structures
- **Resource Limits**: Monitor and limit memory usage

---

## 🔗 Related Documentation

- [Database Schema](./03-database-schema.md) - Data structure details
- [API Documentation](./04-api-documentation.md) - Endpoint specifications
- [Algorithms](./06-algorithms.md) - Mathematical calculations

# Trigger Points - API Documentation

## 🔌 API Overview

The Trigger Points API provides endpoints for generating, managing, and querying trigger points. All endpoints require authentication and follow REST conventions.

## 🛡️ Authentication

All API endpoints require authentication:
- **CMS Users**: Session-based authentication
- **External Services**: Service role token
- **Mobile Apps**: User JWT token

```javascript
// Example headers
const headers = {
  'Authorization': 'Bearer <jwt-token>',
  'Content-Type': 'application/json'
};
```

## 📍 Core Endpoints

### 1. List POIs for Generation

Get POIs that can have trigger points generated.

**Endpoint**: `GET /api/trigger-points/list-for-generation`

**Query Parameters**:
```typescript
interface ListParams {
  country?: string;           // Filter by country
  state?: string;            // Filter by state  
  city?: string;             // Filter by city
  processing_type?: string;   // Type of processing needed
  limit?: number;            // Max results (default: 50)
}
```

**Processing Types**:
- `without_trigger_points` - POIs with no trigger points
- `with_few_trigger_points` - POIs with <3 trigger points
- `all_approved` - All approved POIs
- `needs_update` - POIs not processed in 30 days

**Example Request**:
```bash
GET /api/trigger-points/list-for-generation?country=Brazil&state=São%20Paulo&limit=25
```

**Response**:
```typescript
interface ListResponse {
  success: boolean;
  pois: POI[];
  total: number;
  filters: {
    country?: string;
    state?: string;
    city?: string;
    processing_type: string;
    limit: number;
  };
}

interface POI {
  id: string;
  name: string;
  city: string;
  state?: string;
  country: string;
  google_place_id?: string;
  osm_category?: string;
  heritage_status?: string;
  trigger_points_count?: number;
  last_processed?: string;
}
```

### 2. Generate Trigger Points (Batch)

Generate trigger points for multiple POIs.

**Endpoint**: `POST /api/trigger-points/generate-batch`

**Request Body**:
```typescript
interface BatchRequest {
  attraction_ids?: string[];  // Specific POI IDs (optional)
  country?: string;          // Filter by country
  city?: string;             // Filter by city
  batch_size?: number;       // Max POIs to process (default: 50)
}
```

**Example Request**:
```bash
POST /api/trigger-points/generate-batch
Content-Type: application/json

{
  "attraction_ids": ["poi-uuid-1", "poi-uuid-2"],
  "batch_size": 10
}
```

**Response**:
```typescript
interface BatchResponse {
  success: boolean;
  processed: number;
  successful: number;
  failed: number;
  errors: Array<{
    attraction_id: string;
    attraction_name: string;
    error: string;
  }>;
  summary: {
    approved_tps: number;
    review_tps: number;
    rejected_tps: number;
  };
  results: GenerationResult[];
}

interface GenerationResult {
  poi_id: string;
  poi_name: string;
  success: boolean;
  message: string;
  trigger_points_generated: number;
  trigger_points_saved: number;
  trigger_points_skipped: number;
  boundary_source?: string;
  processing_time?: number;
  errors?: string[];
}
```

### 3. Create Single Trigger Point

Create a single trigger point manually.

**Endpoint**: `POST /api/trigger-points/create`

**Request Body**:
```typescript
interface CreateRequest {
  attraction_id: string;
  lat: number;
  lng: number;
  radius_meters?: number;      // Default: 50
  expected_bearing?: number;   // 0-360 degrees
  bearing_threshold?: number;  // Default: 30
  type?: string;              // Default: 'primary'
  priority?: number;          // Default: 1
  is_active?: boolean;        // Default: true
  direction?: string;         // 'front', 'right', 'left', 'back'
  access?: string;            // Default: 'both'
  name?: string;
  description?: string;
}
```

**Example Request**:
```bash
POST /api/trigger-points/create
Content-Type: application/json

{
  "attraction_id": "poi-uuid",
  "lat": -22.9068,
  "lng": -47.0608,
  "radius_meters": 30,
  "type": "primary",
  "direction": "front",
  "name": "Main Entrance View"
}
```

**Response**:
```typescript
interface CreateResponse {
  success: boolean;
  data?: {
    id: string;
    attraction_id: string;
    location: string;
    // ... other trigger point fields
  };
  error?: string;
}
```

### 4. Update Trigger Point

Update an existing trigger point.

**Endpoint**: `POST /api/trigger-points/update`

**Request Body**:
```typescript
interface UpdateRequest {
  trigger_point_id: string;   // Required
  lat?: number;
  lng?: number;
  radius_meters?: number;
  expected_bearing?: number;
  bearing_threshold?: number;
  type?: string;
  priority?: number;
  is_active?: boolean;
  direction?: string;
  access?: string;
  name?: string;
  description?: string;
}
```

**Response**: Same as Create Response

## 🔍 Query Endpoints

### 5. Get Trigger Points by Location

Find trigger points near a specific location.

**Endpoint**: `GET /api/trigger-points/nearby`

**Query Parameters**:
```typescript
interface NearbyParams {
  lat: number;               // Required
  lng: number;               // Required
  radius?: number;           // Search radius in meters (default: 1000)
  access?: string;           // Filter by access type
  status?: string;           // Filter by final_status
  limit?: number;            // Max results (default: 20)
}
```

**Example Request**:
```bash
GET /api/trigger-points/nearby?lat=-22.9068&lng=-47.0608&radius=500&access=both
```

**Response**:
```typescript
interface NearbyResponse {
  success: boolean;
  trigger_points: TriggerPoint[];
  total: number;
  center: {
    lat: number;
    lng: number;
  };
  radius: number;
}

interface TriggerPoint {
  id: string;
  attraction_id: string;
  attraction_name: string;
  lat: number;
  lng: number;
  radius_meters: number;
  expected_bearing?: number;
  bearing_threshold: number;
  type: string;
  priority: number;
  confidence_score?: number;
  final_status: string;
  access: string;
  direction?: string;
  distance_from_query: number; // Distance from query point
}
```

### 6. Get Trigger Points for POI

Get all trigger points for a specific POI.

**Endpoint**: `GET /api/trigger-points/by-poi/{attraction_id}`

**Query Parameters**:
```typescript
interface ByPOIParams {
  include_inactive?: boolean; // Include inactive trigger points
  status?: string;            // Filter by final_status
}
```

**Response**:
```typescript
interface ByPOIResponse {
  success: boolean;
  attraction_id: string;
  attraction_name: string;
  trigger_points: TriggerPoint[];
  summary: {
    total: number;
    active: number;
    by_status: Record<string, number>;
    by_type: Record<string, number>;
  };
}
```

## 🌍 Location Endpoints

### 7. Countries, states and cities — removed (CARD-CMS-01, 2026-08-05)

`GET /api/locations/countries-cities` and `GET /api/states` no longer exist. They had
no caller: the CMS reads the location taxonomy through the `cms_get_countries`,
`cms_get_states` and `cms_get_cities` RPCs, wrapped by
`lib/core/location-service.ts`. Use that service.

## 🔧 Utility Endpoints

### 9. Vision Analysis

Analyze map imagery to suggest trigger points (experimental).

**Endpoint**: `POST /api/trigger-points/vision-analysis`

**Request Body**:
```typescript
interface VisionRequest {
  attraction_id: string;
  lat: number;
  lng: number;
  zoom?: number;              // Map zoom level (default: 18)
  high_resolution?: boolean;  // Use high-res imagery (default: false)
}
```

**Response**:
```typescript
interface VisionResponse {
  success: boolean;
  suggestions: Array<{
    lat: number;
    lng: number;
    confidence: number;
    reasoning: string;
    type: string;
  }>;
  analysis: {
    map_quality: string;
    visibility_factors: string[];
    recommendations: string[];
  };
}
```

## 📊 Statistics Endpoints

### 10. Generation Statistics

Get statistics about trigger point generation.

**Endpoint**: `GET /api/trigger-points/stats`

**Query Parameters**:
```typescript
interface StatsParams {
  country?: string;
  state?: string;
  city?: string;
  date_from?: string; // ISO date
  date_to?: string;   // ISO date
}
```

**Response**:
```typescript
interface StatsResponse {
  success: boolean;
  period: {
    from: string;
    to: string;
  };
  totals: {
    trigger_points: number;
    pois_with_tps: number;
    avg_tps_per_poi: number;
  };
  quality: {
    approved: number;
    review: number;
    rejected: number;
    avg_confidence: number;
  };
  geographic: {
    countries: number;
    states: number;
    cities: number;
  };
  generation_methods: Record<string, number>;
}
```

## 🚨 Error Handling

### Standard Error Response

```typescript
interface ErrorResponse {
  success: false;
  error: string;
  details?: string;
  code?: string;
}
```

### Common Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid request parameters |
| `UNAUTHORIZED` | 401 | Authentication required |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `RATE_LIMITED` | 429 | Too many requests |
| `PROCESSING_ERROR` | 500 | Internal processing error |
| `DATABASE_ERROR` | 500 | Database operation failed |
| `EXTERNAL_API_ERROR` | 502 | External service unavailable |

### Example Error Response

```json
{
  "success": false,
  "error": "Invalid coordinates provided",
  "details": "Latitude must be between -90 and 90",
  "code": "VALIDATION_ERROR"
}
```

## 🔄 Rate Limiting

### Limits per Endpoint

| Endpoint | Limit | Window |
|----------|-------|--------|
| Generation endpoints | 10 requests | 1 minute |
| Query endpoints | 100 requests | 1 minute |
| Create/Update | 50 requests | 1 minute |
| Statistics | 20 requests | 1 minute |

### Rate Limit Headers

```
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 7
X-RateLimit-Reset: 1640995200
```

## 📝 Usage Examples

### Complete Generation Workflow

```javascript
// 1. Get POIs needing trigger points
const poisResponse = await fetch('/api/trigger-points/list-for-generation?country=Brazil&processing_type=without_trigger_points&limit=10');
const { pois } = await poisResponse.json();

// 2. Generate trigger points for selected POIs
const generateResponse = await fetch('/api/trigger-points/generate-batch', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    attraction_ids: pois.slice(0, 5).map(p => p.id)
  })
});
const results = await generateResponse.json();

// 3. Check results
console.log(`Generated trigger points for ${results.successful}/${results.processed} POIs`);
results.results.forEach(result => {
  if (result.success) {
    console.log(`✅ ${result.poi_name}: ${result.trigger_points_saved} trigger points`);
  } else {
    console.log(`❌ ${result.poi_name}: ${result.message}`);
  }
});
```

### Find Nearby Trigger Points

```javascript
// Get user location
const userLat = -22.9068;
const userLng = -47.0608;

// Find nearby trigger points
const nearbyResponse = await fetch(
  `/api/trigger-points/nearby?lat=${userLat}&lng=${userLng}&radius=1000&access=car`
);
const { trigger_points } = await nearbyResponse.json();

// Process trigger points for app
trigger_points.forEach(tp => {
  const distance = tp.distance_from_query;
  if (distance <= tp.radius_meters) {
    console.log(`🎯 Trigger activated: ${tp.attraction_name} (${distance}m away)`);
  }
});
```

---

## 🔗 Related Documentation

- [Database Schema](./03-database-schema.md) - Data structure details
- [User Interface](./05-user-interface.md) - CMS interface guide
- [Troubleshooting](./07-troubleshooting.md) - Common API issues

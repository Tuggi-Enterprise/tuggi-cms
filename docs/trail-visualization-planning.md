# Trail Visualization Page - Implementation Planning

## 📋 Overview

This document outlines the planning for a new CMS page that visualizes user movement trails from the `drive.route_trail` table. The page will display:
- **Trail Lines**: Individual user paths drawn on a map
- **User Filtering**: Ability to select specific users or view all users
- **Heat Map**: Density visualization showing hot/cold areas of user movement
- **Performance**: Optimized for 10,000+ records with scalability in mind

**Purpose**: Support ad negotiation by identifying high-traffic areas where users pass through.

---

## 🗄️ Database Analysis

### Actual `drive.route_trail` Table Structure

**Confirmed Schema**:
```sql
CREATE TABLE drive.route_trail (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  accuracy real NULL,
  altitude real NULL,
  heading real NULL,
  speed real NULL,
  sequence_order integer NOT NULL,
  timestamp timestamp with time zone NULL DEFAULT now(),
  distance_from_previous real NULL,
  time_since_previous interval NULL,
  is_moving boolean NULL DEFAULT true,
  signal_strength text NULL,
  source text NULL DEFAULT 'gps'::text,
  is_compressed boolean NULL DEFAULT false,
  compression_ratio real NULL DEFAULT 1.0,
  created_at timestamp with time zone NULL DEFAULT now(),
  trip_session_id uuid NOT NULL,
  CONSTRAINT route_trail_pkey PRIMARY KEY (id),
  CONSTRAINT fk_route_trail_trip_session 
    FOREIGN KEY (trip_session_id) 
    REFERENCES drive.trip_sessions(id) ON DELETE CASCADE,
  CONSTRAINT route_trail_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES auth.users(id) ON DELETE CASCADE
);
```

**Existing Indexes**:
- `idx_route_trail_trip_session` on `trip_session_id`
- `idx_route_trail_timestamp` on `(trip_session_id, timestamp)`
- `idx_route_trail_sequence` on `(trip_session_id, sequence_order)`
- `idx_route_trail_user` on `(user_id, created_at DESC)`

**Key Fields for Visualization**:
- `user_id`: Group trails by user
- `latitude`, `longitude`: Map coordinates
- `timestamp`: Time-based filtering
- `trip_session_id`: Group points by trip session
- `sequence_order`: Order points within a trip
- `is_moving`: Filter out stationary points (optional)

### Required Database Optimizations

#### 1. **Spatial Indexing** (Critical for Performance - MISSING)

The table currently lacks spatial indexes for viewport-based queries. Add these:

```sql
-- Composite B-tree index for viewport queries (latitude + longitude)
-- This is essential for bounding box queries
CREATE INDEX IF NOT EXISTS idx_route_trail_lat_lng 
ON drive.route_trail (latitude, longitude);

-- Alternative: PostGIS spatial index (if PostGIS extension is available)
-- More efficient for complex spatial queries
-- CREATE INDEX IF NOT EXISTS idx_route_trail_location_gist 
-- ON drive.route_trail USING GIST (ST_MakePoint(longitude, latitude));

-- Composite index for user + time + location queries
CREATE INDEX IF NOT EXISTS idx_route_trail_user_time_location 
ON drive.route_trail (user_id, timestamp DESC, latitude, longitude);

-- Index for time-based filtering (global, not per trip)
CREATE INDEX IF NOT EXISTS idx_route_trail_timestamp_global 
ON drive.route_trail (timestamp DESC);

-- Index for trip session with location (for trip-based queries)
CREATE INDEX IF NOT EXISTS idx_route_trail_trip_location 
ON drive.route_trail (trip_session_id, sequence_order, latitude, longitude);
```

**Performance Impact**: These indexes will improve viewport queries by 10-100x for large datasets.

#### 2. **Table Partitioning** (For Future Scalability)
Consider partitioning by:
- **Time-based**: Monthly or quarterly partitions
- **Geographic**: By region/city (if applicable)
- **User-based**: Hash partitioning by user_id

#### 3. **Materialized Views** (For Aggregated Heat Map Data)
```sql
-- Pre-aggregate heat map data by grid cells
CREATE MATERIALIZED VIEW IF NOT EXISTS drive.trail_heatmap_grid AS
SELECT 
  -- Grid cell coordinates (e.g., 100m x 100m cells)
  -- Adjust precision based on zoom level needs
  FLOOR(latitude * 1000) / 1000 AS grid_lat,
  FLOOR(longitude * 1000) / 1000 AS grid_lng,
  COUNT(*) AS point_count,
  COUNT(DISTINCT user_id) AS unique_users,
  COUNT(DISTINCT trip_session_id) AS unique_trips,
  MIN(timestamp) AS first_seen,
  MAX(timestamp) AS last_seen,
  AVG(speed) AS avg_speed,
  SUM(CASE WHEN is_moving THEN 1 ELSE 0 END) AS moving_points
FROM drive.route_trail
WHERE is_moving = true  -- Optional: filter stationary points
GROUP BY grid_lat, grid_lng;

-- Refresh strategy: Incremental updates or scheduled refresh
CREATE INDEX IF NOT EXISTS idx_heatmap_grid_coords 
ON drive.trail_heatmap_grid (grid_lat, grid_lng);

-- Optional: Create multiple materialized views for different grid sizes
-- (for different zoom levels)
```

**Refresh Strategy**:
```sql
-- Manual refresh (for initial setup)
REFRESH MATERIALIZED VIEW drive.trail_heatmap_grid;

-- Or set up scheduled refresh via Supabase cron or pg_cron
-- Example: Refresh every hour
-- SELECT cron.schedule('refresh-trail-heatmap', '0 * * * *', 
--   'REFRESH MATERIALIZED VIEW drive.trail_heatmap_grid');
```

---

## 🏗️ Architecture Design

### Single Source of Truth Principles

Following the project's DRY and SSOF principles:

1. **Centralized Service**: Create `lib/services/trail-visualization.service.ts`
2. **Reuse Supabase Client**: Use `lib/core/supabase-client.ts` (existing)
3. **Reuse Map Component**: Extend `components/ui/GoogleMapComponent.tsx`
4. **API Route Pattern**: Follow existing patterns in `app/api/`

### Component Structure

```
app/trail-visualization/
├── page.tsx                    # Main page component
├── layout.tsx                   # Page layout (if needed)
└── components/
    ├── TrailMap.tsx            # Map visualization component
    ├── UserFilter.tsx          # User selection component
    ├── HeatMapToggle.tsx       # Heat map on/off toggle
    └── TrailStats.tsx          # Statistics panel

app/api/trail-visualization/
├── route.ts                    # Main API endpoint
├── trails/
│   └── route.ts                # Get trail data
├── users/
│   └── route.ts                # Get user list
└── heatmap/
    └── route.ts                # Get heat map data

lib/services/
└── trail-visualization.service.ts  # Business logic service
```

---

## 📊 Performance Optimization Strategy

### 1. **Data Fetching Strategy**

#### Approach A: Viewport-Based Loading (Recommended)
- Load only trails visible in current map viewport
- Use Google Maps bounds to filter database queries
- Implement pagination/infinite scroll for large datasets
- **Benefit**: Loads only relevant data, scales infinitely

#### Approach B: Time-Based Filtering
- Load trails from last N days/weeks
- User selects time range
- **Benefit**: Reduces dataset size naturally

#### Approach C: Hybrid (Best Performance)
- Combine viewport + time filtering
- Add user selection filter
- **Benefit**: Maximum performance, most flexible

### 2. **Database Query Optimization**

```typescript
// Example optimized query pattern
interface TrailQueryParams {
  bounds?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  userIds?: string[];
  tripSessionIds?: string[];  // Filter by specific trips
  startDate?: string;
  endDate?: string;
  onlyMoving?: boolean;        // Filter stationary points
  limit?: number;
  offset?: number;
}

// Efficient query using spatial indexing
const query = supabase
  .schema('drive')
  .from('route_trail')
  .select(`
    id, 
    user_id, 
    latitude, 
    longitude, 
    timestamp,
    trip_session_id,
    sequence_order,
    is_moving,
    speed
  `)
  .gte('latitude', bounds.south)
  .lte('latitude', bounds.north)
  .gte('longitude', bounds.west)
  .lte('longitude', bounds.east);

// Optional filters
if (userIds && userIds.length > 0) {
  query.in('user_id', userIds);
}
if (tripSessionIds && tripSessionIds.length > 0) {
  query.in('trip_session_id', tripSessionIds);
}
if (startDate) {
  query.gte('timestamp', startDate);
}
if (endDate) {
  query.lte('timestamp', endDate);
}
if (onlyMoving) {
  query.eq('is_moving', true);
}

query
  .order('trip_session_id', { ascending: true })
  .order('sequence_order', { ascending: true })
  .limit(limit || 5000);
```

### 3. **Client-Side Optimization**

#### Data Aggregation
- Group trail points by user_id on client
- Simplify polylines (reduce points) for distant zoom levels
- Use clustering for heat map visualization

#### Rendering Optimization
- Use Google Maps Data Layer for heat maps (better performance)
- Batch polyline updates
- Implement debouncing for map movement
- Virtual scrolling for user list

#### Caching Strategy
- Cache trail data by viewport bounds + filters
- Use React Query or SWR for data fetching
- Cache TTL: 5-10 minutes (trails don't change frequently)

### 4. **Heat Map Generation**

#### Server-Side Aggregation (Recommended)
- Pre-aggregate heat map data in database
- Use grid-based approach (e.g., 100m x 100m cells)
- Return aggregated data, not raw points
- **Benefit**: Reduces data transfer by 90%+

#### Grid Size Strategy
```typescript
// Adaptive grid size based on zoom level
const getGridSize = (zoom: number): number => {
  if (zoom >= 15) return 0.001;      // ~100m
  if (zoom >= 12) return 0.005;       // ~500m
  if (zoom >= 10) return 0.01;        // ~1km
  return 0.05;                        // ~5km
};
```

---

## 🗺️ Visualization Implementation

### Google Maps Integration

The project already uses Google Maps (`components/ui/GoogleMapComponent.tsx`). We'll extend this pattern.

#### 1. **Trail Lines (Polylines)**

```typescript
// Group points by user_id and create polylines
const userTrails = groupBy(trailPoints, 'user_id');

userTrails.forEach((trail, userId) => {
  const polyline = new google.maps.Polyline({
    path: trail.map(p => ({ lat: p.latitude, lng: p.longitude })),
    geodesic: true,
    strokeColor: getUserColor(userId),
    strokeOpacity: 0.6,
    strokeWeight: 2
  });
  polyline.setMap(map);
});
```

#### 2. **Heat Map**

Google Maps provides `google.maps.visualization.HeatmapLayer`:

```typescript
// Load visualization library
const { HeatmapLayer } = await google.maps.importLibrary("visualization");

const heatmapData = aggregatedGridPoints.map(point => ({
  location: new google.maps.LatLng(point.lat, point.lng),
  weight: point.count // Density value
}));

const heatmap = new HeatmapLayer({
  data: heatmapData,
  map: map,
  radius: 50, // Adjust based on zoom
  opacity: 0.6
});
```

**Performance Note**: Google Maps HeatmapLayer can handle 10,000+ points efficiently when properly aggregated.

### 3. **User Selection UI**

- Multi-select dropdown/checklist
- Search/filter users
- "Select All" / "Deselect All" options
- Show user count and trail count

---

## 🔌 API Design

### Endpoint Structure

#### `GET /api/trail-visualization/trails`

**Query Parameters:**
- `bounds` (string): `north,south,east,west` (required for viewport queries)
- `userIds` (string[]): Comma-separated user IDs (optional)
- `tripSessionIds` (string[]): Comma-separated trip session IDs (optional)
- `startDate` (ISO string): Optional
- `endDate` (ISO string): Optional
- `onlyMoving` (boolean): Filter out stationary points (default: false)
- `limit` (number): Max points to return (default: 5000)
- `offset` (number): Pagination offset

**Response:**
```json
{
  "success": true,
  "data": {
    "trails": [
      {
        "user_id": "uuid",
        "trip_session_id": "uuid",
        "points": [
          { 
            "lat": -23.5505, 
            "lng": -46.6333, 
            "timestamp": "2024-01-01T10:00:00Z",
            "sequence_order": 1,
            "is_moving": true,
            "speed": 45.5
          }
        ]
      }
    ],
    "pagination": {
      "total": 10000,
      "limit": 5000,
      "offset": 0,
      "hasMore": true
    },
    "stats": {
      "total_points": 10000,
      "unique_users": 150,
      "unique_trips": 320,
      "date_range": {
        "start": "2024-01-01T00:00:00Z",
        "end": "2024-01-31T23:59:59Z"
      }
    }
  }
}
```

#### `GET /api/trail-visualization/users`

**Query Parameters:**
- `search` (string): Search by user name/email (optional)
- `limit` (number): Max users to return (default: 100)

**Response:**
```json
{
  "success": true,
  "data": {
    "users": [
      { 
        "id": "uuid", 
        "email": "user@example.com",
        "trail_count": 150,
        "trip_count": 12,
        "last_activity": "2024-01-15T10:30:00Z"
      }
    ],
    "total": 150
  }
}
```

**Note**: User names may need to be joined from `drive.profiles` or `auth.users` table.

#### `GET /api/trail-visualization/heatmap`

**Query Parameters:**
- `bounds` (string): Required - `north,south,east,west`
- `gridSize` (number): Grid cell size in degrees (default: 0.001 = ~100m)
- `startDate` (ISO string): Optional
- `endDate` (ISO string): Optional
- `useMaterializedView` (boolean): Use pre-aggregated view (default: true)

**Response:**
```json
{
  "success": true,
  "data": {
    "heatmap": [
      {
        "lat": -23.5505,
        "lng": -46.6333,
        "weight": 45,           // Point count in this cell
        "unique_users": 12,     // Distinct users in cell
        "unique_trips": 8,      // Distinct trips in cell
        "avg_speed": 42.5,      // Average speed (if available)
        "moving_points": 40     // Points where is_moving = true
      }
    ],
    "gridSize": 0.001,
    "totalPoints": 10000,
    "bounds": {
      "north": -23.5,
      "south": -23.6,
      "east": -46.6,
      "west": -46.7
    }
  }
}
```

**Performance Note**: If `useMaterializedView=true`, query uses `drive.trail_heatmap_grid` for faster results. Otherwise, performs real-time aggregation.

### Service Layer

```typescript
// lib/services/trail-visualization.service.ts

import { getSupabase } from '@/lib/core/supabase-client';

export interface TrailQueryParams {
  bounds?: { north: number; south: number; east: number; west: number };
  userIds?: string[];
  tripSessionIds?: string[];
  startDate?: string;
  endDate?: string;
  onlyMoving?: boolean;
  limit?: number;
  offset?: number;
}

export interface TrailPoint {
  id: string;
  user_id: string;
  trip_session_id: string;
  latitude: number;
  longitude: number;
  timestamp: string;
  sequence_order: number;
  is_moving?: boolean;
  speed?: number;
}

export interface TrailData {
  trails: Array<{
    user_id: string;
    trip_session_id: string;
    points: TrailPoint[];
  }>;
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  stats?: {
    total_points: number;
    unique_users: number;
    unique_trips: number;
    date_range?: { start: string; end: string };
  };
}

export class TrailVisualizationService {
  /**
   * Get trail data with optimized query
   * Groups points by trip_session_id for proper polyline rendering
   */
  static async getTrails(params: TrailQueryParams): Promise<TrailData> {
    const supabase = getSupabase('server');
    
    // Build optimized query with spatial filtering
    let query = supabase
      .schema('drive')
      .from('route_trail')
      .select('*', { count: 'exact' });
    
    // Apply filters
    if (params.bounds) {
      query = query
        .gte('latitude', params.bounds.south)
        .lte('latitude', params.bounds.north)
        .gte('longitude', params.bounds.west)
        .lte('longitude', params.bounds.east);
    }
    
    if (params.userIds && params.userIds.length > 0) {
      query = query.in('user_id', params.userIds);
    }
    
    if (params.tripSessionIds && params.tripSessionIds.length > 0) {
      query = query.in('trip_session_id', params.tripSessionIds);
    }
    
    if (params.startDate) {
      query = query.gte('timestamp', params.startDate);
    }
    
    if (params.endDate) {
      query = query.lte('timestamp', params.endDate);
    }
    
    if (params.onlyMoving) {
      query = query.eq('is_moving', true);
    }
    
    // Order by trip and sequence for proper line rendering
    query = query
      .order('trip_session_id', { ascending: true })
      .order('sequence_order', { ascending: true });
    
    // Apply pagination
    const limit = params.limit || 5000;
    const offset = params.offset || 0;
    query = query.range(offset, offset + limit - 1);
    
    const { data, error, count } = await query;
    
    if (error) throw error;
    
    // Group points by trip_session_id
    const trailsMap = new Map<string, TrailPoint[]>();
    data?.forEach(point => {
      const key = point.trip_session_id;
      if (!trailsMap.has(key)) {
        trailsMap.set(key, []);
      }
      trailsMap.get(key)!.push(point);
    });
    
    // Convert to array format
    const trails = Array.from(trailsMap.entries()).map(([trip_session_id, points]) => ({
      user_id: points[0].user_id,
      trip_session_id,
      points: points.sort((a, b) => a.sequence_order - b.sequence_order)
    }));
    
    return {
      trails,
      pagination: {
        total: count || 0,
        limit,
        offset,
        hasMore: (count || 0) > offset + limit
      }
    };
  }
  
  /**
   * Get aggregated heat map data
   * Uses materialized view if available, otherwise real-time aggregation
   */
  static async getHeatMapData(params: {
    bounds: { north: number; south: number; east: number; west: number };
    gridSize?: number;
    startDate?: string;
    endDate?: string;
    useMaterializedView?: boolean;
  }): Promise<any> {
    const supabase = getSupabase('server');
    const gridSize = params.gridSize || 0.001;
    
    if (params.useMaterializedView !== false) {
      // Try to use materialized view
      let query = supabase
        .schema('drive')
        .from('trail_heatmap_grid')
        .select('*')
        .gte('grid_lat', Math.floor(params.bounds.south * 1000) / 1000)
        .lte('grid_lat', Math.ceil(params.bounds.north * 1000) / 1000)
        .gte('grid_lng', Math.floor(params.bounds.west * 1000) / 1000)
        .lte('grid_lng', Math.ceil(params.bounds.east * 1000) / 1000);
      
      const { data, error } = await query;
      if (!error && data) {
        return {
          heatmap: data.map(cell => ({
            lat: cell.grid_lat,
            lng: cell.grid_lng,
            weight: cell.point_count,
            unique_users: cell.unique_users,
            unique_trips: cell.unique_trips
          })),
          gridSize,
          source: 'materialized_view'
        };
      }
    }
    
    // Fallback: Real-time aggregation
    // This would use a raw SQL query or RPC function
    // Implementation depends on Supabase RPC capabilities
    throw new Error('Real-time aggregation not yet implemented. Use materialized view.');
  }
  
  /**
   * Get user list with trail counts
   */
  static async getUsers(params?: {
    search?: string;
    limit?: number;
  }): Promise<any> {
    const supabase = getSupabase('server');
    
    // Query users with trail statistics
    // This may require a join with auth.users or drive.profiles
    // Implementation depends on available user tables
    
    // For now, return distinct users from route_trail
    const { data, error } = await supabase
      .schema('drive')
      .from('route_trail')
      .select('user_id')
      .limit(params?.limit || 100);
    
    if (error) throw error;
    
    // Get unique users and count their trails
    const userCounts = new Map<string, number>();
    data?.forEach(point => {
      userCounts.set(point.user_id, (userCounts.get(point.user_id) || 0) + 1);
    });
    
    return {
      users: Array.from(userCounts.entries()).map(([id, trail_count]) => ({
        id,
        trail_count
      }))
    };
  }
}
```

---

## 📈 Benchmarks & Market Research

### Similar Solutions

1. **Strava Heat Maps**: Aggregates millions of GPS points into heat maps
   - Uses grid-based aggregation
   - Pre-computes heat map tiles
   - Serves static tiles for performance

2. **Google Timeline**: Shows user movement history
   - Uses clustering for distant zoom
   - Loads data incrementally
   - Caches recent data

3. **Mapbox Heat Maps**: Industry standard
   - Server-side aggregation
   - Tile-based rendering
   - Adaptive detail levels

### Performance Targets

- **Initial Load**: < 2 seconds
- **Viewport Change**: < 500ms
- **Heat Map Generation**: < 1 second
- **User Filter Change**: < 300ms
- **Max Points Rendered**: 10,000+ (with aggregation)

---

## 🚀 Implementation Phases

### Phase 1: Foundation (Week 1)
- [ ] Verify `root_trail` table structure
- [ ] Create database indexes
- [ ] Set up API route structure
- [ ] Create service layer skeleton
- [ ] Basic page layout

### Phase 2: Core Functionality (Week 2)
- [ ] Implement trail line visualization
- [ ] User filtering functionality
- [ ] Viewport-based data loading
- [ ] Basic performance optimization

### Phase 3: Heat Map (Week 3)
- [ ] Heat map data aggregation
- [ ] Google Maps HeatmapLayer integration
- [ ] Grid-based optimization
- [ ] Toggle between trails/heat map

### Phase 4: Optimization (Week 4)
- [ ] Materialized views for heat map
- [ ] Client-side caching
- [ ] Performance tuning
- [ ] Load testing with 10,000+ records

### Phase 5: Polish (Week 5)
- [ ] UI/UX improvements
- [ ] Statistics panel
- [ ] Export functionality (optional)
- [ ] Documentation

---

## 🔒 Security & Privacy Considerations

1. **Access Control**: Use existing CMS authentication
2. **Data Anonymization**: Consider anonymizing user IDs in visualization
3. **Rate Limiting**: Implement API rate limits
4. **Data Retention**: Consider archiving old trail data

---

## 📝 Technical Decisions

### Why Google Maps (Not Leaflet)?
- Project already uses Google Maps
- Better performance for large datasets
- Native HeatmapLayer support
- Consistent with existing codebase

### Why Server-Side Aggregation?
- Reduces data transfer by 90%+
- Better database performance
- Scales to millions of points
- Follows single source of truth

### Why Viewport-Based Loading?
- Only loads visible data
- Scales infinitely
- Better user experience
- Reduces server load

---

## 🧪 Testing Strategy

1. **Unit Tests**: Service layer functions
2. **Integration Tests**: API endpoints
3. **Performance Tests**: Load with 10K, 50K, 100K points
4. **Visual Tests**: Map rendering accuracy
5. **User Acceptance**: Ad negotiation use case validation

---

## 📚 Dependencies

### Existing (Already in Project)
- `@googlemaps/react-wrapper`
- `@supabase/supabase-js`
- `lib/core/supabase-client.ts`
- `components/ui/GoogleMapComponent.tsx`

### New (May Need)
- `@tanstack/react-query` or `swr` (for data fetching/caching)
- Google Maps Visualization library (loaded dynamically)

---

## 🎯 Success Metrics

1. **Performance**: Page loads in < 2 seconds
2. **Scalability**: Handles 100,000+ trail points
3. **Usability**: Users can identify hot zones for ad placement
4. **Maintainability**: Follows DRY and SSOF principles
5. **Accuracy**: Heat map accurately represents user density

---

## ❓ Open Questions

1. ~~**Table Schema**: Need to verify exact `root_trail` structure~~ ✅ **RESOLVED**: Table is `drive.route_trail`
2. ~~**Schema Location**: Confirm if it's in `drive` schema~~ ✅ **RESOLVED**: Confirmed `drive` schema
3. **User Identification**: How to display user names/identifiers?
   - Need to check if `drive.profiles` table exists
   - Or join with `auth.users` for email/name
4. **Time Range**: Default time range for initial load?
   - Suggested: Last 7 days or last 30 days
5. **Export**: Do we need export functionality for ad negotiations?
   - Consider CSV/GeoJSON export of heat map data
6. **PostGIS Extension**: Is PostGIS available for advanced spatial queries?
   - If yes, can use GIST indexes and spatial functions
   - If no, use B-tree indexes on lat/lng columns
7. **Trip Session Metadata**: Should we show trip information?
   - Can join with `drive.trip_sessions` for trip details
   - Useful for filtering by trip duration, distance, etc.

---

## 📖 Next Steps

1. ~~**Verify Database Schema**: Inspect `root_trail` table structure~~ ✅ **DONE**
2. **Create Database Indexes**: Implement spatial indexing (CRITICAL)
   - Priority: `idx_route_trail_lat_lng` (most important)
   - Then: `idx_route_trail_user_time_location`
   - Then: `idx_route_trail_timestamp_global`
3. **Check PostGIS Availability**: Determine if PostGIS extension is available
4. **Create Materialized View**: Set up `trail_heatmap_grid` for heat map performance
5. **Set Up Project Structure**: Create folders and files
6. **Implement Phase 1**: Foundation and basic API
7. **Iterate**: Build incrementally, test frequently

### Immediate Action Items

**Before Implementation**:
1. ✅ Schema verified - `drive.route_trail` confirmed
2. ⚠️ **Create spatial indexes** (see SQL above)
3. ⚠️ **Test query performance** with 10K+ records
4. ⚠️ **Create materialized view** for heat map (optional but recommended)
5. ⚠️ **Verify user table structure** (`drive.profiles` or `auth.users`)

---

## 📄 References

- [Google Maps HeatmapLayer Documentation](https://developers.google.com/maps/documentation/javascript/heatmaplayer)
- [PostGIS Spatial Indexing](https://postgis.net/docs/using_postgis_dbmanagement.html#spatial_indexes)
- [Supabase Performance Best Practices](https://supabase.com/docs/guides/database/performance)
- Project's existing analytics implementation: `app/analytics/page.tsx`
- Project's Supabase client: `lib/core/supabase-client.ts`

---

**Document Version**: 1.0  
**Created**: 2024  
**Status**: Planning Phase - No Implementation Yet


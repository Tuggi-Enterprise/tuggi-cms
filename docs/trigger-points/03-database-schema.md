# Trigger Points - Database Schema

## 🗄️ Core Table: `attraction_trigger_points`

The main table storing all trigger point data with spatial indexing and quality tracking.

### Table Structure

```sql
CREATE TABLE core.attraction_trigger_points (
  -- Primary identification
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attraction_id uuid NOT NULL REFERENCES core.attractions(id) ON DELETE CASCADE,
  
  -- Geographic data
  location geography(Point, 4326) NOT NULL,
  radius_meters integer DEFAULT 30 CHECK (radius_meters > 0 AND radius_meters <= 500),
  
  -- Direction and bearing
  expected_bearing double precision CHECK (expected_bearing >= 0 AND expected_bearing < 360),
  bearing_threshold double precision DEFAULT 30 CHECK (bearing_threshold > 0 AND bearing_threshold <= 180),
  
  -- Classification
  type text DEFAULT 'primary' CHECK (type IN ('primary', 'secondary', 'fallback', 'special', 'testing')),
  priority integer DEFAULT 1 CHECK (priority >= 1 AND priority <= 10),
  
  -- Status and quality
  is_active boolean DEFAULT true,
  confidence_score real CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
  auto_status text CHECK (auto_status IN ('approved', 'review', 'rejected')),
  manual_status text CHECK (manual_status IN ('approved', 'review', 'rejected', 'pending')),
  final_status text CHECK (final_status IN ('approved', 'review', 'rejected', 'pending')),
  
  -- Metadata and context
  score_factors jsonb,
  generation_method text,
  validation_notes text,
  
  -- User interface
  access text DEFAULT 'both' CHECK (access IN ('walk', 'car', 'both')),
  name text,
  description text,
  direction text CHECK (direction IN ('front', 'right', 'left', 'back')),
  
  -- Relationships
  custom_description_id uuid REFERENCES core.attraction_descriptions(id),
  
  -- Audit trail
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  created_by uuid REFERENCES core.cms_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES core.cms_users(id) ON DELETE SET NULL
);
```

## 📊 Field Descriptions

### Geographic Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `location` | `geography(Point, 4326)` | Precise GPS coordinates in WGS84 | `POINT(-47.0608 -22.9068)` |
| `radius_meters` | `integer` | Activation radius in meters | `30` |
| `expected_bearing` | `double precision` | Expected direction of travel (0-360°) | `45.5` |
| `bearing_threshold` | `double precision` | Tolerance for bearing matching (±degrees) | `30.0` |

### Classification Fields

| Field | Type | Description | Values |
|-------|------|-------------|---------|
| `type` | `text` | Trigger point type | `primary`, `secondary`, `fallback`, `special`, `testing` |
| `priority` | `integer` | Activation priority (1=highest) | `1`, `2`, `3` |
| `access` | `text` | Transportation mode | `walk`, `car`, `both` |
| `direction` | `text` | Relative direction for audio cues | `front`, `right`, `left`, `back` |

### Quality & Status Fields

| Field | Type | Description | Range/Values |
|-------|------|-------------|--------------|
| `confidence_score` | `real` | Algorithmic quality score | `0.0` - `1.0` |
| `auto_status` | `text` | System-determined status | `approved`, `review`, `rejected` |
| `manual_status` | `text` | Human-reviewed status | `approved`, `review`, `rejected`, `pending` |
| `final_status` | `text` | Computed final status (manual overrides auto) | `approved`, `review`, `rejected`, `pending` |

### Metadata Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `score_factors` | `jsonb` | Detailed quality metrics | `{"street_confidence": 0.8, "distance_optimization": 0.9}` |
| `generation_method` | `text` | Algorithm used for generation | `boundary_offset_strategy` |
| `validation_notes` | `text` | Human-readable explanation | `"Located on accessible street with good POI visibility"` |

## 🔗 Related Tables

### `core.attractions`
The main POI table that trigger points reference.

**Key Fields:**
- `id` - Referenced by `attraction_trigger_points.attraction_id`
- `name` - POI name for display
- `city`, `state`, `country` - Geographic classification
- `last_tp_generation_at` - Last trigger point generation timestamp

### `core.attraction_descriptions`
Audio descriptions that can be linked to specific trigger points.

**Key Fields:**
- `id` - Referenced by `attraction_trigger_points.custom_description_id`
- `language` - Description language
- `description` - Text content
- `audio_url` - Generated audio file

### `core.cms_users`
CMS users for audit trail tracking.

**Key Fields:**
- `id` - Referenced by `created_by` and `updated_by`
- `email` - User identification
- `role` - User permissions

## 📈 Indexes

### Spatial Indexes (GiST)

```sql
-- Primary spatial index for location-based queries
CREATE INDEX idx_trigger_points_location 
ON core.attraction_trigger_points USING GIST (location);

-- Spatial index for active trigger points only
CREATE INDEX idx_trigger_points_active_location 
ON core.attraction_trigger_points USING GIST (location) 
WHERE (is_active = true);

-- Spatial index for car-accessible trigger points
CREATE INDEX idx_trigger_points_spatial_car 
ON core.attraction_trigger_points USING GIST (location) 
WHERE (is_active = true AND access IN ('car', 'both'));

-- Spatial index for walk-accessible trigger points
CREATE INDEX idx_trigger_points_spatial_walk 
ON core.attraction_trigger_points USING GIST (location) 
WHERE (is_active = true AND access IN ('walk', 'both'));
```

### B-Tree Indexes

```sql
-- Primary foreign key index
CREATE INDEX idx_trigger_points_attraction_id 
ON core.attraction_trigger_points(attraction_id);

-- Status-based queries
CREATE INDEX idx_trigger_points_final_status 
ON core.attraction_trigger_points(final_status);

CREATE INDEX idx_trigger_points_auto_status 
ON core.attraction_trigger_points(auto_status);

-- Quality-based queries
CREATE INDEX idx_trigger_points_confidence 
ON core.attraction_trigger_points(confidence_score);

-- Composite indexes for common queries
CREATE INDEX idx_trigger_points_approved_active 
ON core.attraction_trigger_points(attraction_id, final_status, is_active) 
WHERE (final_status = 'approved' AND is_active = true);

CREATE INDEX idx_trigger_points_active_type_priority 
ON core.attraction_trigger_points(attraction_id, is_active, type, priority) 
WHERE (is_active = true);
```

## 🔄 Database Triggers

### `trigger_update_status`
Automatically calculates status fields before insert/update.

```sql
CREATE TRIGGER trigger_update_status
    BEFORE INSERT OR UPDATE ON core.attraction_trigger_points
    FOR EACH ROW EXECUTE FUNCTION core.update_trigger_point_status();
```

**Function Logic:**
- Calculates `auto_status` from `confidence_score`
- Computes `final_status` (manual overrides auto)
- Sets default `radius_meters` if null

### `handle_updated_at`
Updates the `updated_at` timestamp on changes.

```sql
CREATE TRIGGER handle_updated_at 
    BEFORE UPDATE ON core.attraction_trigger_points 
    FOR EACH ROW EXECUTE FUNCTION core.handle_updated_at();
```

### `trigger_capture_learning`
Captures trigger points for machine learning (when enabled).

```sql
CREATE TRIGGER trigger_capture_learning
    AFTER INSERT ON core.attraction_trigger_points
    FOR EACH ROW EXECUTE FUNCTION core.capture_trigger_point_learning();
```

## 🔍 Common Queries

### Find Trigger Points Near Location

```sql
SELECT tp.*, a.name as poi_name
FROM core.attraction_trigger_points tp
JOIN core.attractions a ON tp.attraction_id = a.id
WHERE tp.is_active = true 
  AND tp.final_status = 'approved'
  AND ST_DWithin(tp.location, ST_MakePoint(-47.0608, -22.9068)::geography, 1000)
ORDER BY tp.location <-> ST_MakePoint(-47.0608, -22.9068)::geography
LIMIT 10;
```

### Get All Trigger Points for POI

```sql
SELECT *
FROM core.attraction_trigger_points
WHERE attraction_id = 'poi-uuid-here'
  AND is_active = true
ORDER BY priority ASC, type ASC;
```

### Quality Statistics

```sql
SELECT 
    auto_status,
    COUNT(*) as count,
    AVG(confidence_score) as avg_confidence,
    MIN(confidence_score) as min_confidence,
    MAX(confidence_score) as max_confidence
FROM core.attraction_trigger_points
WHERE is_active = true
GROUP BY auto_status
ORDER BY auto_status;
```

### Geographic Distribution

```sql
SELECT 
    a.country,
    a.state,
    COUNT(tp.id) as trigger_count,
    AVG(tp.confidence_score) as avg_quality
FROM core.attraction_trigger_points tp
JOIN core.attractions a ON tp.attraction_id = a.id
WHERE tp.is_active = true
GROUP BY a.country, a.state
ORDER BY trigger_count DESC;
```

## 📊 Views

### `trigger_points_with_coords`
Simplified view with coordinate extraction for easier querying.

```sql
CREATE VIEW core.trigger_points_with_coords AS
SELECT 
  tp.*,
  ST_Y(tp.location::geometry) as latitude,
  ST_X(tp.location::geometry) as longitude,
  a.name as attraction_name
FROM core.attraction_trigger_points tp
JOIN core.attractions a ON tp.attraction_id = a.id
ORDER BY tp.attraction_id, tp.priority, tp.type;
```

## 🔒 Row Level Security (RLS)

### Policies

```sql
-- Allow authenticated users full access
CREATE POLICY "Authenticated users can manage trigger points" 
ON core.attraction_trigger_points FOR ALL 
TO authenticated 
USING (true) WITH CHECK (true);

-- Service role full access
CREATE POLICY "Service role can manage trigger points" 
ON core.attraction_trigger_points FOR ALL 
TO service_role 
USING (true) WITH CHECK (true);
```

## 📏 Storage Considerations

### Estimated Storage per Trigger Point
- **Base Row**: ~200 bytes
- **JSONB score_factors**: ~100-500 bytes
- **Spatial Index**: ~50 bytes
- **B-Tree Indexes**: ~30 bytes per index

### Scaling Projections
- **10k POIs × 5 TPs average**: ~50k trigger points
- **Estimated Storage**: ~50MB for data + indexes
- **Query Performance**: Sub-second for spatial queries with proper indexing

---

## 🔗 Related Documentation

- [Generation Process](./02-generation-process.md) - How data is created
- [API Documentation](./04-api-documentation.md) - How to query the data
- [Troubleshooting](./07-troubleshooting.md) - Common database issues

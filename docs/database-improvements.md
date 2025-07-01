# Database Schema Improvements for POI Importer

## Current Issues with `core.attractions` Schema

### 1. **Missing Google Places API Fields**
Our POI Importer analysis uses several Google Places fields not currently stored:

```sql
-- Missing fields that we show in analysis:
price_level INTEGER,                    -- 1-4 scale for budget indication
formatted_phone_number TEXT,           -- Local format phone
international_phone_number TEXT,       -- International format phone  
business_status TEXT,                   -- OPERATIONAL, CLOSED_PERMANENTLY, etc.
vicinity TEXT,                         -- Short address description
photos_references TEXT[],              -- Google photo references
```

### 2. **Import Source Tracking**
No way to track HOW a place was imported:

```sql
-- Need to track import method:
import_source TEXT,                     -- 'poi_importer', 'manual', 'api', etc.
import_batch_id UUID,                   -- Group places imported together
imported_from_polygon_id UUID,         -- Reference to search area used
```

### 3. **Analysis Workflow Support**
Missing fields to support "Good for Tuggi?" workflow:

```sql
-- Analysis and approval workflow:
analysis_notes TEXT,                    -- Why this place is good/bad for Tuggi
import_confidence_score NUMERIC,       -- Algorithm confidence (future use)
reviewed_at TIMESTAMP,                 -- When it was analyzed
review_decision TEXT,                  -- 'approved', 'rejected', 'pending'
```

## Recommended Schema Changes

### **Phase 1: Essential Changes (Immediate)**

```sql
-- Add missing Google Places fields
ALTER TABLE core.attractions 
ADD COLUMN price_level INTEGER,
ADD COLUMN formatted_phone_number TEXT,
ADD COLUMN international_phone_number TEXT,
ADD COLUMN business_status TEXT DEFAULT 'OPERATIONAL',
ADD COLUMN vicinity TEXT,
ADD COLUMN photos_references TEXT[];

-- Add import tracking
ALTER TABLE core.attractions
ADD COLUMN import_source TEXT DEFAULT 'manual',
ADD COLUMN import_batch_id UUID,
ADD COLUMN imported_from_polygon_id UUID;

-- Add indexes for performance
CREATE INDEX idx_attractions_import_source ON core.attractions(import_source);
CREATE INDEX idx_attractions_import_batch ON core.attractions(import_batch_id);
CREATE INDEX idx_attractions_business_status ON core.attractions(business_status);
```

### **Phase 2: Enhanced Analysis (Future)**

```sql
-- Analysis workflow enhancements
ALTER TABLE core.attractions
ADD COLUMN analysis_notes TEXT,
ADD COLUMN import_confidence_score NUMERIC,
ADD COLUMN reviewed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN review_decision TEXT DEFAULT 'pending';

-- Create import batches table for better tracking
CREATE TABLE core.import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  polygon_id UUID,
  search_category TEXT,
  total_found INTEGER,
  total_imported INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Impact on POI Importer Code

### **Immediate Benefits:**
1. **Better deduplication** with business_status check
2. **Richer place details** in analysis cards 
3. **Import tracking** for analytics and debugging
4. **Photo management** for tourism content

### **Code Changes Needed:**
1. Update `importSelectedPlaces()` to include new fields
2. Add import batch creation logic
3. Enhanced place detail display with phone/photos
4. Better error handling for permanently closed places

## Migration Strategy

1. **Add new columns** (non-breaking)
2. **Update POI Importer** to use new fields
3. **Migrate existing data** where possible
4. **Add validation rules** for data quality 
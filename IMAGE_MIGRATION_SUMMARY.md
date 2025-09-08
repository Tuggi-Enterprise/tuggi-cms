# Image Migration Summary

## Problem Identified

The POI Importer was saving direct Google Maps API URLs in the `attractions.image_url` field instead of using the `store-poi-images` Edge Function to download and store images in Supabase Storage.

## Issues Found

1. **POI Importer**: Was generating direct Google Maps API URLs and saving them directly to the database
2. **Edge Function Schema Mismatch**: The `store-poi-images` Edge Function was trying to insert fields that didn't exist in the `attraction_image` table
3. **Database Schema**: The `attraction_image` table was missing `storage_path` and `photo_reference` columns

## Solutions Implemented

### 1. Fixed POI Importer (`app/poi-importer/page.tsx`)

**Before:**
```typescript
// Generate direct Google Places API URL for the primary image
const directImageUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photoReferences[0]}&key=${googleApiKey}`

// Update attraction with direct Google image URL
await supabase
  .schema('core')
  .from('attractions')
  .update({ image_url: directImageUrl })
  .eq('id', newAttraction.id)
```

**After:**
```typescript
// Call Edge Function to download and store images
const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/store-poi-images`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`
  },
  body: JSON.stringify({
    attractionId: newAttraction.id,
    googlePlaceId: placeData.place_id,
    photoReferences: photoReferences,
    attractionName: placeData.name
  })
})
```

### 2. Updated Database Schema

Added missing columns to `core.attraction_image` table:

```sql
ALTER TABLE core.attraction_image 
ADD COLUMN IF NOT EXISTS storage_path text null,
ADD COLUMN IF NOT EXISTS photo_reference text null;

CREATE INDEX IF NOT EXISTS idx_attraction_image_photo_reference 
ON core.attraction_image USING btree (photo_reference);

CREATE INDEX IF NOT EXISTS idx_attraction_image_storage_path 
ON core.attraction_image USING btree (storage_path);
```

### 3. Fixed Edge Function (`supabase/functions/store-poi-images/index.ts`)

Updated the `saveImageReference` function to use the correct schema:

```typescript
const { data, error } = await supabaseAdmin
  .schema('core')
  .from('attraction_image')
  .insert({
    attraction_id: attractionId,
    image_url: publicUrl,
    storage_path: storagePath,
    photo_reference: googlePhotoReference,
    alt_text: `Image from Google Places for attraction ${attractionId}`
  })
```

## Migration Tools Created

### 1. Schema Migration Script
- **File**: `supabase/migrate-attraction-image-schema.sql`
- **Purpose**: Updates the database schema to add missing columns

### 2. Analysis Script
- **File**: `scripts/check-google-images.ts`
- **Purpose**: Analyzes current state of image URLs to identify what needs migration
- **Usage**: `npx tsx scripts/check-google-images.ts`

### 3. Migration Script
- **File**: `scripts/migrate-google-images-to-supabase.ts`
- **Purpose**: Migrates existing Google Maps URLs to Supabase Storage
- **Usage**: `npx tsx scripts/migrate-google-images-to-supabase.ts`

## How to Execute the Migration

### Step 1: Update Database Schema
```bash
# Run the schema migration
psql -h your-db-host -U your-user -d your-db -f supabase/migrate-attraction-image-schema.sql
```

### Step 2: Analyze Current State
```bash
# Check what needs to be migrated
npx tsx scripts/check-google-images.ts
```

### Step 3: Deploy Edge Function
```bash
# Deploy the updated Edge Function
supabase functions deploy store-poi-images
```

### Step 4: Run Migration (if needed)
```bash
# Migrate existing Google URLs to Supabase Storage
npx tsx scripts/migrate-google-images-to-supabase.ts
```

## Benefits of the Fix

1. **Reliability**: Images are now stored in Supabase Storage, not dependent on Google API URLs
2. **Performance**: Images are served from Supabase CDN
3. **Cost Control**: No dependency on Google API quota for image serving
4. **Data Ownership**: Full control over image storage and access
5. **Consistency**: All new POIs will use the same image storage system

## Testing

After implementing the fixes:

1. **Test New POI Import**: Import a new POI and verify it uses Supabase Storage URLs
2. **Verify Edge Function**: Check that the Edge Function processes images correctly
3. **Check Database**: Ensure `attraction_image` table has the correct data structure

## Files Modified

- `app/poi-importer/page.tsx` - Fixed to use Edge Function
- `supabase/functions/store-poi-images/index.ts` - Fixed schema compatibility
- `supabase/migrate-attraction-image-schema.sql` - Database schema update
- `scripts/check-google-images.ts` - Analysis tool
- `scripts/migrate-google-images-to-supabase.ts` - Migration tool

## Next Steps

1. Deploy the updated Edge Function
2. Run the database schema migration
3. Test with a new POI import
4. Run the migration script for existing data (if needed)
5. Monitor the system to ensure everything works correctly

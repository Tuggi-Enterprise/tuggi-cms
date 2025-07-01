# POI Importer Image Storage System

## Overview

The POI Importer now uses a robust image storage system that properly manages Google Places photos through Supabase Edge Functions and Storage.

## Architecture

### Before (Issues)
- ❌ Direct Google Photos URLs (can expire)
- ❌ API key exposed in URLs
- ❌ No image backup/ownership
- ❌ Only 1 image per attraction
- ❌ No proper database structure

### After (Improved)
- ✅ Images downloaded and stored in Supabase Storage
- ✅ Secure API key handling through Edge Functions
- ✅ Multiple images per attraction supported
- ✅ Proper database structure with `attraction_image` table
- ✅ Thumbnail generation (ready for future enhancement)
- ✅ Primary image management

## Components

### 1. Edge Function: `store-poi-images`
**Location**: `supabase/functions/store-poi-images/index.ts`

**Purpose**: Downloads Google Places photos and stores them securely

**Features**:
- Downloads up to 5 photos per attraction
- Generates safe filenames from attraction names
- Stores images in `travel-app-images` bucket
- Creates database references in `attraction_image` table
- Updates attraction's primary image URL
- Handles errors gracefully

### 2. Updated POI Importer
**Location**: `app/poi-importer/page.tsx`

**Changes**:
- Removed direct Google Photos URLs
- Calls `store-poi-images` edge function after creating attraction
- Processes multiple photos per place
- Updates status during image processing
- Continues import even if image processing fails

### 3. Database Structure

#### `core.attraction_image` table
```sql
- id: uuid (primary key)
- attraction_id: uuid (foreign key to attractions)
- image_url: text (public URL)
- thumbnail_url: text (thumbnail public URL)  
- bucket_path: text (storage path)
- alt_text: text (for accessibility)
- is_primary: boolean (primary image flag)
- source: text ('google_places')
- google_photo_reference: text (original reference)
- created_at: timestamp
```

#### `core.attractions` table updates
- `image_url` field now contains Supabase Storage URL
- Removed `photos_references` array field

## Storage Structure

```
supabase storage: travel-app-images bucket
├── [existing images] (preserved)
├── poi-images/
│   ├── place-name-1-timestamp.jpg
│   ├── place-name-2-timestamp.jpg
│   └── ...
└── poi-images/thumbnails/
    ├── place-name-1-timestamp.jpg
    ├── place-name-2-timestamp.jpg
    └── ...
```

## Deployment Steps

1. **Deploy Edge Function**:
   ```bash
   supabase functions deploy store-poi-images
   ```

2. **Use Existing Storage Bucket**:
   - Using existing `travel-app-images` bucket
   - ✅ No setup needed - existing bucket will be used
   - ✅ All existing images preserved

3. **Set Environment Variables**:
   - `VITE_GOOGLE_MAPS_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

4. **Apply RLS Policies**:
   Run `docs/fix-rls-policies.sql` in Supabase SQL Editor

## Benefits

1. **Reliability**: Images stored permanently, won't expire
2. **Performance**: Optimized image serving through CDN
3. **Security**: API keys hidden on server-side
4. **Scalability**: Multiple images per attraction
5. **Management**: Full control over image lifecycle
6. **Analytics**: Track image usage and storage

## Future Enhancements

- **Image Optimization**: Actual thumbnail generation with image processing
- **Multiple Sizes**: Generate different image sizes for different use cases  
- **Alt Text Generation**: AI-powered alt text for accessibility
- **Image Moderation**: Content filtering and approval workflow
- **Lazy Loading**: Progressive image loading in UI
- **Image Analytics**: Track most viewed/popular images

## Error Handling

The system is designed to be fault-tolerant:
- POI import continues even if image processing fails
- Individual image failures don't stop the batch
- Detailed error logging for debugging
- Graceful fallbacks to ensure data integrity

## Migration from Old System

Existing POIs with direct Google URLs will continue to work, but new imports will use the improved storage system. A migration script could be created to upgrade existing POIs if needed. 
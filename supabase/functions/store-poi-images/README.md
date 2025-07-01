# Store POI Images Edge Function

This Supabase Edge Function downloads Google Places photos and stores them properly in Supabase Storage with references in the `attraction_image` table.

## Features

- Downloads photos from Google Places API
- Stores images in Supabase Storage (`travel-app-images` bucket)
- Creates thumbnails (placeholder for now)
- Saves references in `attraction_image` table
- Updates attraction's primary image URL
- Handles up to 5 images per attraction
- Generates safe filenames from attraction names

## Deployment

### 1. Install Supabase CLI

```bash
npm install -g supabase
```

### 2. Login to Supabase

```bash
supabase login
```

### 3. Link to your project

```bash
supabase link --project-ref YOUR_PROJECT_REF
```

### 4. Deploy the function

```bash
supabase functions deploy store-poi-images
```

### 5. Set environment variables

In your Supabase Dashboard > Edge Functions > store-poi-images > Settings:

- `VITE_GOOGLE_MAPS_API_KEY`: Your Google Maps API key
- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_ANON_KEY`: Your Supabase anon key
- `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key

## Storage Setup

### Using existing travel-app-images bucket

The function uses your existing `travel-app-images` bucket:
- ✅ Bucket already exists
- ✅ Images will be stored alongside existing content
- ✅ No data loss or migration needed

### Storage Structure

Uses your existing organization pattern:

```
travel-app-images bucket/
├── [existing images] (preserved)
├── ChIJ9YznpucnQg0RjLZBguGIzUI/
│   ├── ChIJ9YznpucnQg0RjLZBguGIzUI_1750278061017_1.jpg
│   ├── ChIJ9YznpucnQg0RjLZBguGIzUI_1750278061017_2.jpg
│   └── ...
└── AnotherGooglePlaceId/
    ├── AnotherGooglePlaceId_1750278123456_1.jpg
    └── ...
```

**Pattern**: `{googlePlaceId}/{googlePlaceId}_{timestamp}_{index}.jpg`

## Database Requirements

The function expects these tables:

- `core.attractions` - POI data
- `core.attraction_image` - Image references with your existing schema:
  - `id` (uuid)
  - `attraction_id` (text)
  - `storage_path` (text) - Path in bucket
  - `photo_reference` (text) - Original Google reference
  - `created_at` (timestamp)
- `core.attraction_coordinate` - POI coordinates

## Usage

The POI Importer will automatically call this function when importing places with photos.

## API Request Format

```json
{
  "attractionId": "uuid",
  "googlePlaceId": "ChIJ...",
  "photoReferences": ["photo_ref_1", "photo_ref_2"],
  "attractionName": "Place Name"
}
```

## API Response Format

```json
{
  "success": true,
  "processed": 3,
  "total": 3,
  "images": [
    {
      "id": "uuid",
      "url": "https://tysnkzmljlmmqpbotkxv.supabase.co/storage/v1/object/public/travel-app-images/ChIJ9YznpucnQg0RjLZBguGIzUI/ChIJ9YznpucnQg0RjLZBguGIzUI_1750278061017_1.jpg",
      "storage_path": "ChIJ9YznpucnQg0RjLZBguGIzUI/ChIJ9YznpucnQg0RjLZBguGIzUI_1750278061017_1.jpg"
    }
  ]
}
``` 
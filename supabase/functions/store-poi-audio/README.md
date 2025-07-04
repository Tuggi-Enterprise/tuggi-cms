# Store POI Audio Edge Function

This Supabase Edge Function uploads audio files (generated from OpenAI TTS) to Supabase Storage and updates the `attraction_descriptions` table with the audio URL.

## Features

- Uploads audio files to Supabase Storage (`travel-app-audios` bucket)
- Updates `attraction_descriptions` table with `audio_url`
- Handles base64 encoded audio data from OpenAI TTS
- Creates folder structure: `audio/{attractionId}/filename`
- Generates unique filenames with timestamps
- Supports multiple languages (defaults to pt-br)

## Deployment

### 1. Deploy the function

```bash
supabase functions deploy store-poi-audio
```

**Note**: If you encounter module import errors, the function now includes CORS headers directly to avoid import path issues during deployment.

### 2. Set environment variables

In your Supabase Dashboard > Edge Functions > store-poi-audio > Settings:

- `PROJECT_URL`: Your Supabase project URL
- `SERVICE_ROLE_KEY`: Your Supabase service role key

## Storage Setup

### Create travel-app-audios bucket

The function expects a `travel-app-audios` bucket in Supabase Storage:

1. Go to Storage in your Supabase Dashboard
2. Create a new bucket named `travel-app-audios`
3. Set appropriate permissions (public read recommended)

### Storage Structure

```
travel-app-audios bucket/
├── audio/
│   ├── attraction-id-1/
│   │   ├── narration-attraction-id-1-pt-br-1234567890.mp3
│   │   └── narration-attraction-id-1-en-1234567891.mp3
│   ├── attraction-id-2/
│   │   └── narration-attraction-id-2-pt-br-1234567892.mp3
│   └── ...
```

**Pattern**: `audio/{attractionId}/narration-{attractionId}-{language}-{timestamp}.mp3`

## Database Requirements

The function updates the `core.attraction_descriptions` table:

- `id` (uuid)
- `attraction_id` (text)
- `language` (text)
- `audio_url` (text) - Updated by this function
- `description` (text)
- `play_count` (integer)
- `last_played_at` (timestamp)
- `created_at` (timestamp)
- `updated_at` (timestamp)

## Usage

Called from the POI Details Modal when generating audio narration.

## API Request Format

```json
{
  "attractionId": "uuid",
  "audioData": "base64-encoded-audio-data",
  "mimeType": "audio/mpeg",
  "language": "pt-br"
}
```

## API Response Format

```json
{
  "success": true,
  "audio": {
    "id": "uuid",
    "url": "https://your-project.supabase.co/storage/v1/object/public/travel-app-audios/audio/attraction-id/narration-attraction-id-pt-br-1234567890.mp3",
    "storage_path": "audio/attraction-id/narration-attraction-id-pt-br-1234567890.mp3",
    "size": 12345
  }
}
```

## Error Handling

The function handles:
- Missing authorization headers
- Invalid request parameters
- Storage upload failures
- Database update errors
- File format validation

## Security

- Requires proper authorization headers
- Uses service role for database operations
- Validates input parameters
- Sanitizes file paths and names 
# Generate Translated Audio Edge Function

This Supabase Edge Function generates translated and narrated versions of POI descriptions. It integrates with Gemini 1.5 Pro for translation and Google Cloud Text-to-Speech for audio generation.

## Features

- Fetches original Portuguese descriptions from `core.attraction_descriptions`
- Uses Gemini 1.5 Pro for professional tourism translation
- Generates high-quality audio with Google Cloud TTS
- Supports multiple languages and voice genders
- Tracks voice gender used for each description in database
- Uploads audio to Supabase Storage (`travel-app-audios` bucket)
- Updates `attraction_descriptions` table with translated text and audio URL
- Idempotent operations with unique constraint (prevents duplicates)

## Deployment

### 1. Deploy the function

```bash
supabase functions deploy generate-translated-audio
```

### 2. Set environment variables

In your Supabase Dashboard > Edge Functions > generate-translated-audio > Settings:

- `PROJECT_URL`: Your Supabase project URL (or `SUPABASE_URL`)
- `SERVICE_ROLE_KEY`: Your Supabase service role key
- `GEMINI_API_KEY`: Your Google Gemini API key
- `GOOGLE_TTS_API_KEY`: Your Google Cloud TTS API key (recommended - same as Next.js, has billing enabled)
- `GOOGLE_CLOUD_API_KEY`: Fallback Google Cloud API key (or fallback to `GEMINI_API_KEY`)

## Supported Languages

The function supports the following languages with neural voices:

| Language | Code | Male Voice | Female Voice |
|----------|------|------------|--------------|
| English (US) | `en`, `en-us` | en-US-Neural2-J | en-US-Neural2-F |
| Spanish (Spain) | `es`, `es-es` | es-ES-Neural2-B | es-ES-Neural2-A |
| French (France) | `fr`, `fr-fr` | fr-FR-Neural2-B | fr-FR-Neural2-A |
| German | `de`, `de-de` | de-DE-Neural2-B | de-DE-Neural2-A |
| Italian | `it`, `it-it` | it-IT-Neural2-C | it-IT-Neural2-A |
| Portuguese (Brazil) | `pt`, `pt-br` | pt-BR-Neural2-B | pt-BR-Neural2-A |

**Note**: If an unsupported language is provided, the function falls back to English (US).

## API Usage

### Request Format

```json
{
  "attractionId": "uuid-of-the-attraction",
  "targetLanguage": "en-us",
  "voiceGender": "female"
}
```

### Response Format

**Success (200):**
```json
{
  "success": true,
  "data": {
    "audioUrl": "https://your-project.supabase.co/storage/v1/object/public/travel-app-audios/audio/attraction-id/attraction-id-en-us.mp3",
    "translatedText": "This magnificent cathedral stands as one of the most impressive..."
  }
}
```

**Error (400/401/500):**
```json
{
  "error": "Error message describing what went wrong"
}
```

## Storage Structure

Audio files are stored in the `travel-app-audios` bucket with the following pattern:

```
travel-app-audios/
├── audio/
│   ├── attraction-id-1/
│   │   ├── attraction-id-1-en.mp3
│   │   ├── attraction-id-1-es.mp3
│   │   └── attraction-id-1-fr.mp3
│   ├── attraction-id-2/
│   │   ├── attraction-id-2-en.mp3
│   │   └── attraction-id-2-de.mp3
│   └── ...
```

**Pattern**: `audio/{attractionId}/{attractionId}-{language}.mp3`

## Database Requirements

### Tables Used

1. **`core.attraction_descriptions`** (primary table)
   - `id` (uuid) - Primary key
   - `attraction_id` (uuid) - Reference to attraction
   - `language` (text) - Language code (e.g., 'en-us', 'pt-br')
   - `description` (text, NOT NULL) - Translated description text
   - `audio_url` (text) - Public URL to generated audio
   - `gender` (text, NOT NULL) - Voice gender used ('male' or 'female')
   - `play_count` (integer) - Usage statistics
   - `created_at` (timestamp)
   - `updated_at` (timestamp)
   - `group_id` (uuid) - Optional reference to attraction group
   - **Unique constraint**: `(attraction_id, language)`

2. **`core.attractions`** (referenced)
   - Main attractions table

### Expected Workflow

1. **Original Description**: The function looks for Portuguese descriptions with language codes `'pt'` or `'pt-br'`
2. **Translation**: Uses Gemini 1.5 Pro to translate to target language
3. **Audio Generation**: Creates MP3 audio using Google Cloud TTS
4. **Storage**: Uploads to Supabase Storage bucket
5. **Database Update**: Inserts or updates `attraction_descriptions` record

## Error Handling

The function handles various error scenarios:

- **Missing Original Description**: Returns error if no Portuguese description exists
- **API Failures**: Handles Gemini API and Google TTS API errors gracefully
- **Storage Issues**: Reports upload failures with descriptive messages
- **Database Errors**: Catches and reports database operation failures
- **Authentication**: Requires valid authorization header

## Security

- **Authentication Required**: Function checks for authorization header
- **Service Role Access**: Uses service role for database operations
- **API Key Validation**: Validates required environment variables
- **Input Validation**: Validates all input parameters

## Audio Specifications

- **Format**: MP3
- **Sample Rate**: 24kHz
- **Encoding**: Mono, 64kbps equivalent
- **Voice Technology**: Google Cloud Neural voices
- **Language Detection**: Automatic based on target language code

## Integration with RPC Function

This Edge Function is designed to work with the `core.generate_translated_audio` RPC function:

```sql
SELECT * FROM core.generate_translated_audio(
  'attraction-uuid',
  'en-us',
  'female'
);
```

The RPC function provides a SQL interface that calls this Edge Function internally.

## Troubleshooting

### Common Issues

1. **"Original Portuguese description not found"**
   - Ensure the attraction has a description with language 'pt' or 'pt-br'

2. **"Missing required API keys"**
   - Check that `GEMINI_API_KEY` and `GOOGLE_TTS_API_KEY` (or `GOOGLE_CLOUD_API_KEY`) are set
   - **Note**: Use `GOOGLE_TTS_API_KEY` (same as Next.js) to ensure billing is enabled

3. **"Failed to upload audio"**
   - Verify `travel-app-audios` bucket exists and is accessible

4. **"Gemini API error" / "Google TTS API error"**
   - Check API key validity and quota limits

### Testing

You can test the function using curl:

```bash
curl -X POST \
  'https://your-project.supabase.co/functions/v1/generate-translated-audio' \
  -H 'Authorization: Bearer YOUR_ANON_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "attractionId": "your-attraction-uuid",
    "targetLanguage": "en-us",
    "voiceGender": "female"
  }'
```

## Performance Notes

- **Translation Time**: ~2-5 seconds depending on text length
- **Audio Generation**: ~3-8 seconds depending on text length
- **Total Processing**: ~5-15 seconds per request
- **Caching**: Results are cached in database to avoid regeneration

## Limitations

- **Text Length**: Optimized for descriptions up to ~2000 characters
- **Rate Limits**: Subject to Google API rate limits
- **Language Support**: Limited to predefined voice mappings
- **Audio Quality**: Dependent on Google Cloud TTS service availability 
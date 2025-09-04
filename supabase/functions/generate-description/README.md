# Generate Description Edge Function

Edge Function that uses the modular `DescriptionService` to generate POI descriptions.

## Features

- ✅ **JWT Authentication**: Validates user tokens
- ✅ **Permission System**: Checks `description:generate` permission  
- ✅ **Rate Limiting**: Protects against abuse
- ✅ **OSM Enrichment**: Automatic data enrichment
- ✅ **RAG System**: Dynamic source fetching and processing
- ✅ **Quality Analysis**: Comprehensive description scoring
- ✅ **ProcessingResult<T>**: Universal response interface

## Usage

### Request

```bash
curl -X POST 'https://your-project.supabase.co/functions/v1/generate-description' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "poi_data": {
      "id": "uuid-here",
      "name": "Nome do POI",
      "city": "Cidade",
      "country": "Brasil",
      "google_types": ["tourist_attraction"],
      "lat": -23.5505,
      "lng": -46.6333
    },
    "options": {
      "language": "pt-br",
      "use_dynamic_sources": true,
      "enrich_with_osm": true,
      "persist_verification": true,
      "auto_generate_audio": false
    }
  }'
```

### Response

```json
{
  "success": true,
  "processing_time": 15234,
  "data": {
    "description": "Generated description text...",
    "verification": {
      "aprovada": true,
      "pontuacao": 85
    },
    "quality_analysis": {
      "overall_score": 85,
      "confidence_level": "high"
    }
  },
  "metadata": {
    "step": "description_generation",
    "model_used": "pro",
    "quality_score": 85,
    "status": "completed",
    "timestamp": "2024-01-01T10:00:00.000Z"
  }
}
```

## Environment Variables Required

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY` (or `GOOGLE_GEMINI_API_KEY`)

## Permissions Required

- `description:generate` - Generate new descriptions
- User must be authenticated with valid JWT token

## Error Handling

All errors follow the `ProcessingResult<T>` interface:

```json
{
  "success": false,
  "error": "Error message",
  "processing_time": 1234,
  "metadata": {
    "step": "step_name",
    "status": "failed",
    "timestamp": "2024-01-01T10:00:00.000Z"
  }
}
```

## Performance

- **Cold start**: ~2-3 seconds
- **Warm execution**: ~10-20 seconds (depending on RAG complexity)
- **Memory usage**: ~128MB
- **Timeout**: 60 seconds

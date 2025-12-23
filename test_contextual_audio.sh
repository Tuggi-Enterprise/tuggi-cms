#!/bin/bash

# Configuration
# FUNCTION_URL="https://[YOUR_REF].supabase.co/functions/v1/generate-contextual-narration"
FUNCTION_URL="${FUNCTION_URL:-http://localhost:54321/functions/v1/generate-contextual-narration}"
AUTH_TOKEN="${AUTH_TOKEN:-YOUR_ANON_KEY}"
POI_ID="${POI_ID:-some-uuid}"

echo "Testing Contextual Audio Function..."
echo "URL: $FUNCTION_URL"

# Test 1: Generate Text
echo ""
echo "--- Test 1: Generate Text ---"
curl -X POST "$FUNCTION_URL" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "generate_text",
    "poi_id": "'"$POI_ID"'",
    "travel_mode": "drive",
    "user_context": {
      "location": { "latitude": -23.5505, "longitude": -46.6333 },
      "speed": 60,
      "heading": 90,
      "language": "pt-BR"
    }
  }'

# Test 2: Generate Audio
echo ""
echo "--- Test 2: Generate Audio ---"
curl -X POST "$FUNCTION_URL" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "generate_audio",
    "poi_id": "'"$POI_ID"'",
    "travel_mode": "drive",
    "user_context": {
      "location": { "latitude": -23.5505, "longitude": -46.6333 },
      "speed": 60,
      "heading": 90,
      "language": "pt-BR"
    },
    "text_content": "This is a test narration text."
  }'

echo ""
echo "Done."

#!/bin/bash

# Configuration
# Usage: ./test_native_audio.sh [POI_ID] [AUTH_TOKEN]
FUNCTION_URL="${FUNCTION_URL:-http://localhost:54321/functions/v1/generate-native-narration}"
AUTH_TOKEN="${2:-YOUR_ANON_KEY}"
POI_ID="${1:-some-uuid}"

echo "Testing JIT Native Audio Function..."
echo "URL: $FUNCTION_URL"
echo "POI: $POI_ID"

# Test: Generate Native Audio
echo ""
echo "--- Requesting JIT Audio ---"
curl -v -X POST "$FUNCTION_URL" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "poi_id": "'"$POI_ID"'",
    "language": "pt-pt",
    "travel_mode": "drive",
    "user_context": {
      "heading": 90,
      "bearing": 180.5,
      "previous_poi_id": "PREV_POI_UUID",
      "next_poi_id": "NEXT_POI_UUID",
      "next_poi_bearing": 270.0,
      "last_visit_timestamp": "2023-10-27T10:00:00Z",
      "current_location": { "lat": -23.5505, "lng": -46.6333 },
      "last_poi_location": { "lat": -23.5510, "lng": -46.6340 },
      "next_poi_location": { "lat": -23.5600, "lng": -46.6400 }
    },
    "voice_name": "charon"
  }'

echo ""
echo "Done."

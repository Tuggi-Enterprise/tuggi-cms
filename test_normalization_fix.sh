#!/bin/bash

# Configuration
URL="https://tysnkzmljlmmqpbotkxv.supabase.co/functions/v1/generate-contextual-narration"
AUTH_TOKEN="$SUPABASE_ANON_KEY"

# Real POI ID from logs
POI_ID="50cd5835-70db-41be-9084-3adcae63c15e"

echo "🚀 Testing Normalization Fix with App Payload..."
echo "------------------------------------------------------------"

curl -i -X POST "$URL" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
  "action": "generate_text",
  "poi_id": "'$POI_ID'",
  "language": "en-us",
  "bearing": 317.9,
  "poi_type": "tuggi",
  "travel_mode": "drive",
  "user_context": {
    "location": {
      "latitude": -22.985799,
      "longitude": -46.522658
    },
    "speed": 180,
    "heading": 300.1074996174516,
    "language": "en-us"
  }
}'

echo -e "\n\n------------------------------------------------------------"
echo "✅ Test request sent."

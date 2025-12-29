#!/bin/bash

# Configuration
URL="https://tysnkzmljlmmqpbotkxv.supabase.co/functions/v1/generate-contextual-narration"
AUTH_TOKEN="$SUPABASE_ANON_KEY"

# Real POI IDs from Bragança Paulista
LAGO_TABOAO="967f53a6-87e2-3c0d-8e9c-5e88a7d9f75b"
LAGO_PADRES="75e27b48-363f-36cf-998f-3bff9bfb4b7c"
LOCOMOTIVA="b68362d1-52cc-4480-8085-1c504fa17595"

echo "🚀 Starting Database Integration Test..."
echo "------------------------------------------------------------"

# Test Case 1: Full Journey Arc (Previous: Locomotiva, Target: Lago Taboão, Next: Lago Padres)
echo "--- TEST 1: Full Journey Arc ---"
curl -i -X POST "$URL" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "generate_text",
    "target_poi": {
      "id": "'$LAGO_TABOAO'",
      "name": "Lago do Taboão",
      "bearing": 329.5,
      "distance": 400,
      "location": { "latitude": -22.972756, "longitude": -46.534323 }
    },
    "travel_mode": "drive",
    "user_context": {
      "speed": 60,
      "heading": 326.9,
      "language": "pt-br",
      "previous_poi": {
        "id": "'$LOCOMOTIVA'",
        "name": "Locomotiva Doutor Luiz Leme",
        "type": "Historical",
        "played_at": "'$(date -u -v-5M +"%Y-%m-%dT%H:%M:%SZ")'",
        "location": { "latitude": -22.969197, "longitude": -46.531139 }
      },
      "next_predicted_poi": {
        "id": "'$LAGO_PADRES'",
        "name": "Lago dos Padres",
        "type": "Nature",
        "bearing": 180
      }
    }
  }'

echo -e "\n\n------------------------------------------------------------"
echo "✅ Test request sent. Check output for 200 or 500."

#!/bin/bash
# Test script for the updated generate-contextual-narration endpoint
# Tests both generate_text and generate_audio actions with the new payload format

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "           Testing Updated Contextual Narration Payload            "
echo "═══════════════════════════════════════════════════════════════════"
echo ""

HASH_SUFFIX=$(date +%s)
BASE_URL="${SUPABASE_URL:-https://njxfkobpvejqbprqvqcf.supabase.co}/functions/v1/generate-contextual-narration"
AUTH_TOKEN="${SUPABASE_ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qeGZrb2JwdmVqcWJwcnF2cWNmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjYzNDM3MjAsImV4cCI6MjA0MTkxOTcyMH0.04oMxPadfv2HrL-pZ9TfYPE2lKqJLo3lM3I8KxJl7xw}"

echo -e "${BLUE}Endpoint:${NC} $BASE_URL"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Test 1: generate_text action
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${YELLOW}━━━ Test 1: generate_text ━━━${NC}"
echo ""

PAYLOAD_TEXT='{
  "action": "generate_text",
  "travel_mode": "drive",
  "hash": "test_text_hash_'$HASH_SUFFIX'",
  "target_poi": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "type": "tuggi",
    "name": "Lago dos Padres",
    "category": "natureza",
    "trigger_radius": 150,
    "priority": 1,
    "bearing": 45.5,
    "distance": 320,
    "location": {
      "latitude": -25.4284,
      "longitude": -49.2733
    }
  },
  "user_context": {
    "speed": 65.5,
    "heading": 180,
    "language": "pt-BR",
    "accuracy": 10.5,
    "altitude": 920,
    "platform": "ios",
    "app_version": "0.0.27",
    "timestamp": 1735560453000,
    "location": {
      "latitude": -25.4290,
      "longitude": -49.2740
    },
    "previous_poi": {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "name": "Mirante do Morro",
      "type": "tuggi",
      "played_at": "2025-12-30T12:30:00.000Z",
      "location": {
        "latitude": -25.4295,
        "longitude": -49.2750
      }
    },
    "next_poi": {
      "id": "770e8400-e29b-41d4-a716-446655440002",
      "type": "tuggi",
      "distance": 850,
      "bearing": 190,
      "name": "Cachoeira Véu de Noiva"
    },
    "user_profile": {
      "id": "880e8400-e29b-41d4-a716-446655440003",
      "email": "leandro@tuggi.com.br",
      "name": "Leandro Ramos",
      "tier": "premium"
    },
    "trip_session_id": "990e8400-e29b-41d4-a716-446655440004",
    "trip_start_timestamp": 1735555200000
  },
  "text_content": null
}'

echo "Sending request..."
echo ""

RESPONSE_TEXT=$(curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "$PAYLOAD_TEXT")

echo "Response:"
echo "$RESPONSE_TEXT" | jq '.' 2>/dev/null || echo "$RESPONSE_TEXT"
echo ""

# Check if success
if echo "$RESPONSE_TEXT" | jq -e '.success == true' > /dev/null 2>&1; then
  echo -e "${GREEN}✓ Test 1 PASSED${NC}"
  TEXT_CONTENT=$(echo "$RESPONSE_TEXT" | jq -r '.data.text_content')
else
  echo -e "${RED}✗ Test 1 FAILED${NC}"
  ERROR=$(echo "$RESPONSE_TEXT" | jq -r '.error // "Unknown error"')
  echo -e "${RED}Error: $ERROR${NC}"
  TEXT_CONTENT=""
fi

echo ""
echo "───────────────────────────────────────────────────────────────────"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Test 2: generate_audio action (with text_content from previous response)
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${YELLOW}━━━ Test 2: generate_audio ━━━${NC}"
echo ""

if [ -n "$TEXT_CONTENT" ] && [ "$TEXT_CONTENT" != "null" ]; then
  echo "Using text from Test 1 for audio generation..."
  echo ""
  
  # Escape the text content for JSON
  TEXT_ESCAPED=$(echo "$TEXT_CONTENT" | jq -Rs '.')
  
  PAYLOAD_AUDIO='{
  "action": "generate_audio",
  "travel_mode": "drive",
  "hash": "test_audio_hash_'$HASH_SUFFIX'",
  "target_poi": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "type": "tuggi",
    "name": "Lago dos Padres",
    "category": "natureza",
    "trigger_radius": 150,
    "priority": 1,
    "bearing": 45.5,
    "distance": 180,
    "location": {
      "latitude": -25.4284,
      "longitude": -49.2733
    }
  },
  "user_context": {
    "speed": 58.2,
    "heading": 175,
    "language": "pt-BR",
    "accuracy": 8.0,
    "altitude": 918,
    "platform": "ios",
    "app_version": "0.0.27",
    "timestamp": 1735560480000,
    "location": {
      "latitude": -25.4286,
      "longitude": -49.2735
    },
    "previous_poi": {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "name": "Mirante do Morro",
      "type": "tuggi",
      "played_at": "2025-12-30T12:30:00.000Z",
      "location": {
        "latitude": -25.4295,
        "longitude": -49.2750
      }
    },
    "next_poi": {
      "id": "770e8400-e29b-41d4-a716-446655440002",
      "type": "tuggi",
      "distance": 750,
      "bearing": 188,
      "name": "Cachoeira Véu de Noiva"
    },
    "user_profile": {
      "id": "880e8400-e29b-41d4-a716-446655440003",
      "email": "leandro@tuggi.com.br",
      "name": "Leandro Ramos",
      "tier": "premium"
    },
    "trip_session_id": "990e8400-e29b-41d4-a716-446655440004",
    "trip_start_timestamp": 1735555200000
  },
  "text_content": '"$TEXT_ESCAPED"'
}'

  RESPONSE_AUDIO=$(curl -s -X POST "$BASE_URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -d "$PAYLOAD_AUDIO")

  echo "Response:"
  echo "$RESPONSE_AUDIO" | jq '.' 2>/dev/null || echo "$RESPONSE_AUDIO"
  echo ""

  if echo "$RESPONSE_AUDIO" | jq -e '.success == true' > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Test 2 PASSED${NC}"
    AUDIO_URL=$(echo "$RESPONSE_AUDIO" | jq -r '.data.audio_url')
    if [ -n "$AUDIO_URL" ] && [ "$AUDIO_URL" != "null" ]; then
      echo -e "${GREEN}✓ Audio URL:${NC} $AUDIO_URL"
    fi
  else
    echo -e "${RED}✗ Test 2 FAILED${NC}"
    ERROR=$(echo "$RESPONSE_AUDIO" | jq -r '.error // "Unknown error"')
    echo -e "${RED}Error: $ERROR${NC}"
  fi
else
  echo -e "${YELLOW}⚠ Skipping Test 2 - no text content from Test 1${NC}"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "                         Test Complete                              "
echo "═══════════════════════════════════════════════════════════════════"

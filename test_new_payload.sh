#!/bin/bash
# Test script for the updated generate-contextual-narration endpoint
# Tests Single Shot Audio logic

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "           Testing Single Shot Audio Generation            "
echo "═══════════════════════════════════════════════════════════════════"
echo ""

HASH_SUFFIX=$(date +%s)
BASE_URL="${SUPABASE_URL:-https://tysnkzmljlmmqpbotkxv.supabase.co}/functions/v1/generate-contextual-narration"
AUTH_TOKEN="${SUPABASE_ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5c25aem1samxtbXFwYm90a3h2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjYzNDM3MjAsImV4cCI6MjA0MTkxOTcyMH0.04oMxPadfv2HrL-pZ9TfYPE2lKqJLo3lM3I8KxJl7xw}"

echo -e "${BLUE}Endpoint:${NC} $BASE_URL"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Test 3: Single Shot Audio (No Input Text)
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${YELLOW}━━━ Test 3: Single Shot Audio (No Input Text) ━━━${NC}"
echo "Calling generate_audio with text_content: null"
echo ""

PAYLOAD_AUDIO='{
  "action": "generate_audio",
  "travel_mode": "drive",
  "hash": "test_singleshot_'$HASH_SUFFIX'",
  "target_poi": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "type": "tuggi",
    "name": "Lago dos Padres",
    "category": "natureza",
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
    "next_poi_candidates": [
      {
        "id": "POI_CLOSE",
        "name": "Cachoeira Próxima",
        "type": "tuggi",
        "category": "Monument",
        "location": { "latitude": -25.4300, "longitude": -49.2745 } 
      }
    ]
  },
  "text_content": null
}'

echo "Sending request..."
echo ""

RESPONSE_AUDIO=$(curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "$PAYLOAD_AUDIO")

echo "Response:"
echo "$RESPONSE_AUDIO" | jq '.' 2>/dev/null || echo "$RESPONSE_AUDIO"
echo ""

# Check for success AND audio_url
if echo "$RESPONSE_AUDIO" | jq -e '.success == true' > /dev/null 2>&1; then
  AUDIO_URL=$(echo "$RESPONSE_AUDIO" | jq -r '.data.audio_url')
  TEXT_GENERATED=$(echo "$RESPONSE_AUDIO" | jq -r '.data.text_content')
  
  if [ -n "$AUDIO_URL" ] && [ "$AUDIO_URL" != "null" ]; then
    echo -e "${GREEN}✓ Test PASSED${NC}"
    echo -e "${GREEN}✓ Audio URL:${NC} $AUDIO_URL"
    echo -e "${GREEN}✓ Generated Text:${NC} ${TEXT_GENERATED:0:50}..."
  else
    echo -e "${RED}✗ Test FAILED - No Audio URL${NC}"
  fi
else
  echo -e "${RED}✗ Test FAILED - Request unsuccessful${NC}"
  ERROR=$(echo "$RESPONSE_AUDIO" | jq -r '.error // "Unknown error"')
  echo -e "${RED}Error: $ERROR${NC}"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Test 4: Wake Up Action
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${YELLOW}━━━ Test 4: Wake Up Action ━━━${NC}"
echo "Calling wake_up..."
echo ""

PAYLOAD_WAKEUP='{
  "action": "wake_up"
}'

RESPONSE_WAKEUP=$(curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "$PAYLOAD_WAKEUP")

echo "Response:"
echo "$RESPONSE_WAKEUP" | jq '.' 2>/dev/null || echo "$RESPONSE_WAKEUP"
echo ""

if echo "$RESPONSE_WAKEUP" | jq -e '.status == "awake"' > /dev/null 2>&1; then
  echo -e "${GREEN}✓ Wake Up Test PASSED${NC}"
else
  echo -e "${RED}✗ Wake Up Test FAILED${NC}"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Test 5: Missing Previous POI (Validation Rule)
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${YELLOW}━━━ Test 5: Missing Previous POI Rule ━━━${NC}"
echo "Calling generate_text WITHOUT previous_poi..."
echo ""

PAYLOAD_NO_PREV='{
  "action": "generate_text",
  "travel_mode": "drive",
  "hash": "test_noprev_'$HASH_SUFFIX'",
  "target_poi": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "type": "tuggi",
    "name": "Lago dos Padres",
    "category": "natureza",
    "bearing": 45.5,
    "distance": 320,
    "location": { "latitude": -25.4284, "longitude": -49.2733 }
  },
  "user_context": {
    "speed": 65.5,
    "heading": 180,
    "language": "pt-BR",
    "location": { "latitude": -25.4290, "longitude": -49.2740 },
    "previous_poi": null 
  }
}'

RESPONSE_NOPREV=$(curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "$PAYLOAD_NO_PREV")

echo "Response:"
echo "$RESPONSE_NOPREV" | jq '.' 2>/dev/null || echo "$RESPONSE_NOPREV"
echo ""

if echo "$RESPONSE_NOPREV" | jq -e '.code == "NO_PREVIOUS_POI"' > /dev/null 2>&1; then
  echo -e "${GREEN}✓ Missing Prev POI Test PASSED (Correctly rejected)${NC}"
else
  echo -e "${RED}✗ Missing Prev POI Test FAILED (Should have been rejected)${NC}"
fi
echo ""

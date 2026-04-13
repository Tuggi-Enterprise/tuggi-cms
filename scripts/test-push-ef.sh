#!/bin/bash
# Diagnostic: test what the SUPABASE_SERVICE_ROLE_KEY looks like as a JWT
set -a
source "$(dirname "$0")/../.env"
set +a

SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-$SUPABASE_URL}"
SERVICE_KEY="$SUPABASE_SERVICE_ROLE_KEY"

echo "=== JWT Diagnostic ==="
echo "Key length: ${#SERVICE_KEY}"
echo "Key prefix: ${SERVICE_KEY:0:20}..."
echo "Key suffix: ...${SERVICE_KEY: -10}"
echo ""

# Decode the JWT header and payload to see if it's valid
HEADER=$(echo "$SERVICE_KEY" | cut -d'.' -f1)
PAYLOAD=$(echo "$SERVICE_KEY" | cut -d'.' -f2)

echo "=== JWT Header ==="
echo "$HEADER" | base64 -d 2>/dev/null || echo "(base64 decode failed)"
echo ""
echo ""
echo "=== JWT Payload ==="
echo "$PAYLOAD" | base64 -d 2>/dev/null || echo "(base64 decode failed)"
echo ""
echo ""

echo "=== Test: Call firebase-push-notification/send directly (like curl) ==="
HTTP_CODE=$(curl -s -o /tmp/push_test_response.txt -w "%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "apikey: ${SERVICE_KEY}" \
  -d '{"type":"user","userIds":["00000000-0000-0000-0000-000000000000"],"notification":{"title":"Test","body":"Test body"},"priority":"high","ttl":3600}' \
  "${SUPABASE_URL}/functions/v1/firebase-push-notification/send")
echo "HTTP $HTTP_CODE"
cat /tmp/push_test_response.txt
echo ""
echo ""

echo "=== Test: Call daily-gamification-orchestrator (which internally calls push) ==="
HTTP_CODE=$(curl -s -o /tmp/orch_test_response.txt -w "%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "apikey: ${SERVICE_KEY}" \
  -d '{}' \
  "${SUPABASE_URL}/functions/v1/daily-gamification-orchestrator")
echo "HTTP $HTTP_CODE"
cat /tmp/orch_test_response.txt
echo ""
echo ""

echo "=== Done ==="

// Edge Function: places-movement (#827, épico #802)
//
// How many app users passed within 300 m of a point in the last 30 days, for the Portal
// Locais. Contract: `docs/contracts/places-cms.md` (workspace).
//
// Called server-to-server by the portal's Worker with `x-places-secret`; deploy with
// `--no-verify-jwt`. Aggregate only: below 100 people `partner.place_movement` returns no
// number, and this function passes that on as `people_count: null`.

import { createAdminClient } from '../_shared/supabase-client.ts';
import { isPlacesSecret, PLACES_SECRET_HEADER } from '../_shared/places-secret.ts';
import { parseMovementRequest, shapeMovementResponse } from '../_shared/place-story-preview.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!isPlacesSecret(req.headers.get(PLACES_SECRET_HEADER))) {
    return json(401, { error: 'unauthorized' });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_body' });
  }
  const point = parseMovementRequest(body);
  if (!point) return json(400, { error: 'invalid_body' });

  const { data, error } = await createAdminClient()
    .schema('partner')
    .rpc('place_movement', { p_lat: point.lat, p_lng: point.lng });

  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) {
    // The code only: the message of a PostgREST error can echo the arguments.
    console.error('[places-movement] place_movement failed', error?.code ?? 'no_row');
    return json(502, { error: 'upstream_failed' });
  }

  return json(200, shapeMovementResponse(row as Record<string, unknown>));
});

// Edge Function: places-measures (#1145)
//
// The measures of BR-B2B-068 (commission state, listened, saved, downloaded, profile visits) of the
// partner behind a submission, for the overview of the Portal Locais. Contract:
// `docs/contracts/places-cms.md` (workspace). The portal's Worker checks the session and the ownership
// of the submission, then calls here with `x-places-secret`; deploy with `--no-verify-jwt`. The partner
// is resolved from the submission row, never taken from the request. Logic: `_shared/places-measures.ts`.

import { createAdminClient } from '../_shared/supabase-client.ts';
import { isPlacesSecret, PLACES_SECRET_HEADER } from '../_shared/places-secret.ts';
import { handlePlacesMeasures } from '../_shared/places-measures.ts';

Deno.serve((req: Request) => {
  const admin = createAdminClient();
  return handlePlacesMeasures(req, {
    isAuthorized: (r) => isPlacesSecret(r.headers.get(PLACES_SECRET_HEADER)),
    submission: async (submissionId) => {
      const { data, error } = await admin
        .schema('partner')
        .from('place_submissions')
        .select('client_id, legacy_client_id, attraction_id')
        .eq('id', submissionId)
        .maybeSingle();
      return { data, error };
    },
    attractionPartner: async (attractionId) => {
      const { data, error } = await admin
        .schema('core')
        .from('attractions')
        .select('partner_client_id')
        .eq('id', attractionId)
        .maybeSingle();
      return { data: data?.partner_client_id ?? null, error };
    },
    measures: async (clientId, month) => {
      const { data, error } = await admin
        .schema('partner')
        .rpc('get_partner_measures_as', { p_client_id: clientId, p_month: month });
      return { data, error };
    },
  });
});

// Edge Function: places-report (#907, cycles since #993)
//
// The published cycle reports of a live place for the Portal Locais (BR-B2B-059). Contract:
// `docs/contracts/places-cms.md` (workspace). The portal's Worker checks the session and the
// ownership of the submission, then calls here with `x-places-secret`; deploy with
// `--no-verify-jwt`. The list is `partner.report_cycle_list`'s; the logic is in
// `_shared/places-report.ts`.

import { createAdminClient } from '../_shared/supabase-client.ts';
import { isPlacesSecret, PLACES_SECRET_HEADER } from '../_shared/places-secret.ts';
import { handlePlacesReport } from '../_shared/places-report.ts';

Deno.serve((req: Request) =>
  handlePlacesReport(req, {
    isAuthorized: (r) => isPlacesSecret(r.headers.get(PLACES_SECRET_HEADER)),
    cycleList: async (submissionId) => {
      const { data, error } = await createAdminClient()
        .schema('partner')
        .rpc('report_cycle_list', { p_submission_id: submissionId });
      return { data, error };
    },
  })
);

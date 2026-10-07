// _shared/places-payout-runtime.ts — the Deno wiring of `_shared/places-payout.ts` (#903).
//
// Reads with the service role; e-mail through Resend (`sendEmail` of the access-link runtime, the
// same sender and From name as the portal's e-mails); alerts through `places-payment-runtime.ts`.
// Secrets: the Asaas ones of `places-payment` (ASAAS_BASE_URL, ASAAS_API_KEY), RESEND_API_KEY,
// RESEND_FROM, PARTNER_ALERT_TO. No new secret here.

import { createAdminClient } from './supabase-client.ts';
import { alert, rpcOf } from './places-payment-runtime.ts';
import { sendEmail } from './places-access-link-runtime.ts';
import type { AsaasClient } from './asaas.ts';
import { nextMonth, type PayoutContext, type PayoutDeps } from './places-payout.ts';

export function payoutDeps(asaas: AsaasClient): PayoutDeps {
  const admin = createAdminClient();
  const partner = () => admin.schema('partner');

  // deno-lint-ignore no-explicit-any
  async function contextOf(po: any): Promise<PayoutContext> {
    const [acc, key, items, deadline] = await Promise.all([
      partner().from('place_acceptances').select('email, signer_name, legal_name, place_submissions(attraction_id)').eq('id', po.acceptance_id).maybeSingle(),
      partner().from('place_payout_pix_keys').select('pix_key').eq('acceptance_id', po.acceptance_id).maybeSingle(),
      partner().from('place_payout_items').select('id', { count: 'exact', head: true }).eq('payout_id', po.id).eq('kind', 'purchase').is('voided_at', null),
      partner().rpc('last_business_day', { p_day: nextMonth(po.period_month) }),
    ]);
    const failed = acc.error ?? key.error ?? items.error ?? deadline.error;
    if (failed) throw new Error(`payout context read ${failed.code}`);
    const sub = acc.data?.place_submissions;
    const attractionId = (Array.isArray(sub) ? sub[0] : sub)?.attraction_id ?? null;
    let placeName = String(acc.data?.legal_name ?? '');
    if (attractionId) {
      const poi = await admin.schema('core').from('attractions').select('name').eq('id', attractionId).maybeSingle();
      if (poi.error) throw new Error(`payout place read ${poi.error.code}`);
      if (poi.data?.name) placeName = String(poi.data.name);
    }
    return {
      payoutId: po.id,
      status: po.status,
      amountCents: Number(po.amount_cents),
      periodMonth: String(po.period_month).slice(0, 10),
      payDeadline: String(deadline.data ?? '').slice(0, 10),
      placeName,
      email: acc.data?.email ?? null,
      signerName: acc.data?.signer_name ?? null,
      pixKey: key.data?.pix_key ?? null,
      purchases: items.count ?? 0,
    };
  }

  const COLUMNS = 'id, status, amount_cents, period_month, acceptance_id';
  return {
    admin: rpcOf(admin),
    asaas,
    alert,
    sendEmail,
    async payoutContext(payoutId) {
      const { data, error } = await partner().from('place_payouts').select(COLUMNS).eq('id', payoutId).maybeSingle();
      if (error) throw new Error(`payout read ${error.code}`);
      return data ? await contextOf(data) : null;
    },
    async periodPayouts(periodMonth) {
      const { data, error } = await partner().from('place_payouts').select(COLUMNS).eq('period_month', periodMonth).neq('status', 'cancelled');
      if (error) throw new Error(`period payouts read ${error.code}`);
      const out: PayoutContext[] = [];
      for (const po of data ?? []) out.push(await contextOf(po));
      return out;
    },
  };
}

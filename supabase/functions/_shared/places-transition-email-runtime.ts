// _shared/places-transition-email-runtime.ts — the Deno wiring of `places-transition-email.ts`
// (#813): service-role reads of the portal's tables, the state machine and the notice record.
// Used by `places-portal-notify` (approval) and `places-payment-sweep` (no ar, kit reminder).

import { createAdminClient } from './supabase-client.ts';
import { accessLinkDeps } from './places-access-link-runtime.ts';
import { alert } from './places-payment-runtime.ts';
import type { RpcError } from './places-portal-draft.ts';
import type { ApprovedRow, NoticeTarget, Plan, TransitionDeps } from './places-transition-email.ts';

const planOf = (v: unknown): Plan | null => (v === 'map_only' || v === 'map_and_description' ? v : null);
const errOf = (e: { code?: string; details?: string; message?: string } | null): RpcError | null =>
  e ? { code: e.code, details: e.details, message: e.message } : null;

export function transitionDeps(): TransitionDeps {
  const admin = createAdminClient();
  const partner = () => admin.schema('partner');
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    try {
      const { data, error } = await partner().rpc(fn, args);
      return { data, error: errOf(error) };
    } catch {
      return { data: null, error: { code: 'network' } as RpcError };
    }
  };
  return {
    ...accessLinkDeps(admin),
    alert,
    now: () => new Date(),
    async target(submissionId): Promise<NoticeTarget | null> {
      const [s, a] = await Promise.all([
        partner().from('place_submissions').select('id, status').eq('id', submissionId).maybeSingle(),
        partner().from('place_acceptances').select('email, plan_choice').eq('submission_id', submissionId).maybeSingle(),
      ]);
      if (s.error || a.error) throw new Error(`target read ${s.error?.code ?? a.error?.code}`);
      if (!s.data) return null;
      return { submissionId, status: s.data.status, email: a.data?.email ?? null, plan: planOf(a.data?.plan_choice) };
    },
    async approvedRows(): Promise<ApprovedRow[]> {
      const subs = await partner().from('place_submissions').select('id, attraction_id').eq('status', 'approved').limit(500);
      if (subs.error) throw new Error(`approved read ${subs.error.code}`);
      // deno-lint-ignore no-explicit-any
      const rows = (subs.data ?? []) as any[];
      if (!rows.length) return [];
      const ids = rows.map((r) => r.id as string);
      const poiIds = rows.map((r) => r.attraction_id).filter((x): x is string => typeof x === 'string');
      const [pois, accs, trs] = await Promise.all([
        poiIds.length ? admin.schema('core').from('attractions').select('id').in('id', poiIds).eq('approved', true) : Promise.resolve({ data: [], error: null }),
        partner().from('place_acceptances').select('submission_id, email, plan_choice').in('submission_id', ids),
        partner().from('place_submission_transitions').select('submission_id, created_at').eq('to_status', 'approved').in('submission_id', ids),
      ]);
      const failed = pois.error ?? accs.error ?? trs.error;
      if (failed) throw new Error(`approved rows read ${failed.code}`);
      // deno-lint-ignore no-explicit-any
      const published = new Set(((pois.data ?? []) as any[]).map((p) => p.id));
      // deno-lint-ignore no-explicit-any
      const acc = new Map(((accs.data ?? []) as any[]).map((a) => [a.submission_id, a]));
      const approvedAt = new Map<string, string>();
      // deno-lint-ignore no-explicit-any
      for (const t of (trs.data ?? []) as any[]) {
        const cur = approvedAt.get(t.submission_id);
        if (!cur || t.created_at > cur) approvedAt.set(t.submission_id, t.created_at);
      }
      return rows.map((r) => ({
        submissionId: r.id,
        email: acc.get(r.id)?.email ?? null,
        plan: planOf(acc.get(r.id)?.plan_choice),
        published: typeof r.attraction_id === 'string' && published.has(r.attraction_id),
        approvedAt: approvedAt.get(r.id) ?? null,
      }));
    },
    async goLive(submissionId) {
      return (await rpc('transition_place_submission', { p_submission_id: submissionId, p_to: 'live', p_actor_kind: 'system', p_actor_user_id: null, p_note: null })).error;
    },
    recordNotice: (submissionId, kind) => rpc('record_place_submission_notice', { p_submission_id: submissionId, p_kind: kind }),
  };
}

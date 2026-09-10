
import { getSupabaseClient } from '@/lib/core/supabase-client';

// Every notification RPC below lives in `core` (core.get_notification_templates,
// core.create_notification_template, …). The browser client has no `db.schema`, so an
// unqualified .rpc() resolves against `public`: create/update/delete answered PGRST202
// (404) because no wrapper was ever created there, and read only worked through the
// `SELECT core.<same_name>(...)` wrappers added by
// supabase/migrations/20260628_audience_filter_ssot.sql. Pinning the schema on every call
// is also what stops the CMS from depending on `public` being an exposed API schema.

export type NotificationType = 'user' | 'topic' | 'broadcast';
export type NotificationStatus = 'sent' | 'pending' | 'processing' | 'failed';

export interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, any>;
  imageUrl?: string;
  badge?: number;
}

/**
 * The languages a push may be composed in — the APP's interface catalogue, five, by
 * BR-IDIOMA-001 item 3. It is deliberately NOT the newsletter's list (four: no `fr`) and
 * not the content catalogue (twelve): a push lands on the phone's notification tray, which
 * is app-interface surface, and `drive.profiles.language` is what the audience filter
 * matches by prefix (`core.build_audience_filter`).
 */
export const PUSH_LANGUAGES = ['pt', 'en', 'es', 'it', 'fr'] as const;
export type PushLanguage = (typeof PUSH_LANGUAGES)[number];

/** Title + body of one language of a campaign. */
export interface PushContent {
  title: string;
  body: string;
}

export type PushContentByLanguage = Partial<Record<PushLanguage, PushContent>>;

/**
 * `data.type` — the campaign key that makes a push MEASURABLE.
 *
 * `docs/contracts/notificacoes.md` §2.3: the Edge Function writes `data.type ?? 'generic'`
 * into `drive.user_notifications.type` and the app reports the same literal as the GA4
 * `push_type`. `generic` is a BUCKET, not a variant — two campaigns that omit the key
 * become one line in the report. So the composer never omits it.
 *
 * The value is free `snake_case` (contract §2.3). This normaliser is the only place that
 * decides what "snake_case" means for the CMS.
 */
export const CAMPAIGN_TYPE_FALLBACK = 'generic';

export function toCampaignType(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export interface ScheduleRequest {
  type: NotificationType;
  notification: NotificationPayload;
  userIds?: string[];
  topic?: string;
  scheduleAt?: string; // Optional for immediate send
  priority?: 'high' | 'normal';
  ttl?: number;
  filters?: AudienceFilters; // broadcast audience segmentation (SSOT: audience-types)
  /**
   * Per-language copy, `{ pt: { title, body }, en: { … } }`.
   *
   * `/send` fans a BROADCAST out into one pass per key, each narrowing `filters.language` to
   * that key and logging its own `notification_logs` row; a DIRECT push is one message, so the
   * function picks a single entry by `lang`. A language that is not a key receives nothing —
   * there is no silent fallback, because `core.build_audience_filter` has no "everything else"
   * operator and a fallback pass could only be the whole base again.
   *
   * `/schedule` does NOT read it: `marketing.scheduled_notifications` holds one title and one
   * body per row, so a per-language campaign is per-language rows.
   */
  localized?: Record<string, { title: string; body?: string }>;
}

export interface NotificationTemplate {
  id: string;
  name: string;
  title: string;
  body: string;
  category?: string;
  data?: Record<string, any>;
  image_url?: string;
  variables?: string[];
  is_active: boolean;
  created_at: string;
}

// AudienceFilters é compartilhado com a newsletter (mesma segmentação de
// drive.profiles) — SSOT em lib/services/marketing/audience-types.ts.
export type { AudienceFilters } from './marketing/audience-types';
import type { AudienceFilters } from './marketing/audience-types';

export const NotificationService = {
  /**
   * Estimate the number of users that match the given filters
   */
  async estimateAudience(filters: AudienceFilters): Promise<number> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.schema('core').rpc('estimate_notification_audience', {
      p_filters: filters,
    });

    if (error) {
      console.error('❌ Detailed RPC error:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });
      throw error;
    }

    return data || 0;
  },

  /**
   * Schedule a notification via the Edge Function
   */
  async schedule(request: ScheduleRequest) {
    // `/schedule` and `/send` are PATHS on one Edge Function, and `supabase.functions.invoke`
    // has no way to append one — hence the manual fetch in `_callFunctionEndpoint`.
    return this._callFunctionEndpoint('/schedule', request);
  },
  
  /**
   * Send an immediate notification
   */
  async sendImmediate(request: Omit<ScheduleRequest, 'scheduleAt'>) {
    return this._callFunctionEndpoint('/send', request);
  },

  // Helper to call specific function endpoints
  async _callFunctionEndpoint(endpoint: string, body: any) {
    const supabase = getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    // Use the client's function URL base if possible, but env var is safer fallback
    const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const response = await fetch(`${projectUrl}/functions/v1/firebase-push-notification${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Function call failed: ${errorText}`);
    }

    return response.json();
  },

  // Template Management (RPC Based)
  async getTemplates() {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.schema('core').rpc('get_notification_templates');
    if (error) throw error;
    return data as NotificationTemplate[];
  },

  async createTemplate(template: Omit<NotificationTemplate, 'id' | 'created_at'>) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.schema('core').rpc('create_notification_template', {
      p_template: template
    });
    if (error) throw error;
    return data;
  },
  
  async updateTemplate(id: string, updates: Partial<NotificationTemplate>) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.schema('core').rpc('update_notification_template', {
      p_id: id,
      p_updates: updates
    });
    if (error) throw error;
    return data;
  },

  async deleteTemplate(id: string) {
    const supabase = getSupabaseClient();
    const { error } = await supabase.schema('core').rpc('delete_notification_template', {
      p_id: id
    });
    if (error) throw error;
  },

  // Log Management (RPC Based)

  /**
   * One PAGE of the history, searched IN THE DATABASE.
   *
   * It used to be `p_limit: 50` with the search box filtering the 50 rows already in the
   * browser: campaign 51 was unreachable and the box quietly lied about it. We have six
   * e-mail campaigns today and push will pass fifty.
   *
   * DEPENDENCY (`data` owns the RPC — CLAUDE.md §1). The widened signature this asks for is
   *   core.get_notification_logs(p_limit int, p_offset int, p_search text)
   * The `catch` below is the bridge while that migration is not deployed: PostgREST answers
   * PGRST202 ("function not found") for the widened argument list, and until then the old
   * one-argument function is called and the page filters what it got. DELETE THE FALLBACK
   * once the migration lands — a fallback is how a signature that should be retired stays
   * in service.
   */
  async getLogs(opts: { limit?: number; offset?: number; search?: string } = {}) {
    const supabase = getSupabaseClient();
    const limit = opts.limit ?? 25;
    const offset = opts.offset ?? 0;
    const search = (opts.search ?? '').trim();

    const { data, error } = await supabase.schema('core').rpc('get_notification_logs', {
      p_limit: limit,
      p_offset: offset,
      p_search: search || null,
    });

    if (!error) return (data ?? []) as NotificationLog[];
    if (error.code !== 'PGRST202') throw error;

    const legacy = await supabase.schema('core').rpc('get_notification_logs', { p_limit: 50 });
    if (legacy.error) throw legacy.error;
    const rows = (legacy.data ?? []) as NotificationLog[];
    const needle = search.toLowerCase();
    const matched = needle
      ? rows.filter((r) => `${r.title} ${r.body}`.toLowerCase().includes(needle))
      : rows;
    return matched.slice(offset, offset + limit);
  },

  /**
   * The queue nobody could see. `/schedule` writes `marketing.scheduled_notifications`;
   * the history reads `marketing.notification_logs`. DIFFERENT TABLES — a pending item has
   * never once appeared in the history, and `status === 'scheduled'` was decoration for a
   * row that cannot exist there.
   *
   * DEPENDENCY (`data` owns the RPC): core.get_scheduled_notifications(p_limit int)
   */
  async getScheduled(limit = 50): Promise<ScheduledNotification[]> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .schema('core')
      .rpc('get_scheduled_notifications', { p_limit: limit });
    if (error) throw error;
    return (data ?? []) as ScheduledNotification[];
  },

  /**
   * Cancelling is a STATUS, never a DELETE (CLAUDE.md §3). The row is the only record that
   * the campaign was ever planned, and `/process-scheduled` selects `status = 'pending'`
   * — flipping the column is what stops it.
   *
   * DEPENDENCY (`data` owns the RPC): core.cancel_scheduled_notification(p_id uuid)
   */
  async cancelScheduled(id: string): Promise<void> {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .schema('core')
      .rpc('cancel_scheduled_notification', { p_id: id });
    if (error) throw error;
  },
};

export interface NotificationLog {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, any>;
  user_ids: string[];
  topic?: string;
  /**
   * `scheduled` is gone. A scheduled item lives in `marketing.scheduled_notifications` and
   * never reaches this table, so the branch that painted it was code nobody could call
   * (CLAUDE.md §6). The queue has its own section now — `ScheduledNotification`.
   *
   * `partial` is what a localized broadcast pass writes when FCM accepted some tokens and
   * refused others — the common outcome once dead registrations exist in the base, and a state
   * neither `sent` nor `failed` describes honestly.
   */
  status: 'sent' | 'failed' | 'partial';
  sent_at: string;
  created_at: string;

  /**
   * WHAT FCM ACCEPTED, per token — not what was delivered and not what was opened.
   *
   * The Edge Function has always counted these (`stats.success` / `stats.failure`) and
   * always thrown them at `console.log`. They are columns now, written by the EF (owned by
   * another agent — see the delivery note), and they are `undefined` for every row logged
   * before that lands, which is why every reader below tests for it.
   */
  success_count?: number | null;
  failure_count?: number | null;
  /** Size of the audience the send resolved to, before FCM saw a single token. */
  recipient_count?: number | null;
  /** The segmentation the operator actually sent to — `{}` means the whole base. */
  audience_filters?: AudienceFilters | null;
}

/** A row of `marketing.scheduled_notifications` — the queue, as the operator sees it. */
export interface ScheduledNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, any>;
  user_ids: string[] | null;
  topic: string | null;
  priority: 'high' | 'normal';
  /** UTC instant; the screen prints it in the operator's own zone. */
  scheduled_for: string;
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
  audience_filters: AudienceFilters | null;
  created_at: string;
}

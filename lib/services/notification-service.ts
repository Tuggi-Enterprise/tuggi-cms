
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

export interface ScheduleRequest {
  type: NotificationType;
  notification: NotificationPayload;
  userIds?: string[];
  topic?: string;
  scheduleAt?: string; // Optional for immediate send
  priority?: 'high' | 'normal';
  ttl?: number;
  filters?: AudienceFilters; // broadcast audience segmentation (SSOT: audience-types)
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
    const supabase = getSupabaseClient();
    // Use invoke to call the function path /schedule
    // Note: The function name is 'firebase-push-notification'. 
    // supabase-js invoke appends the second argument as body but doesn't easily append path unless configured.
    // However, for most Supabase setups, invoked functions are at /functions/v1/function-name.
    // To reach /schedule, we rely on the function's internal router.
    // We send payload to root, but add a property to specify actior OR we use a fetch wrapper.
    // BUT! Since we defined the function to use URL mapping, let's stick to the manual fetch helper used previously
    // to GUARANTEE we hit the right endpoint, OR update the function to read 'action' from body.
    
    // Actually, sticking to the standard `invoke` and updating the function to read from body is cleaner (KISS).
    // BUT I already deployed the function expecting URL paths.
    // So let's restore the helper method that does the fetch correctly, using getSupabaseClient() for the session token.
    
    // WAIT! `supabase.functions.invoke` DOES NOT Support paths easily in all versions.
    // It is simpler to keep the `_callFunctionEndpoint` helper I wrote before, but fix the client import.
    
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
  async getLogs() {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.schema('core').rpc('get_notification_logs', {
      p_limit: 50
    });
    if (error) throw error;
    return data as NotificationLog[];
  }
};

export interface NotificationLog {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, any>;
  user_ids: string[];
  topic?: string;
  status: 'sent' | 'failed' | 'scheduled';
  sent_at: string;
  created_at: string;
}

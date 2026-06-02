/**
 * Newsletter service (Módulo Marketing).
 *
 * Espelha o lib/services/notification-service.ts:
 *  - segmentação de audiência via RPC SECURITY DEFINER (.schema('marketing'))
 *  - campanhas via API routes admin-gated (padrão coupons, service-role)
 *  - envio/agendamento/preview via Edge Function send-newsletter
 *  - tradução via API route (Gemini)
 */

import { getSupabaseClient } from '@/lib/core/supabase-client';
import type { AudienceFilters } from '@/lib/services/marketing/audience-types';
import type {
  NewsletterCampaign,
  NewsletterCampaignInput,
  NewsletterCampaignStats,
  NewsletterContent,
  NewsletterContentByLanguage,
  NewsletterLanguage,
  NewsletterTemplate,
} from '@/types/newsletter';

export const NewsletterService = {
  /** Estima a audiência (RPC SECURITY DEFINER, já exclui opt-out). */
  async estimateAudience(filters: AudienceFilters): Promise<number> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .schema('marketing')
      .rpc('estimate_newsletter_audience', { p_filters: filters });
    if (error) throw error;
    return data || 0;
  },

  // ── Campanhas (API routes admin-gated) ──────────────────────────────────
  async listCampaigns(): Promise<NewsletterCampaign[]> {
    const res = await fetch('/api/admin/marketing/campaigns');
    if (!res.ok) throw new Error(await res.text());
    const json = await res.json();
    return json.campaigns;
  },

  async getCampaign(id: string): Promise<{ campaign: NewsletterCampaign; stats: NewsletterCampaignStats }> {
    const res = await fetch(`/api/admin/marketing/campaigns/${id}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async createCampaign(input: NewsletterCampaignInput): Promise<NewsletterCampaign> {
    const res = await fetch('/api/admin/marketing/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(await res.text());
    const json = await res.json();
    return json.campaign;
  },

  async updateCampaign(id: string, updates: Partial<NewsletterCampaignInput>): Promise<NewsletterCampaign> {
    const res = await fetch(`/api/admin/marketing/campaigns/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(await res.text());
    const json = await res.json();
    return json.campaign;
  },

  async deleteCampaign(id: string): Promise<void> {
    const res = await fetch(`/api/admin/marketing/campaigns/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await res.text());
  },

  // ── Tradução ────────────────────────────────────────────────────────────
  async translate(
    source: NewsletterContent,
    targetLanguages: NewsletterLanguage[]
  ): Promise<NewsletterContentByLanguage> {
    const res = await fetch('/api/admin/marketing/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, targetLanguages }),
    });
    if (!res.ok) throw new Error(await res.text());
    const json = await res.json();
    return json.translations;
  },

  // ── Envio / Agendamento / Preview (Edge Function) ────────────────────────
  async send(campaignId: string) {
    return this._callFunctionEndpoint('/send', { campaignId });
  },

  async schedule(campaignId: string, scheduledFor: string) {
    return this._callFunctionEndpoint('/schedule', { campaignId, scheduledFor });
  },

  async preview(content: NewsletterContent, language: NewsletterLanguage): Promise<string> {
    const { html } = await this._callFunctionEndpoint('/preview', { content, language });
    return html;
  },

  async _callFunctionEndpoint(endpoint: string, body: any) {
    const supabase = getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const response = await fetch(`${projectUrl}/functions/v1/send-newsletter${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Function call failed: ${await response.text()}`);
    return response.json();
  },

  // ── Templates (RPC .schema('marketing')) ─────────────────────────────────
  async getTemplates(): Promise<NewsletterTemplate[]> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.schema('marketing').rpc('get_newsletter_templates');
    if (error) throw error;
    return data as NewsletterTemplate[];
  },

  async createTemplate(template: Omit<NewsletterTemplate, 'id' | 'created_at'>) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .schema('marketing')
      .rpc('create_newsletter_template', { p_template: template });
    if (error) throw error;
    return data;
  },

  async updateTemplate(id: string, updates: Partial<NewsletterTemplate>) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .schema('marketing')
      .rpc('update_newsletter_template', { p_id: id, p_updates: updates });
    if (error) throw error;
    return data;
  },

  async deleteTemplate(id: string) {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .schema('marketing')
      .rpc('delete_newsletter_template', { p_id: id });
    if (error) throw error;
  },
};

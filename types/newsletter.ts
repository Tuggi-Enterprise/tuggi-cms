/**
 * Tipos do Módulo Marketing — Newsletter.
 */

import type { AudienceFilters } from '@/lib/services/marketing/audience-types';

export type NewsletterLanguage = 'pt' | 'en' | 'es' | 'it';

export const NEWSLETTER_LANGUAGES: NewsletterLanguage[] = ['pt', 'en', 'es', 'it'];

/** Blocos do composer (modelo novo). */
export type NewsletterBlock =
  | { type: 'heading'; text: string }
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; alt?: string; link?: string }
  | { type: 'button'; label: string; url: string; variant?: 'primary' | 'accent' }
  | { type: 'divider' };

export type NewsletterBlockType = NewsletterBlock['type'];

/** Conteúdo de um email, por idioma. `blocks` é o modelo novo; demais campos = legado. */
export interface NewsletterContent {
  subject?: string;
  preheader?: string; // texto de preview na inbox
  blocks?: NewsletterBlock[];
  // legado (compat):
  title?: string;
  paragraphs?: string[];
  cta_label?: string;
  cta_url?: string;
  hero_image_url?: string;
  hero_alt?: string;
}

/** Mapa idioma → conteúdo (ex.: { pt: {...}, en: {...} }). */
export type NewsletterContentByLanguage = Partial<Record<NewsletterLanguage, NewsletterContent>>;

/**
 * `cancelled` is what a scheduled campaign becomes when the operator calls it off. It is a
 * STATUS and never a `DELETE`: the schedule is the only undo window this module has, and a row
 * that disappears takes with it what was going to be sent, to whom, and who stopped it
 * (CLAUDE.md §3).
 */
/**
 * `partial` é um desfecho, não um enfeite: a campanha do Iceland alcançou 300 de 500 e ficou
 * gravada como `sent`, indistinguível de uma que alcançou todo mundo. Ele existe porque pede uma
 * ação diferente — reenviar para quem falhou, não para a base.
 *
 * O vocabulário é o do banco: `20260910_04_newsletter_campaign_progress.sql` põe um CHECK em
 * `status` com exatamente estes sete valores. Sinônimo aqui vira 23514 lá.
 */
export type NewsletterStatus =
  | 'draft'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'partial'
  | 'failed'
  | 'cancelled';

export interface NewsletterCampaign {
  id: string;
  name: string;
  default_language: NewsletterLanguage;
  content: NewsletterContentByLanguage;
  audience_filters: AudienceFilters;
  status: NewsletterStatus;
  /**
   * O disparo, em números. Colunas de `20260910_04_newsletter_campaign_progress.sql`:
   * `recipient_count` é o denominador gravado antes do primeiro lote, e o CHECK do banco garante
   * `sent_count + failed_count <= recipient_count`.
   */
  recipient_count?: number | null;
  sent_count?: number | null;
  failed_count?: number | null;
  started_at?: string | null;
  scheduled_for: string | null;
  sent_at: string | null;
  created_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type NewsletterCampaignInput = Pick<
  NewsletterCampaign,
  'name' | 'default_language' | 'content' | 'audience_filters'
>;

/** Métricas agregadas de uma campanha (lidas de newsletter_recipients). */
export interface NewsletterCampaignStats {
  total: number;
  delivered: number;
  opened: number;
  /** Contado por `click_count > 0`, nunca por `status = 'clicked'` — ver `computeStats`. */
  clicked: number;
  bounced: number;
  /** Destinatários desta campanha que se descadastraram depois do disparo dela. */
  unsubscribed: number;
  open_rate: number; // opened / delivered
}

export interface NewsletterTemplate {
  id: string;
  name: string;
  default_language: NewsletterLanguage;
  content: NewsletterContentByLanguage;
  category?: string;
  is_active: boolean;
  created_at: string;
}

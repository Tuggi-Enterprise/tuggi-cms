/**
 * Tipos do Módulo Marketing — Newsletter.
 */

import type { AudienceFilters } from '@/lib/services/marketing/audience-types';

export type NewsletterLanguage = 'pt' | 'en' | 'es';

export const NEWSLETTER_LANGUAGES: NewsletterLanguage[] = ['pt', 'en', 'es'];

/** Blocos do composer (modelo novo). */
export type NewsletterBlock =
  | { type: 'heading'; text: string }
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; alt?: string }
  | { type: 'button'; label: string; url: string }
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

export type NewsletterStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';

export interface NewsletterCampaign {
  id: string;
  name: string;
  default_language: NewsletterLanguage;
  content: NewsletterContentByLanguage;
  audience_filters: AudienceFilters;
  status: NewsletterStatus;
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
  clicked: number;
  bounced: number;
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

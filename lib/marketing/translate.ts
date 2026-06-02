/**
 * Marketing — tradução de conteúdo de newsletter (lado Node).
 *
 * Mesmo esquema de fallback de modelos do _shared/translationUtility.ts (Deno),
 * porém no runtime Node usado pela API route do painel. Traduz campo a campo o
 * conteúdo estruturado da campanha (subject/title/paragraphs/cta_label),
 * preservando URLs e placeholders {{ }}.
 */

import type { NewsletterContent } from '@/types/newsletter';

const LANGUAGE_NAMES: Record<string, string> = {
  pt: 'Brazilian Portuguese',
  en: 'English (United States)',
  es: 'Spanish (Spain)',
};

const MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-1.5-flash'];

async function runGemini(prompt: string, apiKey: string): Promise<string> {
  let lastError: Error | null = null;
  for (const model of MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        lastError = new Error(`Gemini ${model}: ${res.status} ${err?.error?.message || res.statusText}`);
        continue;
      }
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        lastError = new Error(`Gemini ${model}: empty response`);
        continue;
      }
      return String(text).trim();
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastError || new Error('All Gemini models failed');
}

async function translateSnippet(text: string, targetLang: string, apiKey: string): Promise<string> {
  if (!text || !text.trim()) return '';
  const langName = LANGUAGE_NAMES[targetLang] || targetLang;
  const prompt = `You are a professional marketing copy translator for a travel app called Tuggi.

Translate the marketing/email snippet below into the target language.

Rules:
- Keep the marketing tone: clear, friendly and engaging.
- Preserve meaning, intent and any call-to-action.
- Do NOT translate brand names, URLs, or placeholders wrapped in {{ }}.
- Keep it concise and natural for a native speaker.
- Output ONLY the translated snippet — no labels, quotes, or explanations.

TARGET LANGUAGE: ${langName} (code: ${targetLang})

SNIPPET:
${text}`;
  return runGemini(prompt, apiKey);
}

/**
 * Traduz um NewsletterContent inteiro para o idioma alvo (campo a campo).
 * URLs e imagens não são traduzidas.
 */
export async function translateNewsletterContent(
  source: NewsletterContent,
  targetLang: string,
  apiKey: string
): Promise<NewsletterContent> {
  const [subject, preheader, title, cta_label] = await Promise.all([
    translateSnippet(source.subject || '', targetLang, apiKey),
    translateSnippet(source.preheader || '', targetLang, apiKey),
    translateSnippet(source.title || '', targetLang, apiKey),
    translateSnippet(source.cta_label || '', targetLang, apiKey),
  ]);

  const paragraphs = await Promise.all(
    (source.paragraphs || []).map((p) => translateSnippet(p, targetLang, apiKey))
  );

  const blocks = source.blocks
    ? await Promise.all(
        source.blocks.map(async (b) => {
          if (b.type === 'heading' || b.type === 'text') {
            return { ...b, text: await translateSnippet(b.text, targetLang, apiKey) };
          }
          if (b.type === 'button') {
            return { ...b, label: await translateSnippet(b.label, targetLang, apiKey) };
          }
          return b; // image/divider: mantém (alt opcional)
        })
      )
    : undefined;

  return {
    subject,
    preheader,
    blocks,
    title,
    paragraphs,
    cta_label,
    cta_url: source.cta_url, // mantém
    hero_image_url: source.hero_image_url, // mantém
    hero_alt: source.hero_alt, // mantém (alt curto; opcional traduzir depois)
  };
}

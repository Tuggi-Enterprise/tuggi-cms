// Edge Function: send-newsletter
//
// Envia campanhas de newsletter via Resend, traduzidas por idioma do usuário,
// respeitando opt-out. Espelha o padrão da firebase-push-notification
// (router por path, CORS, admin client, logging por requestId).
//
// Routes:
//   POST /send                { campaignId }  -> send now                        [admin]
//   POST /schedule            { campaignId, scheduledFor }                       [admin]
//   POST /process-scheduled   -> drains due campaigns (cron)                   [machine]
//   POST /preview             { content, language } -> rendered HTML             [admin]
//   POST /send-test           { content, email, language }                       [admin]
//   POST /translate           { source, targetLanguages }                        [admin]
//   POST /audience-breakdown  { campaignId } | { audienceFilters, content, defaultLanguage }
//                             -> recipient count per language                    [admin]
//   POST /unsubscribe?e=&s=   -> RFC 8058 one-click                             [PUBLIC]
//   GET  /health                                                                [PUBLIC]
//
// AUTHORIZATION (#346). Every route that sends, schedules or reads the audience goes through
// `requireAdmin` (`_shared/auth-middleware.ts`) — the same mechanism the ~15 content functions
// already use, with the machine-key bypass that keeps the cron drain and the database trigger
// working. Before this, the function read no `Authorization` at all, and `verify_jwt` is
// satisfied by the publishable key, which ships inside the app binary and the site's JS: anyone
// holding it could send mail signed with our DKIM.
//
// ⚠️ DEPLOY: this function needs `--no-verify-jwt`. The `/unsubscribe` route is called by
//    Gmail/Yahoo with no key at all (RFC 8058), and the gateway would refuse it before our code
//    ran. Authorization now lives in the function BODY, not in the gateway — which is exactly
//    why the gateway can be turned off without opening anything.
//
// Secrets: RESEND_API_KEY, RESEND_FROM, APP_URL, NEWSLETTER_SECRET, PUBLIC_FUNCTIONS_URL
//   (+ TUGGI_SECRET_KEY / SUPABASE_URL já usados pelo _shared/supabase-client)

import { createAdminClient } from '../_shared/supabase-client.ts';
import { renderEmail, renderText, NewsletterContent } from '../_shared/emailLayout.ts';
import { translateText } from '../_shared/translationUtility.ts';
import { requireAdmin } from '../_shared/auth-middleware.ts';
import { slugifyCampaign } from '../_shared/newsletter-metrics.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RESEND_BATCH_URL = 'https://api.resend.com/emails/batch';
const BATCH_SIZE = 100; // limite da Resend por chamada /emails/batch
// https://resend.com/docs/api-reference/emails/send-batch-emails — "up to 100 emails in a
// single API call". `attachments` is the only field documented as unsupported; `headers` and
// `text` ARE supported, which is what the unsubscribe headers below depend on.

/**
 * Resend's requests-per-second ceiling, and why it is here.
 *
 * https://resend.com/docs/api-reference/introduction — "The default maximum rate limit is 10
 * requests per second per team", and anything over it answers `429`. It is PER TEAM, not per
 * key: `send-transactional` shares the same ceiling, so this loop must not spend all of it.
 * 5 rps leaves half the lane for account confirmation and password recovery — the traffic that
 * cannot wait behind a campaign.
 *
 * THIS IS MEASURED, not caution: the "We are in Iceland" campaign (2026-09-08) had 500
 * recipients and wrote 200 `failed` rows between 13:00:54.70 and 13:00:55.25 — five batches
 * fired inside the same 550 ms window against a 10/s ceiling.
 */
const RESEND_MAX_RPS = 5;
const MIN_INTERVAL_MS = Math.ceil(1000 / RESEND_MAX_RPS);

/** Attempts per batch before giving up on it (1 send + 3 retries). */
const MAX_ATTEMPTS = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const toBase64Url = (bytes: Uint8Array): string => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};

const encodeEmail = (email: string): string =>
  toBase64Url(new TextEncoder().encode(email.toLowerCase().trim()));

// Assinatura HMAC-SHA256 do email (stateless): permite descadastro sem
// pré-popular linhas no banco e impede unsubscribe de emails arbitrários.
async function signEmail(email: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(email.toLowerCase().trim()));
  return toBase64Url(new Uint8Array(sig));
}

/**
 * Verifies an `e`/`s` pair and returns the plaintext e-mail, or null.
 *
 * Twin of `verify` in `tuggi-enterprise/src/app/[locale]/unsubscribe/page.tsx`: same secret
 * (`NEWSLETTER_SECRET`), same HMAC-SHA256 over the normalized address, same base64url.
 * Duplicated because Deno does not import the Next side; the parity is asserted by
 * `tests/api/marketing-ef-unsubscribe.test.ts`.
 *
 * The comparison is constant-time. A `===` over the signature leaks, byte by byte, how much of
 * a guess was right, and this secret unsubscribes any address in the base.
 */
async function verifySignedEmail(
  e: string,
  s: string,
  secret: string
): Promise<string | null> {
  if (!e || !s || !secret) return null;
  let email: string;
  try {
    const padded = e.replace(/-/g, '+').replace(/_/g, '/');
    email = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  } catch {
    return null;
  }
  if (!email.includes('@')) return null;

  const expected = await signEmail(email, secret);
  if (expected.length !== s.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ s.charCodeAt(i);
  return diff === 0 ? email.toLowerCase().trim() : null;
}

// O unsubscribe é hospedado no site público (tuggi.app), cujos locales são
// en/es/pt-br/pt-pt (sem italiano). Mapeamos o idioma do conteúdo para um locale
// VÁLIDO do site para a rota, e passamos &lang= para a página exibir o idioma real
// (ex.: it usa a rota /en mas mostra texto em italiano).
const SITE_LOCALE: Record<string, string> = { pt: 'pt-br', en: 'en', es: 'es', it: 'en' };

async function buildUnsubscribeUrl(email: string, appUrl: string, secret: string, lang: string): Promise<string> {
  const e = encodeEmail(email);
  const s = await signEmail(email, secret);
  const base = appUrl.replace(/\/$/, '');
  const siteLocale = SITE_LOCALE[lang] || 'en';
  return `${base}/${siteLocale}/unsubscribe?e=${e}&s=${s}&lang=${lang}`;
}

/**
 * The address the `List-Unsubscribe` HEADER carries, and why it is NOT the site page.
 *
 * RFC 8058 is a POST: the mail client sends `List-Unsubscribe=One-Click` as the body of the
 * https URI and expects 2xx. The site page (`tuggi-enterprise`,
 * `src/app/[locale]/unsubscribe/page.tsx`) is a Server Component — it answers GET only, and a
 * POST to it returns 405. Advertising `List-Unsubscribe-Post` pointed at it would leave Gmail's
 * unsubscribe button erroring out, which is worse than having no button.
 *
 * So the header points at `POST /unsubscribe` on THIS function, which accepts the POST and
 * writes; the visible footer link in the body stays the site page, which is localized and
 * readable. Two surfaces, one secret, the same `e`/`s` pair.
 */
async function buildOneClickUrl(email: string, functionsUrl: string, secret: string): Promise<string> {
  const e = encodeEmail(email);
  const s = await signEmail(email, secret);
  return `${functionsUrl.replace(/\/$/, '')}/send-newsletter/unsubscribe?e=${e}&s=${s}`;
}

/**
 * Both one-click unsubscribe headers. Gmail requires BOTH of any sender doing 5,000 messages a
 * day — https://support.google.com/a/answer/81126: "Marketing messages and subscribed messages
 * must support one-click unsubscribe", with `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
 * and `List-Unsubscribe: <https://…>`, citing RFC 2369 and RFC 8058. The same page requires
 * "spam rates reported in Postmaster Tools below 0.30%".
 *
 * Until 2026-09-10 only the first was sent, and on its own it does not meet the requirement.
 */
function unsubscribeHeaders(oneClickUrl: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${oneClickUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

// Personalização: substitui {{first_name}} / {{name}}. Sem nome → fallback por idioma.
// `it` was missing, so an Italian reader with no `full_name` opened an Italian e-mail whose
// FIRST word was `traveler`, in English — the `|| FALLBACK_NAME.en` below.
const FALLBACK_NAME: Record<string, string> = {
  pt: 'viajante',
  en: 'traveler',
  es: 'viajero',
  it: 'viaggiatore',
};

function personalizeText(text: string | undefined, vars: Record<string, string>): string | undefined {
  if (!text) return text;
  return text.replace(/\{\{\s*(first_name|name)\s*\}\}/gi, (_m, k) => vars[String(k).toLowerCase()] ?? '');
}

function personalizeContent(c: NewsletterContent, name: string, lang: string): NewsletterContent {
  const full = (name || '').trim();
  const fallback = FALLBACK_NAME[lang] || FALLBACK_NAME.en;
  const vars = {
    name: full || fallback,
    first_name: full ? full.split(/\s+/)[0] : fallback,
  };
  return {
    ...c,
    subject: personalizeText(c.subject, vars),
    preheader: personalizeText(c.preheader, vars),
    title: personalizeText(c.title, vars),
    paragraphs: (c.paragraphs || []).map((p) => personalizeText(p, vars) as string),
    cta_label: personalizeText(c.cta_label, vars),
    blocks: c.blocks
      ? c.blocks.map((b: any) => {
          if (b.type === 'heading' || b.type === 'text') return { ...b, text: personalizeText(b.text, vars) };
          if (b.type === 'button') return { ...b, label: personalizeText(b.label, vars) };
          return b;
        })
      : c.blocks,
  };
}

// Traduz um NewsletterContent (campos + blocos) para um idioma alvo.
async function translateContent(source: NewsletterContent, targetLang: string, apiKey: string): Promise<NewsletterContent> {
  const tr = (s: string | undefined) => translateText(s || '', targetLang, apiKey);
  const [subject, preheader, title, cta_label] = await Promise.all([
    tr(source.subject), tr(source.preheader), tr(source.title), tr(source.cta_label),
  ]);
  const paragraphs = await Promise.all((source.paragraphs || []).map(tr));
  const blocks = source.blocks
    ? await Promise.all(
        source.blocks.map(async (b: any) => {
          if (b.type === 'heading' || b.type === 'text') return { ...b, text: await tr(b.text) };
          if (b.type === 'button') return { ...b, label: await tr(b.label) };
          return b; // image/divider mantém
        })
      )
    : undefined;
  return { ...source, subject, preheader, title, paragraphs, cta_label, blocks };
}

// Escolhe o conteúdo do idioma do usuário com fallback para o idioma padrão.
//
// `fellBack` is the third return value and it is the point of this change. The choice itself is
// UNCHANGED — a reader whose language the campaign does not carry still gets `default_language`,
// because the composer is what has to warn before the send, not this function during it. What
// was missing is that the fall was SILENT: the "We are in Iceland" campaign went out with
// `default_language: pt` to 500 people drawn from the whole base and nothing, anywhere, counted
// how many of them do not read Portuguese. Now `/audience-breakdown` can answer that before the
// operator presses send, and the send itself logs the total.
function pickContent(
  content: Record<string, NewsletterContent>,
  userLang: string | null,
  defaultLang: string
): { content: NewsletterContent; lang: string; fellBack: boolean } {
  const norm = (userLang || '').slice(0, 2).toLowerCase();
  if (norm && content[norm]) return { content: content[norm], lang: norm, fellBack: false };
  if (content[defaultLang]) return { content: content[defaultLang], lang: defaultLang, fellBack: true };
  const first = Object.keys(content)[0];
  return { content: content[first] || {}, lang: first || defaultLang, fellBack: true };
}

/**
 * What `/audience-breakdown` answers, and what the send logs: how many recipients read each
 * language, and how many of those are only getting the fallback.
 */
interface LanguageBreakdown {
  total: number;
  /** Language actually sent -> how many recipients get it. */
  by_language: Record<string, number>;
  /** Subset of the above that reached it through the fallback, keyed by the reader's OWN lang. */
  fallback_from: Record<string, number>;
  fallback_total: number;
}

function breakdownAudience(
  recipients: Array<{ language: string | null }>,
  content: Record<string, NewsletterContent>,
  defaultLang: string
): LanguageBreakdown {
  const by_language: Record<string, number> = {};
  const fallback_from: Record<string, number> = {};
  let fallback_total = 0;

  for (const r of recipients) {
    const { lang, fellBack } = pickContent(content, r.language, defaultLang);
    by_language[lang] = (by_language[lang] || 0) + 1;
    if (fellBack) {
      const own = (r.language || '').slice(0, 2).toLowerCase() || 'unknown';
      fallback_from[own] = (fallback_from[own] || 0) + 1;
      fallback_total++;
    }
  }

  return { total: recipients.length, by_language, fallback_from, fallback_total };
}

/**
 * One Resend call, paced and retried.
 *
 * Two separate problems, one place, because they are the same call:
 *
 *  - PACING. `MIN_INTERVAL_MS` since the previous call, tracked on a cursor the caller owns, so
 *    the gap holds ACROSS batches and not just inside one. Without it the loop fired every batch
 *    as fast as `fetch` resolved, which is what put five of them inside 550 ms.
 *  - RETRY. `429` and 5xx are transient by definition — a 429 says "later", not "no". Exponential
 *    backoff with full jitter, honouring `retry-after` when Resend sends it. 4xx other than 429 is
 *    OUR request being wrong and is returned immediately: retrying it just spends the ceiling.
 */
async function resendFetch(
  url: string,
  init: RequestInit,
  pace: { nextAt: number },
  label: string
): Promise<{ ok: boolean; status: number; data: any; attempts: number }> {
  let lastStatus = 0;
  let lastData: any = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const wait = pace.nextAt - Date.now();
    if (wait > 0) await sleep(wait);
    pace.nextAt = Date.now() + MIN_INTERVAL_MS;

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e) {
      lastStatus = 0;
      lastData = { message: (e as Error).message };
      if (attempt === MAX_ATTEMPTS) break;
      await sleep(backoffMs(attempt, null));
      continue;
    }

    const data = await res.json().catch(() => ({}));
    lastStatus = res.status;
    lastData = data;

    if (res.ok) return { ok: true, status: res.status, data, attempts: attempt };

    const transient = res.status === 429 || res.status >= 500;
    if (!transient || attempt === MAX_ATTEMPTS) break;

    const retryAfter = res.headers.get('retry-after');
    const delay = backoffMs(attempt, retryAfter);
    console.warn(`⏳ ${label}: HTTP ${res.status} on attempt ${attempt}, retrying in ${delay}ms`);
    await sleep(delay);
  }

  return { ok: false, status: lastStatus, data: lastData, attempts: MAX_ATTEMPTS };
}

/**
 * Exponential backoff with FULL JITTER. Without the jitter every batch of a run that hit the
 * ceiling together would also come back together, and re-hit it together.
 *
 * `retry-after` wins when present. Resend's API reference documents the 429 but says nothing
 * about the header, so this reads it and does not depend on it.
 */
function backoffMs(attempt: number, retryAfter: string | null): number {
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0 && seconds <= 60) return Math.ceil(seconds * 1000);
  const ceiling = Math.min(8000, 500 * 2 ** (attempt - 1));
  return Math.floor(ceiling / 2 + Math.random() * (ceiling / 2));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const requestId = crypto.randomUUID();
  console.log(`[${requestId}] 🚀 send-newsletter: ${req.method} ${req.url}`);

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/.*\/send-newsletter/, '') || '/';

    const RESEND_API_KEY = (Deno.env.get('RESEND_API_KEY') ?? '').trim();
    const RESEND_FROM = (Deno.env.get('RESEND_FROM') ?? 'Tuggi <news@tuggi.app>').trim();
    // URL pública que hospeda a página de unsubscribe (site tuggi.app, não o CMS).
    const APP_URL = (Deno.env.get('APP_URL') ?? 'https://www.tuggi.app').trim();
    const NEWSLETTER_SECRET = (Deno.env.get('NEWSLETTER_SECRET') ?? '').trim();
    // Where THIS function answers from, for the `List-Unsubscribe` header. Defaults to the
    // project's own functions origin, which is what production uses; the secret exists so a
    // branch/staging deployment can point its mail somewhere else.
    const FUNCTIONS_URL = (
      Deno.env.get('PUBLIC_FUNCTIONS_URL') ||
      `${(Deno.env.get('SUPABASE_URL') ?? '').trim().replace(/\/$/, '')}/functions/v1`
    ).trim();

    const supabase = createAdminClient();

    // ---- /health : público, e não diz nada ----
    if (path === '/health') return json({ status: 'ok' });

    // ---- /unsubscribe : PÚBLICO, POST-only, RFC 8058 one-click ----
    //
    // The signature IS the authorization here: `NEWSLETTER_SECRET` HMACs the address, so this
    // route can only remove an address we ourselves mailed. It answers POST and NOTHING ELSE —
    // a GET that writes is exactly the defect that lets a link scanner unsubscribe people who
    // never clicked anything, and RFC 8058 §3.1 asks for the POST precisely to avoid it.
    if (path === '/unsubscribe') {
      if (req.method !== 'POST') {
        return json({ error: 'method_not_allowed', hint: 'RFC 8058 one-click is a POST' }, 405);
      }
      const email = await verifySignedEmail(
        url.searchParams.get('e') || '',
        url.searchParams.get('s') || '',
        NEWSLETTER_SECRET
      );
      if (!email) {
        console.warn(`[${requestId}] ❌ one-click unsubscribe with a bad signature`);
        return json({ error: 'invalid_signature' }, 400);
      }
      const { error: unsubErr } = await supabase
        .schema('marketing')
        .from('email_unsubscribes')
        .upsert({ email, source: 'list_unsubscribe' }, { onConflict: 'email', ignoreDuplicates: true });
      if (unsubErr) {
        console.error(`[${requestId}] 💥 one-click unsubscribe failed:`, JSON.stringify(unsubErr));
        return json({ error: 'unsubscribe_failed' }, 500);
      }
      console.log(`[${requestId}] 🚪 one-click unsubscribe recorded`);
      return json({ success: true });
    }

    // ---- Tudo abaixo exige admin ou chave de máquina (#346) ----
    const auth = await requireAdmin(req, { ...corsHeaders, 'Content-Type': 'application/json' });
    if (auth instanceof Response) {
      console.warn(`[${requestId}] ⛔ refused ${path}: ${auth.status}`);
      return auth;
    }

    // ---- /preview : renderiza sem enviar (usado pelo painel) ----
    if (path === '/preview') {
      const { content, language = 'pt' } = await req.json();
      const html = renderEmail(personalizeContent(content || {}, '', language), {
        unsubscribeUrl: `${APP_URL.replace(/\/$/, '')}/${language}/unsubscribe?e=preview&s=preview`,
        locale: language,
        utmCampaign: 'preview',
      });
      return json({ success: true, html });
    }

    // ---- /send-test : envia 1 email para um endereço específico (ignora audiência) ----
    if (path === '/send-test') {
      if (!RESEND_API_KEY) return json({ error: 'RESEND_API_KEY ausente' }, 500);
      const { content, email, language = 'pt' } = await req.json();
      if (!email || !content) return json({ error: 'email and content required' }, 400);

      const pc = personalizeContent(content, '', language);
      const unsubscribeUrl = await buildUnsubscribeUrl(email, APP_URL, NEWSLETTER_SECRET, language);
      const oneClickUrl = await buildOneClickUrl(email, FUNCTIONS_URL, NEWSLETTER_SECRET);
      const testOpts = { unsubscribeUrl, locale: language, utmCampaign: 'test' };
      const html = renderEmail(pc, testOpts);
      const text = renderText(pc, testOpts);

      const sent = await resendFetch(
        'https://api.resend.com/emails',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: RESEND_FROM,
            to: [email],
            subject: `[TESTE] ${pc.subject || 'Tuggi'}`,
            html,
            text,
            headers: unsubscribeHeaders(oneClickUrl),
          }),
        },
        { nextAt: 0 },
        'send-test'
      );
      if (!sent.ok) {
        return json({ error: sent.data?.message || 'Resend error', detail: sent.data }, 502);
      }
      console.log(`[${requestId}] ✉️ test e-mail sent by ${auth.email}`);
      return json({ success: true, id: sent.data?.id });
    }

    // ---- /translate : traduz o conteúdo para os idiomas alvo (reusa GEMINI dos secrets) ----
    if (path === '/translate') {
      const GEMINI = (Deno.env.get('GEMINI_API_KEY') ?? Deno.env.get('GOOGLE_GEMINI_API_KEY') ?? '').trim();
      if (!GEMINI) return json({ error: 'GEMINI_API_KEY ausente nos secrets' }, 500);
      const { source, targetLanguages } = await req.json();
      if (!source || !Array.isArray(targetLanguages) || targetLanguages.length === 0) {
        return json({ error: 'source and targetLanguages required' }, 400);
      }
      const entries = await Promise.all(
        targetLanguages.map(async (lang: string) => [lang, await translateContent(source, lang, GEMINI)] as const)
      );
      return json({ success: true, translations: Object.fromEntries(entries) });
    }

    /**
     * Resolves the audience of a campaign (or of a hypothetical one) and answers how many
     * recipients read each language — the number the composer needs BEFORE the send, so that
     * "500 people, all in Portuguese" is a thing the operator can see instead of discover.
     *
     * Two shapes, because the panel asks it in both situations:
     *   { campaignId }                                        -> a saved campaign
     *   { audienceFilters, content, defaultLanguage }          -> a draft not saved yet
     */
    if (path === '/audience-breakdown') {
      const body = await req.json().catch(() => ({}));
      let filters = body?.audienceFilters ?? {};
      let content: Record<string, NewsletterContent> = body?.content ?? {};
      let defaultLang: string = body?.defaultLanguage ?? 'pt';

      if (body?.campaignId) {
        const { data: campaign, error } = await supabase
          .schema('marketing').from('newsletter_campaigns')
          .select('audience_filters, content, default_language').eq('id', body.campaignId).single();
        if (error || !campaign) return json({ error: 'campaign not found' }, 404);
        filters = campaign.audience_filters || {};
        content = (campaign.content || {}) as Record<string, NewsletterContent>;
        defaultLang = campaign.default_language || 'pt';
      }

      const { data: audience, error: audErr } = await supabase
        .schema('marketing')
        .rpc('get_newsletter_audience', { p_filters: filters });
      if (audErr) throw audErr;

      return json({
        success: true,
        breakdown: breakdownAudience(audience || [], content, defaultLang),
        content_languages: Object.keys(content),
        default_language: defaultLang,
      });
    }

    /**
     * Updates a campaign row, tolerating the columns that do not exist yet.
     *
     * `recipient_count`, `sent_count`, `failed_count` and `started_at` arrive with
     * `20260910_04_newsletter_campaign_progress.sql`, which is the `data` agent's and runs by
     * hand in the panel. PostgREST refuses the WHOLE update with PGRST204 when one column is
     * unknown — and the update this guards is the one that takes the campaign OUT of `sending`.
     * Losing it would leave every campaign stuck in flight forever, which is a worse defect
     * than the one being fixed.
     *
     * `status` stays in `required` and is safe either way: before that migration the column is
     * free `text` with no CHECK at all, and the migration's own CHECK lists `partial`.
     */
    const updateCampaign = async (
      id: string,
      required: Record<string, unknown>,
      optional: Record<string, unknown> = {}
    ) => {
      const campaigns = () => supabase.schema('marketing').from('newsletter_campaigns');
      const { error } = await campaigns().update({ ...required, ...optional }).eq('id', id);
      if (error?.code === 'PGRST204' && Object.keys(optional).length > 0) {
        console.error(
          `[${requestId}] 🚨 newsletter_campaigns is missing ${Object.keys(optional).join('/')} — ` +
          'the migration has not run. Writing without them.'
        );
        // Nothing required left to write: the whole patch was the columns that do not exist.
        if (Object.keys(required).length === 0) return;
        const { error: retryErr } = await campaigns().update(required).eq('id', id);
        if (retryErr) console.error(`[${requestId}] 💥 campaign update failed:`, JSON.stringify(retryErr));
      } else if (error) {
        console.error(`[${requestId}] 💥 campaign update failed:`, JSON.stringify(error));
      }
    };

    // Helper: envia uma campanha já carregada.
    const sendCampaign = async (campaign: any) => {
      if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY ausente');

      const content = (campaign.content || {}) as Record<string, NewsletterContent>;
      const defaultLang = campaign.default_language || 'pt';

      // 1. Resolve audiência (RPC já filtra opt-out e exige email não-nulo)
      const { data: audience, error: audErr } = await supabase
        .schema('marketing')
        .rpc('get_newsletter_audience', { p_filters: campaign.audience_filters || {} });
      if (audErr) throw audErr;

      const recipients: Array<{ email: string; user_id: string | null; language: string | null; name?: string | null }> =
        audience || [];

      if (recipients.length === 0) {
        await updateCampaign(
          campaign.id,
          { status: 'sent', sent_at: new Date().toISOString() },
          { recipient_count: 0, sent_count: 0, failed_count: 0 }
        );
        return { sent: 0, failed: 0, total: 0, status: 'sent', breakdown: breakdownAudience([], content, defaultLang) };
      }

      // The denominator, written BEFORE the first batch. `sent_count + failed_count` is checked
      // against it by the migration, and without it a run that dies halfway leaves no record of
      // how big it was supposed to be — which is what made the Iceland campaign unreadable.
      await updateCampaign(
        campaign.id,
        {},
        {
          recipient_count: recipients.length,
          sent_count: 0,
          failed_count: 0,
          started_at: new Date().toISOString(),
        }
      );

      // The language mix is decided here and LOGGED here, whatever the composer showed. The
      // Iceland campaign's 500 Portuguese e-mails left no trace of being 500 Portuguese e-mails.
      const breakdown = breakdownAudience(recipients, content, defaultLang);
      console.log(
        `[${requestId}] 🗣 campaign ${campaign.id} languages=${JSON.stringify(breakdown.by_language)} ` +
        `fallback=${breakdown.fallback_total}/${breakdown.total}`
      );

      // `utm_campaign` is a GA4 dimension: slug, never the free-text name (#8).
      const utmCampaign = slugifyCampaign(campaign.name, String(campaign.id));

      // One pacing cursor for the WHOLE campaign, so the gap between batches survives the loop.
      const pace = { nextAt: 0 };

      let sent = 0;
      let failed = 0;

      for (const group of chunk(recipients, BATCH_SIZE)) {
        // Monta o payload do lote + linhas de recipients (uma a uma p/ casar o resend id)
        const emails: any[] = [];
        const rows: any[] = [];

        for (const r of group) {
          const { content: cBase, lang } = pickContent(content, r.language, defaultLang);
          const c = personalizeContent(cBase, r.name || '', lang);
          const unsubscribeUrl = await buildUnsubscribeUrl(r.email, APP_URL, NEWSLETTER_SECRET, lang);
          const oneClickUrl = await buildOneClickUrl(r.email, FUNCTIONS_URL, NEWSLETTER_SECRET);
          const renderOpts = { unsubscribeUrl, locale: lang, utmCampaign };
          const html = renderEmail(c, renderOpts);
          const text = renderText(c, renderOpts);

          emails.push({
            from: RESEND_FROM,
            to: [r.email],
            subject: c.subject || campaign.name,
            html,
            text,
            // Both headers, or the requirement is not met — see `unsubscribeHeaders`. The
            // header URL is this function's POST route; the visible footer link stays the site.
            headers: unsubscribeHeaders(oneClickUrl),
          });
          rows.push({
            campaign_id: campaign.id,
            email: r.email,
            user_id: r.user_id,
            language: lang,
          });
        }

        const res = await resendFetch(
          RESEND_BATCH_URL,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(emails),
          },
          pace,
          `campaign ${campaign.id}`
        );

        if (!res.ok) {
          // WHY THE REASON IS WRITTEN PER RECIPIENT. Until 2026-09-10 a failed batch wrote
          // `status: 'failed'` and a bare `data?.message`, so 200 of the Iceland rows say
          // nothing about WHY. `error_details` already exists on the table; it just was not
          // carrying the status code, and a `failed` row with no code is a dead end.
          const reason =
            `HTTP ${res.status} after ${res.attempts} attempt(s): ` +
            (res.data?.message || res.data?.name || 'batch error');
          console.error(`[${requestId}] ❌ Resend batch failed: ${reason}`);
          failed += rows.length;
          await supabase.schema('marketing').from('newsletter_recipients').insert(
            rows.map((row) => ({ ...row, status: 'failed', error_details: reason }))
          );
          continue;
        }

        // Resend retorna { data: [{ id }, ...] } na mesma ordem
        const ids: Array<{ id: string }> = res.data?.data || [];
        const now = new Date().toISOString();
        await supabase.schema('marketing').from('newsletter_recipients').insert(
          rows.map((row, i) => ({
            ...row,
            resend_message_id: ids[i]?.id || null,
            status: 'sent',
            sent_at: now,
          }))
        );
        sent += rows.length;
      }

      // THE STATUS TELLS THE TRUTH, and this is the whole point of the change. The old
      // expression was `failed > 0 && sent === 0 ? 'failed' : 'sent'`: a campaign that reached
      // 300 of 500 people was filed as `sent`, indistinguishable from one that reached all of
      // them, and the operator had no way to know. `partial` is a THIRD outcome because it needs
      // a third answer — resend to the failures, not to everyone.
      //
      // THE SPELLING IS `partial` AND NOT ANYTHING ELSE. `20260910_04_newsletter_campaign_progress.sql`
      // puts a CHECK on the column — `draft|scheduled|sending|sent|partial|failed|cancelled` —
      // so a synonym here is a 23514 at the end of a send that already went out.
      const status = failed === 0 ? 'sent' : sent === 0 ? 'failed' : 'partial';

      await updateCampaign(
        campaign.id,
        { status, sent_at: new Date().toISOString() },
        { sent_count: sent, failed_count: failed }
      );

      return { sent, failed, total: recipients.length, status, breakdown };
    };

    // ---- /send ----
    if (path === '/send') {
      const { campaignId } = await req.json();
      if (!campaignId) return json({ error: 'campaignId required' }, 400);

      const { data: campaign, error } = await supabase
        .schema('marketing').from('newsletter_campaigns').select('*').eq('id', campaignId).single();
      if (error || !campaign) return json({ error: 'campaign not found' }, 404);

      // A campaign already in flight is not re-sent. Two operators pressing the button, or one
      // pressing it twice while the first run is still walking 500 addresses, used to produce
      // two full sends: the audience RPC is not idempotent and neither is Resend.
      if (campaign.status === 'sending') {
        return json({ error: 'campaign_already_sending', campaignId }, 409);
      }

      await supabase.schema('marketing').from('newsletter_campaigns')
        .update({ status: 'sending' }).eq('id', campaignId);

      try {
        const result = await sendCampaign(campaign);
        return json({ success: true, ...result });
      } catch (e) {
        // A campaign that dies mid-flight used to stay `sending` FOREVER: the loop only wrote a
        // final status on its way out, and an exception skipped that. `failed` is the honest
        // answer, and it is also what makes the row eligible for a retry.
        console.error(`[${requestId}] 💥 campaign ${campaignId} threw:`, (e as Error).message);
        await supabase.schema('marketing').from('newsletter_campaigns')
          .update({ status: 'failed' }).eq('id', campaignId);
        throw e;
      }
    }

    // ---- /schedule ----
    if (path === '/schedule') {
      const { campaignId, scheduledFor } = await req.json();
      if (!campaignId || !scheduledFor) return json({ error: 'campaignId and scheduledFor required' }, 400);

      const { error } = await supabase.schema('marketing').from('newsletter_campaigns')
        .update({ status: 'scheduled', scheduled_for: scheduledFor }).eq('id', campaignId);
      if (error) throw error;
      return json({ success: true });
    }

    // ---- /process-scheduled (cron) ----
    // `requireAdmin` above already gated this: the caller is the Vault's `ef_secret_key`, sent by
    // `marketing.trigger_process_scheduled_newsletters` (`net.http_post`), and it lands on the
    // machine-key bypass. See `isOwnMachineKey` for the set of names accepted, and for why the
    // `SERVICE_ROLE_KEY` the migration files name is not one of them.
    if (path === '/process-scheduled') {
      const { data: due, error } = await supabase
        .schema('marketing').from('newsletter_campaigns')
        .select('*')
        .eq('status', 'scheduled')
        .lte('scheduled_for', new Date().toISOString())
        .limit(5);
      if (error) throw error;

      const results = [];
      for (const campaign of due || []) {
        await supabase.schema('marketing').from('newsletter_campaigns')
          .update({ status: 'sending' }).eq('id', campaign.id);
        try {
          const r = await sendCampaign(campaign);
          results.push({ id: campaign.id, ...r });
        } catch (e) {
          console.error(`[${requestId}] ⚠️ campaign ${campaign.id} failed:`, (e as Error).message);
          await supabase.schema('marketing').from('newsletter_campaigns')
            .update({ status: 'failed' }).eq('id', campaign.id);
          results.push({ id: campaign.id, error: (e as Error).message });
        }
      }
      return json({ success: true, processed: results.length, results });
    }

    return json({ error: 'Not found' }, 404);
  } catch (err: any) {
    console.error(`[${requestId}] 💥 Fatal:`, err);
    return json({ error: 'Internal Server Error', message: err.message, requestId }, 500);
  }
});

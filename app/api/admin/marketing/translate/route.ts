/**
 * POST /api/admin/marketing/translate
 *
 * Traduz o conteúdo de uma newsletter (idioma base) para os idiomas-alvo,
 * reaproveitando a infra de tradução (Gemini). Admin-only.
 *
 * Body: { source: NewsletterContent, targetLanguages: NewsletterLanguage[] }
 * Resp: { success: true, translations: { [lang]: NewsletterContent } }
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client';
import { translateNewsletterContent } from '@/lib/marketing/translate';
import type { NewsletterContent, NewsletterLanguage } from '@/types/newsletter';

async function adminGate(): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const cookieStore = await cookies();
  const supabaseAuth = getSupabaseRouteHandler(cookieStore);

  const { data: { session }, error: authError } = await supabaseAuth.auth.getSession();
  if (authError || !session) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const { data: cmsUser, error: cmsError } = await supabaseAuth
    .schema('core')
    .from('cms_users')
    .select('role, is_active')
    .eq('email', session.user.email as string)
    .eq('is_active', true)
    .single();

  if (cmsError || !cmsUser || cmsUser.role !== 'admin') {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden - Admin only' }, { status: 403 }) };
  }
  return { ok: true };
}

export async function POST(request: NextRequest) {
  try {
    const gate = await adminGate();
    if (!gate.ok) return gate.response;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
    }

    const { source, targetLanguages } = (await request.json()) as {
      source: NewsletterContent;
      targetLanguages: NewsletterLanguage[];
    };

    if (!source || !Array.isArray(targetLanguages) || targetLanguages.length === 0) {
      return NextResponse.json({ error: 'source and targetLanguages are required' }, { status: 400 });
    }

    const entries = await Promise.all(
      targetLanguages.map(async (lang) => [lang, await translateNewsletterContent(source, lang, apiKey)] as const)
    );

    return NextResponse.json({ success: true, translations: Object.fromEntries(entries) });
  } catch (err: any) {
    console.error('[marketing/translate] error:', err);
    return NextResponse.json({ error: err.message || 'Translation failed' }, { status: 500 });
  }
}

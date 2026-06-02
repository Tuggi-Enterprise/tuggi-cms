'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { NewsletterService } from '@/lib/services/newsletter-service';
import {
  NEWSLETTER_LANGUAGES,
  type NewsletterContentByLanguage,
  type NewsletterLanguage,
} from '@/types/newsletter';

/**
 * Mostra o email exatamente como o usuário recebe: pede à própria Edge Function
 * (rota /preview) o HTML renderizado pelo layout-base (SSOT) e exibe num iframe.
 */
export function NewsletterPreview({ contentByLang }: { contentByLang: NewsletterContentByLanguage }) {
  const t = useTranslations('Pages.Marketing.Newsletter');
  const [lang, setLang] = useState<NewsletterLanguage>('pt');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const content = contentByLang[lang];
    if (!content) {
      setHtml('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    NewsletterService.preview(content, lang)
      .then((h) => { if (!cancelled) setHtml(h); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [lang, contentByLang]);

  const availableLangs = NEWSLETTER_LANGUAGES.filter((l) => contentByLang[l]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1">
          {availableLangs.map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={cn(
                'px-3 py-1.5 text-sm font-semibold rounded-lg border',
                lang === l
                  ? 'border-tuggi-blue text-tuggi-blue bg-tuggi-blue/5'
                  : 'border-gray-200 text-gray-500 hover:text-gray-700'
              )}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {(['desktop', 'mobile'] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDevice(d)}
              className={cn(
                'px-3 py-1.5 text-sm font-semibold rounded-lg border capitalize',
                device === d
                  ? 'border-tuggi-blue text-tuggi-blue bg-tuggi-blue/5'
                  : 'border-gray-200 text-gray-500 hover:text-gray-700'
              )}
            >
              {t(`preview.${d}`)}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden bg-white">
        {loading ? (
          <div className="flex items-center justify-center h-96 text-gray-400">
            <Loader2 className="animate-spin" size={24} />
          </div>
        ) : html ? (
          <div className="flex justify-center bg-gray-100 dark:bg-gray-900 py-4">
            <iframe
              title="email-preview"
              sandbox=""
              srcDoc={html}
              className="h-[700px] bg-white border border-gray-200 transition-all"
              style={{ width: device === 'mobile' ? 390 : '100%', maxWidth: device === 'mobile' ? 390 : '100%' }}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-96 text-gray-400 text-sm">{t('preview.empty')}</div>
        )}
      </div>
    </div>
  );
}

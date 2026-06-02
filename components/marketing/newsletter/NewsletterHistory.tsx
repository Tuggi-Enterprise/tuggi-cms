'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NewsletterService } from '@/lib/services/newsletter-service';
import type { NewsletterCampaign, NewsletterCampaignStats } from '@/types/newsletter';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  scheduled: 'bg-amber-100 text-amber-700',
  sending: 'bg-blue-100 text-blue-700',
  sent: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

export function NewsletterHistory() {
  const t = useTranslations('Pages.Marketing.Newsletter');
  const [campaigns, setCampaigns] = useState<NewsletterCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, NewsletterCampaignStats>>({});

  useEffect(() => {
    NewsletterService.listCampaigns()
      .then(setCampaigns)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const toggle = async (id: string) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (!stats[id]) {
      try {
        const { stats: s } = await NewsletterService.getCampaign(id);
        setStats((prev) => ({ ...prev, [id]: s }));
      } catch (e) {
        console.error(e);
      }
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-40 text-gray-400"><Loader2 className="animate-spin" /></div>;
  }

  if (campaigns.length === 0) {
    return <div className="text-center text-sm text-gray-400 py-12">{t('history.empty')}</div>;
  }

  return (
    <div className="space-y-2">
      {campaigns.map((c) => {
        const s = stats[c.id];
        const open = openId === c.id;
        return (
          <Card key={c.id}>
            <CardContent className="p-0">
              <button onClick={() => toggle(c.id)} className="w-full flex items-center justify-between px-4 py-3 text-left">
                <div>
                  <div className="font-semibold text-gray-900 dark:text-white">{c.name}</div>
                  <div className="text-xs text-gray-500">
                    {c.sent_at ? new Date(c.sent_at).toLocaleString() : new Date(c.created_at).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={cn('text-xs font-semibold px-2 py-1 rounded-full', STATUS_STYLES[c.status] || STATUS_STYLES.draft)}>
                    {t(`status.${c.status}`)}
                  </span>
                  <ChevronDown size={16} className={cn('text-gray-400 transition-transform', open && 'rotate-180')} />
                </div>
              </button>

              {open && (
                <div className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {s ? (
                    <>
                      <Metric label={t('history.total')} value={s.total} />
                      <Metric label={t('history.delivered')} value={s.delivered} />
                      <Metric label={t('history.opened')} value={s.opened} />
                      <Metric label={t('history.clicked')} value={s.clicked} />
                      <Metric label={t('history.openRate')} value={`${Math.round(s.open_rate * 100)}%`} highlight />
                    </>
                  ) : (
                    <div className="col-span-full flex items-center gap-2 text-sm text-gray-400">
                      <Loader2 className="animate-spin" size={14} /> {t('history.loading')}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: number | string; highlight?: boolean }) {
  return (
    <div className={cn('rounded-lg p-3 text-center', highlight ? 'bg-tuggi-blue/5' : 'bg-gray-50 dark:bg-gray-800/50')}>
      <div className={cn('text-lg font-bold', highlight ? 'text-tuggi-blue' : 'text-gray-900 dark:text-white')}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

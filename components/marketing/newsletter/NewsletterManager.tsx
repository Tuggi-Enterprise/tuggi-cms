'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { Mail, Languages, Send, Clock, Eye, Pencil, History, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { useCmsUser } from '@/lib/hooks/useCmsUser';
import { AudienceFilter } from '@/components/marketing/shared/AudienceFilter';
import { NewsletterService } from '@/lib/services/newsletter-service';
import type { AudienceFilters } from '@/lib/services/marketing/audience-types';
import {
  NEWSLETTER_LANGUAGES,
  type NewsletterContent,
  type NewsletterContentByLanguage,
  type NewsletterLanguage,
} from '@/types/newsletter';
import { NewsletterPreview } from './NewsletterPreview';
import { NewsletterHistory } from './NewsletterHistory';

type Tab = 'compose' | 'preview' | 'history';

const emptyContent = (): NewsletterContent => ({
  subject: '',
  title: '',
  paragraphs: [],
  cta_label: '',
  cta_url: '',
  hero_image_url: '',
});

export function NewsletterManager() {
  const t = useTranslations('Pages.Marketing.Newsletter');
  const { canEdit } = useCmsUser();

  const [tab, setTab] = useState<Tab>('compose');
  const [name, setName] = useState('');
  const [defaultLang, setDefaultLang] = useState<NewsletterLanguage>('pt');
  const [activeLang, setActiveLang] = useState<NewsletterLanguage>('pt');
  const [contentByLang, setContentByLang] = useState<NewsletterContentByLanguage>({ pt: emptyContent() });
  const [filters, setFilters] = useState<AudienceFilters>({});
  const [scheduleAt, setScheduleAt] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const active = contentByLang[activeLang] || emptyContent();

  const setActiveField = (field: keyof NewsletterContent, value: any) => {
    setContentByLang((prev) => ({
      ...prev,
      [activeLang]: { ...(prev[activeLang] || emptyContent()), [field]: value },
    }));
  };

  const handleTranslate = async () => {
    const source = contentByLang[defaultLang];
    if (!source) return;
    setBusy('translate');
    setMessage(null);
    try {
      const targets = NEWSLETTER_LANGUAGES.filter((l) => l !== defaultLang);
      const translations = await NewsletterService.translate(source, targets);
      setContentByLang((prev) => ({ ...prev, [defaultLang]: source, ...translations }));
      setMessage({ type: 'ok', text: t('messages.translated') });
    } catch (e: any) {
      setMessage({ type: 'err', text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const persist = async () => {
    return NewsletterService.createCampaign({
      name: name || t('untitled'),
      default_language: defaultLang,
      content: contentByLang,
      audience_filters: filters,
    });
  };

  const handleSend = async () => {
    setBusy('send');
    setMessage(null);
    try {
      const campaign = await persist();
      const res = await NewsletterService.send(campaign.id);
      setMessage({ type: 'ok', text: t('messages.sent', { count: res.sent ?? 0 }) });
    } catch (e: any) {
      setMessage({ type: 'err', text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const handleSchedule = async () => {
    if (!scheduleAt) return;
    setBusy('schedule');
    setMessage(null);
    try {
      const campaign = await persist();
      await NewsletterService.schedule(campaign.id, new Date(scheduleAt).toISOString());
      setMessage({ type: 'ok', text: t('messages.scheduled') });
    } catch (e: any) {
      setMessage({ type: 'err', text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const tabs: { id: Tab; label: string; icon: typeof Mail }[] = [
    { id: 'compose', label: t('tabs.compose'), icon: Pencil },
    { id: 'preview', label: t('tabs.preview'), icon: Eye },
    { id: 'history', label: t('tabs.history'), icon: History },
  ];

  return (
    <div className="space-y-6">
      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800">
        {tabs.map((tb) => {
          const Icon = tb.icon;
          return (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors',
                tab === tb.id
                  ? 'border-tuggi-blue text-tuggi-blue'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              <Icon size={16} />
              {tb.label}
            </button>
          );
        })}
      </div>

      {message && (
        <div
          className={cn(
            'rounded-lg px-4 py-3 text-sm',
            message.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          )}
        >
          {message.text}
        </div>
      )}

      {tab === 'compose' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail size={18} /> {t('compose.title')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>{t('compose.name')}</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('compose.namePlaceholder')} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>{t('compose.defaultLanguage')}</Label>
                    <Select value={defaultLang} onChange={(e: any) => { setDefaultLang(e.target.value); setActiveLang(e.target.value); }}>
                      {NEWSLETTER_LANGUAGES.map((l) => <SelectItem key={l} value={l}>{l.toUpperCase()}</SelectItem>)}
                    </Select>
                  </div>
                  <div>
                    <Label>{t('compose.editingLanguage')}</Label>
                    <Select value={activeLang} onChange={(e: any) => setActiveLang(e.target.value)}>
                      {NEWSLETTER_LANGUAGES.map((l) => <SelectItem key={l} value={l}>{l.toUpperCase()}</SelectItem>)}
                    </Select>
                  </div>
                </div>

                <div>
                  <Label>{t('compose.subject')}</Label>
                  <Input value={active.subject || ''} onChange={(e) => setActiveField('subject', e.target.value)} />
                </div>
                <div>
                  <Label>{t('compose.heading')}</Label>
                  <Input value={active.title || ''} onChange={(e) => setActiveField('title', e.target.value)} />
                </div>
                <div>
                  <Label>{t('compose.paragraphs')}</Label>
                  <Textarea
                    rows={6}
                    value={(active.paragraphs || []).join('\n\n')}
                    onChange={(e) => setActiveField('paragraphs', e.target.value.split(/\n\n+/).map((p) => p.trim()).filter(Boolean))}
                    placeholder={t('compose.paragraphsPlaceholder')}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>{t('compose.ctaLabel')}</Label>
                    <Input value={active.cta_label || ''} onChange={(e) => setActiveField('cta_label', e.target.value)} />
                  </div>
                  <div>
                    <Label>{t('compose.ctaUrl')}</Label>
                    <Input value={active.cta_url || ''} onChange={(e) => setActiveField('cta_url', e.target.value)} placeholder="https://" />
                  </div>
                </div>
                <div>
                  <Label>{t('compose.heroImage')}</Label>
                  <Input value={active.hero_image_url || ''} onChange={(e) => setActiveField('hero_image_url', e.target.value)} placeholder="https://" />
                </div>

                <Button variant="outline" onClick={handleTranslate} disabled={busy !== null}>
                  {busy === 'translate' ? <Loader2 className="animate-spin" size={16} /> : <Languages size={16} />}
                  {t('compose.translate')}
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <AudienceFilter filters={filters} onChange={setFilters} estimateFn={NewsletterService.estimateAudience} />

            <Card>
              <CardHeader>
                <CardTitle>{t('compose.deliver')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button className="w-full" onClick={handleSend} disabled={!canEdit || busy !== null}>
                  {busy === 'send' ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                  {t('compose.sendNow')}
                </Button>
                <div className="space-y-2">
                  <Input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
                  <Button variant="outline" className="w-full" onClick={handleSchedule} disabled={!canEdit || !scheduleAt || busy !== null}>
                    {busy === 'schedule' ? <Loader2 className="animate-spin" size={16} /> : <Clock size={16} />}
                    {t('compose.schedule')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {tab === 'preview' && <NewsletterPreview contentByLang={contentByLang} />}

      {tab === 'history' && <NewsletterHistory />}
    </div>
  );
}

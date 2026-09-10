'use client';

/**
 * Reusable push messages.
 *
 * This screen was 100% English literals inside a CMS translated to three locales — an operator
 * in Spanish read `No templates found` next to a Spanish menu. Every string is `messages/*.json`
 * now, under `Pages.Notifications.templates`.
 *
 * `confirm()` on delete STAYS for the moment, and that is a decision rather than an oversight:
 * unlike the send button, a guard EXISTS here, and replacing it with a dialog is work that
 * competes with the send path having no guard at all. What did change is the failure: a template
 * that fails to save or to delete used to `alert()` a sentence with no cause in it, so the
 * PostgREST message never reached the person who could act on it.
 */

import { useState, useEffect } from 'react';
import { useCmsUser } from '@/lib/hooks/useCmsUser';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Trash2, Edit, Check, FileEdit, Plus, Layout, MessageSquare, ImageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { NotificationService, NotificationTemplate } from '@/lib/services/notification-service';
import { cn } from '@/lib/utils';

interface TemplateManagerProps {
  onLoadTemplate: (template: NotificationTemplate) => void;
}

export function TemplateManager({ onLoadTemplate }: TemplateManagerProps) {
  const t = useTranslations('Pages.Notifications.templates');
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newMode, setNewMode] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const { canEdit } = useCmsUser();

  const [formData, setFormData] = useState<Partial<NotificationTemplate>>({
    name: '',
    title: '',
    body: '',
    image_url: '',
  });

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const data = await NotificationService.getTemplates();
      setTemplates(data);
    } catch (error: any) {
      setBanner(t('load_failed', { error: error?.message || String(error) }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchTemplates();
  }, []);

  const handleSave = async () => {
    setBanner(null);
    if (!formData.name || !formData.title || !formData.body) {
      setBanner(t('required_fields'));
      return;
    }
    try {
      if (newMode) {
        await NotificationService.createTemplate(formData as any);
      } else if (editingId) {
        await NotificationService.updateTemplate(editingId, formData);
      }
      setNewMode(false);
      setEditingId(null);
      setFormData({ name: '', title: '', body: '', image_url: '' });
      void fetchTemplates();
    } catch (error: any) {
      setBanner(t('save_failed', { error: error?.message || String(error) }));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('delete_confirm'))) return;
    setBanner(null);
    try {
      await NotificationService.deleteTemplate(id);
      void fetchTemplates();
    } catch (error: any) {
      setBanner(t('delete_failed', { error: error?.message || String(error) }));
    }
  };

  const startEdit = (tpl: NotificationTemplate) => {
    setEditingId(tpl.id);
    setNewMode(false);
    setFormData({
      name: tpl.name,
      title: tpl.title,
      body: tpl.body,
      image_url: tpl.image_url,
      data: tpl.data,
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Layout className="h-6 w-6 text-tuggi-blue" />
            {t('title')}
          </h2>
          <p className="text-sm text-gray-500 font-medium">{t('subtitle')}</p>
        </div>
        {!newMode && !editingId && canEdit && (
          <Button
            className="rounded-xl bg-tuggi-blue hover:bg-blue-600 font-bold px-6 py-5 shadow-lg shadow-blue-500/20 active:scale-95 transition-all"
            onClick={() => { setNewMode(true); setEditingId(null); setFormData({}); }}
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('new')}
          </Button>
        )}
      </div>

      {banner && (
        <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 break-words">
          {banner}
        </div>
      )}

      {(newMode || editingId) && (
        <Card className="rounded-2xl border-gray-200 dark:border-gray-800 shadow-xl border-t-4 border-t-tuggi-blue bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle as="h3" className="text-lg font-bold flex items-center gap-2">
              <FileEdit className="h-5 w-5 text-tuggi-blue" />
              {newMode ? t('create_title') : t('edit_title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="tpl-name" className="font-bold text-gray-700 dark:text-gray-300">
                  {t('label_name')}
                </Label>
                <Input
                  id="tpl-name"
                  className="rounded-xl border-gray-200 dark:border-gray-700"
                  placeholder={t('placeholder_name')}
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tpl-title" className="font-bold text-gray-700 dark:text-gray-300">
                  {t('label_title')}
                </Label>
                <Input
                  id="tpl-title"
                  className="rounded-xl border-gray-200 dark:border-gray-700"
                  value={formData.title || ''}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tpl-body" className="font-bold text-gray-700 dark:text-gray-300">
                {t('label_body')}
              </Label>
              <Textarea
                id="tpl-body"
                className="rounded-xl border-gray-200 dark:border-gray-700 min-h-[100px]"
                value={formData.body || ''}
                onChange={(e) => setFormData({ ...formData, body: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tpl-image" className="font-bold text-gray-700 dark:text-gray-300">
                {t('label_image')}
              </Label>
              <Input
                id="tpl-image"
                className="rounded-xl border-gray-200 dark:border-gray-700"
                placeholder="https://..."
                value={formData.image_url || ''}
                onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                className="rounded-xl px-6 font-bold"
                onClick={() => { setNewMode(false); setEditingId(null); }}
              >
                {t('cancel')}
              </Button>
              {canEdit && (
                <Button className="rounded-xl px-8 bg-tuggi-blue hover:bg-blue-600 font-bold" onClick={handleSave}>
                  <Check className="h-4 w-4 mr-2" />
                  {t('save')}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {templates.map((tpl) => (
          <Card
            key={tpl.id}
            className="group rounded-2xl border-gray-100 dark:border-gray-800 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:border-tuggi-blue/30 overflow-hidden bg-white dark:bg-gray-900"
          >
            <div className="h-1 bg-gray-100 dark:bg-gray-800 transition-colors group-hover:bg-tuggi-blue" />
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2 mb-1">
                <div className="p-1 px-2 rounded-lg bg-tuggi-blue/10 text-tuggi-blue text-[10px] font-bold uppercase tracking-widest leading-none">
                  {t('badge')}
                </div>
              </div>
              <CardTitle as="h3" className="text-xl font-bold text-gray-900 dark:text-white group-hover:text-tuggi-blue transition-colors">
                {tpl.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700 space-y-1">
                <p className="text-sm font-bold text-gray-800 dark:text-gray-200 line-clamp-1 flex items-center gap-1.5">
                  <MessageSquare className="h-3.5 w-3.5 text-gray-400" />
                  {tpl.title}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 leading-relaxed">{tpl.body}</p>
              </div>

              {tpl.image_url && (
                <div className="flex items-center gap-2 text-[10px] font-bold text-gray-400 uppercase">
                  <ImageIcon className="h-3 w-3" />
                  {t('has_image')}
                </div>
              )}

              <div className="flex justify-between items-center mt-4 pt-2 border-t border-gray-50 dark:border-gray-800">
                <Button
                  className="rounded-xl bg-gray-900 dark:bg-gray-100 dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-white text-xs font-bold px-4 transition-all duration-300"
                  size="sm"
                  onClick={() => onLoadTemplate(tpl)}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  {t('load')}
                </Button>
                <div className="flex gap-1">
                  {canEdit && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 text-gray-400 hover:text-tuggi-blue"
                        onClick={() => startEdit(tpl)}
                        aria-label={t('edit')}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-500"
                        onClick={() => handleDelete(tpl.id)}
                        aria-label={t('delete')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {templates.length === 0 && !loading && !newMode && (
        <div className="text-center py-20 bg-gray-50 dark:bg-gray-900/50 rounded-3xl border border-dashed border-gray-200 dark:border-gray-800">
          <div className="p-4 bg-white dark:bg-gray-900 rounded-full w-fit mx-auto shadow-sm mb-4">
            <Layout className="h-12 w-12 text-gray-200" />
          </div>
          <p className="text-gray-900 dark:text-white font-bold text-xl">{t('empty_title')}</p>
          <p className="text-gray-500 max-w-xs mx-auto mt-1 font-medium">{t('empty_body')}</p>
          {canEdit && (
            <Button
              variant="outline"
              className="mt-6 rounded-xl font-bold border-gray-200 hover:bg-white"
              onClick={() => setNewMode(true)}
            >
              {t('empty_cta')}
            </Button>
          )}
        </div>
      )}

      {loading && templates.length === 0 && (
        <div className={cn('grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6')}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-[220px] bg-gray-100 dark:bg-gray-800 animate-pulse rounded-2xl" />
          ))}
        </div>
      )}
    </div>
  );
}

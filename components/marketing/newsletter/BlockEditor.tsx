'use client';

import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Type, AlignLeft, Image as ImageIcon, MousePointerClick, Minus, ArrowUp, ArrowDown, Trash2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NewsletterBlock, NewsletterBlockType } from '@/types/newsletter';

const newBlock = (type: NewsletterBlockType): NewsletterBlock => {
  switch (type) {
    case 'heading': return { type: 'heading', text: '' };
    case 'text': return { type: 'text', text: '' };
    case 'image': return { type: 'image', url: '', alt: '' };
    case 'button': return { type: 'button', label: '', url: '' };
    case 'divider': return { type: 'divider' };
  }
};

const ADD_TYPES: { type: NewsletterBlockType; icon: typeof Type }[] = [
  { type: 'heading', icon: Type },
  { type: 'text', icon: AlignLeft },
  { type: 'image', icon: ImageIcon },
  { type: 'button', icon: MousePointerClick },
  { type: 'divider', icon: Minus },
];

interface Props {
  blocks: NewsletterBlock[];
  onChange: (blocks: NewsletterBlock[]) => void;
}

export function BlockEditor({ blocks, onChange }: Props) {
  const t = useTranslations('Pages.Marketing.Newsletter.blocks');

  const update = (i: number, patch: Partial<NewsletterBlock>) =>
    onChange(blocks.map((b, idx) => (idx === i ? ({ ...b, ...patch } as NewsletterBlock) : b)));

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const remove = (i: number) => onChange(blocks.filter((_, idx) => idx !== i));
  const add = (type: NewsletterBlockType) => onChange([...blocks, newBlock(type)]);

  return (
    <div className="space-y-3">
      {blocks.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-6 border border-dashed border-gray-200 rounded-xl">
          {t('empty')}
        </p>
      )}

      {blocks.map((b, i) => (
        <div key={i} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/40 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t(`types.${b.type}`)}</span>
            <div className="flex items-center gap-1">
              <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"><ArrowUp size={15} /></button>
              <button onClick={() => move(i, 1)} disabled={i === blocks.length - 1} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"><ArrowDown size={15} /></button>
              <button onClick={() => remove(i)} className="p-1 text-gray-400 hover:text-red-600"><Trash2 size={15} /></button>
            </div>
          </div>

          {b.type === 'heading' && (
            <Input value={b.text} onChange={(e) => update(i, { text: e.target.value })} placeholder={t('headingPlaceholder')} />
          )}

          {b.type === 'text' && (
            <div>
              <Textarea rows={4} value={b.text} onChange={(e) => update(i, { text: e.target.value })} placeholder={t('textPlaceholder')} />
              <p className="text-xs text-gray-400 mt-1">{t('markdownHint')}</p>
            </div>
          )}

          {b.type === 'image' && (
            <div className="space-y-2">
              <Input value={b.url} onChange={(e) => update(i, { url: e.target.value })} placeholder="https://" />
              <Input value={b.alt || ''} onChange={(e) => update(i, { alt: e.target.value })} placeholder={t('imageAlt')} />
            </div>
          )}

          {b.type === 'button' && (
            <div className="grid grid-cols-2 gap-2">
              <Input value={b.label} onChange={(e) => update(i, { label: e.target.value })} placeholder={t('buttonLabel')} />
              <Input value={b.url} onChange={(e) => update(i, { url: e.target.value })} placeholder="https://" />
            </div>
          )}

          {b.type === 'divider' && <div className="border-t border-gray-200 dark:border-gray-700 my-1" />}
        </div>
      ))}

      <div className="flex flex-wrap gap-2 pt-1">
        {ADD_TYPES.map(({ type, icon: Icon }) => (
          <Button key={type} variant="outline" size="sm" onClick={() => add(type)}>
            <Plus size={14} /> <Icon size={14} /> {t(`types.${type}`)}
          </Button>
        ))}
      </div>
    </div>
  );
}

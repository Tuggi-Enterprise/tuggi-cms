'use client'

/**
 * EntityManagementDrawer — chrome do "modal de POI management" reaproveitado para
 * Eventos e Locais. Drawer lateral (como POIDetailsModal) com navegação de abas:
 *   • Details              — form específico do módulo (passado via children)
 *   • Boundary & Triggers  — reusa a aba unificada components/poi-management/tabs/TriggerPointsTab
 *                            (um mapa com toggle Triggers|Boundary — boundary embutido)
 * As abas de POI leem tudo de POIModalContext, alimentado por useEntityModalContext
 * (keyed por attraction_id). Boundary/TP só aparecem em modo edição (precisam do id).
 */
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { X, Info, Target, Save, Loader2, FileText, Volume2, Link2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { POIModalProvider } from '@/components/poi-management/POIModalContext'
import { TriggerPointsTab } from '@/components/poi-management/tabs/TriggerPointsTab'
import { DescriptionTab } from '@/components/poi-management/tabs/DescriptionTab'
import { NarrationAudioTab } from '@/components/poi-management/tabs/NarrationAudioTab'
import { useEntityModalContext } from './useEntityModalContext'

type Tab = 'details' | 'description' | 'narration-audio' | 'trigger-points'

interface Props {
  isOpen: boolean
  isEdit: boolean
  entityId: string
  name: string
  coordinates?: { latitude: number; longitude: number }
  canEdit: boolean
  loading?: boolean
  saving?: boolean
  title: string
  HeaderIcon: React.ComponentType<{ className?: string }>
  /** Evento vinculado a um POI anfitrião: desabilita a autoria de trigger points
   *  (quem narra é o POI). Só eventos passam isso; POI/local ficam undefined. */
  venueLinked?: boolean
  venueName?: string
  onClose: () => void
  onSave: () => void
  invalidate: () => void
  children: React.ReactNode
}

export function EntityManagementDrawer({
  isOpen, isEdit, entityId, name, coordinates, canEdit,
  loading = false, saving = false, title, HeaderIcon,
  venueLinked = false, venueName,
  onClose, onSave, invalidate, children,
}: Props) {
  const t = useTranslations('Modals.POIDetails')
  const tc = useTranslations('Common')
  const [activeTab, setActiveTab] = useState<Tab>('details')

  useEffect(() => { if (!isOpen) setActiveTab('details') }, [isOpen])

  const ctx = useEntityModalContext({ entityId, name, coordinates, canEdit, onClose, invalidate })

  if (!isOpen) return null

  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'details', label: t('tabs.details'), icon: Info },
    ...(isEdit ? [
      { id: 'description' as Tab, label: t('tabs.description'), icon: FileText },
      { id: 'narration-audio' as Tab, label: t('tabs.narration'), icon: Volume2 },
      { id: 'trigger-points' as Tab, label: t('tabs.boundary_and_triggers'), icon: Target },
    ] : []),
  ]

  return (
    <div className="fixed inset-0 z-[100] flex justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[85vw] bg-white dark:bg-gray-900 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="px-8 py-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-white/80 dark:bg-gray-900/80 backdrop-blur-md z-30">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-tuggi-blue/10 rounded-2xl"><HeaderIcon className="h-6 w-6 text-tuggi-blue" /></div>
            <h2 className="text-2xl font-extrabold text-gray-900 dark:text-white tracking-tight">{title}</h2>
          </div>
          <button onClick={onClose} className="p-3 text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5 rounded-2xl transition-all">
            <X className="h-6 w-6" />
          </button>
        </header>

        {/* Body */}
        <div className="flex overflow-hidden flex-1">
          {/* Tab nav */}
          <aside className="w-72 flex-shrink-0 border-r border-gray-100 dark:border-gray-800 p-6 flex flex-col gap-2 bg-gray-50/50 dark:bg-gray-950/30">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-3 mb-1">{t('sidebar.navigation')}</span>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 rounded-2xl font-bold text-sm transition-all duration-300 text-left w-full',
                  activeTab === tab.id
                    ? 'bg-tuggi-blue text-white'
                    : 'text-gray-500 dark:text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5'
                )}
              >
                <tab.icon className={cn('h-5 w-5', activeTab === tab.id && 'animate-pulse')} />
                {tab.label}
              </button>
            ))}
            {!isEdit && (
              <p className="text-[11px] text-gray-400 px-3 mt-3 leading-relaxed">{t('validation.location_required')}</p>
            )}
          </aside>

          {/* Content */}
          <main className="flex-1 bg-white dark:bg-gray-900 overflow-y-auto">
            {activeTab === 'details' && (
              loading ? (
                <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-tuggi-blue" /></div>
              ) : (
                <div className="p-8 space-y-6">{children}</div>
              )
            )}
            {activeTab === 'description' && (
              <POIModalProvider value={ctx}><DescriptionTab /></POIModalProvider>
            )}
            {activeTab === 'narration-audio' && (
              <POIModalProvider value={ctx}><NarrationAudioTab /></POIModalProvider>
            )}
            {activeTab === 'trigger-points' && (
              venueLinked ? (
                <div className="p-8">
                  <div className="max-w-xl mx-auto text-center py-16">
                    <div className="inline-flex p-4 bg-amber-100 dark:bg-amber-900/20 rounded-2xl mb-5">
                      <Link2 className="h-8 w-8 text-amber-600 dark:text-amber-400" />
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">{t('trigger_disabled.title')}</h3>
                    <p className="text-sm text-gray-500 leading-relaxed">{t('trigger_disabled.body', { venue: venueName || '—' })}</p>
                  </div>
                </div>
              ) : (
                <POIModalProvider value={ctx}><TriggerPointsTab /></POIModalProvider>
              )
            )}
          </main>
        </div>

        {/* Footer (Details only — as demais abas têm seus próprios botões de salvar) */}
        {activeTab === 'details' && (
          <footer className="px-8 py-5 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-3">
            <button onClick={onClose} className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-sm font-medium rounded-xl text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              {tc('actions.cancel')}
            </button>
            {canEdit && (
              <button
                onClick={onSave}
                disabled={saving}
                className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-xl text-white bg-tuggi-blue hover:bg-tuggi-blue/90 shadow-lg shadow-tuggi-blue/20 disabled:opacity-50 transition-all"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? tc('actions.saving') : (isEdit ? tc('actions.save') : tc('actions.create'))}
              </button>
            )}
          </footer>
        )}
      </div>
    </div>
  )
}

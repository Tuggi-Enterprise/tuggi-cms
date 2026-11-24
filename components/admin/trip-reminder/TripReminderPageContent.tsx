'use client'

/**
 * /admin/trip-reminder (#1233): four tabs over the contract `docs/contracts/viagem-marcada-e-lembrete.md`.
 *
 * - Painel: `GET .../panel`, counts only (BR-USUARIO-055 item 6.c).
 * - Configuração: switches, numbers and WhatsApp templates (BR-COMUNICACAO-023 item 5,
 *   BR-COMUNICACAO-024 items 8 and 9, BR-MONETIZACAO-086 2.d, BR-MONETIZACAO-091).
 * - Segredos: write-only provider secrets and their change log (BR-COMUNICACAO-024 item 10).
 * - Envios: "send a test to me" and the send log (BR-COMUNICACAO-024 item 9).
 *
 * One read (`GET .../settings`) feeds Configuração, Segredos and the test grid; the panel and the
 * log load when their tab opens. Every block fails alone, with the refusal named.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Container } from '@/components/ui/Container'
import { DIM } from '@/components/ui/dense-table'
import type { TripAdminError, TripSettings } from '@/lib/trip-reminder/settings'
import { ReadFailure } from './ReadFailure'
import { TripPanel } from './TripPanel'
import { TripSettingsTab } from './TripSettingsTab'
import { ProviderSecrets } from './ProviderSecrets'
import { MessageSends } from './MessageSends'

const TABS = ['panel', 'settings', 'secrets', 'sends'] as const
type Tab = (typeof TABS)[number]

export type SettingsLoad =
  | { state: 'loading' }
  | { state: 'error'; error: TripAdminError | null }
  | { state: 'ready'; data: TripSettings }

export function TripReminderPageContent() {
  const t = useTranslations('TripReminder')
  const [tab, setTab] = useState<Tab>('panel')
  const [settings, setSettings] = useState<SettingsLoad>({ state: 'loading' })
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ panel: null, settings: null, secrets: null, sends: null })

  const loadSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/trip-reminder/settings', { cache: 'no-store' })
      const envelope = await response.json().catch(() => null)
      if (!response.ok) {
        setSettings({ state: 'error', error: envelope?.error ?? null })
        return
      }
      setSettings({ state: 'ready', data: envelope as TripSettings })
    } catch {
      setSettings({ state: 'error', error: null })
    }
  }, [])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length]
    setTab(next)
    tabRefs.current[next]?.focus()
  }

  const settingsBlock = (render: (data: TripSettings) => ReactNode) => {
    if (settings.state === 'loading') return <p className={`text-sm ${DIM}`}>{t('loading')}</p>
    if (settings.state === 'error') return <ReadFailure error={settings.error} onRetry={() => void loadSettings()} />
    return render(settings.data)
  }

  return (
    <div className="cms-width min-h-screen bg-gray-50/50">
      <Container className="py-8">
        <header className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{t('subtitle')}</p>
        </header>

        <div role="tablist" aria-label={t('title')} className="mb-6 flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-700">
          {TABS.map((id) => (
            <button
              key={id}
              ref={(el) => {
                tabRefs.current[id] = el
              }}
              id={`trip-tab-${id}`}
              role="tab"
              type="button"
              aria-selected={tab === id}
              aria-controls={`trip-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={onTabKey}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 sm:px-4 text-sm font-semibold ${
                tab === id
                  ? 'border-primary-800 text-primary-800 dark:border-sky-400 dark:text-sky-300'
                  : 'border-transparent text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'
              }`}>
              {t(`tabs.${id}`)}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`trip-panel-${tab}`} aria-labelledby={`trip-tab-${tab}`}>
          {tab === 'panel' ? <TripPanel /> : null}
          {tab === 'settings'
            ? settingsBlock((data) => <TripSettingsTab data={data} reload={loadSettings} onChange={(d) => setSettings({ state: 'ready', data: d })} />)
            : null}
          {tab === 'secrets' ? settingsBlock((data) => <ProviderSecrets data={data} reload={loadSettings} />) : null}
          {tab === 'sends' ? settingsBlock((data) => <MessageSends switches={data.switches} />) : null}
        </div>
      </Container>
    </div>
  )
}

'use client'

/**
 * /admin/reward-settings — the operator edits the numbers of earned hours (#855, values of #854).
 *
 * The editor itself is `RewardSettingsTable`, shared with `/admin/trip-reminder` (#1233). This
 * page owns the read (`GET /api/admin/reward-settings`, every key) and the header.
 *
 * pt-BR only, by card. The page gate is `resolveAccess` (proxy); the API gate is `withAuth`.
 */

import { useCallback, useEffect, useState } from 'react'
import { Container } from '@/components/ui/Container'
import { DIM } from '@/components/ui/dense-table'
import { RewardSettingsTable } from '@/components/admin/rewards/RewardSettingsTable'
import {
  rewardSettingErrorText,
  type RewardSettingError,
  type RewardSettingsEnvelope,
} from '@/lib/rewards/settings'

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

type Load =
  | { state: 'loading' }
  | { state: 'error'; error: RewardSettingError | null }
  | { state: 'ready'; data: RewardSettingsEnvelope }

export function RewardSettingsPageContent() {
  const [load, setLoad] = useState<Load>({ state: 'loading' })

  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/reward-settings', { cache: 'no-store' })
      const envelope = await response.json().catch(() => null)
      if (!response.ok) {
        setLoad({ state: 'error', error: envelope?.error ?? null })
        return
      }
      setLoad({ state: 'ready', data: envelope as RewardSettingsEnvelope })
    } catch {
      setLoad({ state: 'error', error: null })
    }
  }, [])

  useEffect(() => {
    void fetchSettings()
  }, [fetchSettings])

  return (
    <div className="cms-width min-h-screen bg-gray-50/50">
      <Container className="py-8">
        <header className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Horas concedidas</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Valor novo vale para concessões futuras. Hora já creditada não muda.
          </p>
          {load.state === 'ready' && load.data.updated_at ? (
            <p className={`mt-1 text-xs ${DIM}`}>
              Última alteração: {dateFormat.format(new Date(load.data.updated_at))}
            </p>
          ) : null}
        </header>

        {load.state === 'loading' ? <p className={`text-sm ${DIM}`}>Carregando…</p> : null}

        {load.state === 'error' ? (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Não foi possível ler os parâmetros. {rewardSettingErrorText(load.error)}
          </div>
        ) : null}

        {load.state === 'ready' ? (
          <RewardSettingsTable settings={load.data.settings} onSaved={fetchSettings} />
        ) : null}
      </Container>
    </div>
  )
}

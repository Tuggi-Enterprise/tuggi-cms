'use client'

/**
 * Which route partner (`core.custom_route_partners`) this Tuggi partner is (#1261, BR-B2B-073 item
 * 6; contract `tuggi-do-parceiro.md` §10.4). The public routes on the air of that route partner are
 * the "Roteiros de @parceiro" of the partner page and of the highlight. One here: choosing another
 * unties the previous one first. The route partners themselves are created in the route editor.
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { RoutePartner } from '@/lib/routes/route-ownership'

const INPUT =
  'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-tuggi-blue/40'

export function RoutePartnerLink({ clientId }: { clientId: string }) {
  const t = useTranslations('PartnerBrand.routePartner')
  const [partners, setPartners] = useState<RoutePartner[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/routes/partners')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return setMessage({ ok: false, text: t('readFailed') })
      setPartners(data.partners ?? [])
    } catch {
      setMessage({ ok: false, text: t('readFailed') })
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const current = partners?.find((p) => p.client_id === clientId) ?? null

  const patch = async (id: string, client: string | null) => {
    const res = await fetch('/api/routes/partners', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, client_id: client }),
    })
    return res.ok
  }

  const choose = async (id: string) => {
    setBusy(true)
    setMessage(null)
    try {
      if (current && current.id !== id && !(await patch(current.id, null))) return setMessage({ ok: false, text: t('saveFailed') })
      if (id && !(await patch(id, clientId))) return setMessage({ ok: false, text: t('saveFailed') })
      setMessage({ ok: true, text: id ? t('saved') : t('cleared') })
      await load()
    } catch {
      setMessage({ ok: false, text: t('saveFailed') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <label htmlFor={`route-partner-${clientId}`} className="block text-xs font-semibold text-gray-700">
        {t('label')}
      </label>
      <select
        id={`route-partner-${clientId}`}
        className={`${INPUT} w-full max-w-md`}
        disabled={busy || partners === null}
        value={current?.id ?? ''}
        onChange={(e) => void choose(e.target.value)}>
        <option value="">{t('none')}</option>
        {(partners ?? []).map((p) => (
          <option key={p.id} value={p.id} disabled={!!p.client_id && p.client_id !== clientId}>
            {p.client_id && p.client_id !== clientId ? t('takenOption', { name: p.name }) : p.name}
          </option>
        ))}
      </select>
      <p className="text-xs text-gray-600">{t('hint')}</p>
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={`text-sm ${message.ok ? 'text-green-800' : 'text-red-700'}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}

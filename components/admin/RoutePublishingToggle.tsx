'use client'

/**
 * "Can publish itineraries in the app" : `drive.profiles.can_publish_routes` (#945, spec 8.3).
 *
 * Admin only, above the `CreditPanel`. Saves on click through
 * `PATCH /api/admin/users/:id/route-publishing`, and turns it on AND off: off is how the CMS blocks
 * an abusive user (App Store 1.2, BR-ROTA-006). While the migration is not applied the door answers
 * `available: false` and nothing is drawn.
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

export function RoutePublishingToggle({ userId }: { userId: string }) {
  const t = useTranslations('Pages.AppUsers')
  const [available, setAvailable] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [failed, setFailed] = useState(false)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/admin/users/${userId}/route-publishing`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setAvailable(data.available === true)
        setEnabled(data.can_publish_routes === true)
      })
      .catch(() => { /* not drawn */ })
    return () => {
      cancelled = true
      if (savedTimer.current) clearTimeout(savedTimer.current)
    }
  }, [userId])

  if (!available) return null

  const toggle = async (next: boolean) => {
    const previous = enabled
    setEnabled(next)
    setSaving(true)
    setFailed(false)
    setSaved(false)
    try {
      const res = await fetch(`/api/admin/users/${userId}/route-publishing`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json()
      setEnabled(data.can_publish_routes === true)
      setSaved(true)
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setSaved(false), 2000)
    } catch {
      setEnabled(previous)
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
      <div className="flex items-start gap-3">
        <input
          id={`can-publish-${userId}`}
          type="checkbox"
          checked={enabled}
          disabled={saving}
          onChange={(event) => { void toggle(event.target.checked) }}
          aria-describedby={`can-publish-hint-${userId}`}
          className="mt-0.5 h-4 w-4 rounded border-gray-400 text-tuggi-blue focus:ring-tuggi-blue disabled:opacity-50"
        />
        <div className="min-w-0">
          <label htmlFor={`can-publish-${userId}`} className="text-sm font-semibold text-gray-900 dark:text-white">
            {t('can_publish_label')}
          </label>
          {saved && <span className="ml-2 text-xs font-semibold text-green-700" role="status">{t('can_publish_saved')}</span>}
          <p id={`can-publish-hint-${userId}`} className="text-xs text-gray-500">{t('can_publish_hint')}</p>
          {failed && <p className="text-xs text-red-700 mt-1" role="alert">{t('can_publish_error')}</p>}
        </div>
      </div>
    </div>
  )
}

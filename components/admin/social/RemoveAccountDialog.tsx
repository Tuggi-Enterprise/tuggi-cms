'use client'

/**
 * Stop following an account (#1059, spec 4.3): `PATCH accounts/{id}` with `active: false`, never a
 * DELETE, so the history comes back if the account is added again. The confirmation exists because
 * the days without collection do not come back. Focus starts on "Voltar" (`DialogShell`).
 */

import { useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/admin/credit/DialogShell'

export function RemoveAccountDialog({
  account,
  onClose,
  onRemoved,
}: {
  account: { id: string; username: string } | null
  onClose: () => void
  onRemoved: (username: string) => void
}) {
  const t = useTranslations('Pages.Social.competitors')
  const ta = useTranslations('Common.actions')
  const backRef = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const close = () => {
    setFailed(false)
    onClose()
  }

  const remove = async () => {
    if (!account) return
    setBusy(true)
    setFailed(false)
    try {
      const res = await fetch(`/api/admin/social/accounts/${account.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: false }),
      })
      if (!res.ok) throw new Error(String(res.status))
      onRemoved(account.username)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogShell
      open={account !== null}
      title={account ? t('remove_title', { username: account.username }) : ''}
      busy={busy}
      onClose={close}
      initialFocusRef={backRef}
      footer={
        <>
          <Button ref={backRef} type="button" variant="outline" onClick={close} disabled={busy}>
            {ta('back')}
          </Button>
          <Button type="button" variant="destructive" onClick={() => void remove()} disabled={busy}>
            {busy && <LoaderCircle className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {t('remove_yes')}
          </Button>
        </>
      }
    >
      <p className="text-sm text-gray-700 dark:text-gray-300">{t('remove_body')}</p>
      {failed && (
        <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {t('remove_failed')}
        </div>
      )}
    </DialogShell>
  )
}

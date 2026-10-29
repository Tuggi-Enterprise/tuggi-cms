'use client'

/**
 * Add an Instagram account to the comparison (#1059, spec 4.2). The username is normalized and
 * checked here BEFORE any call (Nielsen 5): trimmed, without the `@`, lowercase, Instagram's
 * characters only, and never our own account. The server checks it again, then asks the Meta
 * through `social-collect`; every refusal lands on the field with what to do next (Nielsen 9).
 */

import { useId, useRef, useState } from 'react'
import { LoaderCircle, Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DIM } from '@/components/ui/dense-table'
import { USERNAME_PATTERN, normalizeUsername } from '@/lib/social/labels'

type FieldError = 'error_invalid' | 'error_own' | 'error_duplicate' | 'error_not_found' | 'error_meta'

const ERROR_BY_CODE: Record<string, FieldError> = {
  invalid: 'error_invalid',
  own_account: 'error_own',
  duplicate: 'error_duplicate',
  not_found: 'error_not_found',
}

export function AddAccountForm({
  ownUsername,
  onAdded,
  onDuplicate,
}: {
  ownUsername: string | null
  onAdded: (id: string, username: string) => void
  onDuplicate: (id: string | null, username: string) => void
}) {
  const t = useTranslations('Pages.Social.competitors')
  const inputId = useId()
  const errorId = useId()
  const hintId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ key: FieldError; username: string } | null>(null)
  const [status, setStatus] = useState('')

  const fail = (key: FieldError, username: string) => {
    setError({ key, username })
    setStatus('')
    inputRef.current?.focus()
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const username = normalizeUsername(value)
    if (!USERNAME_PATTERN.test(username)) return fail('error_invalid', username)
    if (ownUsername && username === ownUsername) return fail('error_own', username)
    setError(null)
    setBusy(true)
    setStatus(t('add_checking'))
    try {
      const res = await fetch('/api/admin/social/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      })
      const body = (await res.json().catch(() => null)) as { account?: { id: string }; error?: { code?: string; id?: string } } | null
      if (res.ok && body?.account) {
        setValue('')
        setStatus(t('added', { username }))
        onAdded(body.account.id, username)
        return
      }
      const key = ERROR_BY_CODE[body?.error?.code ?? ''] ?? 'error_meta'
      if (key === 'error_duplicate') onDuplicate(body?.error?.id ?? null, username)
      fail(key, username)
    } catch {
      fail('error_meta', username)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mb-4">
      <Label htmlFor={inputId} className="mb-1 block text-sm font-medium text-gray-800 dark:text-gray-200">
        {t('add_label')}
      </Label>
      <div className="flex flex-wrap items-start gap-2">
        <div className="w-full max-w-xs">
          <Input
            id={inputId}
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('add_placeholder')}
            autoComplete="off"
            maxLength={31}
            disabled={busy}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${errorId} ${hintId}` : hintId}
          />
        </div>
        <Button type="submit" variant="cta" disabled={busy}>
          {busy ? (
            <LoaderCircle className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          {busy ? t('add_checking') : t('add_button')}
        </Button>
      </div>
      {error && (
        <p id={errorId} className="mt-1 text-xs text-red-700">
          {t(error.key, { username: error.username })}
        </p>
      )}
      <p id={hintId} className={`mt-1 text-xs ${DIM}`}>
        {t('add_hint')}
      </p>
      <p role="status" className="sr-only">
        {status}
      </p>
      {status && !busy && !error && <p className="mt-1 text-xs text-gray-700 dark:text-gray-300">{status}</p>}
    </form>
  )
}

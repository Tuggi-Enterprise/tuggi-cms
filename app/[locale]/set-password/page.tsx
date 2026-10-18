'use client'

// Where the CMS invite e-mail lands (#941): the invited person defines the password and goes in.
//
// The invite link carries the session in the URL hash (`#access_token=...&type=invite`): GoTrue
// does not support PKCE for `inviteUserByEmail`, and the shared browser client runs in PKCE, so
// it refuses to read that hash on its own. This page hands the two tokens to `setSession` and
// clears the hash. The password itself goes through `POST /api/auth/update-password`, the same
// route (and the same audit row) as any other password change.

import { useEffect, useState } from 'react'
import { useRouter } from '@/navigation'
import { useTranslations } from 'next-intl'
import { AlertCircle } from 'lucide-react'
import { getSupabaseClient } from '@/lib/core/supabase-client'
import { TuggiLogo } from '@/components/ui/TuggiLogo'

type LinkState = 'checking' | 'ready' | 'invalid'

export default function SetPasswordPage() {
  const t = useTranslations('Pages.SetPassword')
  const router = useRouter()
  const [linkState, setLinkState] = useState<LinkState>('checking')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    const supabase = getSupabaseClient()
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))

    const resolve = async () => {
      if (hash.get('error_description') || hash.get('error')) {
        setLinkState('invalid')
        return
      }
      const accessToken = hash.get('access_token')
      const refreshToken = hash.get('refresh_token')
      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })
        // The tokens must not stay in the address bar, the history or a copied link.
        window.history.replaceState(null, '', window.location.pathname)
        setLinkState(sessionError ? 'invalid' : 'ready')
        return
      }
      const { data } = await supabase.auth.getSession()
      setLinkState(data.session ? 'ready' : 'invalid')
    }

    resolve().catch(() => setLinkState('invalid'))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password !== confirmation) {
      setError(t('mismatch'))
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch('/api/auth/update-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        setError(body?.error || t('generic_error'))
        return
      }
      router.push('/dashboard')
    } catch {
      setError(t('generic_error'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-tuggi-background flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <TuggiLogo size="xl" showText={false} />
          </div>
          <h1 className="text-2xl font-bold text-tuggi-text mb-2">{t('title')}</h1>
          <p className="text-sm text-gray-600">{t('subtitle')}</p>
        </div>

        {linkState === 'checking' && (
          <div className="flex justify-center">
            <div className="w-6 h-6 border-2 border-tuggi-blue border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {linkState === 'invalid' && (
          <div className="tuggi-card p-8 shadow-xl text-sm text-tuggi-text flex items-start space-x-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5 text-tuggi-orange" />
            <span>{t('invalid_link')}</span>
          </div>
        )}

        {linkState === 'ready' && (
          <form className="tuggi-card p-8 space-y-6 shadow-xl" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-red-50 border border-red-200 text-tuggi-orange px-4 py-3 rounded-md text-sm flex items-center space-x-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-tuggi-text mb-2">
                {t('password_label')}
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isSaving}
                className="tuggi-input block w-full px-4 py-3 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue disabled:opacity-50 sm:text-sm"
              />
            </div>

            <div>
              <label htmlFor="confirmation" className="block text-sm font-medium text-tuggi-text mb-2">
                {t('confirmation_label')}
              </label>
              <input
                id="confirmation"
                type="password"
                autoComplete="new-password"
                required
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                disabled={isSaving}
                className="tuggi-input block w-full px-4 py-3 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue disabled:opacity-50 sm:text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={isSaving || !password || !confirmation}
              className="tuggi-button-primary w-full flex justify-center py-3 px-4 text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-tuggi-blue disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? t('saving') : t('submit')}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

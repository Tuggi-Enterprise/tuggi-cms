'use client'

import { useState, useEffect } from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, AlertCircle } from 'lucide-react'
import { TuggiLogo } from '@/components/ui/TuggiLogo'
import type { CmsUser } from '@/lib/supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const supabase = createClientComponentClient()
  const router = useRouter()

  // Check if user is already logged in
  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        router.push('/dashboard')
      }
    }
    checkUser()
  }, [supabase, router])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    try {
      // Step 1: Authenticate with Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (authError) {
        if (
          authError.status === 429 ||
          authError.code === 'over_request_rate_limit'
        ) {
          setError('Too many login attempts. Please wait a few minutes and try again.');
        } else {
          setError(authError.message)
        }
        return
      }

      if (!authData.user) {
        setError('Authentication failed')
        return
      }

      // Step 2: Check authorization in cms_users table
      const { data: cmsUser, error: cmsError } = await supabase
        .schema('core')
        .from('cms_users')
        .select('*')
        .eq('email', authData.user.email)
        .eq('is_active', true)
        .single()

      if (cmsError) {
        await supabase.auth.signOut()
        setError(`Database error: ${cmsError.message}`)
        return
      }

      if (!cmsUser) {
        await supabase.auth.signOut()
        setError('Access denied. You are not authorized to use this CMS.')
        return
      }

      // Step 3: Check role authorization (admin or editor only)
      if (!['admin', 'editor'].includes(cmsUser.role)) {
        await supabase.auth.signOut()
        setError('Access denied. Insufficient privileges.')
        return
      }

      // Step 4: Update last login timestamp
      const { error: updateError } = await supabase
        .schema('core')
        .from('cms_users')
        .update({ last_login_at: new Date().toISOString() })
        .eq('email', authData.user.email)

      if (updateError) {
        console.warn('Failed to update last_login_at:', updateError)
      }

      // Step 5: Redirect to dashboard
      router.push('/dashboard')

    } catch (err) {
      console.error('Login error:', err)
      setError('An unexpected error occurred. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-tuggi-background flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-8">
        {/* Logo & Header */}
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <TuggiLogo size="xl" showText={false} />
          </div>
          <h1 className="text-4xl font-bold text-tuggi-text mb-2">
            Tuggi
          </h1>
          <h2 className="text-xl font-medium text-tuggi-blue mb-3">
            Content Management System
          </h2>
          <p className="text-sm text-gray-600">
            Sign in to manage your points of interest
          </p>
        </div>

        {/* Login Form */}
        <form className="tuggi-card p-8 space-y-6 shadow-xl" onSubmit={handleLogin}>
          {error && (
            <div className="bg-red-50 border border-red-200 text-tuggi-orange px-4 py-3 rounded-md text-sm flex items-center space-x-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-tuggi-text mb-2">
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
              className="tuggi-input appearance-none relative block w-full px-4 py-3 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue disabled:opacity-50 disabled:cursor-not-allowed sm:text-sm"
              placeholder="Enter your email"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-tuggi-text mb-2">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                className="tuggi-input appearance-none relative block w-full px-4 py-3 pr-12 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue disabled:opacity-50 disabled:cursor-not-allowed sm:text-sm"
                placeholder="Enter your password"
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 pr-4 flex items-center"
                onClick={() => setShowPassword(!showPassword)}
                disabled={isLoading}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4 text-gray-400" />
                ) : (
                  <Eye className="h-4 w-4 text-gray-400" />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading || !email.trim() || !password}
            className="tuggi-button-primary group relative w-full flex justify-center py-3 px-4 text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-tuggi-blue disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
          >
            {isLoading ? (
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>Signing in...</span>
              </div>
            ) : (
              'Sign in'
            )}
          </button>
        </form>

        {/* Footer */}
        <div className="text-center text-xs text-gray-500">
          <p>Secure access for authorized personnel only</p>
        </div>
      </div>
    </div>
  )
} 
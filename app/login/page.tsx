'use client'

import { useState } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, MapPin } from 'lucide-react'
import { TuggiLogo } from '@/components/ui/TuggiLogo'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const supabase = useSupabaseClient()
  const router = useRouter()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        setError(error.message)
      } else if (data.user) {
        // Check if user has admin role
        const userRole = data.user.user_metadata?.role || data.user.app_metadata?.role
        if (userRole !== 'admin') {
          setError('Access denied. Admin role required.')
          await supabase.auth.signOut()
        } else {
          router.push('/dashboard')
        }
      }
    } catch (err) {
      setError('An unexpected error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-tuggi-background dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-8">
        {/* Logo & Header */}
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <TuggiLogo size="xl" showText={false} />
          </div>
          <h1 className="text-4xl font-bold text-tuggi-text dark:text-white mb-2">
            Tuggi
          </h1>
          <h2 className="text-xl font-medium text-tuggi-blue dark:text-tuggi-blue mb-3">
            Content Management System
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Sign in to manage your points of interest
          </p>
        </div>

        {/* Login Form */}
        <form className="tuggi-card p-8 space-y-6 shadow-xl" onSubmit={handleLogin}>
          {error && (
            <div className="bg-red-50 dark:bg-red-900/50 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 px-4 py-3 rounded-md text-sm">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-tuggi-text dark:text-gray-300 mb-2">
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
              className="tuggi-input appearance-none relative block w-full px-4 py-3 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue sm:text-sm"
              placeholder="Enter your email"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-tuggi-text dark:text-gray-300 mb-2">
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
                className="tuggi-input appearance-none relative block w-full px-4 py-3 pr-12 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue sm:text-sm"
                placeholder="Enter your password"
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 pr-4 flex items-center"
                onClick={() => setShowPassword(!showPassword)}
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
            disabled={isLoading}
            className="tuggi-button-primary group relative w-full flex justify-center py-3 px-4 text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
} 
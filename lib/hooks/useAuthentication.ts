/**
 * Authentication Hook for Supabase Edge Functions
 * 
 * Provides helpers to automatically include Bearer tokens in edge function calls
 * 
 * Usage:
 * ```typescript
 * import { useAuthenticatedInvoke, useAuthenticatedFetch } from '@/lib/hooks/useAuthentication'
 * 
 * // In a React component
 * const authenticatedInvoke = useAuthenticatedInvoke()
 * const { data } = await authenticatedInvoke('generate-description', { body: {...} })
 * 
 * // Or for fetch
 * const authenticatedFetch = useAuthenticatedFetch()
 * const response = await authenticatedFetch('/api/endpoint', { method: 'POST' })
 * ```
 */

'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'

/**
 * Hook to invoke edge functions with automatic Bearer token
 * 
 * @returns Function to invoke edge functions with authentication
 */
export function useAuthenticatedInvoke() {
  const supabase = useSupabaseClient()
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Fetch token on mount
  useEffect(() => {
    const fetchToken = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.access_token) {
          setToken(session.access_token)
        }
      } catch (error) {
        console.error('Failed to fetch auth token:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchToken()
  }, [supabase.auth])

  // Return invoke function
  return useCallback(
    async (functionName: string, options?: any) => {
      if (isLoading) {
        throw new Error('Authentication is still loading')
      }

      if (!token) {
        console.warn(`⚠️ No authentication token available for ${functionName}`)
        // Fallback: try to invoke without token (may fail if function requires auth)
        return supabase.functions.invoke(functionName, options)
      }

      // Add Authorization header to options
      const authOptions = {
        ...options,
        headers: {
          ...options?.headers,
          'Authorization': `Bearer ${token}`
        }
      }

      console.log(`📡 Invoking ${functionName} with authentication`)

      return supabase.functions.invoke(functionName, authOptions)
    },
    [supabase.functions, token, isLoading]
  )
}

/**
 * Hook for authenticated fetch calls to APIs and edge functions
 * 
 * @returns Fetch function with automatic Bearer token
 */
export function useAuthenticatedFetch() {
  const supabase = useSupabaseClient()
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Fetch token on mount
  useEffect(() => {
    const fetchToken = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.access_token) {
          setToken(session.access_token)
        }
      } catch (error) {
        console.error('Failed to fetch auth token:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchToken()
  }, [supabase.auth])

  // Return fetch wrapper
  return useCallback(
    async (url: string, options?: RequestInit) => {
      if (isLoading) {
        throw new Error('Authentication is still loading')
      }

      if (!token) {
        console.warn(`⚠️ No authentication token available for ${url}`)
        // Fallback: try regular fetch
        return fetch(url, options)
      }

      // Add Authorization header
      const authOptions = {
        ...options,
        headers: {
          ...options?.headers,
          'Authorization': `Bearer ${token}`
        }
      }

      console.log(`📡 Fetching ${url} with authentication`)

      return fetch(url, authOptions)
    },
    [token, isLoading]
  )
}

/**
 * Standalone function to get current auth token
 * Useful for non-React code or manual token management
 */
export async function getAuthToken(supabaseClient: any): Promise<string | null> {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession()
    return session?.access_token || null
  } catch (error) {
    console.error('Failed to get auth token:', error)
    return null
  }
}

/**
 * Helper to create fetch headers with Bearer token
 */
export function createAuthHeaders(token: string, additionalHeaders?: Record<string, string>): Record<string, string> {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...additionalHeaders
  }
}

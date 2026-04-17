'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { getSupabaseClient } from '@/lib/core/supabase-client'
import { SessionContextProvider } from '@supabase/auth-helpers-react'
import { QueryProvider } from '@/components/providers/QueryProvider'
import { UserLocationProvider } from '@/components/providers/UserLocationProvider'

const ThemeContext = createContext<{
  theme: 'light' | 'dark'
  toggleTheme: () => void
}>({
  theme: 'light',
  toggleTheme: () => {},
})

export const useTheme = () => useContext(ThemeContext)

export function Providers({ children }: { children: React.ReactNode }) {
  const [supabaseClient] = useState(() => getSupabaseClient())
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark'
    if (savedTheme) {
      setTheme(savedTheme)
    }
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    const { data: subscription } = supabaseClient.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') {
        fetch('/api/audit/auth-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'LOGIN_SUCCESS',
            description: 'Login successful',
            user_email: session?.user?.email
          })
        }).catch((err) => {
          console.warn('Auth audit log failed (non-blocking):', err)
        })
      }
    })

    return () => {
      subscription.subscription?.unsubscribe()
    }
  }, [supabaseClient])

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light')
  }

  return (
    <SessionContextProvider supabaseClient={supabaseClient}>
      <QueryProvider>
        <UserLocationProvider>
          <ThemeContext.Provider value={{ theme, toggleTheme }}>
            {children}
          </ThemeContext.Provider>
        </UserLocationProvider>
      </QueryProvider>
    </SessionContextProvider>
  )
} 
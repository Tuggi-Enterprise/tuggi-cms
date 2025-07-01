'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { SessionContextProvider } from '@supabase/auth-helpers-react'

const ThemeContext = createContext<{
  theme: 'light' | 'dark'
  toggleTheme: () => void
}>({
  theme: 'light',
  toggleTheme: () => {},
})

export const useTheme = () => useContext(ThemeContext)

export function Providers({ children }: { children: React.ReactNode }) {
  const [supabaseClient] = useState(() => createClientComponentClient())
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')

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

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light')
  }

  return (
    <SessionContextProvider supabaseClient={supabaseClient}>
      <ThemeContext.Provider value={{ theme, toggleTheme }}>
        {children}
      </ThemeContext.Provider>
    </SessionContextProvider>
  )
} 
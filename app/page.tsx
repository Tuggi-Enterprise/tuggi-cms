'use client'

import { useEffect } from 'react'
import { useSupabaseClient, useUser } from '@supabase/auth-helpers-react'
import { useRouter } from 'next/navigation'

export default function HomePage() {
  const user = useUser()
  const router = useRouter()

  useEffect(() => {
    if (user) {
      router.push('/dashboard')
    } else {
      router.push('/login')
    }
  }, [user, router])

  return (
    <div className="min-h-screen bg-tuggi-background dark:bg-gray-900 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-tuggi-blue mx-auto"></div>
        <p className="mt-4 text-tuggi-text dark:text-gray-400">Loading...</p>
      </div>
    </div>
  )
} 
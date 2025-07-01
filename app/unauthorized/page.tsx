'use client'

import { AlertCircle, ArrowLeft, LogOut } from 'lucide-react'
import Link from 'next/link'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { useRouter } from 'next/navigation'

export default function UnauthorizedPage() {
  const supabase = createClientComponentClient()
  const router = useRouter()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="min-h-screen bg-tuggi-background flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="tuggi-card py-8 px-4 shadow-xl sm:px-10">
          <div className="flex flex-col items-center space-y-4">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100">
              <AlertCircle className="h-6 w-6 text-tuggi-orange" />
            </div>
            
            <div className="text-center">
              <h1 className="text-2xl font-bold text-tuggi-text">
                Access Denied
              </h1>
              <p className="mt-2 text-sm text-gray-600">
                You don't have permission to access this CMS.
              </p>
              <p className="mt-1 text-sm text-gray-500">
                Only authorized admin and editor users can access this system.
              </p>
            </div>

            <div className="flex flex-col space-y-3 w-full">
              <button
                onClick={handleLogout}
                className="tuggi-button-secondary w-full flex justify-center items-center px-4 py-2 rounded-md text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </button>
              <Link
                href="/debug"
                className="tuggi-button-primary w-full flex justify-center items-center px-4 py-2 rounded-md text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors"
              >
                Debug User Info
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
} 
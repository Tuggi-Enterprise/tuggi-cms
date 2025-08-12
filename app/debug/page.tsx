'use client'

import { useUser, useSupabaseClient } from '@supabase/auth-helpers-react'
import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'

export default function DebugPage() {
  const user = useUser()
  const supabase = useSupabaseClient()
  const [dbUserData, setDbUserData] = useState<any>(null)

  const fetchDbUserData = useCallback(async () => {
    if (!user) return
    
    try {
      const { data, error } = await supabase
        .from('auth.users')
        .select('*')
        .eq('id', user.id)
        .single()
      
      setDbUserData(data)
    } catch (error) {
      console.error('Error fetching user data:', error)
    }
  }, [user, supabase])

  useEffect(() => {
    if (user) {
      fetchDbUserData()
    }
  }, [user, fetchDbUserData])

  if (!user) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Debug - Not Logged In</h1>
        <p>Please log in first to see debug information.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-tuggi-background dark:bg-gray-900 p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6 text-tuggi-text dark:text-white">
          Debug User Information
        </h1>
        
        <div className="space-y-6">
          {/* Session User Data */}
          <div className="tuggi-card p-6">
            <h2 className="text-xl font-semibold mb-4 text-tuggi-text dark:text-white">
              Session User Data
            </h2>
            <div className="bg-gray-100 dark:bg-gray-700 p-4 rounded-md overflow-auto">
              <pre className="text-sm">
                {JSON.stringify(user, null, 2)}
              </pre>
            </div>
          </div>

          {/* User Metadata */}
          <div className="tuggi-card p-6">
            <h2 className="text-xl font-semibold mb-4 text-tuggi-text dark:text-white">
              User Metadata
            </h2>
            <div className="space-y-3 mb-4">
              <div className="flex items-center space-x-2">
                <span className="font-medium text-tuggi-text">user_metadata.role:</span>
                <span className={cn(
                  'px-2 py-1 text-xs font-medium rounded-full',
                  user.user_metadata?.role === 'admin' 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-tuggi-orange/10 text-tuggi-orange'
                )}>
                  {user.user_metadata?.role || 'Not set'}
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="font-medium text-tuggi-text">app_metadata.role:</span>
                <span className={cn(
                  'px-2 py-1 text-xs font-medium rounded-full',
                  user.app_metadata?.role === 'admin' 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-tuggi-orange/10 text-tuggi-orange'
                )}>
                  {user.app_metadata?.role || 'Not set'}
                </span>
              </div>
            </div>
            <div className="bg-gray-100 dark:bg-gray-700 p-4 rounded-md mt-4 overflow-auto">
              <h3 className="font-medium mb-2 text-tuggi-text">Full user_metadata:</h3>
              <pre className="text-sm">
                {JSON.stringify(user.user_metadata, null, 2)}
              </pre>
            </div>
            <div className="bg-gray-100 dark:bg-gray-700 p-4 rounded-md mt-4 overflow-auto">
              <h3 className="font-medium mb-2 text-tuggi-text">Full app_metadata:</h3>
              <pre className="text-sm">
                {JSON.stringify(user.app_metadata, null, 2)}
              </pre>
            </div>
          </div>

          {/* Database User Data */}
          <div className="tuggi-card p-6">
            <h2 className="text-xl font-semibold mb-4 text-tuggi-text dark:text-white">
              Database User Data
            </h2>
            {dbUserData ? (
              <div className="bg-gray-100 dark:bg-gray-700 p-4 rounded-md overflow-auto">
                <pre className="text-sm">
                  {JSON.stringify(dbUserData, null, 2)}
                </pre>
              </div>
            ) : (
              <p className="text-tuggi-text">Loading database user data...</p>
            )}
          </div>

          {/* Quick Fix Instructions */}
          <div className="bg-tuggi-blue/10 border border-tuggi-blue/20 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4 text-tuggi-blue">
              Quick Fix Options
            </h2>
            <div className="space-y-4 text-sm">
              <div>
                <h3 className="font-medium text-tuggi-text">Option 1: Update via SQL (recommended)</h3>
                <p className="text-gray-600 mb-2">Run this in your Supabase SQL Editor:</p>
                <code className="block bg-white border border-tuggi-border p-3 rounded-md mt-1 text-tuggi-text">
                  {`UPDATE auth.users 
SET raw_user_meta_data = '{"role": "admin"}'::jsonb
WHERE email = '${user.email}';`}
                </code>
              </div>
              <div>
                <h3 className="font-medium text-tuggi-text">Option 2: Update via Supabase Dashboard</h3>
                <p className="text-gray-600 mb-2">Go to Authentication &gt; Users &gt; Your User &gt; Raw User Meta Data and set:</p>
                <code className="block bg-white border border-tuggi-border p-3 rounded-md mt-1 text-tuggi-text">
                  {`{"role": "admin"}`}
                </code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
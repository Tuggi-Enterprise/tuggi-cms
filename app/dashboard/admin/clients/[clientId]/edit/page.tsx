'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { ClientFormAdmin } from '@/components/admin/ClientFormAdmin'
import { Client } from '@/types/clients'
import { useSupabaseClient, useSessionContext } from '@supabase/auth-helpers-react'

export default function AdminEditClientPage({
  params
}: {
  params: { clientId: string }
}) {
  const router = useRouter()
  const { session, isLoading: sessionLoading } = useSessionContext()
  const supabase = useSupabaseClient()
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [client, setClient] = useState<Client | null>(null)

  useEffect(() => {
    const checkAuth = async () => {
      if (sessionLoading) return
      if (!session) {
        router.push('/login')
        return
      }

      try {
        // Prefer server-side admin API which uses service-role and validates admin status.
        const res = await fetch(`/api/admin/clients/${params.clientId}`)

        if (res.status === 403) {
          // Server says user is not admin / not authorized
          router.push('/unauthorized')
          return
        }

        if (res.status === 404) {
          router.push('/dashboard/admin/clients')
          return
        }

        if (!res.ok) {
          console.error('Failed to fetch client (admin API):', await res.text())
          router.push('/dashboard/admin/clients')
          return
        }

        const data = await res.json()
        setClient(data.client as Client)
        setIsAuthorized(true)
      } catch (error) {
        console.error('Auth/error fetching client via admin API:', error)
        router.push('/unauthorized')
      } finally {
        setIsLoading(false)
      }
    }

    checkAuth()
  }, [session, sessionLoading, router, params.clientId])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-tuggi-blue mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  if (!isAuthorized || !client) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header with breadcrumb */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/dashboard" className="text-blue-600 hover:text-blue-700">
              Dashboard
            </Link>
            <ChevronRight className="w-4 h-4 text-gray-400" />
            <Link href="/dashboard/admin/clients" className="text-blue-600 hover:text-blue-700">
              Clients
            </Link>
            <ChevronRight className="w-4 h-4 text-gray-400" />
            <Link href={`/dashboard/admin/clients/${client.id}`} className="text-blue-600 hover:text-blue-700">
              {client.name}
            </Link>
            <ChevronRight className="w-4 h-4 text-gray-400" />
            <span className="text-gray-900 font-medium">Edit</span>
          </nav>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg border border-gray-200 p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Edit Client</h1>
          <p className="text-gray-600 mb-8">Update client information</p>

          <ClientFormAdmin 
            client={client as Client}
            onSubmit={(client) => {
              // Redirect after success
              window.location.href = `/dashboard/admin/clients/${client.id}`
            }}
            onCancel={() => {
              window.history.back()
            }}
          />
        </div>
      </div>
    </div>
  )
}

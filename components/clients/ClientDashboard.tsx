'use client'

import React, { useEffect, useState } from 'react'
import { Client, ClientCmsUser } from '@/types/clients'

interface ClientDashboardProps {
  clientId?: string
}

export function ClientDashboard({ clientId: initialClientId }: ClientDashboardProps) {
  const [clients, setClients] = useState<Client[]>([])
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [linkedUsers, setLinkedUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchClients()
  }, [])

  useEffect(() => {
    if (selectedClient) {
      fetchLinkedData(selectedClient.id)
    }
  }, [selectedClient])

  const fetchClients = async () => {
    try {
      const response = await fetch('/api/clients/my-clients')
      const data = await response.json()

      if (data.success) {
        setClients(data.clients)
        if (initialClientId) {
          const client = data.clients.find((c: Client) => c.id === initialClientId)
          if (client) {
            setSelectedClient(client)
          }
        } else if (data.clients.length > 0) {
          setSelectedClient(data.clients[0])
        }
      }
    } catch (error) {
      console.error('Error fetching clients:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchLinkedData = async (clientId: string) => {
    try {
      // Fetch linked CMS users
      const usersResponse = await fetch(`/api/clients/${clientId}/users`)
      if (usersResponse.ok) {
        const usersData = await usersResponse.json()
        setLinkedUsers(usersData.users || [])
      }
    } catch (error) {
      console.error('Error fetching linked data:', error)
    }
  }

  if (loading) {
    return <div className="text-center py-8">Loading...</div>
  }

  if (clients.length === 0) {
    return (
      <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-6 text-center">
        <p className="text-yellow-700">No approved clients found. Contact admin to get approval.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Client Selector */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900 mb-3">My Clients</h3>
        <div className="space-y-2">
          {clients.map(client => (
            <button
              key={client.id}
              onClick={() => setSelectedClient(client)}
              className={`w-full text-left p-3 rounded-md border transition ${
                selectedClient?.id === client.id
                  ? 'bg-blue-50 border-blue-300'
                  : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
              }`}
            >
              <h4 className="font-medium text-gray-900">{client.name}</h4>
              <p className="text-sm text-gray-600">{client.email}</p>
            </button>
          ))}
        </div>
      </div>

      {selectedClient && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="p-6 bg-gradient-to-r from-blue-50 to-blue-100 border-b border-gray-200">
            <h2 className="text-xl font-bold text-gray-900">{selectedClient.name}</h2>
            <p className="text-sm text-gray-600 mt-1">{selectedClient.email}</p>
          </div>

          {/* Linked Users Section */}
          <div className="p-6 space-y-4">
            <h3 className="font-semibold text-gray-900">👥 CMS Users Linked to This Client</h3>
            {linkedUsers.length === 0 ? (
              <p className="text-gray-600 text-sm">No users linked yet</p>
            ) : (
              <div className="space-y-2">
                {linkedUsers.map((link: any) => (
                  <div key={link.id} className="p-3 bg-gray-50 rounded-md border border-gray-200 flex justify-between items-center">
                    <div>
                      <p className="font-medium text-gray-900">{link.cms_users?.full_name ?? link.cms_users?.name}</p>
                      <p className="text-sm text-gray-600">{link.cms_users?.email}</p>
                      <span className="inline-block text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded mt-1">
                        {link.client_role}
                      </span>
                    </div>
                    <button
                      className="text-red-600 hover:text-red-700 text-sm font-medium"
                      onClick={() => console.log('Remove user:', link.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

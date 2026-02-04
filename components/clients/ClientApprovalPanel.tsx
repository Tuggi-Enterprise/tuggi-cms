'use client'

import React, { useEffect, useState } from 'react'
import { Client } from '@/types/clients'

interface ClientApprovalPanelProps {
  onApprove?: (clientId: string) => void
  onReject?: (clientId: string) => void
}

export function ClientApprovalPanel({ onApprove, onReject }: ClientApprovalPanelProps) {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [cmsUserEmail, setCmsUserEmail] = useState('')
  const [cmsUserName, setCmsUserName] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [action, setAction] = useState<'approve' | 'reject' | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetchPendingClients()
  }, [])

  const fetchPendingClients = async () => {
    try {
      const response = await fetch('/api/admin/clients/pending')
      const data = await response.json()

      if (data.success) {
        setClients(data.clients)
      } else {
        console.error('Failed to fetch pending clients:', data.error)
      }
    } catch (error) {
      console.error('Error fetching pending clients:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async () => {
    if (!selectedClient || !cmsUserEmail || !cmsUserName) {
      alert('Please fill in all required fields')
      return
    }

    setSubmitting(true)

    try {
      const response = await fetch(`/api/admin/clients/${selectedClient.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmsUserEmail, cmsUserName })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to approve')
      }

      setClients(clients.filter(c => c.id !== selectedClient.id))
      setSelectedClient(null)
      setCmsUserEmail('')
      setCmsUserName('')
      setAction(null)
      onApprove?.(selectedClient.id)
    } catch (error) {
      alert(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setSubmitting(false)
    }
  }

  const handleReject = async () => {
    if (!selectedClient) {
      alert('Please select a client')
      return
    }

    setSubmitting(true)

    try {
      const response = await fetch(`/api/admin/clients/${selectedClient.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejectionReason: rejectReason })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to reject')
      }

      setClients(clients.filter(c => c.id !== selectedClient.id))
      setSelectedClient(null)
      setRejectReason('')
      setAction(null)
      onReject?.(selectedClient.id)
    } catch (error) {
      alert(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="text-center py-8">Loading pending clients...</div>
  }

  if (clients.length === 0) {
    return (
      <div className="rounded-lg bg-blue-50 border border-blue-200 p-6 text-center">
        <p className="text-blue-700">No pending client registrations</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="p-4 bg-gray-50 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Pending Client Registrations ({clients.length})</h3>
        </div>

        <div className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
          {clients.map(client => (
            <div
              key={client.id}
              onClick={() => setSelectedClient(client)}
              className={`p-4 cursor-pointer hover:bg-gray-50 transition ${
                selectedClient?.id === client.id ? 'bg-blue-50' : ''
              }`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-medium text-gray-900">{client.name}</h4>
                  <p className="text-sm text-gray-600">{client.email}</p>
                  {client.company_name && <p className="text-sm text-gray-600">{client.company_name}</p>}
                  {client.city && <p className="text-xs text-gray-500">{client.city}, {client.state}</p>}
                </div>
                <span className="text-xs text-gray-500">
                  {new Date(client.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {selectedClient && action === null && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Details: {selectedClient.name}</h3>
          <div className="space-y-2 text-sm text-gray-600 mb-6">
            <p><strong>Email:</strong> {selectedClient.email}</p>
            <p><strong>Phone:</strong> {selectedClient.phone || 'N/A'}</p>
            <p><strong>Company:</strong> {selectedClient.company_name || 'N/A'}</p>
            <p><strong>Address:</strong> {selectedClient.address || 'N/A'}</p>
            <p><strong>City:</strong> {selectedClient.city || 'N/A'}, {selectedClient.state || 'N/A'}</p>
            <p><strong>Country:</strong> {selectedClient.country || 'N/A'}</p>
            <p><strong>Industry:</strong> {selectedClient.industry || 'N/A'}</p>
            {selectedClient.website && <p><strong>Website:</strong> <a href={selectedClient.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{selectedClient.website}</a></p>}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setAction('approve')}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-md transition"
            >
              ✅ Approve
            </button>
            <button
              onClick={() => setAction('reject')}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-md transition"
            >
              ❌ Reject
            </button>
          </div>
        </div>
      )}

      {selectedClient && action === 'approve' && (
        <div className="bg-white rounded-lg border border-green-200 p-6">
          <h3 className="font-semibold text-green-900 mb-4">Approve Client: {selectedClient.name}</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                CMS User Email <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                value={cmsUserEmail}
                onChange={e => setCmsUserEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-green-500 focus:border-green-500"
                placeholder="user@example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                CMS User Full Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={cmsUserName}
                onChange={e => setCmsUserName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-green-500 focus:border-green-500"
                placeholder="John Doe"
              />
            </div>

            <p className="text-sm text-gray-600">
              A CMS user with role <strong>client</strong> will be created with these credentials.
            </p>

            <div className="flex gap-2">
              <button
                onClick={handleApprove}
                disabled={submitting}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-md transition"
              >
                {submitting ? 'Approving...' : 'Confirm Approve'}
              </button>
              <button
                onClick={() => setAction(null)}
                disabled={submitting}
                className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-900 font-medium py-2 px-4 rounded-md transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedClient && action === 'reject' && (
        <div className="bg-white rounded-lg border border-red-200 p-6">
          <h3 className="font-semibold text-red-900 mb-4">Reject Client: {selectedClient.name}</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Rejection Reason
              </label>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500"
                rows={4}
                placeholder="Why are you rejecting this client registration?"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleReject}
                disabled={submitting}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-md transition"
              >
                {submitting ? 'Rejecting...' : 'Confirm Reject'}
              </button>
              <button
                onClick={() => setAction(null)}
                disabled={submitting}
                className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-900 font-medium py-2 px-4 rounded-md transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

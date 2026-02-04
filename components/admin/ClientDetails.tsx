'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, ArrowLeft, Edit2, Plus, Trash2, AlertCircle, Check } from 'lucide-react'
import { Client } from '@/types/clients'
import { CmsUser } from '@/lib/supabase'

interface ClientDetailsProps {
  clientId: string
}

const statusColors = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800'
}

export function ClientDetails({ clientId }: ClientDetailsProps) {
  const router = useRouter()
  const [client, setClient] = useState<(Client & { users_count: number }) | null>(null)
  const [linkedUsers, setLinkedUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddUser, setShowAddUser] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [selectedRole, setSelectedRole] = useState('viewer')
  const [allUsers, setAllUsers] = useState<CmsUser[]>([])
  const [addingUser, setAddingUser] = useState(false)
  const [unlinkingUserId, setUnlinkingUserId] = useState<string | null>(null)
  const [loadingUsers, setLoadingUsers] = useState(false)

  useEffect(() => {
    if (!clientId) return
    fetchClientDetails()
    fetchLinkedUsers()
  }, [clientId])

  const fetchClientDetails = async () => {
    try {
      const response = await fetch(`/api/admin/clients/${clientId}`)
      if (!response.ok) throw new Error('Failed to fetch client')
      const data = await response.json()
      setClient(data.client)
    } catch (err) {
      setError('Failed to load client details')
      console.error(err)
    }
  }

  const fetchLinkedUsers = async () => {
    try {
      const response = await fetch(`/api/clients/${clientId}/users`)
      if (!response.ok) throw new Error('Failed to fetch linked users')
      const data = await response.json()
      setLinkedUsers(data.users || [])
    } catch (err) {
      console.error('Failed to load linked users:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchAvailableUsers = async () => {
    try {
      setLoadingUsers(true)
      const response = await fetch('/api/admin/users?limit=100')
      if (!response.ok) throw new Error('Failed to fetch users')
      const data = await response.json()
      console.log('📊 Fetched users:', data)
      console.log('📊 Linked users:', linkedUsers)
      // Filter out already linked users
      const linked = linkedUsers.map(u => u.cms_user_id)
      const availableUsers = (data.users || []).filter((u: CmsUser) => !linked.includes(u.id))
      console.log('📊 Available users after filter:', availableUsers)
      setAllUsers(availableUsers)
    } catch (err) {
      console.error('Failed to load available users:', err)
      setError('Failed to load available users')
    } finally {
      setLoadingUsers(false)
    }
  }

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedUserId) return

    try {
      setAddingUser(true)
      const response = await fetch(`/api/admin/users/${selectedUserId}/link-client`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_role: selectedRole })
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Failed to add user')
        return
      }

      // Refresh linked users
      await fetchLinkedUsers()
      setShowAddUser(false)
      setSelectedUserId('')
      setSelectedRole('viewer')
    } catch (err) {
      setError('Failed to add user')
      console.error(err)
    } finally {
      setAddingUser(false)
    }
  }

  const handleUnlinkUser = async (userId: string) => {
    try {
      setUnlinkingUserId(userId)
      const response = await fetch(`/api/admin/users/${userId}/link-client?client_id=${clientId}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Failed to unlink user')
        return
      }

      // Refresh linked users
      await fetchLinkedUsers()
    } catch (err) {
      setError('Failed to unlink user')
      console.error(err)
    } finally {
      setUnlinkingUserId(null)
    }
  }

  if (loading) {
    return <div className="text-center py-8">Loading...</div>
  }

  if (!client) {
    return <div className="text-center py-8 text-red-600">Client not found</div>
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm mb-8">
        <Link href="/dashboard" className="text-blue-600 hover:text-blue-700">
          Dashboard
        </Link>
        <ChevronRight className="w-4 h-4 text-gray-400" />
        <Link href="/dashboard/admin/clients" className="text-blue-600 hover:text-blue-700">
          Clients
        </Link>
        <ChevronRight className="w-4 h-4 text-gray-400" />
        <span className="text-gray-900 font-medium">{client.name}</span>
      </nav>

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex gap-3 mb-8">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-gray-900">{client.name}</h1>
            <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${statusColors[client.status]}`}>
              {client.status.charAt(0).toUpperCase() + client.status.slice(1)}
            </span>
          </div>
          <p className="text-gray-600 mt-2">{client.email}</p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/dashboard/admin/clients/${client.id}/edit`}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            <Edit2 className="w-4 h-4" />
            Edit Client
          </Link>
        </div>
      </div>

      {/* Client Info Card */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Client Information</h2>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="text-sm text-gray-600">Email</p>
            <p className="text-gray-900 font-medium">{client.email}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Phone</p>
            <p className="text-gray-900 font-medium">{client.phone || '-'}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Company</p>
            <p className="text-gray-900 font-medium">{client.company_name || '-'}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">City</p>
            <p className="text-gray-900 font-medium">{client.city || '-'}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Country</p>
            <p className="text-gray-900 font-medium">{client.country || '-'}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Website</p>
            <p className="text-gray-900 font-medium">{client.website || '-'}</p>
          </div>
        </div>
      </div>

      {/* Linked Users Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-900">Linked Users</h2>
          <button
            onClick={() => {
              setShowAddUser(!showAddUser)
              if (!showAddUser) fetchAvailableUsers()
            }}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium text-sm"
          >
            <Plus className="w-4 h-4" />
            Add User
          </button>
        </div>

        {/* Add User Form */}
        {showAddUser && (
          <form onSubmit={handleAddUser} className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                required
                disabled={loadingUsers}
              >
                <option value="">
                  {loadingUsers ? 'Loading users...' : 'Select a user...'}
                </option>
                {!loadingUsers && allUsers.length === 0 && (
                  <option disabled>No available users</option>
                )}
                {allUsers.map(user => (
                  <option key={user.id} value={user.id}>
                    {user.email} ({user.full_name || 'No name'})
                  </option>
                ))}
              </select>

              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="viewer">Viewer</option>
                <option value="manager">Manager</option>
                <option value="owner">Owner</option>
              </select>

              <button
                type="submit"
                disabled={!selectedUserId || addingUser}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
              >
                {addingUser ? 'Adding...' : 'Add'}
              </button>
            </div>
          </form>
        )}

        {/* Users Table */}
        {linkedUsers.length === 0 ? (
          <p className="text-gray-600 text-center py-8">No users linked yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Email</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Name</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Role</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">Action</th>
                </tr>
              </thead>
              <tbody>
                {linkedUsers.map(link => (
                  <tr key={link.id} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-900">{link.cms_users?.email}</td>
                    <td className="px-4 py-3 text-gray-600">{link.cms_users?.full_name || '-'}</td>
                    <td className="px-4 py-3">
                      <span className="inline-block px-2 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded">
                        {link.client_role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleUnlinkUser(link.cms_user_id)}
                        disabled={unlinkingUserId === link.cms_user_id}
                        className="text-red-600 hover:bg-red-50 px-3 py-1 rounded text-sm disabled:opacity-50"
                      >
                        Unlink
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

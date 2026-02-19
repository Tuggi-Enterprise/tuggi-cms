'use client'

import { useEffect, useState } from 'react'
import { Search, ChevronLeft, ChevronRight, Plus, Eye, Edit2, Trash2, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { CmsUser } from '@/lib/supabase'

interface UsersListAdminProps {
  onCreateNew?: () => void
}

const roleColors = {
  admin: 'bg-red-100 text-red-800',
  client: 'bg-blue-100 text-blue-800',
  editor: 'bg-purple-100 text-purple-800',
  viewer: 'bg-gray-100 text-gray-800'
}

export function UsersListAdmin({ onCreateNew }: UsersListAdminProps) {
  const [users, setUsers] = useState<CmsUser[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [role, setRole] = useState<'all' | 'admin' | 'client' | 'editor' | 'viewer'>('all')
  const [isActive, setIsActive] = useState<'all' | 'true' | 'false'>('all')
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    pages: 1
  })
  const [error, setError] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchUsers = async (searchPage = 1) => {
    try {
      setLoading(true)
      setError(null)

      const params = new URLSearchParams({
        page: searchPage.toString(),
        limit: '10'
      })

      if (search) params.append('search', search)
      if (role !== 'all') params.append('role', role)
      if (isActive !== 'all') params.append('is_active', isActive)

      const response = await fetch(`/api/admin/users?${params}`)

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Failed to fetch users')
        return
      }

      const data = await response.json()
      setUsers(data.users || [])
      setPagination(data.pagination)
      setPage(searchPage)
    } catch (err) {
      setError('An error occurred while fetching users')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers(1)
  }, [search, role, isActive])

  const handleDelete = async (userId: string) => {
    if (!deleteConfirm) {
      setDeleteConfirm(userId)
      return
    }

    try {
      setDeleting(true)
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Failed to delete user')
        return
      }

      setUsers(prev => prev.filter(u => u.id !== userId))
      setDeleteConfirm(null)
    } catch (err) {
      setError('An error occurred while deleting the user')
      console.error(err)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Users Management</h2>
          <p className="text-gray-600 text-sm mt-1">Manage CMS users and their roles</p>
        </div>
        <Link
          href="/dashboard/admin/users/new"
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
        >
          <Plus className="w-4 h-4" />
          New User
        </Link>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by email or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <select
          value={role}
          onChange={(e) => setRole(e.target.value as any)}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Roles</option>
          <option value="admin">Admin</option>
          <option value="client">Client</option>
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </select>

        <select
          value={isActive}
          onChange={(e) => setIsActive(e.target.value as any)}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Email</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Name</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Role</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Client</th>
                <th className="px-6 py-3 text-center text-sm font-semibold text-gray-700">Status</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Created</th>
                <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                    No users found
                  </td>
                </tr>
              ) : (
                users.map(user => (
                  <tr key={user.id} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-900">{user.email}</td>
                    <td className="px-6 py-4 text-gray-600 text-sm">{user.full_name || '-'}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${roleColors[user.role]}`}>
                        {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {user.clients && user.clients.length > 0 ? (
                        <div className="flex flex-col">
                          <span className="font-medium text-gray-900">{user.clients.map(c => c.name || c.id).join(', ')}</span>
                          <span className="text-xs text-gray-500">{user.clients.map(c => c.client_role).filter(Boolean).join(', ')}</span>
                        </div>
                      ) : (
                        user.client_name ? <span className="font-medium text-gray-900">{user.client_name}</span> : '-'
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
                        user.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                      }`}>
                        {user.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/dashboard/admin/users/${user.id}`}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                          title="View details"
                        >
                          <Eye className="w-4 h-4" />
                        </Link>

                        <Link
                          href={`/dashboard/admin/users/${user.id}/edit`}
                          className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition"
                          title="Edit"
                        >
                          <Edit2 className="w-4 h-4" />
                        </Link>

                        <button
                          onClick={() => handleDelete(user.id)}
                          disabled={deleting || deleteConfirm === user.id}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition disabled:opacity-50"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>

                        {deleteConfirm === user.id && (
                          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                            <div className="bg-white rounded-lg p-6 max-w-sm mx-4">
                              <h3 className="font-bold text-lg mb-2">Delete User?</h3>
                              <p className="text-gray-600 mb-4">
                                Are you sure you want to delete {user.email}?
                              </p>
                              <div className="flex gap-3 justify-end">
                                <button
                                  onClick={() => setDeleteConfirm(null)}
                                  className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => handleDelete(user.id)}
                                  disabled={deleting}
                                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                                >
                                  {deleting ? 'Deleting...' : 'Delete'}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Page {pagination.page} of {pagination.pages} ({pagination.total} total)
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => fetchUsers(page - 1)}
              disabled={page === 1 || loading}
              className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => fetchUsers(page + 1)}
              disabled={page === pagination.pages || loading}
              className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

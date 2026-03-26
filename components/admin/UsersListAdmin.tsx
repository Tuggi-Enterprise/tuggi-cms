'use client'

import { useEffect, useState } from 'react'
import { Search, ChevronLeft, ChevronRight, Plus, Eye, Edit2, Trash2, AlertCircle, Users, Shield, UserCheck, Filter, RotateCcw } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CmsUser } from '@/lib/supabase'
import { cn } from '@/lib/utils'

interface UsersListAdminProps {
  onCreateNew?: () => void
}

export function UsersListAdmin({ onCreateNew }: UsersListAdminProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
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
        limit: '50'
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
      const response = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' })
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

  const clearFilters = () => { setSearch(''); setRole('all'); setIsActive('all'); }

  return (
    <div className="flex gap-8 flex-1 animate-in fade-in duration-500">
      {/* Sidebar - Matching /pois exactly */}
      <div className="w-[18%] flex-shrink-0">
        <div className="bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 shadow-2xl shadow-black/5 sticky top-24">
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-tuggi-blue/10 rounded-xl">
                  <Filter className="h-5 w-5 text-tuggi-blue" />
                </div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white tracking-tight">
                  Filters
                </h2>
              </div>
              {(search || role !== 'all' || isActive !== 'all') && (
                <button
                  onClick={clearFilters}
                  className="p-2 text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5 rounded-lg transition-all"
                  title="Clear All"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Search Bar */}
            <div className="mb-6">
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Search className="h-4 w-4 text-gray-400 group-focus-within:text-tuggi-blue transition-colors" />
                </div>
                <input
                  type="text"
                  placeholder="Search Users..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-gray-50/50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-tuggi-blue focus:border-transparent transition-all outline-none"
                />
              </div>
            </div>

            {/* Filters List */}
            <div className="space-y-5">
              <div>
                <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 px-1">Access Role</h3>
                <div className="space-y-2">
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as any)}
                    className="w-full px-3 py-2.5 bg-gray-50/50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue transition-all"
                  >
                    <option value="all">All Roles</option>
                    <option value="admin">Admin</option>
                    <option value="client">Client</option>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </div>
              </div>

              <div>
                <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 px-1">Status</h3>
                <div className="space-y-2">
                  <select
                    value={isActive}
                    onChange={(e) => setIsActive(e.target.value as any)}
                    className="w-full px-3 py-2.5 bg-gray-50/50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue transition-all"
                  >
                    <option value="all">All Status</option>
                    <option value="true">Active Only</option>
                    <option value="false">Locked Only</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Column */}
      <div className="w-[82%]">
        {/* Stats Summary Bar */}
        <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 shadow-2xl shadow-black/5 mb-8 sticky top-0 z-30">
          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-8 pl-2">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-1">Total Users</span>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold text-gray-900 dark:text-white leading-none">{pagination.total}</span>
                  <div className="w-1.5 h-1.5 rounded-full bg-tuggi-blue animate-pulse" />
                </div>
              </div>

              <div className="h-8 w-px bg-gray-200 dark:bg-gray-800" />

              <div className="flex items-center gap-4">
                <button
                  onClick={onCreateNew}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-2xl font-semibold text-xs bg-tuggi-blue text-white hover:bg-tuggi-blue/90 shadow-lg shadow-tuggi-blue/20 transition-all duration-300"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New User
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3 pr-2">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-4">Workspace Management</p>
            </div>
          </div>
        </div>

        {/* Content Table */}
        <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 shadow-2xl shadow-black/5 overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50/50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
                <th className="px-8 py-5 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Identify / Account</th>
                <th className="px-8 py-5 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Access Role</th>
                <th className="px-8 py-5 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Associations</th>
                <th className="px-8 py-5 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">Status</th>
                <th className="px-8 py-5 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-8 py-20 text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-tuggi-blue mx-auto" />
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-8 py-20 text-center text-gray-400 font-medium italic">No users found matching your filters</td>
                </tr>
              ) : (
                users.map(user => (
                  <tr key={user.id} className="group hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="px-8 py-6">
                      <div className="font-bold text-gray-900 dark:text-white text-base">{user.email}</div>
                      <div className="text-xs text-gray-500 font-medium">{user.full_name || 'Individual Contributor'}</div>
                    </td>
                    <td className="px-8 py-6">
                      <span className={cn(
                        "inline-flex items-center px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest border",
                        user.role === 'admin' ? 'bg-red-50 text-red-700 border-red-100' :
                        user.role === 'client' ? 'bg-blue-50 text-blue-700 border-blue-100' :
                        'bg-gray-50 text-gray-600 border-gray-100'
                      )}>
                        {user.role}
                      </span>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex flex-col">
                        <span className="text-[11px] font-bold text-gray-900 dark:text-white uppercase truncate max-w-[180px]">
                          {user.clients?.length ? user.clients.map(c => c.name).join(', ') : user.client_name || '—'}
                        </span>
                        {(user.clients?.length ?? 0) > 1 && <span className="text-[9px] text-gray-400 font-bold uppercase mt-0.5">Multiple Entities</span>}
                      </div>
                    </td>
                    <td className="px-8 py-6 text-center">
                      <div className={cn(
                        "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-widest",
                        user.is_active ? "text-green-500 bg-green-50" : "text-gray-400 bg-gray-50"
                      )}>
                        <div className={cn("w-1.5 h-1.5 rounded-full", user.is_active ? "bg-green-500" : "bg-gray-400")} />
                        {user.is_active ? 'Active' : 'Locked'}
                      </div>
                    </td>
                    <td className="px-8 py-6 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Link href={`/admin/users/${user.id}`} className="p-2 text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5 rounded-xl transition-all"><Eye className="w-5 h-5" /></Link>
                        <Link href={`/admin/users/${user.id}/edit`} className="p-2 text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5 rounded-xl transition-all"><Edit2 className="w-5 h-5" /></Link>
                        <button onClick={() => handleDelete(user.id)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"><Trash2 className="w-5 h-5" /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination bar */}
        {pagination.pages > 1 && (
          <div className="flex flex-col md:flex-row items-center justify-between gap-6 py-10 font-sans">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Rendering {users.length} of {pagination.total} account records</p>
            <div className="flex items-center gap-2">
              <button onClick={() => fetchUsers(page - 1)} disabled={page === 1} className="p-3 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl disabled:opacity-20 hover:shadow-lg transition-all"><ChevronLeft className="w-4 h-4 text-gray-400" /></button>
              <div className="flex gap-1.5">
                {[...Array(pagination.pages)].map((_, i) => (
                  <button
                    key={i}
                    onClick={() => fetchUsers(i + 1)}
                    className={cn(
                      "w-10 h-10 rounded-2xl font-bold text-xs transition-all",
                      page === i + 1 ? "bg-tuggi-blue text-white shadow-lg" : "bg-white text-gray-400 hover:bg-gray-50"
                    )}
                  >{i + 1}</button>
                ))}
              </div>
              <button onClick={() => fetchUsers(page + 1)} disabled={page === pagination.pages} className="p-3 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl disabled:opacity-20 hover:shadow-lg transition-all"><ChevronRight className="w-4 h-4 text-gray-400" /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

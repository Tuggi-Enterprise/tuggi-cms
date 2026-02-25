'use client'

import { useState, useEffect, useCallback } from 'react'
import { Search, Users, X, Check, Loader2 } from 'lucide-react'

export interface User {
  id: string
  email?: string
  trail_count: number
  trip_count?: number
  last_activity?: string
}

interface UserFilterProps {
  selectedUserIds: string[]
  onSelectionChange: (userIds: string[]) => void
  className?: string
}

export function UserFilter({ selectedUserIds, onSelectionChange, className }: UserFilterProps) {
  const [users, setUsers] = useState<User[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const [loadingProgress, setLoadingProgress] = useState<{ current: number; total: number } | null>(null)

  const fetchUsers = useCallback(async (loadMore = false) => {
    try {
      if (loadMore) {
        setIsLoadingMore(true)
      } else {
        setIsLoading(true)
        setOffset(0)
      }
      setError(null)

      const params = new URLSearchParams()
      if (searchTerm) {
        params.append('search', searchTerm)
      }

      // Fetch all users at once using fetchAll parameter
      params.append('fetchAll', 'true')

      const response = await fetch(`/api/trail-visualization/users?${params.toString()}`)
      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch users')
      }

      setUsers(result.data?.users || [])
      setHasMore(result.data?.hasMore || false)
    } catch (err) {
      console.error('Error fetching users:', err)
      setError(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setIsLoading(false)
      setIsLoadingMore(false)
    }
  }, [searchTerm])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const handleToggleUser = (userId: string) => {
    if (selectedUserIds.includes(userId)) {
      onSelectionChange(selectedUserIds.filter(id => id !== userId))
    } else {
      onSelectionChange([...selectedUserIds, userId])
    }
  }

  const handleSelectAll = () => {
    if (selectedUserIds.length === filteredUsers.length) {
      onSelectionChange([])
    } else {
      onSelectionChange(filteredUsers.map(u => u.id))
    }
  }

  const filteredUsers = users.filter(user =>
    user.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (user.email && user.email.toLowerCase().includes(searchTerm.toLowerCase()))
  )

  return (
    <div className={className}>
      <div className="tuggi-card p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-tuggi-text dark:text-white flex items-center">
            <Users className="h-5 w-5 mr-2" />
            Filter Users
          </h3>
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="text-sm text-tuggi-blue hover:text-blue-600 dark:text-blue-400"
          >
            {isOpen ? 'Hide' : 'Show'}
          </button>
        </div>

        {isOpen && (
          <>
            {/* Search */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search users..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-tuggi-blue"
              />
            </div>

            {/* Select All / Deselect All */}
            <div className="mb-3">
              <button
                onClick={handleSelectAll}
                disabled={!canEdit}
                className="text-sm text-tuggi-blue hover:text-blue-600 dark:text-blue-400 disabled:opacity-50"
              >
                {selectedUserIds.length === filteredUsers.length ? 'Deselect All' : 'Select All'}
              </button>
              <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
                ({selectedUserIds.length} of {users.length} selected)
              </span>
            </div>

            {/* User List */}
            {error && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-tuggi-blue mb-4" />
                <span className="text-gray-600 dark:text-gray-400">
                  {loadingProgress 
                    ? `Loading users... ${loadingProgress.current.toLocaleString()} / ${loadingProgress.total > 0 ? loadingProgress.total.toLocaleString() : '?'}`
                    : 'Loading all users...'}
                </span>
                {loadingProgress && loadingProgress.total > 0 && (
                  <div className="w-full mt-2 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div 
                      className="bg-tuggi-blue h-2 rounded-full transition-all duration-300"
                      style={{ width: `${Math.min((loadingProgress.current / loadingProgress.total) * 100, 100)}%` }}
                    />
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="max-h-96 overflow-y-auto space-y-2">
                  {filteredUsers.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                      No users found
                    </p>
                  ) : (
                    filteredUsers.map((user) => {
                      const isSelected = selectedUserIds.includes(user.id)
                      return (
                        <div
                          key={user.id}
                          onClick={() => handleToggleUser(user.id)}
                          className={`
                            flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors
                            ${isSelected
                              ? 'bg-tuggi-blue/10 border-2 border-tuggi-blue'
                              : 'bg-gray-50 dark:bg-gray-800 border-2 border-transparent hover:border-gray-300 dark:hover:border-gray-600'
                            }
                          `}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-tuggi-text dark:text-white truncate">
                              {user.email || user.id.substring(0, 8) + '...'}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {user.trail_count} trails · {user.trip_count || 0} trips
                            </p>
                          </div>
                          <div className="ml-3">
                            {isSelected ? (
                              <div className="h-5 w-5 rounded bg-tuggi-blue flex items-center justify-center">
                                <Check className="h-3 w-3 text-white" />
                              </div>
                            ) : (
                              <div className="h-5 w-5 rounded border-2 border-gray-300 dark:border-gray-600" />
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>

                {/* Total count indicator */}
                <div className="mt-3 text-center text-sm text-gray-500 dark:text-gray-400">
                  Showing {filteredUsers.length} of {users.length} total users
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}


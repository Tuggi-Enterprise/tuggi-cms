'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, Check } from 'lucide-react'
import { CmsUser } from '@/lib/supabase'
import { Client } from '@/types/clients'

interface UserFormAdminProps {
  user?: CmsUser
  onSubmit?: (user: CmsUser) => void
  onCancel?: () => void
  isLoading?: boolean
}

export function UserFormAdmin({ user, onSubmit, onCancel, isLoading = false }: UserFormAdminProps) {
  const [formData, setFormData] = useState({
    email: user?.email || '',
    full_name: user?.full_name || '',
    password: '', // Only for new users or password reset
    role: user?.role || 'viewer',
    is_active: user?.is_active ?? true,
    client_id: user?.client_id || ''
  })

  const [clients, setClients] = useState<Client[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [showSuccess, setShowSuccess] = useState(false)
  const [loadingClients, setLoadingClients] = useState(false)

  useEffect(() => {
    // Load clients if role is client
    if (formData.role === 'client') {
      fetchClients()
    }
  }, [formData.role])

  const fetchClients = async () => {
    try {
      setLoadingClients(true)
      const response = await fetch('/api/admin/clients?status=approved&limit=100')
      if (response.ok) {
        const data = await response.json()
        setClients(data.clients || [])
      }
    } catch (err) {
      console.error('Failed to load clients:', err)
    } finally {
      setLoadingClients(false)
    }
  }

  const validateForm = () => {
    const newErrors: Record<string, string> = {}

    if (!formData.email.trim()) newErrors.email = 'Email is required'
    if (formData.email && !formData.email.includes('@')) newErrors.email = 'Invalid email format'
    if (!formData.full_name.trim()) newErrors.full_name = 'Full name is required'

    // If creating new user, password is required
    if (!user && !formData.password) newErrors.password = 'Password is required for new users'
    if (formData.password && formData.password.length < 6) newErrors.password = 'Password must be at least 6 characters'

    // If role is client, client_id is required
    if (formData.role === 'client' && !formData.client_id) {
      newErrors.client_id = 'Client is required for client role'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) return

    try {
      const endpoint = user
        ? `/api/admin/users/${user.id}`
        : '/api/admin/users'

      const method = user ? 'PATCH' : 'POST'

      // Prepare payload - don't send immutable fields if updating
      const payload = user ? {
        email: formData.email,
        full_name: formData.full_name,
        is_active: formData.is_active
      } : formData

      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        const error = await response.json()
        setErrors({ submit: error.error || 'Failed to save user' })
        return
      }

      const data = await response.json()
      setShowSuccess(true)
      setTimeout(() => {
        onSubmit?.(data.user)
        setShowSuccess(false)
      }, 1500)
    } catch (error) {
      setErrors({ submit: 'An error occurred' })
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    const checked = (e.target as any).checked

    setFormData(prev => ({
      ...prev,
      [name]: name === 'is_active' ? checked : value
    }))

    // Clear error for this field
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }))
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {errors.submit && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-red-700">{errors.submit}</p>
        </div>
      )}

      {showSuccess && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex gap-3">
          <Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          <p className="text-green-700">Saved successfully!</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Email */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Email *
          </label>
          <input
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
              errors.email ? 'border-red-500' : 'border-gray-300'
            }`}
            disabled={isLoading || !!user}
          />
          {errors.email && <p className="text-red-600 text-sm mt-1">{errors.email}</p>}
        </div>

        {/* Full Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Full Name *
          </label>
          <input
            type="text"
            name="full_name"
            value={formData.full_name}
            onChange={handleChange}
            className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
              errors.full_name ? 'border-red-500' : 'border-gray-300'
            }`}
            disabled={isLoading}
          />
          {errors.full_name && <p className="text-red-600 text-sm mt-1">{errors.full_name}</p>}
        </div>

        {/* Password */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Password {!user && '*'}
          </label>
          <input
            type="password"
            name="password"
            value={formData.password}
            onChange={handleChange}
            placeholder={user ? 'Leave empty to keep current password' : 'At least 6 characters'}
            className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
              errors.password ? 'border-red-500' : 'border-gray-300'
            }`}
            disabled={isLoading}
          />
          {errors.password && <p className="text-red-600 text-sm mt-1">{errors.password}</p>}
        </div>

        {/* Role */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Role {user && '(immutable)'}
          </label>
          <select
            name="role"
            value={formData.role}
            onChange={handleChange}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            disabled={isLoading || !!user}
          >
            <option value="admin">Admin</option>
            <option value="client">Client</option>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>

        {/* Client (only if role is client) */}
        {formData.role === 'client' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Client {user && '(immutable)'}
            </label>
            <select
              name="client_id"
              value={formData.client_id}
              onChange={handleChange}
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
                errors.client_id ? 'border-red-500' : 'border-gray-300'
              }`}
              disabled={isLoading || !!user || loadingClients}
            >
              <option value="">Select a client...</option>
              {clients.map(client => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
            {errors.client_id && <p className="text-red-600 text-sm mt-1">{errors.client_id}</p>}
          </div>
        )}

        {/* Active Status */}
        <div className="flex items-end">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              name="is_active"
              checked={formData.is_active}
              onChange={handleChange}
              className="w-4 h-4 rounded border-gray-300"
              disabled={isLoading}
            />
            <span className="text-sm font-medium text-gray-700">Active User</span>
          </label>
        </div>
      </div>

      {/* Form Actions */}
      <div className="flex gap-3 pt-4">
        <button
          type="submit"
          disabled={isLoading}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
        >
          {isLoading ? 'Saving...' : user ? 'Update User' : 'Create User'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="px-6 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 disabled:opacity-50 font-medium"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

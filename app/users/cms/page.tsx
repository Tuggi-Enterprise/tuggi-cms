'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { 
  UserCog, Plus, Search, MoreVertical, Shield, Edit2, 
  Trash2, CheckCircle, XCircle, Mail, Calendar, RefreshCw,
  AlertCircle, Loader2
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ============================================================================
// TYPES
// ============================================================================

interface CMSUser {
  id: string
  email: string
  full_name: string | null
  role: 'admin' | 'editor' | 'viewer' | 'client'
  is_active: boolean
  created_at: string
  updated_at: string
  last_login_at: string | null
  company_name: string | null
  city: string | null
  country: string | null
}

interface InviteFormData {
  email: string
  full_name: string
  role: 'admin' | 'editor' | 'viewer' | 'client'
}

// ============================================================================
// ROLE BADGE COMPONENT
// ============================================================================

const RoleBadge = ({ role }: { role: string }) => {
  const colors: Record<string, string> = {
    admin: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    editor: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    viewer: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
    client: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
  }
  
  return (
    <span className={cn(
      'px-2 py-1 rounded-full text-xs font-bold uppercase tracking-wider',
      colors[role] || colors.viewer
    )}>
      {role}
    </span>
  )
}

// ============================================================================
// INVITE MODAL COMPONENT
// ============================================================================

const InviteModal = ({ 
  isOpen, 
  onClose, 
  onInvite,
  isLoading 
}: { 
  isOpen: boolean
  onClose: () => void
  onInvite: (data: InviteFormData) => Promise<void>
  isLoading: boolean
}) => {
  const [formData, setFormData] = useState<InviteFormData>({
    email: '',
    full_name: '',
    role: 'viewer'
  })
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    
    if (!formData.email) {
      setError('Email é obrigatório')
      return
    }
    
    try {
      await onInvite(formData)
      setFormData({ email: '', full_name: '', role: 'viewer' })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao convidar usuário')
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-in zoom-in-95 duration-300">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center">
            <Plus className="h-5 w-5 mr-2 text-tuggi-blue" />
            Convidar Novo Usuário
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Um email de convite será enviado para o usuário
          </p>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-sm flex items-center">
              <AlertCircle className="h-4 w-4 mr-2 flex-shrink-0" />
              {error}
            </div>
          )}
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Email *
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue focus:border-transparent"
              placeholder="usuario@email.com"
              required
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Nome Completo
            </label>
            <input
              type="text"
              value={formData.full_name}
              onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue focus:border-transparent"
              placeholder="João Silva"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Papel
            </label>
            <select
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue focus:border-transparent"
            >
              <option value="viewer">Viewer - Apenas visualização</option>
              <option value="editor">Editor - Pode editar POIs</option>
              <option value="admin">Admin - Acesso total</option>
              <option value="client">Client - Cliente parceiro</option>
            </select>
          </div>
          
          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 bg-tuggi-blue text-white rounded-lg font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4 mr-2" />
                  Enviar Convite
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ============================================================================
// MAIN PAGE
// ============================================================================

export default function CMSUsersPage() {
  const supabase = useSupabaseClient()
  const [users, setUsers] = useState<CMSUser[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isInviting, setIsInviting] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Fetch CMS users
  const fetchUsers = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      
      const { data, error } = await supabase
        .schema('core')
        .from('cms_users')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      setUsers(data || [])
    } catch (err) {
      console.error('Error fetching CMS users:', err)
      setError(err instanceof Error ? err.message : 'Erro ao carregar usuários')
    } finally {
      setIsLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  // Invite new user
  const handleInvite = async (data: InviteFormData) => {
    setIsInviting(true)
    
    try {
      // 1. Create user in Supabase Auth via invite
      const { data: authData, error: authError } = await supabase.auth.admin.inviteUserByEmail(data.email, {
        data: {
          full_name: data.full_name
        }
      })
      
      if (authError) {
        // If user already exists in auth, we can still add to cms_users
        if (!authError.message.includes('already registered')) {
          throw authError
        }
      }
      
      // 2. Create entry in cms_users
      const { error: cmsError } = await supabase
        .schema('core')
        .from('cms_users')
        .insert({
          email: data.email,
          full_name: data.full_name || null,
          role: data.role,
          is_active: true
        })
      
      if (cmsError) {
        if (cmsError.message.includes('duplicate key')) {
          throw new Error('Este email já está cadastrado no CMS')
        }
        throw cmsError
      }
      
      // Refresh list
      await fetchUsers()
      
    } catch (err) {
      console.error('Error inviting user:', err)
      throw err
    } finally {
      setIsInviting(false)
    }
  }

  // Toggle user active status
  const toggleUserStatus = async (user: CMSUser) => {
    try {
      const { error } = await supabase
        .schema('core')
        .from('cms_users')
        .update({ is_active: !user.is_active })
        .eq('id', user.id)

      if (error) throw error
      
      setUsers(prev => prev.map(u => 
        u.id === user.id ? { ...u, is_active: !u.is_active } : u
      ))
    } catch (err) {
      console.error('Error toggling user status:', err)
      alert('Erro ao atualizar status do usuário')
    }
  }

  // Update user role
  const updateUserRole = async (user: CMSUser, newRole: CMSUser['role']) => {
    try {
      const { error } = await supabase
        .schema('core')
        .from('cms_users')
        .update({ role: newRole })
        .eq('id', user.id)

      if (error) throw error
      
      setUsers(prev => prev.map(u => 
        u.id === user.id ? { ...u, role: newRole } : u
      ))
    } catch (err) {
      console.error('Error updating user role:', err)
      alert('Erro ao atualizar papel do usuário')
    }
  }

  // Filtered users
  const filteredUsers = users.filter(user => 
    user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (user.full_name && user.full_name.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  // Stats
  const stats = {
    total: users.length,
    active: users.filter(u => u.is_active).length,
    admins: users.filter(u => u.role === 'admin').length,
    editors: users.filter(u => u.role === 'editor').length
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900 dark:text-white flex items-center">
            <UserCog className="h-8 w-8 mr-3 text-tuggi-blue" />
            CMS Team
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Gerencie usuários com acesso ao CMS
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={fetchUsers}
            disabled={isLoading}
            className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("h-5 w-5 text-gray-500", isLoading && "animate-spin")} />
          </button>
          
          <button
            onClick={() => setShowInviteModal(true)}
            className="flex items-center px-4 py-2 bg-tuggi-blue text-white rounded-lg font-medium hover:bg-blue-600 transition-colors"
          >
            <Plus className="h-5 w-5 mr-2" />
            Convidar Usuário
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Total</p>
          <p className="text-3xl font-black text-gray-900 dark:text-white">{stats.total}</p>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Ativos</p>
          <p className="text-3xl font-black text-green-600">{stats.active}</p>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Admins</p>
          <p className="text-3xl font-black text-red-600">{stats.admins}</p>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Editors</p>
          <p className="text-3xl font-black text-blue-600">{stats.editors}</p>
        </div>
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por email ou nome..."
            className="w-full pl-10 pr-4 py-3 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue focus:border-transparent"
          />
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 flex items-center">
          <AlertCircle className="h-5 w-5 mr-2 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Users Table */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Usuário</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Role</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Último Login</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Criado em</th>
                <th className="px-6 py-4 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-6 py-4"><div className="h-10 w-48 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                    <td className="px-6 py-4"><div className="h-6 w-20 bg-gray-200 dark:bg-gray-700 rounded-full" /></td>
                    <td className="px-6 py-4"><div className="h-6 w-16 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                    <td className="px-6 py-4"><div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                    <td className="px-6 py-4"><div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                    <td className="px-6 py-4"><div className="h-8 w-8 bg-gray-200 dark:bg-gray-700 rounded ml-auto" /></td>
                  </tr>
                ))
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                    {searchQuery ? 'Nenhum usuário encontrado' : 'Nenhum usuário cadastrado'}
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-tuggi-blue to-purple-500 flex items-center justify-center text-white font-bold mr-3">
                          {(user.full_name || user.email).charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">
                            {user.full_name || 'Sem nome'}
                          </p>
                          <p className="text-sm text-gray-500">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <select
                        value={user.role}
                        onChange={(e) => updateUserRole(user, e.target.value as CMSUser['role'])}
                        className="bg-transparent border-none text-sm font-medium focus:ring-0 cursor-pointer"
                      >
                        <option value="admin">Admin</option>
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                        <option value="client">Client</option>
                      </select>
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => toggleUserStatus(user)}
                        className={cn(
                          'flex items-center px-3 py-1 rounded-full text-xs font-bold transition-colors',
                          user.is_active
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-200'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-200'
                        )}
                      >
                        {user.is_active ? (
                          <>
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Ativo
                          </>
                        ) : (
                          <>
                            <XCircle className="h-3 w-3 mr-1" />
                            Inativo
                          </>
                        )}
                      </button>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {user.last_login_at 
                        ? new Date(user.last_login_at).toLocaleDateString('pt-BR')
                        : 'Nunca'
                      }
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {new Date(user.created_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
                        <MoreVertical className="h-5 w-5 text-gray-400" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invite Modal */}
      <InviteModal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        onInvite={handleInvite}
        isLoading={isInviting}
      />
    </div>
  )
}

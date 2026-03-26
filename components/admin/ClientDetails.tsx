'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, ArrowLeft, Edit2, Plus, Trash2, AlertCircle, Check, QrCode, Download, Copy, Users, FileText, MapPin, X, Save } from 'lucide-react'
import { QRCodeCanvas } from 'qrcode.react'
import { Client } from '@/types/clients'
import { CmsUser } from '@/lib/supabase'
import { cn } from '@/lib/utils'

interface ClientDetailsProps {
  clientId: string
  isDrawer?: boolean
}

export function ClientDetails({ clientId, isDrawer }: ClientDetailsProps) {
  const router = useRouter()
  const [client, setClient] = useState<(Client & { users_count: number }) | null>(null)
  const [linkedUsers, setLinkedUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Edit State
  const [isEditing, setIsEditing] = useState(false)
  const [editedClient, setEditedClient] = useState<Partial<Client>>({})
  const [saving, setSaving] = useState(false)

  // Linked Users State
  const [showAddUser, setShowAddUser] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [selectedRole, setSelectedRole] = useState('viewer')
  const [allUsers, setAllUsers] = useState<CmsUser[]>([])
  const [addingUser, setAddingUser] = useState(false)
  const [unlinkingUserId, setUnlinkingUserId] = useState<string | null>(null)
  const [loadingUsers, setLoadingUsers] = useState(false)
  
  const [showQrCode, setShowQrCode] = useState(false)
  const [copied, setCopied] = useState(false)

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
      setEditedClient(data.client)
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
      const linked = linkedUsers.map(u => u.cms_user_id)
      const availableUsers = (data.users || []).filter((u: CmsUser) => !linked.includes(u.id))
      setAllUsers(availableUsers)
    } catch (err) { console.error('Failed to load users:', err) } finally { setLoadingUsers(false) }
  }

  const handleUpdateClient = async () => {
    try {
      setSaving(true)
      setError(null)
      const response = await fetch(`/api/admin/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editedClient)
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update client')
      }

      setClient({ ...client!, ...data.client })
      setIsEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error updating client')
      console.error(err)
    } finally {
      setSaving(false)
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
      await fetchLinkedUsers(); setShowAddUser(false); setSelectedUserId(''); setSelectedRole('viewer')
    } catch (err) { console.error(err) } finally { setAddingUser(false) }
  }

  const handleUnlinkUser = async (userId: string) => {
    try {
      setUnlinkingUserId(userId)
      const response = await fetch(`/api/admin/users/${userId}/link-client?client_id=${clientId}`, { method: 'DELETE' })
      if (!response.ok) return
      await fetchLinkedUsers()
    } catch (err) { console.error(err) } finally { setUnlinkingUserId(null) }
  }

  const handleDownloadQR = () => {
    const canvas = document.getElementById('client-qr-code') as HTMLCanvasElement
    if (!canvas || !client) return
    const url = canvas.toDataURL('image/png')
    const link = document.createElement('a')
    link.download = `tuggi-qr-${client.name.toLowerCase().replace(/\s+/g, '-')}.png`
    link.href = url; link.click()
  }

  const handleCopyQR = async () => {
    const canvas = document.getElementById('client-qr-code') as HTMLCanvasElement
    if (!canvas) return
    canvas.toBlob(async (blob) => {
      if (!blob) return
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        setCopied(true); setTimeout(() => setCopied(false), 2000)
      } catch (err) { console.error(err) }
    }, 'image/png')
  }

  if (loading) return <div className="text-center py-20 text-sm font-semibold text-gray-400">Loading...</div>
  if (!client) return <div className="text-center py-20 text-sm font-bold text-red-500 uppercase tracking-widest">Client Not Found</div>

  return (
    <div className={cn("space-y-8 animate-in fade-in duration-500 max-w-[1600px] mx-auto", isDrawer ? "px-8" : "px-4 py-8")}>
      {!isDrawer && (
        <nav className="flex items-center gap-2 text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-6">
          <Link href="/dashboard" className="hover:text-tuggi-blue transition-colors">Dashboard</Link>
          <ChevronRight className="w-3 h-3" />
          <Link href="/admin/clients" className="hover:text-tuggi-blue transition-colors">Admin</Link>
          <ChevronRight className="w-3 h-3 text-tuggi-blue" />
          <span className="text-gray-900 dark:text-white">{client.name}</span>
        </nav>
      )}

      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">{client.name}</h1>
            <span className={cn(
              "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border",
              client.status === 'approved' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-orange-100 text-orange-700 border-orange-200'
            )}>
              {client.status}
            </span>
          </div>
          <p className="text-gray-500 font-medium text-sm">{client.email}</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => setShowQrCode(!showQrCode)} className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white rounded-xl hover:bg-black font-semibold text-xs transition-all shadow-md">
            <QrCode className="w-4 h-4" /> {showQrCode ? 'Hide QR' : 'Revenue QR'}
          </button>
          {!isEditing ? (
            <button 
              onClick={() => setIsEditing(true)} 
              className="flex items-center gap-2 px-5 py-2.5 bg-white border border-gray-200 text-tuggi-blue rounded-xl hover:bg-gray-50 font-semibold text-xs transition-all shadow-sm"
            >
              <Edit2 className="w-4 h-4" /> Edit Profile
            </button>
          ) : (
             <div className="flex gap-2">
                <button 
                  onClick={() => setIsEditing(false)} 
                  className="flex items-center gap-2 px-5 py-2.5 bg-gray-50 text-gray-600 rounded-xl hover:bg-gray-100 font-semibold text-xs transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleUpdateClient} 
                  disabled={saving}
                  className="flex items-center gap-2 px-5 py-2.5 bg-tuggi-blue text-white rounded-xl hover:bg-tuggi-blue/90 font-semibold text-xs transition-all shadow-lg shadow-tuggi-blue/20"
                >
                  {saving ? 'Saving...' : <><Save className="w-4 h-4" /> Save Changes</>}
                </button>
             </div>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-2xl text-red-600 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-semibold">{error}</p>
        </div>
      )}

      {showQrCode && (
        <div className="bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 p-8 flex flex-col items-center justify-center animate-in zoom-in-95 duration-300 shadow-xl rounded-3xl">
          <div className="p-4 bg-white border-2 border-gray-100 rounded-2xl shadow-sm mb-6">
            <QRCodeCanvas id="client-qr-code" value={client.id} size={200} level="H" includeMargin={true} />
          </div>
          <div className="text-center max-w-sm">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Revenue Share QR Code</h3>
            <p className="text-xs text-gray-500 mb-6">Encodes Client ID for campaign attribution</p>
            <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 mb-6">
               <code className="block text-[11px] font-mono break-all text-tuggi-blue">{client.id}</code>
            </div>
            <div className="flex gap-3 justify-center">
              <button onClick={handleDownloadQR} className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-xs font-bold transition-all"><Download className="w-4 h-4" /> PNG</button>
              <button onClick={handleCopyQR} className={cn("flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all", copied ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700")}>
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start pb-20">
        
        {/* Column 1: Client Information */}
        <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-8 shadow-sm h-full">
          <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-6 flex items-center">
            <div className="w-1.5 h-1.5 bg-tuggi-blue rounded-full mr-3" />
            Client Information
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-8 gap-x-12">
            <EditField 
              label="Company Name" 
              value={isEditing ? editedClient.name || '' : client.name} 
              isEditing={isEditing}
              onChange={(val) => setEditedClient({ ...editedClient, name: val })}
            />
            <EditField 
              label="Contact Email" 
              value={isEditing ? editedClient.email || '' : client.email} 
              isEditing={isEditing}
              onChange={(val) => setEditedClient({ ...editedClient, email: val })}
            />
            <EditField 
              label="Phone" 
              value={isEditing ? editedClient.phone || '' : client.phone || '-'} 
              isEditing={isEditing}
              onChange={(val) => setEditedClient({ ...editedClient, phone: val })}
            />
            <EditField 
              label="Website" 
              value={isEditing ? editedClient.website || '' : client.website || '-'} 
              isEditing={isEditing}
              isLink={!isEditing && !!client.website}
              onChange={(val) => setEditedClient({ ...editedClient, website: val })}
            />
            <EditField 
              label="City/Region" 
              value={isEditing ? editedClient.city || '' : client.city || '-'} 
              isEditing={isEditing}
              onChange={(val) => setEditedClient({ ...editedClient, city: val })}
            />
            <EditField 
              label="Country" 
              value={isEditing ? editedClient.country || '' : client.country || '-'} 
              isEditing={isEditing}
              onChange={(val) => setEditedClient({ ...editedClient, country: val })}
            />
            
            <div className="sm:col-span-2 pt-4 border-t border-gray-50 dark:border-gray-800 mt-2">
               <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Total Connections</p>
               <p className="text-2xl font-bold text-gray-900 dark:text-white leading-none flex items-center gap-2">
                 {client.users_count} 
                 <span className="text-xs font-medium text-gray-400">active users linked</span>
               </p>
            </div>
          </div>
        </div>

        {/* Column 2: Linked Users */}
        <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-8 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center">
              <div className="w-1.5 h-1.5 bg-green-500 rounded-full mr-3" />
              Linked Users
            </h2>
            <button 
              onClick={() => { setShowAddUser(!showAddUser); if (!showAddUser) fetchAvailableUsers(); }} 
              className="px-4 py-2 bg-gray-50 dark:bg-gray-800 text-tuggi-blue rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-tuggi-blue hover:text-white transition-all border border-transparent hover:border-tuggi-blue/10"
            >
              Link User
            </button>
          </div>
          
          {showAddUser && (
            <form onSubmit={handleAddUser} className="mb-6 p-5 bg-gray-50 dark:bg-gray-950 rounded-2xl border border-gray-100 dark:border-gray-800 animate-in translate-y-2 duration-300">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase pl-1">Target User</label>
                  <select 
                    value={selectedUserId} 
                    onChange={(e) => setSelectedUserId(e.target.value)} 
                    className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue transition-all" 
                    required 
                    disabled={loadingUsers}
                  >
                    <option value="">{loadingUsers ? 'Loading...' : 'Select User...'}</option>
                    {allUsers.map(user => <option key={user.id} value={user.id}>{user.email}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase pl-1">Role</label>
                  <select 
                    value={selectedRole} 
                    onChange={(e) => setSelectedRole(e.target.value)} 
                    className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue transition-all"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="manager">Manager</option>
                    <option value="owner">Owner</option>
                  </select>
                </div>
              </div>
              <button 
                type="submit" 
                disabled={!selectedUserId || addingUser} 
                className="w-full py-3 bg-tuggi-blue text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-tuggi-blue/90 disabled:opacity-50 shadow-lg shadow-tuggi-blue/20 transition-all"
              >
                {addingUser ? 'Linking...' : 'Confirm Link'}
              </button>
            </form>
          )}

          <div className="overflow-hidden rounded-2xl border border-gray-100 dark:border-gray-800">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-800/50">
                <tr>
                  <th className="px-5 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">User Profile</th>
                  <th className="px-5 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">Role</th>
                  <th className="px-5 py-3 text-right text-[10px] font-bold text-gray-400 uppercase tracking-widest">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {linkedUsers.length === 0 ? (
                  <tr><td colSpan={3} className="px-5 py-8 text-center text-gray-400 text-xs italic font-medium">No users linked to this client</td></tr>
                ) : linkedUsers.map(link => (
                  <tr key={link.id} className="group hover:bg-gray-50 dark:hover:bg-gray-800/20 transition-colors">
                    <td className="px-5 py-4">
                      <div className="font-bold text-gray-900 dark:text-white text-sm">{link.cms_users?.email}</div>
                      <div className="text-[11px] text-gray-400 font-medium">{link.cms_users?.full_name || '-'}</div>
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-flex px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-tuggi-blue/5 text-tuggi-blue border border-tuggi-blue/10">
                        {link.client_role}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button 
                        onClick={() => handleUnlinkUser(link.cms_user_id)} 
                        disabled={unlinkingUserId === link.cms_user_id} 
                        className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function EditField({ 
  label, 
  value, 
  isEditing, 
  onChange, 
  isLink 
}: { 
  label: string, 
  value: string, 
  isEditing: boolean, 
  onChange: (val: string) => void,
  isLink?: boolean
}) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</p>
      {isEditing ? (
        <input 
          type="text" 
          value={value} 
          onChange={(e) => onChange(e.target.value)} 
          className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg text-sm font-bold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-tuggi-blue/20 transition-all"
          placeholder={`Enter ${label}...`}
        />
      ) : isLink ? (
        <a href={value.startsWith('http') ? value : `https://${value}`} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-tuggi-blue hover:underline break-all">{value}</a>
      ) : (
        <p className="text-sm font-bold text-gray-900 dark:text-white break-all">{value}</p>
      )}
    </div>
  )
}

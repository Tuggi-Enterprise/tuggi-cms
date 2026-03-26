'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, Edit2, Trash2, AlertCircle, Check, QrCode, Download, Copy, Users, Save, Building2, Scale, Landmark, Percent, Globe } from 'lucide-react'
import { QRCodeCanvas } from 'qrcode.react'
import { Client, TaxIdType } from '@/types/clients'
import { CmsUser } from '@/lib/supabase'
import { cn } from '@/lib/utils'

interface ClientDetailsProps {
  clientId: string
  isDrawer?: boolean
}

// Tax ID config per country
const TAX_ID_CONFIG: Record<string, { type: TaxIdType; label: string; placeholder: string; mask?: string }> = {
  'Brazil': { type: 'cnpj', label: 'CNPJ', placeholder: 'XX.XXX.XXX/XXXX-XX' },
  'Portugal': { type: 'nipc', label: 'NIPC', placeholder: '9 dígitos' },
  'Spain': { type: 'nif', label: 'NIF/CIF', placeholder: 'A12345678' },
  'France': { type: 'vat', label: 'SIRET / TVA', placeholder: 'FRXX 123456789' },
  'Germany': { type: 'vat', label: 'USt-IdNr', placeholder: 'DE123456789' },
  'Italy': { type: 'vat', label: 'Partita IVA', placeholder: 'IT12345678901' },
  'Netherlands': { type: 'vat', label: 'BTW-nummer', placeholder: 'NL123456789B01' },
  'United States': { type: 'ein', label: 'EIN', placeholder: 'XX-XXXXXXX' },
  'United Kingdom': { type: 'vat', label: 'VAT Number', placeholder: 'GB123456789' },
}

const COUNTRIES = [
  'Brazil', 'Portugal', 'Spain', 'France', 'Germany', 'Italy', 'Netherlands', 
  'United Kingdom', 'United States', 'Belgium', 'Austria', 'Switzerland',
  'Ireland', 'Luxembourg', 'Greece', 'Poland', 'Czech Republic', 'Sweden',
  'Denmark', 'Norway', 'Finland', 'Canada', 'Mexico', 'Argentina', 'Chile',
  'Colombia', 'Peru', 'Australia', 'Japan', 'South Korea'
].sort()

function usesBankingIBAN(country: string): boolean {
  const usCountries = ['United States', 'Canada']
  return !usCountries.includes(country)
}

export function ClientDetails({ clientId, isDrawer }: ClientDetailsProps) {
  const router = useRouter()
  const [client, setClient] = useState<(Client & { users_count: number }) | null>(null)
  const [linkedUsers, setLinkedUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  
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

  // Determine current country for dynamic form
  const currentCountry = isEditing ? (editedClient.country || '') : (client?.country || '')
  const taxConfig = TAX_ID_CONFIG[currentCountry] || { type: 'other' as TaxIdType, label: 'Tax ID', placeholder: 'Enter tax ID' }
  const showIBAN = usesBankingIBAN(currentCountry)

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

  const handleStartEditing = () => {
    setEditedClient({ ...client })
    setIsEditing(true)
    setError(null)
    setSuccessMsg(null)
  }

  const handleCancelEditing = () => {
    setEditedClient({ ...client })
    setIsEditing(false)
    setError(null)
  }

  const handleUpdateClient = async () => {
    try {
      setSaving(true)
      setError(null)
      
      // Auto-set tax_id_type based on country
      const payload = { ...editedClient }
      if (payload.country && TAX_ID_CONFIG[payload.country]) {
        payload.tax_id_type = TAX_ID_CONFIG[payload.country].type
      }

      const response = await fetch(`/api/admin/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update client')
      }

      setClient({ ...client!, ...data.client })
      setEditedClient({ ...client!, ...data.client })
      setIsEditing(false)
      setSuccessMsg('Client updated successfully')
      setTimeout(() => setSuccessMsg(null), 3000)
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

  const updateField = (field: keyof Client, value: any) => {
    setEditedClient(prev => ({ ...prev, [field]: value }))
  }

  const finalQrUrl = useMemo(() => {
    if (!client) return ''
    return `https://www.tuggi.app/download?ID=${client.id}`
  }, [client])

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
          <span className="text-gray-900 dark:text-white">{client.company_name || client.name}</span>
        </nav>
      )}

      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">{client.company_name || client.name}</h1>
            <span className={cn(
              "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border",
              client.status === 'approved' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-orange-100 text-orange-700 border-orange-200'
            )}>
              {client.status}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-gray-500 font-semibold text-sm">{client.name}</p>
            <div className="w-1 h-1 bg-gray-300 rounded-full" />
            <p className="text-gray-400 font-medium text-sm">{client.email}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={() => setShowQrCode(!showQrCode)} className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white rounded-xl hover:bg-black font-semibold text-xs transition-all shadow-md">
            <QrCode className="w-4 h-4" /> {showQrCode ? 'Hide QR' : 'Revenue QR'}
          </button>
          {!isEditing ? (
            <button 
              onClick={handleStartEditing} 
              className="flex items-center gap-2 px-5 py-2.5 bg-white border border-gray-200 text-tuggi-blue rounded-xl hover:bg-gray-50 font-semibold text-xs transition-al shadow-sm"
            >
              <Edit2 className="w-4 h-4" /> Edit Profile
            </button>
          ) : (
             <div className="flex gap-2">
                <button 
                  onClick={handleCancelEditing} 
                  className="flex items-center gap-2 px-5 py-2.5 bg-gray-50 text-gray-600 rounded-xl hover:bg-gray-100 font-semibold text-xs transition-al"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleUpdateClient} 
                  disabled={saving}
                  className="flex items-center gap-2 px-5 py-2.5 bg-tuggi-blue text-white rounded-xl hover:bg-tuggi-blue/90 font-semibold text-xs transition-all shadow-lg shadow-tuggi-blue/20 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : <><Save className="w-4 h-4" /> Save Changes</>}
                </button>
             </div>
          )}
        </div>
      </div>

      {/* Status Messages */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-2xl text-red-600 flex items-center gap-3 animate-in fade-in duration-300">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-semibold">{error}</p>
        </div>
      )}
      {successMsg && (
        <div className="p-4 bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800 rounded-2xl text-green-600 flex items-center gap-3 animate-in fade-in duration-300">
          <Check className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-semibold">{successMsg}</p>
        </div>
      )}

      {showQrCode && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 p-10 animate-in zoom-in-95 duration-500 shadow-2xl rounded-[2.5rem]">
          <div className="flex flex-col items-center">
             <div className="p-5 bg-white border-2 border-gray-50 rounded-[2rem] shadow-sm transform hover:scale-105 transition-transform duration-500">
                <QRCodeCanvas id="client-qr-code" value={finalQrUrl} size={240} level="H" includeMargin={true} />
             </div>
             <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-6">Scan to track revenue share</p>
          </div>
          
          <div className="space-y-8">
            <div className="space-y-2">
               <h3 className="text-2xl font-bold text-gray-900 dark:text-white">Revenue QR Code</h3>
               <p className="text-sm text-gray-500 font-medium">Generate a universal download link with client attribution.</p>
            </div>

            <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800">
               <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Target URL</div>
               <code className="text-xs font-mono text-tuggi-blue font-semibold break-all leading-relaxed">{finalQrUrl}</code>
            </div>

            <div className="flex gap-3">
              <button onClick={handleDownloadQR} className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-gray-900 text-white rounded-xl text-xs font-bold hover:bg-black transition-all shadow-md"><Download className="w-4 h-4" /> Download PNG</button>
              <button onClick={handleCopyQR} className={cn("flex items-center gap-2 px-5 py-3 rounded-xl text-xs font-bold transition-all border", copied ? "bg-green-50 text-green-700 border-green-200" : "bg-white text-gray-700 border-gray-200")}>
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{copied ? 'Copied' : 'Copy Image'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content — 3 Section Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start pb-20">
        
        <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-8 shadow-sm">
          <SectionHeader icon={<Building2 className="w-4 h-4 text-tuggi-blue" />} title="Company Profile" color="tuggi-blue" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-10">
            <EditField label="Company Trade Name" value={isEditing ? editedClient.company_name || '' : client.company_name || '-'} isEditing={isEditing} onChange={(v) => updateField('company_name', v)} />
            <EditField label="Legal Name / Razão Social" value={isEditing ? editedClient.name || '' : client.name} isEditing={isEditing} onChange={(v) => updateField('name', v)} />
            <EditField label="Contact Email" value={isEditing ? editedClient.email || '' : client.email} isEditing={isEditing} onChange={(v) => updateField('email', v)} type="email" />
            <EditField label="Phone" value={isEditing ? editedClient.phone || '' : client.phone || '-'} isEditing={isEditing} onChange={(v) => updateField('phone', v)} type="tel" />
            <EditField label="Website" value={isEditing ? editedClient.website || '' : client.website || '-'} isEditing={isEditing} isLink={!isEditing && !!client.website} onChange={(v) => updateField('website', v)} />
            <EditField label="Address" value={isEditing ? editedClient.address || '' : client.address || '-'} isEditing={isEditing} onChange={(v) => updateField('address', v)} fullWidth />
            <EditField label="City / Region" value={isEditing ? editedClient.city || '' : client.city || '-'} isEditing={isEditing} onChange={(v) => updateField('city', v)} />
            <EditField label="State / Province" value={isEditing ? editedClient.state || '' : client.state || '-'} isEditing={isEditing} onChange={(v) => updateField('state', v)} />
            {isEditing ? (
              <div className="space-y-1 sm:col-span-1">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Country</p>
                <select 
                  value={editedClient.country || ''}
                  onChange={(e) => updateField('country', e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-semibold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-tuggi-blue/30 transition-all"
                >
                  <option value="">Select Country...</option>
                  {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            ) : (
              <EditField label="Country" value={client.country || '-'} isEditing={false} onChange={() => {}} />
            )}
            <EditField label="Postal Code" value={isEditing ? editedClient.postal_code || '' : client.postal_code || '-'} isEditing={isEditing} onChange={(v) => updateField('postal_code', v)} />
            <EditField label="Industry" value={isEditing ? editedClient.industry || '' : client.industry || '-'} isEditing={isEditing} onChange={(v) => updateField('industry', v)} />
          </div>
        </div>

        {/* === Section 2: Legal & Fiscal === */}
        <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-8 shadow-sm">
          <SectionHeader icon={<Scale className="w-4 h-4 text-purple-500" />} title="Legal & Fiscal" color="purple-500" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-10">
            <EditField 
              label={taxConfig.label} 
              value={isEditing ? editedClient.tax_id || '' : client.tax_id || '-'} 
              isEditing={isEditing} 
              onChange={(v) => updateField('tax_id', v)} 
              placeholder={taxConfig.placeholder}
            />
            {/* Show the type badge in view mode */}
            {!isEditing && client.tax_id_type && (
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Tax ID Type</p>
                <span className="inline-flex px-3 py-1 rounded-lg text-[11px] font-bold uppercase tracking-widest bg-purple-50 text-purple-600 border border-purple-100">
                  {client.tax_id_type}
                </span>
              </div>
            )}
            {isEditing && (
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Tax ID Type</p>
                <p className="text-sm text-gray-500 font-medium pt-1">
                  {currentCountry ? (
                    <span className="inline-flex px-3 py-1 rounded-lg text-[11px] font-bold uppercase tracking-widest bg-purple-50 text-purple-600 border border-purple-100">
                      Auto: {taxConfig.type}
                    </span>
                  ) : 'Select a country first'}
                </p>
              </div>
            )}
            <EditField 
              label="Legal Representative" 
              value={isEditing ? editedClient.legal_representative_name || '' : client.legal_representative_name || '-'} 
              isEditing={isEditing} 
              onChange={(v) => updateField('legal_representative_name', v)} 
              placeholder="Full name"
            />
            <EditField 
              label="Representative Role / Title" 
              value={isEditing ? editedClient.legal_representative_role || '' : client.legal_representative_role || '-'} 
              isEditing={isEditing} 
              onChange={(v) => updateField('legal_representative_role', v)} 
              placeholder="e.g. CEO, Director, Sócio-Gerente"
            />
            <div className="sm:col-span-2">
              <EditField 
                label="Notes" 
                value={isEditing ? editedClient.notes || '' : client.notes || '-'} 
                isEditing={isEditing} 
                onChange={(v) => updateField('notes', v)} 
                multiline
                placeholder="Internal notes about this client..."
              />
            </div>
          </div>
        </div>

        {/* === Section 3: Banking & Commissions === */}
        <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-8 shadow-sm">
          <SectionHeader icon={<Landmark className="w-4 h-4 text-green-500" />} title="Banking & Payments" color="green-500" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-10">
            <EditField 
              label="Billing / Finance Email" 
              value={isEditing ? editedClient.billing_email || '' : client.billing_email || '-'} 
              isEditing={isEditing} 
              onChange={(v) => updateField('billing_email', v)} 
              type="email"
              placeholder="finance@company.com"
            />
            <EditField 
              label="Bank Name" 
              value={isEditing ? editedClient.bank_name || '' : client.bank_name || '-'} 
              isEditing={isEditing} 
              onChange={(v) => updateField('bank_name', v)} 
              placeholder="e.g. Millennium BCP, Itaú"
            />

            {/* IBAN/BIC for EU/BR */}
            {(showIBAN || !currentCountry) && (
              <>
                <EditField 
                  label="IBAN" 
                  value={isEditing ? editedClient.iban || '' : client.iban || '-'} 
                  isEditing={isEditing} 
                  onChange={(v) => updateField('iban', v)} 
                  placeholder="PT50 0059 0007 2199 3800 0807 6"
                />
                <EditField 
                  label="BIC / SWIFT" 
                  value={isEditing ? editedClient.bic_swift || '' : client.bic_swift || '-'} 
                  isEditing={isEditing} 
                  onChange={(v) => updateField('bic_swift', v)} 
                  placeholder="CEMAPTP2XXX"
                />
              </>
            )}

            {/* Routing/Account for US/CA */}
            {(!showIBAN && currentCountry) && (
              <>
                <EditField 
                  label="Routing Number (ABA)" 
                  value={isEditing ? editedClient.bank_routing_number || '' : client.bank_routing_number || '-'} 
                  isEditing={isEditing} 
                  onChange={(v) => updateField('bank_routing_number', v)} 
                  placeholder="021000021"
                />
                <EditField 
                  label="Account Number" 
                  value={isEditing ? editedClient.bank_account_number || '' : client.bank_account_number || '-'} 
                  isEditing={isEditing} 
                  onChange={(v) => updateField('bank_account_number', v)} 
                  placeholder="123456789"
                />
              </>
            )}
          </div>
        </div>

        {/* === Section 4: Commissions & Linked Users === */}
        <div className="space-y-8">
          {/* Commission Card */}
          <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-8 shadow-sm">
            <SectionHeader icon={<Percent className="w-4 h-4 text-amber-500" />} title="Commission" color="amber-500" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-10">
              {isEditing ? (
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Commission Rate (%)</p>
                  <input 
                    type="number" 
                    step="0.001"
                    min="0"
                    max="1"
                    value={editedClient.commission_rate ?? 0.2}
                    onChange={(e) => updateField('commission_rate', parseFloat(e.target.value))}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-bold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-tuggi-blue/30 transition-all"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">Value between 0 and 1 (e.g. 0.20 = 20%)</p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Commission Rate</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">{((client.commission_rate || 0.2) * 100).toFixed(1)}%</p>
                </div>
              )}
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total Connections</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white leading-none flex items-center gap-2">
                  {client.users_count} 
                  <span className="text-xs font-medium text-gray-400">linked users</span>
                </p>
              </div>
            </div>
          </div>

          {/* Linked Users Card */}
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
              <form onSubmit={handleAddUser} className="mb-6 p-5 bg-gray-50 dark:bg-gray-950 rounded-2xl border border-gray-100 dark:border-gray-800 animate-in slide-in-from-top-2 duration-300">
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
                    <tr><td colSpan={3} className="px-5 py-8 text-center text-gray-400 text-xs font-medium">No users linked to this client</td></tr>
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
    </div>
  )
}

// ============================================================================
// Helper Components
// ============================================================================

function SectionHeader({ icon, title, color }: { icon: React.ReactNode; title: string; color: string }) {
  return (
    <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-6 flex items-center gap-2.5">
      <div className={cn("p-1.5 rounded-lg", `bg-${color}/10`)}>{icon}</div>
      {title}
    </h2>
  )
}

function EditField({ 
  label, value, isEditing, onChange, isLink, type = 'text', placeholder, fullWidth, multiline
}: { 
  label: string
  value: string
  isEditing: boolean 
  onChange: (val: string) => void
  isLink?: boolean
  type?: string
  placeholder?: string
  fullWidth?: boolean
  multiline?: boolean
}) {
  return (
    <div className={cn("space-y-1", fullWidth && "sm:col-span-2")}>
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</p>
      {isEditing ? (
        multiline ? (
          <textarea 
            value={value} 
            onChange={(e) => onChange(e.target.value)} 
            rows={3}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-semibold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-tuggi-blue/30 transition-all resize-none"
            placeholder={placeholder || `Enter ${label}...`}
          />
        ) : (
          <input 
            type={type} 
            value={value} 
            onChange={(e) => onChange(e.target.value)} 
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-semibold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-tuggi-blue/30 transition-all"
            placeholder={placeholder || `Enter ${label}...`}
          />
        )
      ) : isLink ? (
        <a href={value.startsWith('http') ? value : `https://${value}`} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-tuggi-blue hover:underline break-all">{value}</a>
      ) : (
        <p className="text-sm font-bold text-gray-900 dark:text-white break-all">{value}</p>
      )}
    </div>
  )
}

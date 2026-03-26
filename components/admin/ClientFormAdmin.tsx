'use client'

import { useState, useEffect } from 'react'
import { AlertCircle, Check, Building2, Scale, Landmark, Percent } from 'lucide-react'
import { Client, TaxIdType } from '@/types/clients'
import { cn } from '@/lib/utils'

interface ClientFormAdminProps {
  client?: Client
  onSubmit?: (client: Client) => void
  onCancel?: () => void
  isLoading?: boolean
}

// Tax ID config per country
const TAX_ID_CONFIG: Record<string, { type: TaxIdType; label: string; placeholder: string }> = {
  'Brazil': { type: 'cnpj', label: 'CNPJ', placeholder: 'XX.XXX.XXX/XXXX-XX' },
  'Portugal': { type: 'nipc', label: 'NIPC', placeholder: '9 digits' },
  'Spain': { type: 'nif', label: 'NIF/CIF', placeholder: 'A12345678' },
  'United States': { type: 'ein', label: 'EIN', placeholder: 'XX-XXXXXXX' },
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

export function ClientFormAdmin({ client, onSubmit, onCancel, isLoading = false }: ClientFormAdminProps) {
  const [formData, setFormData] = useState({
    name: client?.name || '',
    email: client?.email || '',
    phone: client?.phone || '',
    company_name: client?.company_name || '',
    address: client?.address || '',
    city: client?.city || '',
    state: client?.state || '',
    country: client?.country || '',
    postal_code: client?.postal_code || '',
    industry: client?.industry || '',
    website: client?.website || '',
    status: client?.status || 'pending',
    rejection_reason: client?.rejection_reason || '',
    notes: client?.notes || '',
    // New fields
    tax_id: client?.tax_id || '',
    tax_id_type: client?.tax_id_type || 'other' as TaxIdType,
    legal_representative_name: client?.legal_representative_name || '',
    legal_representative_role: client?.legal_representative_role || '',
    billing_email: client?.billing_email || '',
    iban: client?.iban || '',
    bic_swift: client?.bic_swift || '',
    bank_account_number: client?.bank_account_number || '',
    bank_routing_number: client?.bank_routing_number || '',
    bank_name: client?.bank_name || '',
    commission_rate: client?.commission_rate ?? 0.20,
    is_platform_owner: client?.is_platform_owner ?? false
  })

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [showSuccess, setShowSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const taxConfig = TAX_ID_CONFIG[formData.country] || { type: 'other' as TaxIdType, label: 'Tax ID', placeholder: 'Enter tax ID' }
  const showIBAN = usesBankingIBAN(formData.country)

  const validateForm = () => {
    const newErrors: Record<string, string> = {}

    if (!formData.name.trim()) newErrors.name = 'Name is required'
    if (!formData.email.trim()) newErrors.email = 'Email is required'
    if (formData.email && !formData.email.includes('@')) newErrors.email = 'Invalid email format'

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) return

    try {
      setSubmitting(true)
      const endpoint = client
        ? `/api/admin/clients/${client.id}`
        : '/api/admin/clients'

      const method = client ? 'PATCH' : 'POST'
      
      const payload = { ...formData }
      if (payload.country && TAX_ID_CONFIG[payload.country]) {
        payload.tax_id_type = TAX_ID_CONFIG[payload.country].type
      }

      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        const errorData = await response.json()
        setErrors({ submit: errorData.error || 'Failed to save client' })
        return
      }

      const data = await response.json()
      setShowSuccess(true)
      setTimeout(() => {
        onSubmit?.(data.client)
        setShowSuccess(false)
      }, 1500)
    } catch (error) {
      setErrors({ submit: 'An error occurred while saving' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target
    const val = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value
    
    setFormData(prev => ({ ...prev, [name]: val }))
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }))
    }
  }

  const isSaving = isLoading || submitting

  return (
    <form onSubmit={handleSubmit} className="space-y-8 max-w-5xl mx-auto">
      {errors.submit && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex gap-3 animate-in fade-in transition-all">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-red-700 font-medium text-sm">{errors.submit}</p>
        </div>
      )}

      {showSuccess && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-2xl flex gap-3 animate-in fade-in transition-all">
          <Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          <p className="text-green-700 font-medium text-sm">Saved successfully!</p>
        </div>
      )}

      {/* Profile Section */}
      <div className="bg-white rounded-3xl border border-gray-200 p-8 shadow-sm">
        <SectionHeader icon={<Building2 className="w-4 h-4 text-tuggi-blue" />} title="Company Profile" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField label="Client Name *" name="name" value={formData.name} onChange={handleChange} error={errors.name} disabled={isSaving} required />
          <FormField label="Contact Email *" name="email" value={formData.email} onChange={handleChange} error={errors.email} disabled={isSaving || !!client} required type="email" />
          <FormField label="Phone" name="phone" value={formData.phone} onChange={handleChange} disabled={isSaving} type="tel" />
          <FormField label="Company Trade Name" name="company_name" value={formData.company_name} onChange={handleChange} disabled={isSaving} />
          
          <div className="md:col-span-2">
            <FormField label="Address" name="address" value={formData.address} onChange={handleChange} disabled={isSaving} />
          </div>

          <FormField label="City" name="city" value={formData.city} onChange={handleChange} disabled={isSaving} />
          <FormField label="State / Province" name="state" value={formData.state} onChange={handleChange} disabled={isSaving} />
          
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 pl-1">Country</label>
            <select
              name="country"
              value={formData.country}
              onChange={handleChange}
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-tuggi-blue/20 transition-all"
              disabled={isSaving}
            >
              <option value="">Select Country...</option>
              {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <FormField label="Postal Code" name="postal_code" value={formData.postal_code} onChange={handleChange} disabled={isSaving} />
          <FormField label="Industry" name="industry" value={formData.industry} onChange={handleChange} disabled={isSaving} />
          <FormField label="Website" name="website" value={formData.website} onChange={handleChange} disabled={isSaving} type="url" />
        </div>
      </div>

      {/* Legal Section */}
      <div className="bg-white rounded-3xl border border-gray-200 p-8 shadow-sm">
        <SectionHeader icon={<Scale className="w-4 h-4 text-purple-500" />} title="Legal & Fiscal" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField label={taxConfig.label} name="tax_id" value={formData.tax_id} onChange={handleChange} disabled={isSaving} placeholder={taxConfig.placeholder} />
          <div className="flex flex-col justify-end">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 pl-1">Tax ID Type</p>
            <span className="inline-flex items-center px-4 py-2.5 h-[42px] rounded-xl text-xs font-bold uppercase tracking-widest bg-purple-50 text-purple-600 border border-purple-100">
               {formData.country ? `Auto: ${taxConfig.type}` : 'Detecting...'}
            </span>
          </div>
          <FormField label="Legal Representative Name" name="legal_representative_name" value={formData.legal_representative_name} onChange={handleChange} disabled={isSaving} placeholder="Full legal name" />
          <FormField label="Representative Role" name="legal_representative_role" value={formData.legal_representative_role} onChange={handleChange} disabled={isSaving} placeholder="e.g. CEO, Director" />
        </div>
      </div>

      {/* Banking Section */}
      <div className="bg-white rounded-3xl border border-gray-200 p-8 shadow-sm">
        <SectionHeader icon={<Landmark className="w-4 h-4 text-green-500" />} title="Banking & Payments" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField label="Billing / Finance Email" name="billing_email" value={formData.billing_email} onChange={handleChange} disabled={isSaving} type="email" placeholder="finance@company.com" />
          <FormField label="Bank Name" name="bank_name" value={formData.bank_name} onChange={handleChange} disabled={isSaving} placeholder="e.g. Millennium BCP, Itaú" />

          {showIBAN ? (
            <>
              <FormField label="IBAN" name="iban" value={formData.iban} onChange={handleChange} disabled={isSaving} placeholder="PT50 0059 ..." />
              <FormField label="BIC / SWIFT" name="bic_swift" value={formData.bic_swift} onChange={handleChange} disabled={isSaving} placeholder="CEMAPTP2XXX" />
            </>
          ) : (
            <>
              <FormField label="Routing Number (ABA)" name="bank_routing_number" value={formData.bank_routing_number} onChange={handleChange} disabled={isSaving} placeholder="021000021" />
              <FormField label="Account Number" name="bank_account_number" value={formData.bank_account_number} onChange={handleChange} disabled={isSaving} placeholder="123456789" />
            </>
          )}
        </div>
      </div>

      {/* Administration & Internal */}
      <div className="bg-white rounded-3xl border border-gray-200 p-8 shadow-sm">
        <SectionHeader icon={<Percent className="w-4 h-4 text-amber-500" />} title="Administration" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 pl-1">Status</label>
            <select
              name="status"
              value={formData.status}
              onChange={handleChange}
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-tuggi-blue/20 transition-all"
              disabled={isSaving}
            >
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>

          <FormField label="Commission Rate (e.g. 0.20)" name="commission_rate" value={formData.commission_rate.toString()} onChange={handleChange} disabled={isSaving} type="number" step="0.001" min="0" max="1" />
          
          <div className="md:col-span-2">
            <FormField label="Internal Notes" name="notes" value={formData.notes} onChange={handleChange} disabled={isSaving} multiline placeholder="General notes about this client..." />
          </div>

          {formData.status === 'rejected' && (
            <div className="md:col-span-2">
              <FormField label="Rejection Reason" name="rejection_reason" value={formData.rejection_reason} onChange={handleChange} disabled={isSaving} multiline />
            </div>
          )}
        </div>
      </div>

      {/* Form Actions */}
      <div className="flex items-center gap-4 pt-4 pb-20">
        <button
          type="submit"
          disabled={isSaving}
          className="flex items-center gap-2 px-8 py-3 bg-tuggi-blue text-white rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-tuggi-blue/90 disabled:opacity-50 shadow-lg shadow-tuggi-blue/20 transition-all"
        >
          {isSaving ? 'Processing...' : client ? 'Update Client' : 'Create Client'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="px-8 py-3 bg-gray-100 text-gray-600 rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-gray-200 disabled:opacity-50 transition-all"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-8 border-b border-gray-50 pb-4">
      <div className="p-2 bg-gray-50 rounded-xl">
        {icon}
      </div>
      <h2 className="text-sm font-bold text-gray-900 tracking-tight">{title}</h2>
    </div>
  )
}

function FormField({ 
  label, name, value, onChange, error, disabled, type = 'text', placeholder, required, multiline, step, min, max
}: { 
  label: string; name: string; value: string; onChange: any; error?: string; disabled?: boolean; type?: string; placeholder?: string; required?: boolean; multiline?: boolean; step?: string; min?: string; max?: string
}) {
  const inputClasses = cn(
    "w-full px-4 py-2.5 bg-gray-50 border rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-tuggi-blue/20 transition-all",
    error ? "border-red-300 bg-red-50/50" : "border-gray-200",
    disabled && "opacity-50 cursor-not-allowed"
  )

  return (
    <div className="space-y-1">
      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest pl-1">
        {label}
      </label>
      {multiline ? (
        <textarea
          name={name}
          value={value}
          onChange={onChange}
          rows={3}
          className={cn(inputClasses, "resize-none")}
          placeholder={placeholder}
          disabled={disabled}
        />
      ) : (
        <input
          type={type}
          name={name}
          value={value}
          onChange={onChange}
          className={inputClasses}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          step={step}
          min={min}
          max={max}
        />
      )}
      {error && <p className="text-red-500 text-[10px] font-bold uppercase mt-1 pl-1">{error}</p>}
    </div>
  )
}

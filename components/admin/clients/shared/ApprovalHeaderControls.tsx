'use client'

import { useState } from 'react'
import { CheckCircle, XCircle, Clock, AlertTriangle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ClientStatus } from '@/types/clients'

interface ApprovalHeaderControlsProps {
  clientId: string
  status: ClientStatus
  defaultCmsUserEmail?: string
  defaultCmsUserName?: string
  canEdit: boolean
  onChanged: (next: { status: ClientStatus; rejection_reason?: string; approved_at?: string }) => void
}

/**
 * Status badge + inline approve/reject buttons rendered in the
 * ClientEditorModal header — same place where POIDetailsModal shows
 * its HOMOLOGADO / EM ANÁLISE state. Approve uses a tiny inline form
 * (the existing endpoint requires the CMS user's email + name to create
 * the linked auth account); reject uses a single rejection_reason input.
 */
export function ApprovalHeaderControls({
  clientId,
  status,
  defaultCmsUserEmail,
  defaultCmsUserName,
  canEdit,
  onChanged,
}: ApprovalHeaderControlsProps) {
  const [openAction, setOpenAction] = useState<null | 'approve' | 'reject'>(null)
  const [cmsUserEmail, setCmsUserEmail] = useState(defaultCmsUserEmail ?? '')
  const [cmsUserName, setCmsUserName] = useState(defaultCmsUserName ?? '')
  const [rejectionReason, setRejectionReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const badge = (() => {
    switch (status) {
      case 'approved':
        return { label: 'Approved', icon: CheckCircle, className: 'bg-green-50 border-green-200 text-green-700' }
      case 'rejected':
        return { label: 'Rejected', icon: XCircle, className: 'bg-red-50 border-red-200 text-red-600' }
      default:
        return { label: 'Pending', icon: Clock, className: 'bg-orange-50 border-orange-200 text-orange-700' }
    }
  })()

  const handleApprove = async () => {
    if (!cmsUserEmail.trim() || !cmsUserName.trim()) {
      setError('Email e nome do CMS user são obrigatórios')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmsUserEmail: cmsUserEmail.trim(), cmsUserName: cmsUserName.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Falha ao aprovar')
        return
      }
      onChanged({ status: 'approved', approved_at: new Date().toISOString() })
      setOpenAction(null)
    } catch {
      setError('Erro de rede ao aprovar')
    } finally {
      setSubmitting(false)
    }
  }

  const handleReject = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejectionReason: rejectionReason.trim() || 'No reason provided' }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Falha ao rejeitar')
        return
      }
      onChanged({ status: 'rejected', rejection_reason: rejectionReason.trim() })
      setOpenAction(null)
    } catch {
      setError('Erro de rede ao rejeitar')
    } finally {
      setSubmitting(false)
    }
  }

  const Icon = badge.icon
  return (
    <div className="relative flex items-center gap-2">
      <span className={cn('inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border', badge.className)}>
        <Icon className="w-3.5 h-3.5" />
        {badge.label}
      </span>

      {status === 'pending' && canEdit && (
        <>
          <button
            type="button"
            onClick={() => setOpenAction('approve')}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-xl bg-green-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-50 transition-all"
          >
            <CheckCircle className="w-3.5 h-3.5" /> Aprovar
          </button>
          <button
            type="button"
            onClick={() => setOpenAction('reject')}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-50 transition-all"
          >
            <XCircle className="w-3.5 h-3.5" /> Rejeitar
          </button>
        </>
      )}

      {openAction && (
        // Popover is anchored to the right edge of the header and capped
        // at the viewport width with margins so it never bleeds out on
        // smaller laptops (the modal itself is 85vw → on 1280px screens
        // the available header space is ~1088px).
        <div
          className="absolute right-0 top-full mt-2 z-50 w-[min(24rem,calc(100vw-2rem))] max-w-sm rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-gray-900">
              {openAction === 'approve' ? 'Aprovar cliente' : 'Rejeitar cliente'}
            </h3>
            <button
              type="button"
              onClick={() => { setOpenAction(null); setError(null) }}
              className="text-gray-400 hover:text-gray-700"
            >
              <XCircle className="w-4 h-4" />
            </button>
          </div>

          {error && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertTriangle className="w-3.5 h-3.5" /> {error}
            </div>
          )}

          {openAction === 'approve' ? (
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
                  CMS user email
                </label>
                <input
                  type="email"
                  value={cmsUserEmail}
                  onChange={(e) => setCmsUserEmail(e.target.value)}
                  placeholder="user@empresa.com"
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-tuggi-blue/30"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
                  CMS user nome
                </label>
                <input
                  type="text"
                  value={cmsUserName}
                  onChange={(e) => setCmsUserName(e.target.value)}
                  placeholder="João Silva"
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-tuggi-blue/30"
                />
              </div>
              <button
                type="button"
                onClick={handleApprove}
                disabled={submitting}
                className="w-full py-2.5 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2 text-sm"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirmar aprovação
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
                  Motivo da rejeição
                </label>
                <textarea
                  rows={3}
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="Documentação incompleta, etc."
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-tuggi-blue/30 resize-none"
                />
              </div>
              <button
                type="button"
                onClick={handleReject}
                disabled={submitting}
                className="w-full py-2.5 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2 text-sm"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirmar rejeição
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

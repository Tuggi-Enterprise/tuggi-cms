'use client'

/**
 * The record's read of `GET /api/admin/clients/[clientId]/contract` — one hook for `ContractTab`
 * and `FiscalPaymentsTab`, over the record cache, so the two tabs make one request between them
 * (#875) and cannot read different shapes of the same answer.
 */

import { useEffect, useState } from 'react'
import { useRecordRead } from '@/lib/hooks/use-record-cache'

export interface ClientContractSummary {
  contract: {
    status: 'draft' | 'sent' | 'signed' | 'superseded' | 'terminated'
    tier: 'free' | 'paid'
    templateVersion: string
    createdAt: string
    sentAt: string | null
    snapshot: { monthlyFeeCents: number | null; isCourtesy: boolean }
    feeDivergence: { diverges: boolean; registrationFeeCents: number | null }
  } | null
  acceptance: { acceptedAt: string; signerName: string } | null
}

export function useClientContract(clientId?: string): { summary: ClientContractSummary | null; failed: boolean } {
  const read = useRecordRead()
  const [summary, setSummary] = useState<ClientContractSummary | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!clientId) return
    let active = true
    read<ClientContractSummary>(`/api/admin/clients/${clientId}/contract`)
      .then((response) => {
        if (!active) return
        if (response.ok && response.body) setSummary(response.body)
        else setFailed(true)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [clientId, read])

  return { summary, failed }
}

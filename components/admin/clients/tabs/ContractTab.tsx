'use client'

/**
 * The contract, seen from where the team already is (#342, spec do `design` §4.1).
 *
 * The page is its own route because a contract does not fit in a modal; this tab is the
 * summary that keeps the STATE visible in the client list — state, frozen value, and the
 * way in. Two surfaces, one truth: both read
 * `app/api/admin/clients/[clientId]/contract`, so nothing here can drift from the page.
 *
 * The `design` calls it `ContratoTab`; the identifier is English because
 * `.claude/rules/codigo-em-ingles.md` governs code and the spec governs the surface.
 */

import { useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
import { FileSignature } from 'lucide-react'
import { SectionHeader } from '@/components/admin/clients/shared/SectionHeader'
import { formatDate, formatFee } from '@/lib/contract/snapshot'
import type { ClientEditorTabProps } from './ProfileTab'

interface Summary {
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

export function ContractTab({ clientId }: ClientEditorTabProps) {
  const locale = useLocale()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!clientId) return
    let active = true
    fetch(`/api/admin/clients/${clientId}/contract`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('load failed'))))
      .then((data: Summary) => {
        if (active) setSummary(data)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [clientId])

  const contract = summary?.contract ?? null
  const acceptance = summary?.acceptance ?? null

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="rounded-3xl border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <SectionHeader
          icon={<FileSignature className="h-4 w-4 text-indigo-500" />}
          title="Contrato de parceria"
          color="indigo-500"
        />

        {failed ? (
          <p className="text-sm text-gray-600">Não foi possível carregar o estado do contrato.</p>
        ) : !summary ? (
          <p className="text-sm text-gray-600">Carregando…</p>
        ) : (
          <dl className="grid grid-cols-1 gap-y-4 sm:grid-cols-2">
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Estado</dt>
              <dd className="text-sm font-semibold text-gray-900 dark:text-white">
                {!contract
                  ? 'Sem contrato'
                  : acceptance
                    ? `Assinado em ${formatDate(acceptance.acceptedAt)} por ${acceptance.signerName}`
                    : contract.status === 'sent'
                      ? `Aguardando aceite desde ${formatDate(contract.sentAt ?? contract.createdAt)}`
                      : contract.status === 'superseded'
                        ? 'Substituído por um aditivo'
                        : contract.status === 'terminated'
                          ? 'Encerrado'
                          : `Rascunho gerado em ${formatDate(contract.createdAt)}`}
              </dd>
            </div>

            <div>
              <dt className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                Valor congelado
              </dt>
              <dd className="text-sm font-semibold text-gray-900 dark:text-white">
                {!contract || contract.tier === 'free'
                  ? '—'
                  : contract.snapshot.isCourtesy
                    ? 'Cortesia, sem mensalidade'
                    : `${formatFee(contract.snapshot.monthlyFeeCents)} por mês`}
              </dd>
            </div>

            {contract && acceptance && contract.feeDivergence.diverges ? (
              <div className="sm:col-span-2 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-gray-900">
                O cadastro mostra hoje {formatFee(contract.feeDivergence.registrationFeeCents)}. Editar o
                cadastro não muda este contrato — cobrar outro valor exige aditivo com novo aceite.
              </div>
            ) : null}
          </dl>
        )}

        <a
          className="mt-6 inline-flex rounded-xl bg-primary-800 px-4 py-2 text-sm font-semibold text-white"
          href={`/${locale}/admin/clients/${clientId}/contract`}
        >
          Abrir a página do contrato
        </a>
      </div>
    </div>
  )
}

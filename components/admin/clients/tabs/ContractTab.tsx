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

import { useLocale, useTranslations } from 'next-intl'
import { FileSignature } from 'lucide-react'
import { SectionHeader } from '@/components/admin/clients/shared/SectionHeader'
import { formatDate, formatFee } from '@/lib/contract/snapshot'
import { returnParams } from '@/lib/navigation/return-to'
import { useClientContract } from '@/components/admin/clients/shared/use-client-contract'
import { OriginRow, PortalAcceptances } from '@/components/admin/clients/shared/PortalRecord'
import { AcceptanceLinkPanel } from '@/components/admin/clients/shared/AcceptanceLinkPanel'
import type { ClientEditorTabProps } from './ProfileTab'

export function ContractTab({ clientId, client }: ClientEditorTabProps) {
  const locale = useLocale()
  const { summary, failed } = useClientContract(clientId)

  const tPortal = useTranslations('Clients.portal')
  const contract = summary?.contract ?? null
  const acceptance = summary?.acceptance ?? null
  /**
   * A portal client's contract IS its electronic acceptance (BR-B2B-047, #871): the card below
   * shows it, and the generated-contract summary stays only if one was made before the portal.
   */
  const fromPortal = summary?.origin === 'portal'
  const showGenerated = !fromPortal || contract !== null

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {summary ? (
        <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm lg:p-8 dark:border-gray-800 dark:bg-gray-900">
          <dl className="grid grid-cols-1 gap-y-4 sm:grid-cols-2">
            <OriginRow origin={summary.origin} />
          </dl>
          {summary.portal === null ? (
            <p className="mt-4 text-sm text-gray-600">{tPortal('readError')}</p>
          ) : fromPortal ? (
            <div className="mt-6 space-y-6">
              <SectionHeader
                icon={<FileSignature className="h-4 w-4 text-indigo-500" />}
                title={tPortal('acceptance.title')}
                color="indigo-500"
              />
              <PortalAcceptances records={summary.portal} />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* BR-B2B-056: who did not come through the portal accepts by link (#872). */}
      {summary && !fromPortal && clientId ? (
        <AcceptanceLinkPanel clientId={clientId} email={client?.email ?? null} />
      ) : null}

      {showGenerated ? (
      <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm lg:p-8 dark:border-gray-800 dark:bg-gray-900">
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

        {/* The way back is this very tab, so generating the contract and coming back to the
            record is not a hunt through the client list. */}
        <a
          className="mt-6 inline-flex rounded-xl bg-primary-800 px-4 py-2 text-sm font-semibold text-white"
          href={`/${locale}/admin/clients/${clientId}/contract?${new URLSearchParams(
            returnParams(
              `/${locale}/admin/clients?clientId=${clientId}&tab=contract`,
              'Voltar para a ficha do cliente'
            )
          ).toString()}`}
        >
          Abrir a página do contrato
        </a>
      </div>
      ) : null}
    </div>
  )
}

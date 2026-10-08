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
import { RecordSection } from '@/components/admin/clients/shared/RecordSection'
import { formatDate, formatFee } from '@/lib/contract/snapshot'
import { returnParams } from '@/lib/navigation/return-to'
import { useClientContract } from '@/components/admin/clients/shared/use-client-contract'
import { OriginRow, PortalAcceptances } from '@/components/admin/clients/shared/PortalRecord'
import { AcceptanceLinkPanel } from '@/components/admin/clients/shared/AcceptanceLinkPanel'
import type { ClientEditorTabProps } from './ProfileTab'

const TERM = 'text-[10px] font-bold uppercase tracking-widest text-gray-500'

/**
 * ONE CARD FOR THE ACCEPTANCE, WITH THE ORIGIN AS ITS FIRST LINE (#911). The origin used to be a
 * card of its own, and a client with no generated contract saw a third card saying so.
 *
 * - Portal client: "Aceite eletrônico", the acceptance the portal recorded (BR-B2B-047, #871).
 * - Direct or proposal client: "Aceite do termo", the link of BR-B2B-056 (#872).
 * - "Contrato de parceria" only when a contract was generated: BR-B2B-056 item 1, the CMS does not
 *   generate one for a new partner. A legacy contract signed before the link existed is the
 *   acceptance itself, so the link panel stays away and the origin opens this card instead.
 */
export function ContractTab({ clientId, client }: ClientEditorTabProps) {
  const locale = useLocale()
  const { summary, failed } = useClientContract(clientId)
  const tPortal = useTranslations('Clients.portal')

  if (failed || !summary) {
    return (
      <div className="mx-auto max-w-5xl">
        <p className="text-sm text-gray-600">
          {failed ? 'Não foi possível carregar o estado do contrato.' : 'Carregando…'}
        </p>
      </div>
    )
  }

  const { contract, acceptance } = summary
  const fromPortal = summary.origin === 'portal'
  const originInContract = !fromPortal && acceptance !== null && contract !== null
  const origin = (
    <dl className="grid grid-cols-1 gap-y-4 sm:grid-cols-2">
      <OriginRow origin={summary.origin} />
    </dl>
  )
  const portalReadError =
    summary.portal === null ? <p className="text-sm text-gray-600">{tPortal('readError')}</p> : null

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {fromPortal ? (
        <RecordSection
          icon={<FileSignature className="h-4 w-4 text-indigo-500" />}
          title={tPortal('acceptance.title')}
          color="indigo-500"
        >
          <div className="space-y-6">
            {origin}
            {summary.portal === null ? portalReadError : <PortalAcceptances records={summary.portal} />}
          </div>
        </RecordSection>
      ) : clientId && !originInContract ? (
        <AcceptanceLinkPanel
          clientId={clientId}
          email={client?.email ?? null}
          lead={
            <div className="space-y-3">
              {origin}
              {portalReadError}
            </div>
          }
        />
      ) : null}

      {contract ? (
        <RecordSection
          icon={<FileSignature className="h-4 w-4 text-indigo-500" />}
          title="Contrato de parceria"
          color="indigo-500"
        >
          {originInContract ? <div className="mb-4">{origin}</div> : null}
          <dl className="grid grid-cols-1 gap-y-4 sm:grid-cols-2">
            <div>
              <dt className={TERM}>Estado</dt>
              <dd className="text-sm font-semibold text-gray-900 dark:text-white">
                {acceptance
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
              <dt className={TERM}>Valor congelado</dt>
              <dd className="text-sm font-semibold text-gray-900 dark:text-white">
                {contract.tier === 'free'
                  ? '—'
                  : contract.snapshot.isCourtesy
                    ? 'Cortesia, sem mensalidade'
                    : `${formatFee(contract.snapshot.monthlyFeeCents)} por mês`}
              </dd>
            </div>

            {acceptance && contract.feeDivergence.diverges ? (
              <div className="sm:col-span-2 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-gray-900">
                O cadastro mostra hoje {formatFee(contract.feeDivergence.registrationFeeCents)}. Editar o
                cadastro não muda este contrato — cobrar outro valor exige aditivo com novo aceite.
              </div>
            ) : null}
          </dl>

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
        </RecordSection>
      ) : null}
    </div>
  )
}

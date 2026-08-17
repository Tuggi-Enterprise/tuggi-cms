'use client'

/**
 * The internal half of the contract (#342) — spec do `design`, §4.1.
 *
 * Its own route and not a tab, because a contract is a long document with a trail and a
 * version history and it does not fit in `ClientEditorModal` (Tech Lead, #342). The state
 * still shows up where the team already looks: `ContractTab` in the modal reads the same
 * endpoint and links here.
 *
 * The density here is the CMS's, not the phone's: this operator does this a few times a
 * week and wants the checklist, the trail and the hash in front of them — DS-LAYOUT-005
 * governs the EXTERNAL surface and nothing on this page.
 *
 * The copy is Portuguese and is not translated, for the reason written in
 * `components/contract/ContractText.tsx`.
 */

import { useCallback, useEffect, useState } from 'react'
import { ContractText } from '@/components/contract/ContractText'
import { ClientEditorModal } from '@/components/admin/clients/ClientEditorModal'
import {
  formatDate,
  formatDateTime,
  formatFee,
  type ChecklistItem,
  type ContractSnapshot,
} from '@/lib/contract/snapshot'

interface ContractState {
  template: {
    version: string
    title: string
  }
  checklist: { ready: boolean; missing: ChecklistItem[] }
  registration: {
    legalName: string
    recipientEmail: string | null
    monthlyFeeCents: number | null
    isCourtesy: boolean
    commissionRate: number | null
  }
  contract: {
    id: string
    status: 'draft' | 'sent' | 'signed' | 'superseded' | 'terminated'
    tier: 'free' | 'paid'
    templateVersion: string
    snapshot: ContractSnapshot
    documentHash: string
    createdAt: string
    sentAt: string | null
    sentToEmail: string | null
    openedAt: string | null
    tokenExpiresAt: string | null
    feeDivergence: { diverges: boolean; registrationFeeCents: number | null }
  } | null
  acceptance: {
    signerName: string
    signerRole: string
    acceptedAt: string
    ipAddress: string
    userAgent: string
    recipientEmail: string
    templateVersion: string
    documentHash: string
    signedDocumentHash: string | null
  } | null
}

/** Text and shape, never colour alone (spec do `design`, §4.1). */
function statusLabel(state: ContractState): string {
  const contract = state.contract
  if (!contract) return 'Sem contrato'
  if (contract.status === 'signed' && state.acceptance) {
    return `Assinado em ${formatDate(state.acceptance.acceptedAt)}`
  }
  if (contract.status === 'superseded') return 'Substituído por um aditivo'
  if (contract.status === 'terminated') return 'Encerrado'
  if (contract.status === 'sent') {
    const expired = contract.tokenExpiresAt && new Date(contract.tokenExpiresAt).getTime() <= Date.now()
    return expired
      ? `Link expirou em ${formatDate(contract.tokenExpiresAt!)} — reenviar`
      : `Aguardando aceite desde ${formatDate(contract.sentAt ?? contract.createdAt)}`
  }
  return `Rascunho gerado em ${formatDate(contract.createdAt)}`
}

export function ContractManager({
  clientId,
  returnTo = null,
  returnLabel = null,
}: {
  clientId: string
  /** Already validated by the page; see `lib/navigation/return-to`. */
  returnTo?: string | null
  returnLabel?: string | null
}) {
  const [state, setState] = useState<ContractState | null>(null)
  const [tier, setTier] = useState<'free' | 'paid'>('free')
  const [paymentMethod, setPaymentMethod] = useState<'boleto' | 'pix' | ''>('')
  const [qrDeliveryDays, setQrDeliveryDays] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  /**
   * The registration the operator is filling in WITHOUT leaving this page.
   *
   * Every checklist item used to be an instruction — `aba Fiscal e Pagamentos` — and obeying
   * it cost a round trip per missing field: leave, hunt for the record, fill, come back,
   * discover the next hole. The record is a drawer that fetches and saves on its own, so it
   * comes here instead. It carries an id because Tuggi's own side of the contract lives in a
   * DIFFERENT row of `core.clients` than the partner's, and both are on this checklist.
   */
  const [editing, setEditing] = useState<{ clientId: string; tab: 'profile' | 'fiscal' } | null>(null)

  // The fetch does not touch state: `react-hooks/set-state-in-effect` is right that an
  // effect whose body sets state cascades renders, and keeping the two apart also makes
  // the same call reusable after every action below.
  const fetchState = useCallback(async (): Promise<ContractState | null> => {
    const query = new URLSearchParams({ tier, qrDeliveryDays })
    if (paymentMethod) query.set('paymentMethod', paymentMethod)
    const response = await fetch(`/api/admin/clients/${clientId}/contract?${query.toString()}`)
    return response.ok ? ((await response.json()) as ContractState) : null
  }, [clientId, tier, paymentMethod, qrDeliveryDays])

  useEffect(() => {
    let active = true
    void fetchState().then((next) => {
      if (!active) return
      if (next) setState(next)
      else setMessage('Não foi possível carregar o estado do contrato.')
    })
    return () => {
      active = false
    }
  }, [fetchState])

  async function reload() {
    const next = await fetchState()
    if (next) setState(next)
  }

  async function act(action: 'generate' | 'send' | 'verify') {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/admin/clients/${clientId}/contract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          tier,
          paymentMethod: paymentMethod || null,
          qrDeliveryDays: Number(qrDeliveryDays) || null,
        }),
      })
      const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null

      if (action === 'verify') {
        setMessage(
          payload?.state === 'match'
            ? 'O arquivo guardado bate com o hash registrado no aceite.'
            : payload?.state === 'mismatch'
              ? 'O arquivo guardado NÃO bate com o hash registrado. Não use este PDF como prova — avise o time antes de qualquer coisa.'
              : 'Não foi possível conferir o arquivo agora.'
        )
      } else if (!response.ok) {
        setMessage(
          payload?.error === 'checklist_incomplete'
            ? 'Ainda falta item do checklist.'
            : 'A ação não foi concluída.'
        )
      } else if (action === 'send') {
        setMessage(
          payload?.emailed
            ? `Contrato enviado para ${String(payload.recipientEmail)}.`
            : `Link gerado, mas o e-mail não saiu. Link: ${String(payload?.url ?? '')}`
        )
      } else {
        setMessage('Contrato gerado.')
      }

      await reload()
    } finally {
      setBusy(false)
    }
  }

  if (!state) {
    return <p className="p-8 text-sm text-gray-600">Carregando o contrato…</p>
  }

  const signed = Boolean(state.acceptance)

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Whoever sent the operator here says so, and takes them back. Without it the only way
          out of a page reached from the pipeline was the browser's button. */}
      {returnTo ? (
        <a
          href={returnTo}
          className="inline-flex min-h-[24px] items-center text-sm font-semibold text-primary-800 underline underline-offset-4"
        >
          {returnLabel ?? 'Voltar'}
        </a>
      ) : null}

      <header>
        <h1 className="text-2xl font-bold text-gray-900">Contrato de parceria</h1>
        <p className="mt-1 text-sm text-gray-700">
          {state.registration.legalName} · {statusLabel(state)}
        </p>
      </header>

      {state.contract && signed && state.contract.feeDivergence.diverges ? (
        <section className="rounded-lg border border-amber-400 bg-amber-50 p-4 text-sm text-gray-900">
          <p className="font-semibold">
            Valor aceito:{' '}
            {state.contract.snapshot.isCourtesy
              ? 'cortesia, sem mensalidade'
              : `${formatFee(state.contract.snapshot.monthlyFeeCents)} por mês`}{' '}
            — congelado em {formatDate(state.acceptance!.acceptedAt)}.
          </p>
          <p className="mt-1">
            O cadastro deste cliente mostra hoje {formatFee(state.contract.feeDivergence.registrationFeeCents)}.
            Editar o cadastro não muda este contrato. Para cobrar outro valor é preciso um aditivo com novo
            aceite.
          </p>
        </section>
      ) : null}

      {/*
        Não existe aviso de "minuta pendente de revisão jurídica" nem botão travado por ela.
        Quem decide se a minuta está pronta para ir ao parceiro é o operador, fora do
        software — decisão dele em 2026-08-17. A trava que fica é o checklist de campos
        obrigatórios, e ela recusa a GERAÇÃO logo abaixo.
      */}
      {!signed ? (
        <section className="space-y-4 rounded-lg border border-gray-300 p-4">
          <h2 className="text-lg font-semibold text-gray-900">Gerar contrato</h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="text-sm font-semibold text-gray-900">
              Faixa
              <select
                className="mt-1 block w-full rounded border border-gray-400 px-2 py-2 text-sm"
                value={tier}
                onChange={(event) => setTier(event.target.value as 'free' | 'paid')}
              >
                <option value="free">Gratuita</option>
                <option value="paid">Paga</option>
              </select>
            </label>

            {tier === 'paid' ? (
              <label className="text-sm font-semibold text-gray-900">
                Forma de pagamento
                <select
                  className="mt-1 block w-full rounded border border-gray-400 px-2 py-2 text-sm"
                  value={paymentMethod}
                  onChange={(event) => setPaymentMethod(event.target.value as 'boleto' | 'pix' | '')}
                >
                  <option value="">Escolher</option>
                  <option value="boleto">Boleto</option>
                  <option value="pix">Pix</option>
                </select>
              </label>
            ) : null}

            <label className="text-sm font-semibold text-gray-900">
              Prazo de entrega do QR (dias)
              <input
                type="number"
                min={1}
                max={180}
                className="mt-1 block w-full rounded border border-gray-400 px-2 py-2 text-sm"
                value={qrDeliveryDays}
                onChange={(event) => setQrDeliveryDays(event.target.value)}
              />
            </label>
          </div>

          {!state.checklist.ready ? (
            <div className="rounded border border-gray-300 bg-gray-50 p-3 text-sm text-gray-900">
              <p className="font-semibold">Ainda não dá para gerar o contrato. Faltam:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {state.checklist.missing.map((item) => (
                  <li key={item.id}>
                    <MissingItem
                      item={item}
                      onOpenClient={(clientId, tab) => setEditing({ clientId, tab })}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="rounded border border-gray-300 p-3 text-sm text-gray-900">
            A cláusula de comissão cria uma obrigação que o sistema ainda não sabe apurar. Não prometa
            extrato de comissão a este parceiro.
          </p>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="rounded bg-primary-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={busy || !state.checklist.ready}
              onClick={() => act('generate')}
            >
              Gerar contrato
            </button>

            {state.contract ? (
              <>
                <button
                  type="button"
                  className="rounded border border-gray-400 px-4 py-2 text-sm font-semibold text-gray-900"
                  onClick={() => setPreview((value) => !value)}
                >
                  {preview ? 'Fechar a prévia' : 'Ver o contrato como o parceiro vai ver'}
                </button>
                <button
                  type="button"
                  className="rounded bg-primary-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  disabled={busy}
                  onClick={() => act('send')}
                >
                  Enviar para assinatura
                </button>
              </>
            ) : null}
          </div>

          {state.contract ? (
            <p className="text-sm text-gray-700">
              Vamos enviar o contrato para <strong>{state.registration.recipientEmail ?? '—'}</strong>, na
              versão <strong>{state.contract.templateVersion}</strong>.
              {state.contract.tier === 'paid' ? (
                <>
                  {' '}
                  Depois do aceite, o valor de{' '}
                  <strong>
                    {state.contract.snapshot.isCourtesy
                      ? 'cortesia'
                      : formatFee(state.contract.snapshot.monthlyFeeCents)}
                  </strong>{' '}
                  fica congelado neste contrato. Mudar o valor no cadastro não muda contrato já assinado.
                </>
              ) : null}
            </p>
          ) : null}
        </section>
      ) : null}

      {state.contract && preview ? (
        <section className="rounded-lg border border-gray-300 p-4">
          <ContractText snapshot={state.contract.snapshot} />
        </section>
      ) : null}

      {state.contract ? (
        <section className="rounded-lg border border-gray-300 p-4">
          <h2 className="text-lg font-semibold text-gray-900">Trilha do aceite</h2>
          <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-[220px_1fr]">
            <Row label="Gerado em" value={formatDateTime(state.contract.createdAt)} />
            <Row
              label="Enviado em / para"
              value={
                state.contract.sentAt
                  ? `${formatDateTime(state.contract.sentAt)} · ${state.contract.sentToEmail ?? '—'}`
                  : 'ainda não enviado'
              }
            />
            <Row
              label="Aberto pelo parceiro em"
              value={state.contract.openedAt ? formatDateTime(state.contract.openedAt) : 'ainda não aberto'}
            />
            {state.acceptance ? (
              <>
                <Row
                  label="Assinado em"
                  value={`${formatDateTime(state.acceptance.acceptedAt)} por ${state.acceptance.signerName}, ${state.acceptance.signerRole}`}
                />
                <Row label="IP" value={state.acceptance.ipAddress} />
                <Row label="Navegador" value={state.acceptance.userAgent} />
                <Row label="Versão do modelo" value={state.acceptance.templateVersion} />
                <Row label="SHA-256 do documento aceito" value={state.acceptance.documentHash} copyable />
                <Row
                  label="SHA-256 do PDF assinado"
                  value={state.acceptance.signedDocumentHash ?? '—'}
                  copyable={Boolean(state.acceptance.signedDocumentHash)}
                />
              </>
            ) : (
              <Row label="SHA-256 do documento" value={state.contract.documentHash} copyable />
            )}
          </dl>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              className="rounded border border-gray-400 px-4 py-2 text-sm font-semibold text-gray-900"
              disabled={busy}
              onClick={() => act('verify')}
            >
              Conferir integridade
            </button>
            <a
              className="rounded border border-gray-400 px-4 py-2 text-sm font-semibold text-gray-900"
              href={`/api/admin/clients/${clientId}/contract/pdf`}
            >
              Abrir o PDF
            </a>
          </div>
        </section>
      ) : null}

      {message ? (
        <p role="status" className="rounded border border-gray-300 p-3 text-sm text-gray-900">
          {message}
        </p>
      ) : null}

      {/* Closing it re-reads the checklist: the item the operator just resolved disappears with
          no manual reload, which is the whole point of bringing the record here. */}
      <ClientEditorModal
        clientId={editing?.clientId}
        isOpen={editing !== null}
        mode="edit"
        initialTab={editing?.tab ?? 'profile'}
        onClose={() => {
          setEditing(null)
          void reload()
        }}
        onSaved={() => void reload()}
      />
    </div>
  )
}

/**
 * One missing item — a control when the screen can take the operator there, prose when it
 * cannot.
 *
 * `kind: 'page'` is already on this screen and `kind: 'conference'` is the proposal's band,
 * which has no id here to link with; both keep saying where in words. A `clientId` of `null`
 * means nobody is marked as the platform owner, or more than one is — there is no single
 * record to open, and a button that opens the wrong one is worse than a sentence.
 */
function MissingItem({
  item,
  onOpenClient,
}: {
  item: ChecklistItem
  onOpenClient: (clientId: string, tab: 'profile' | 'fiscal') => void
}) {
  if (item.target.kind === 'client' && item.target.clientId) {
    const { clientId, tab } = item.target
    return (
      <>
        {item.label} —{' '}
        <button
          type="button"
          onClick={() => onOpenClient(clientId, tab)}
          className="font-semibold text-primary-800 underline underline-offset-4"
        >
          {item.where}
        </button>
      </>
    )
  }

  return (
    <>
      {item.label} — <em>{item.where}</em>
    </>
  )
}

function Row({ label, value, copyable }: { label: string; value: string; copyable?: boolean }) {
  return (
    <>
      <dt className="font-semibold text-gray-700">{label}</dt>
      <dd className="break-all text-gray-900">
        {value}
        {copyable ? (
          <button
            type="button"
            className="ml-2 rounded border border-gray-400 px-2 py-0.5 text-xs"
            onClick={() => navigator.clipboard?.writeText(value)}
          >
            Copiar
          </button>
        ) : null}
      </dd>
    </>
  )
}

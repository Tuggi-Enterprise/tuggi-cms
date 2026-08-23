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
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { PARTNER_DOCUMENT_KINDS, type PartnerDocumentKind } from '@/lib/partner-form/fields'
import { EMPTY_CONFERENCE, type ConferenceRecord } from '@/lib/partner-form/regularity'
import {
  formatDate,
  formatDateTime,
  formatFee,
  type ChecklistItem,
  type ContractSnapshot,
} from '@/lib/contract/snapshot'

/**
 * THE SHELL IS THE CMS's, THE INK IS ACCESSIBLE, AND THE DOCUMENT PRINTS ALONE.
 *
 * Same two constants as `ProposalReview`, for the same reason: this screen drew flat `rounded`
 * boxes on plain white with no dark theme, while every other CMS surface is a glass panel over
 * `bg-gray-50 dark:bg-gray-950`.
 *
 * `print:` is the half that is not cosmetic. A contract is the one document in this product
 * somebody will put on paper, and until now Ctrl+P here printed the checklist, the generation
 * form and the audit trail around it. Every panel that is not the document carries
 * `print:hidden`, so what leaves the printer is what `ContractText` renders — the same text the
 * partner reads and the same array the PDF walks.
 */
const CARD =
  'rounded-3xl border border-gray-200 bg-white/70 shadow-2xl shadow-black/5 backdrop-blur-xl ' +
  'dark:border-gray-800 dark:bg-gray-900/70'

const FIELD =
  'mt-1 block w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-2.5 text-sm ' +
  'text-gray-900 outline-none transition-all focus:border-transparent focus:ring-2 ' +
  'focus:ring-primary-800 dark:border-gray-700 dark:bg-gray-900/50 dark:text-white'

interface ContractState {
  template: {
    version: string
    title: string
  }
  checklist: { ready: boolean; missing: ChecklistItem[] }
  /** O que o estabelecimento escolheu no formulário, quando houve formulário. */
  planChoice: 'map_only' | 'map_and_description' | null
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
  /**
   * A faixa começa NA ESCOLHA DO ESTABELECIMENTO, e a rota é quem a resolve — ver o cabeçalho
   * de `loadPlanChoice`. Aqui ela só espera a primeira resposta: `null` até lá, e o `select`
   * fica no que o servidor mandou. Um `useState('free')` fixo era a terceira vez que alguém
   * digitava a mesma decisão.
   */
  const [tier, setTier] = useState<'free' | 'paid' | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<'boleto' | 'pix' | ''>('')
  const [qrDeliveryDays, setQrDeliveryDays] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  /**
   * The signing link the last send minted, kept on screen instead of inside a sentence.
   *
   * IT CANNOT BE FETCHED BACK, and that is why it lives here. `partner.partner_contracts`
   * stores only the SHA-256 of the token, so the raw value exists exactly once: in the answer
   * to the POST that created it. Until 2026-08-21 the page printed it only when the e-mail
   * FAILED, inside a status line with no control on it, and an operator who wanted to send
   * the contract over WhatsApp had no way to reach it. Losing it is not fatal — sending again
   * mints a new one, while the contract is unsigned — but it costs the partner a dead link.
   */
  const [signingLink, setSigningLink] = useState<SigningLink | null>(null)
  /**
   * The registration the operator is filling in WITHOUT leaving this page.
   *
   * Every checklist item used to be an instruction — `aba Fiscal e Pagamentos` — and obeying
   * it cost a round trip per missing field: leave, hunt for the record, fill, come back,
   * discover the next hole. The record is a drawer that fetches and saves on its own, so it
   * comes here instead. It carries an id because Tuggi's own side of the contract lives in a
   * DIFFERENT row of `partner.clients` than the partner's, and both are on this checklist.
   */
  const [editing, setEditing] = useState<{ clientId: string; tab: 'profile' | 'fiscal' } | null>(null)

  // The fetch does not touch state: `react-hooks/set-state-in-effect` is right that an
  // effect whose body sets state cascades renders, and keeping the two apart also makes
  // the same call reusable after every action below.
  const fetchState = useCallback(async (): Promise<ContractState | null> => {
    const query = new URLSearchParams({ ...(tier ? { tier } : {}), qrDeliveryDays })
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

  /**
   * A FAIXA EFETIVA, e ela é derivada em UM lugar.
   *
   * `tier` é o que o operador escolheu NESTA sessão da tela e começa `null`; abaixo dele vem a
   * faixa do contrato que já existe, e abaixo dela a escolha do estabelecimento. Ler `tier`
   * cru em três lugares — o `select`, o campo de pagamento e o corpo do POST — era garantir
   * que os três discordassem enquanto a primeira resposta não chegasse.
   */
  const effectiveTier: 'free' | 'paid' =
    tier ?? state?.contract?.tier ?? (state?.planChoice === 'map_and_description' ? 'paid' : 'free')

  async function act(action: 'generate' | 'send' | 'verify') {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/admin/clients/${clientId}/contract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          tier: effectiveTier,
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
        const url = typeof payload?.url === 'string' ? payload.url : ''
        if (url) {
          setSigningLink({
            url,
            expiresAt: typeof payload?.expiresAt === 'string' ? payload.expiresAt : null,
            recipientEmail:
              typeof payload?.recipientEmail === 'string' ? payload.recipientEmail : null,
            emailed: payload?.emailed === true,
          })
        }
        setMessage(
          payload?.emailed
            ? `Contrato enviado para ${String(payload.recipientEmail)}.`
            : 'O link foi gerado, mas o e-mail não saiu. Use o link abaixo para enviar por outro canal.'
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
    return (
      <p className="min-h-screen bg-gray-50 p-8 text-sm text-gray-600 dark:bg-gray-950 dark:text-gray-300">
        Carregando o contrato…
      </p>
    )
  }

  const signed = Boolean(state.acceptance)

  return (
    <div className="min-h-screen bg-gray-50 p-6 dark:bg-gray-950 lg:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
      {/* Whoever sent the operator here says so, and takes them back. Without it the only way
          out of a page reached from the pipeline was the browser's button. */}
      {returnTo ? (
        <a
          href={returnTo}
          className="inline-flex min-h-[24px] items-center text-sm font-semibold text-primary-800 underline underline-offset-4 print:hidden dark:text-tuggi-blue"
        >
          {returnLabel ?? 'Voltar'}
        </a>
      ) : null}

      <header className={`${CARD} p-6 print:hidden`}>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Contrato de parceria</h1>
        <p className="mt-1 text-sm text-gray-700 dark:text-gray-400">
          {state.registration.legalName} · {statusLabel(state)}
        </p>
      </header>

      {state.contract && signed && state.contract.feeDivergence.diverges ? (
        <section className="rounded-3xl border border-amber-400 bg-amber-50 p-6 text-sm text-gray-900 print:hidden dark:bg-amber-950/30 dark:text-amber-100">
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
      {!signed ? <ConferenceCard clientId={clientId} onSaved={() => void reload()} /> : null}

      {!signed ? (
        <section className={`${CARD} space-y-4 p-6 print:hidden`}>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Gerar contrato</h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="text-sm font-semibold text-gray-900 dark:text-gray-200">
              Faixa
              <select
                className={FIELD}
                value={effectiveTier}
                onChange={(event) => setTier(event.target.value as 'free' | 'paid')}
              >
                <option value="free">Gratuita</option>
                <option value="paid">Paga</option>
              </select>
            </label>

            {effectiveTier === 'paid' ? (
              <label className="text-sm font-semibold text-gray-900 dark:text-gray-200">
                Forma de pagamento
                <select
                  className={FIELD}
                  value={paymentMethod}
                  onChange={(event) => setPaymentMethod(event.target.value as 'boleto' | 'pix' | '')}
                >
                  <option value="">Escolher</option>
                  <option value="boleto">Boleto</option>
                  <option value="pix">Pix</option>
                </select>
              </label>
            ) : null}

            <label className="text-sm font-semibold text-gray-900 dark:text-gray-200">
              Prazo de entrega do QR (dias)
              <input
                type="number"
                min={1}
                max={180}
                className={FIELD}
                value={qrDeliveryDays}
                onChange={(event) => setQrDeliveryDays(event.target.value)}
              />
            </label>
          </div>

          {!state.checklist.ready ? (
            <div className="rounded-2xl border border-gray-200 bg-gray-50/60 p-4 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-200">
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

          <p className="rounded-2xl border border-gray-200 p-4 text-sm text-gray-900 dark:border-gray-800 dark:text-gray-200">
            A cláusula de comissão cria uma obrigação que o sistema ainda não sabe apurar. Não prometa
            extrato de comissão a este parceiro.
          </p>

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="cta"
              disabled={busy || !state.checklist.ready}
              onClick={() => act('generate')}
            >
              Gerar contrato
            </Button>

            {state.contract ? (
              <>
                <Button type="button" variant="outline" onClick={() => setPreview((value) => !value)}>
                  {preview ? 'Fechar a prévia' : 'Ver o contrato como o parceiro vai ver'}
                </Button>
                <Button type="button" variant="cta" disabled={busy} onClick={() => act('send')}>
                  Enviar para assinatura
                </Button>
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

      {/* The one panel that is NOT `print:hidden`: the document is what a print is for, and it
          drops the card's chrome on paper so nothing frames the instrument. */}
      {state.contract && preview ? (
        <section className={`${CARD} p-6 print:border-0 print:bg-transparent print:p-0 print:shadow-none`}>
          <ContractText snapshot={state.contract.snapshot} />
        </section>
      ) : null}

      {signingLink ? <SigningLinkCard link={signingLink} /> : null}

      {state.contract ? (
        <section className={`${CARD} p-6 print:hidden`}>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Trilha do aceite</h2>
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
            <Button type="button" variant="outline" disabled={busy} onClick={() => act('verify')}>
              Conferir integridade
            </Button>
            <a
              className="inline-flex h-10 items-center rounded-md border border-input px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-accent dark:text-gray-200"
              href={`/api/admin/clients/${clientId}/contract/pdf`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Abrir o PDF
            </a>
          </div>
        </section>
      ) : null}

      {message ? (
        <p
          role="status"
          className="rounded-2xl border border-gray-200 bg-white/70 p-4 text-sm text-gray-900 backdrop-blur-xl print:hidden dark:border-gray-800 dark:bg-gray-900/70 dark:text-gray-200"
        >
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
      <dt className="font-semibold text-gray-700 dark:text-gray-400">{label}</dt>
      <dd className="break-all text-gray-900 dark:text-gray-200">
        {value}
        {copyable ? <CopyButton value={value} size="compact" className="ml-2" /> : null}
      </dd>
    </>
  )
}

/**
 * The in-person conference of BR-B2B-022, item 3, WHERE THE OPERATOR IS BLOCKED.
 *
 * The evidence used to be registered only on the proposal review screen, so a client that was
 * never a proposal had nowhere to record it and the checklist item above pointed at a band that
 * did not exist for them. It is a fact about the client now (`partner.client_conferences`), and
 * it is filled in here, on the page that refuses the generation without it.
 *
 * NOTHING HERE VERIFIES A DOCUMENT, and the copy says so. What is stored is one named person
 * asserting what they saw, with `reviewed_by` and a date on it. A tick is not "Tuggi checked the
 * alvará"; it is "somebody at Tuggi says they had it in their hands".
 *
 * IT IS TWO TICKS AND NOTHING ELSE (operator, 2026-08-21: *"nao iremos pedir o numero do alvará,
 * só dar um check no cms"*). The licence number, the issuing municipality and the validity date
 * were three transcriptions off a piece of paper on every conference, and nothing read them
 * back. What went with the date is written on `ConferenceRecord`.
 */
function ConferenceCard({ clientId, onSaved }: { clientId: string; onSaved: () => void }) {
  const [conference, setConference] = useState<ConferenceRecord>(EMPTY_CONFERENCE)
  const [reviewed, setReviewed] = useState<{ at: string | null; byLabel: string | null }>({
    at: null,
    byLabel: null,
  })
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetch(`/api/admin/clients/${clientId}/conference`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('load failed'))))
      .then((data) => {
        if (!active) return
        setConference(data.conference ?? EMPTY_CONFERENCE)
        setReviewed({ at: data.reviewedAt ?? null, byLabel: data.reviewedByLabel ?? null })
        setLoaded(true)
      })
      .catch(() => {
        if (active) setLoaded(true)
      })
    return () => {
      active = false
    }
  }, [clientId])

  function toggle(kind: PartnerDocumentKind) {
    setConference((current) => ({
      ...current,
      documentsSeen:
        current.documentsSeen.indexOf(kind) >= 0
          ? current.documentsSeen.filter((seen) => seen !== kind)
          : current.documentsSeen.concat(kind),
    }))
  }

  async function save() {
    setSaving(true)
    setNote(null)
    try {
      const response = await fetch(`/api/admin/clients/${clientId}/conference`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(conference),
      })
      if (!response.ok) {
        setNote('Não foi possível registrar a conferência.')
        return
      }
      const data = (await response.json()) as { conference: ConferenceRecord }
      setConference(data.conference)
      setNote('Conferência registrada.')
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={`${CARD} space-y-4 p-6 print:hidden`}>
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Conferência presencial</h2>
        <p className="mt-1 text-sm text-gray-800 dark:text-gray-300">
          Marque o que você viu em mãos. Isto é o seu registro do que conferiu, e não uma verificação
          do documento pela Tuggi.
        </p>
      </div>

      <fieldset>
        <legend className="sr-only">Documentos conferidos</legend>
        {PARTNER_DOCUMENT_KINDS.map((kind) => (
          <label key={kind} className="mt-2 flex items-start gap-2 text-sm text-gray-900 dark:text-white">
            <Checkbox
              checked={conference.documentsSeen.indexOf(kind) >= 0}
              disabled={!loaded}
              onCheckedChange={() => toggle(kind)}
            />
            <span>
              {kind === 'business_license'
                ? 'Vi o alvará de funcionamento'
                : 'Vi o contrato social ou o documento de constituição'}
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        {/* `cta` and not the default: `bg-primary` is #00A8E8, and white on it measures 2.70:1
            against the 4.5:1 of WCAG AA. Every primary action on this page already uses `cta`
            (`bg-primary-800`) for that reason, and axe caught this one the moment it appeared. */}
        <Button type="button" variant="cta" disabled={saving || !loaded} onClick={() => void save()}>
          {saving ? 'Registrando…' : 'Registrar a conferência'}
        </Button>
        {note ? (
          <span role="status" className="text-sm text-gray-900 dark:text-gray-200">
            {note}
          </span>
        ) : null}
      </div>

      {reviewed.at ? (
        <p className="border-t border-gray-200 pt-2 text-xs text-gray-800 dark:border-gray-800 dark:text-gray-300">
          {reviewed.byLabel
            ? `Conferido por ${reviewed.byLabel} em ${formatDateTime(reviewed.at)}.`
            : `Conferido em ${formatDateTime(reviewed.at)}.`}{' '}
          Registrar de novo substitui este registro e passa a valer o seu nome.
        </p>
      ) : null}
    </section>
  )
}

interface SigningLink {
  url: string
  expiresAt: string | null
  recipientEmail: string | null
  emailed: boolean
}

/**
 * The link that was just minted, with the two ways out of this screen it actually needs.
 *
 * WHY WHATSAPP IS A BUTTON AND NOT AN INSTRUCTION. It is how the team talks to the partners,
 * and `wa.me` needs no integration, no number and no token of its own: it opens the app with
 * the message written and the operator picks the contact. Everything sensitive stays where it
 * already is — the link IS the credential, and this is the same link the e-mail carries.
 *
 * THE WARNING IS NOT DECORATION. The raw token is nowhere in the database, so leaving this
 * page loses it. Saying that beside the control is cheaper than an operator discovering it.
 */
function SigningLinkCard({ link }: { link: SigningLink }) {
  const message =
    'Olá! O contrato de parceria da Tuggi está pronto para assinatura. ' +
    `Você lê o texto completo e assina por este link: ${link.url}`

  return (
    <section className={`${CARD} p-6 print:hidden`}>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Link de assinatura</h2>

      <p className="mt-1 text-sm text-gray-800 dark:text-gray-300">
        {link.emailed
          ? `Enviado por e-mail para ${link.recipientEmail ?? 'o representante legal'}. Use o link abaixo para mandar também por WhatsApp ou por outro canal.`
          : 'O e-mail não saiu. Envie o link abaixo por WhatsApp ou por outro canal.'}
      </p>

      <p className="mt-3 break-all rounded-lg bg-gray-50 p-3 font-mono text-xs text-gray-900 dark:bg-gray-800 dark:text-gray-200">
        {link.url}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <CopyButton value={link.url} label="Copiar o link" />
        <a
          className="inline-flex h-10 items-center rounded-md border border-input px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-accent dark:text-gray-200"
          href={`https://wa.me/?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Enviar por WhatsApp
        </a>
      </div>

      <p className="mt-3 border-t border-gray-200 pt-2 text-xs text-gray-800 dark:border-gray-800 dark:text-gray-300">
        {link.expiresAt
          ? `O link vale até ${formatDateTime(link.expiresAt)}. Guarde-o agora, porque ele não fica salvo e sai da tela quando você a deixar. Enquanto o contrato não for assinado, enviar de novo gera um link novo e invalida este.`
          : 'Guarde o link agora, porque ele não fica salvo e sai da tela quando você a deixar. Enquanto o contrato não for assinado, enviar de novo gera um link novo e invalida este.'}
      </p>
    </section>
  )
}

/**
 * Copy, and say that it copied. A button that answers nothing leaves the operator pressing it
 * twice and pasting into the address bar to check.
 */
function CopyButton({
  value,
  label = 'Copiar',
  size = 'default',
  className = '',
}: {
  value: string
  label?: string
  /** `compact` is the inline chip beside a hash; `default` is a control of its own. */
  size?: 'default' | 'compact'
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard?.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // A clipboard the browser refuses is not an error worth a banner: the value is on
      // screen and selectable, which is the fallback the operator already knows.
    }
  }

  const shape =
    size === 'compact'
      ? 'rounded border border-gray-400 px-2 py-0.5 text-xs'
      : 'h-10 rounded-md border border-input px-4 py-2 text-sm font-semibold hover:bg-accent'

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-live="polite"
      className={`inline-flex items-center text-gray-900 dark:text-gray-200 ${shape} ${className}`}
    >
      {copied ? 'Copiado' : label}
    </button>
  )
}

'use client'

/**
 * The act of signing — DS-COMPONENTE-017, spec do `design` §4.2.
 *
 * TWO AFFIRMATIVE ACTS, AND NEITHER OF THEM IS SCROLLING. Releasing the button on scroll
 * is forbidden: it does not prove reading, it punishes screen readers, and at 360 px the
 * end of the text disappears. What counts is (1) a checkbox that is always born unchecked
 * plus the full name typed — the typing IS the signature — and (2) an INLINE panel, not a
 * modal, that repeats the parties, the version, the name and the role before the second
 * click. A modal over a long document on a phone hides exactly what should be re-read.
 *
 * The name that does not match the registration WARNS and does not block. Blocking there
 * stops a real signature because of somebody else's typo.
 *
 * THE RETRY BUTTON EXISTS BECAUSE THE SERVER DEDUPLICATES. `app/api/contract/[token]`
 * keys the acceptance on the contract, in the database, so a second request after a
 * network failure returns the FIRST acceptance — same stamp, same hash. That is the only
 * reason the copy may say "se já tiver dado certo, a gente não assina duas vezes"; without
 * the deduplication this button would not exist and the message would be the other one
 * (spec do `design`, §4.3).
 */

import { useRef, useState } from 'react'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_CONTROL, FIELD_LABEL, FIELD_HELP } from '@/components/partner-form/styles'
import { formatTaxId } from '@/lib/contract/snapshot'

export interface SigningReceipt {
  signerName: string
  signerRole: string
  acceptedAt: string
  recipientEmail: string
  documentHash: string | null
  verificationCode: string | null
}

interface SigningBlockProps {
  token: string
  legalName: string
  taxId: string
  templateVersion: string
  representativeName: string
  representativeRole: string
  onSigned: (receipt: SigningReceipt) => void
}

/** Accent- and case-insensitive, because "José" and "jose" are the same person. */
function looseEquals(a: string, b: string): boolean {
  const normalize = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
  return normalize(a) === normalize(b)
}

export function SigningBlock({
  token,
  legalName,
  taxId,
  templateVersion,
  representativeName,
  representativeRole,
  onSigned,
}: SigningBlockProps) {
  const [accepted, setAccepted] = useState(false)
  const [name, setName] = useState('')
  const [role, setRole] = useState(representativeRole)
  const [reviewing, setReviewing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [failed, setFailed] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const reviewRef = useRef<HTMLDivElement>(null)

  const nameDiverges = name.trim().length > 0 && !looseEquals(name, representativeName)
  const canReview = accepted && name.trim().length >= 3 && role.trim().length >= 2

  function review() {
    if (!canReview) {
      setProblem('Marque a caixa e escreva o seu nome completo para continuar.')
      return
    }
    setProblem(null)
    setReviewing(true)
    // The focus goes to the panel: the second act has to be where the person is looking.
    window.requestAnimationFrame(() => reviewRef.current?.focus())
  }

  async function confirm() {
    setSubmitting(true)
    setFailed(false)
    setProblem(null)

    try {
      const response = await fetch(`/api/contract/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: true, signerName: name.trim(), signerRole: role.trim() }),
      })

      const payload = (await response.json().catch(() => null)) as (SigningReceipt & { state?: string }) | null

      if (response.ok && payload?.acceptedAt) {
        onSigned(payload)
        return
      }

      if (response.status === 409 || response.status === 410) {
        setProblem('Este contrato não está mais aberto para assinatura. Responda o e-mail que a gente resolve.')
        return
      }

      setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section aria-labelledby="aceite" className="mx-auto mt-10 w-full max-w-3xl px-4">
      <h2 id="aceite" className="text-xl font-bold text-gray-900">
        Aceite
      </h2>
      <p className="mt-2 text-base text-gray-700">
        Quem aceita precisa ser a pessoa que representa o estabelecimento.
      </p>

      <label className="mt-6 flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-6 w-6 rounded border-input"
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
        />
        <span className="text-base font-semibold text-gray-900">
          Li o contrato inteiro e aceito os termos em nome de {legalName}.
        </span>
      </label>

      <div className="mt-6">
        <label className={FIELD_LABEL} htmlFor="signer-name">
          Digite o seu nome completo, como está no documento de constituição
        </label>
        <p className={FIELD_HELP} id="signer-name-help">
          É esta digitação que vale como a sua assinatura.
        </p>
        <input
          id="signer-name"
          className={FIELD_CONTROL}
          type="text"
          autoComplete="name"
          value={name}
          aria-describedby={nameDiverges ? 'signer-name-help signer-name-warning' : 'signer-name-help'}
          onChange={(event) => setName(event.target.value)}
        />
        {nameDiverges ? (
          <p id="signer-name-warning" role="status" className="mt-2 text-sm font-medium text-gray-900">
            Este nome está diferente do que consta no cadastro. Se você mudou de nome ou o cadastro está
            errado, responda o e-mail antes de assinar.
          </p>
        ) : null}
      </div>

      <div className="mt-6">
        <label className={FIELD_LABEL} htmlFor="signer-role">
          Seu cargo no estabelecimento
        </label>
        <p className={FIELD_HELP}>Já preenchido com o que você informou; pode corrigir.</p>
        <input
          id="signer-role"
          className={FIELD_CONTROL}
          type="text"
          autoComplete="organization-title"
          value={role}
          onChange={(event) => setRole(event.target.value)}
        />
      </div>

      {problem ? (
        <p role="alert" className="mt-4 text-sm font-medium text-destructive">
          {problem}
        </p>
      ) : null}

      {!reviewing ? (
        <button type="button" className={`${BUTTON_PRIMARY} mt-6`} onClick={review}>
          Revisar e assinar
        </button>
      ) : (
        <div
          ref={reviewRef}
          tabIndex={-1}
          className="mt-6 rounded-md border border-input bg-gray-50 p-4"
          aria-labelledby="revisao"
        >
          <h3 id="revisao" className="text-lg font-bold text-gray-900">
            Confira antes de assinar
          </h3>
          <p className="mt-2 text-base text-gray-900">
            Você está assinando o contrato de parceria de <strong>{legalName}</strong>, CNPJ{' '}
            <strong>{formatTaxId(taxId)}</strong>, na versão <strong>{templateVersion}</strong>, em nome de{' '}
            <strong>{name.trim()}</strong>, como <strong>{role.trim()}</strong>.
          </p>
          <p className="mt-2 text-base text-gray-700">
            Depois de confirmar, o aceite não se desfaz por aqui — para encerrar o contrato existe a
            cláusula de rescisão, que está no texto acima.
          </p>

          {failed ? (
            <div role="alert" className="mt-4 rounded-md border border-destructive p-3">
              <p className="text-base font-semibold text-destructive">
                Não conseguimos registrar a sua assinatura agora.
              </p>
              <p className="mt-1 text-base text-gray-900">
                Sua conexão pode ter caído. Toque em tentar de novo — se já tiver dado certo, a gente não
                assina duas vezes.
              </p>
            </div>
          ) : null}

          <div className="mt-4 space-y-3">
            <button
              type="button"
              className={BUTTON_PRIMARY}
              onClick={confirm}
              disabled={submitting}
              aria-busy={submitting}
            >
              {submitting ? 'Registrando a sua assinatura…' : failed ? 'Tentar de novo' : 'Confirmar assinatura'}
            </button>
            <button
              type="button"
              className={BUTTON_SECONDARY}
              onClick={() => setReviewing(false)}
              disabled={submitting}
            >
              Voltar e reler
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

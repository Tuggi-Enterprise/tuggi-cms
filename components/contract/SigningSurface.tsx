'use client'

/**
 * What the partner sees below the contract text — the acceptance block, or the receipt.
 *
 * Already signed shows the RECEIPT and no acceptance control at all (DS-COMPONENTE-017,
 * last edge case): reloading the link after signing must never offer a second signature,
 * even though the server would deduplicate it anyway. Two defences, and the one that
 * matters is the server's.
 */

import { useState } from 'react'
import { SigningBlock, type SigningReceipt } from './SigningBlock'
import { formatDateTime } from '@/lib/contract/snapshot'
import { BUTTON_SECONDARY } from '@/components/partner-form/styles'

interface SigningSurfaceProps {
  token: string
  legalName: string
  taxId: string
  templateVersion: string
  representativeName: string
  representativeRole: string
  initialReceipt: SigningReceipt | null
}

export function SigningSurface({ initialReceipt, ...props }: SigningSurfaceProps) {
  const [receipt, setReceipt] = useState<SigningReceipt | null>(initialReceipt)

  if (receipt) {
    return <Receipt token={props.token} legalName={props.legalName} taxId={props.taxId} receipt={receipt} />
  }

  return <SigningBlock {...props} onSigned={setReceipt} />
}

function Receipt({
  token,
  legalName,
  taxId,
  receipt,
}: {
  token: string
  legalName: string
  taxId: string
  receipt: SigningReceipt
}) {
  const [copied, setCopied] = useState(false)

  return (
    <section aria-labelledby="recibo" className="mx-auto mt-10 w-full max-w-3xl px-4">
      <h2 id="recibo" className="text-xl font-bold text-gray-900">
        Contrato assinado.
      </h2>
      <p className="mt-2 text-base text-gray-900">
        {legalName} · CNPJ {taxId}
      </p>
      <p className="mt-1 text-base text-gray-900">
        Assinado por <strong>{receipt.signerName}</strong> ({receipt.signerRole}) em{' '}
        <strong>{formatDateTime(receipt.acceptedAt)}</strong>.
      </p>
      <p className="mt-1 text-base text-gray-900">
        Enviamos uma cópia para <strong>{receipt.recipientEmail}</strong>.
      </p>

      <a className={`${BUTTON_SECONDARY} mt-6`} href={`/api/contract/${encodeURIComponent(token)}/pdf`}>
        Baixar o contrato assinado (PDF)
      </a>

      {receipt.verificationCode ? (
        <div className="mt-6 rounded-md border border-input p-4">
          <p className="text-base font-semibold text-gray-900">Código de verificação deste documento</p>
          <p className="mt-1 break-all font-mono text-base text-gray-900">{receipt.verificationCode}</p>
          <button
            type="button"
            className={`${BUTTON_SECONDARY} mt-3`}
            onClick={() => {
              navigator.clipboard?.writeText(receipt.documentHash ?? receipt.verificationCode ?? '')
              setCopied(true)
            }}
          >
            {copied ? 'Código copiado' : 'Copiar'}
          </button>
          <p className="mt-3 text-sm text-gray-700">
            Guarde este código junto com o PDF. Ele serve para provar que o arquivo não mudou depois da
            assinatura.
          </p>
        </div>
      ) : null}
    </section>
  )
}

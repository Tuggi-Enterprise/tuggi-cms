import { redirect } from 'next/navigation'
import { ContractText } from '@/components/contract/ContractText'
import { SigningSurface } from '@/components/contract/SigningSurface'
import { CONTRACT_LOCALE, contractPath } from '@/lib/contract/link'
import { formatTaxId } from '@/lib/contract/snapshot'
import { shortHash } from '@/lib/contract/hash'
import {
  canServeDocument,
  markOpened,
  resolveSigningToken,
  type SigningState,
} from '@/lib/services/partner-contract-service'
import { BUTTON_SECONDARY } from '@/components/partner-form/styles'

/**
 * The external half of the contract (#342). Public, no login: the signing token in the URL
 * is the credential (BR-B2B-026, item 2), and the person on the other side is a restaurant
 * owner reading from their phone.
 *
 * WHY THIS IS A SERVER COMPONENT AND NOT A CLIENT FETCH. The contract has to be real text
 * in the document, present on first paint, without JavaScript and without downloading
 * anything (DS-COMPONENTE-017 (a), CDC art. 46). Fetching it from the browser would put the
 * thing being signed behind a spinner. So the read happens here, keyed by the token, and
 * the only write goes to `app/api/contract/[token]`, which is rate limited and validates.
 *
 * That makes this file a public surface that reaches `service_role` through the service
 * module — the pairing `scripts/check-route-policies.ts` refuses inside `app/api`, and the
 * check does not see pages. It is written down here on purpose, and it holds for the same
 * three reasons the #341 service holds: the API of the module is closed and narrow, every
 * operation is keyed by a 256-bit token stored only as a hash, and nothing it exposes can
 * reach `core.clients`. The read is by token, and a token that does not resolve gets the
 * same page as one that never existed.
 *
 * The locale is pinned to `pt` by redirect, not by hope: `i18n.ts` falls back to `en`, and
 * this is a Brazilian instrument signed by a Brazilian legal representative.
 */

export const metadata = {
  title: 'Contrato de parceria — Tuggi',
  // A private link to one establishment, never a page for search.
  robots: { index: false, follow: false },
}

/** Nothing about a contract may be served from a cache shared with another token. */
export const dynamic = 'force-dynamic'

export default async function ContractSigningPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>
}) {
  const { locale, token } = await params

  if (locale !== CONTRACT_LOCALE) {
    redirect(contractPath(token))
  }

  const resolved = await resolveSigningToken(token)

  // Who may still see the document is decided in ONE place — `canServeDocument` — and the
  // PDF route reads the same function. What is per-state here is only the copy.
  if (!canServeDocument(resolved.state) || !resolved.contract) {
    const closed = CLOSED_COPY[resolved.state] ?? CLOSED_COPY.invalid
    return <Closed title={closed.title} detail={closed.detail} />
  }

  const contract = resolved.contract
  const snapshot = contract.snapshot
  const acceptance = resolved.acceptance ?? null

  if (resolved.state === 'open') {
    // For the trail only. It never gates anything, and it is written once.
    await markOpened(contract.id)
  }

  return (
    <main className="min-h-screen bg-white py-8">
      {/*
        THE THIRD WAY OF READING IT, and until now it was broken.
        
        The spec (§4.2) gives two: the text on the page and the PDF for filing, because
        CDC art. 46 does not let us bind somebody to what they could not read. There is a third
        that nobody designed and everybody uses — Ctrl+P — and it printed the buttons, the skip
        link and the acceptance form along with the instrument.
        
        `print:hidden` on the navigation leaves the DOCUMENT on the paper. The acceptance form
        is hidden by `SigningBlock` for the same reason: an unsigned form on paper is not a
        contract, and printing it invites somebody to sign a sheet that records nothing. The
        RECEIPT does print — a signed contract with its verification code is exactly what
        somebody files.
      */}
      <p className="mx-auto mb-6 w-full max-w-3xl px-4 text-base text-gray-700 print:hidden">
        Leia o contrato inteiro antes de aceitar. Ele está aqui embaixo por escrito, e você também pode
        baixar o PDF.
      </p>

      <div className="mx-auto mb-8 w-full max-w-3xl space-y-3 px-4 print:hidden">
        <a className={BUTTON_SECONDARY} href={`/api/contract/${encodeURIComponent(token)}/pdf`}>
          Baixar o PDF
        </a>
        <a className="block text-base text-primary-800 underline" href={acceptance ? '#recibo' : '#aceite'}>
          {acceptance ? 'Ir para o recibo' : 'Ir para o aceite'}
        </a>
      </div>

      <ContractText snapshot={snapshot} />

      <div className="mx-auto mt-8 w-full max-w-3xl px-4 print:hidden">
        <a className="text-base text-primary-800 underline" href="#top">
          Voltar ao topo
        </a>
      </div>

      <SigningSurface
        token={token}
        legalName={snapshot.partner.legalName}
        taxId={formatTaxId(snapshot.partner.taxId)}
        templateVersion={snapshot.templateVersion}
        representativeName={snapshot.partner.representativeName}
        representativeRole={snapshot.partner.representativeRole}
        initialReceipt={
          acceptance
            ? {
                signerName: acceptance.signer_name,
                signerRole: acceptance.signer_role,
                acceptedAt: acceptance.accepted_at,
                recipientEmail: acceptance.recipient_email,
                documentHash: acceptance.signed_document_hash,
                verificationCode: acceptance.signed_document_hash
                  ? shortHash(acceptance.signed_document_hash)
                  : null,
              }
            : null
        }
      />
    </main>
  )
}

/**
 * A closed link says WHY, in the words of the spec do `design` (§4.2), and a state with no
 * entry falls back to "not valid" — the least it can say. The unknown state is `invalid`,
 * never the document.
 */
const CLOSED_COPY: Partial<Record<SigningState, { title: string; detail: string }>> & {
  invalid: { title: string; detail: string }
} = {
  invalid: {
    title: 'Este link não é válido.',
    detail: 'Confira se você copiou o endereço inteiro do e-mail.',
  },
  expired: {
    title: 'Este link expirou.',
    detail: 'Responda o e-mail que a gente manda um novo — o contrato continua o mesmo.',
  },
  superseded: {
    title: 'Este contrato foi substituído por uma versão nova.',
    detail: 'Use o link do e-mail mais recente.',
  },
  terminated: {
    title: 'Este contrato foi encerrado.',
    detail: 'Se você acha que isso está errado, responda o e-mail que a gente confere.',
  },
}

/** A link that is not open says so and shows nothing else — no CNPJ, no name, no value. */
function Closed({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-white px-4 py-16">
      <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
      <p className="mt-3 text-base text-gray-700">{detail}</p>
    </main>
  )
}

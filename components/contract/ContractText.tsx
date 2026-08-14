/**
 * The contract as READABLE TEXT — #342, spec do `design` §4.2 and DS-COMPONENTE-017 (a).
 *
 * The document is in the DOM as text, one `<h2>` per clause, with an anchored index. The
 * PDF is a copy for filing and never the only way to read it: someone who cannot open a
 * PDF on their phone still has to be able to read what they are signing (CDC art. 46).
 *
 * NO ANCESTOR OF THIS TEXT MAY COMBINE `max-height` WITH `overflow: hidden`. It has
 * happened in this team — an answer that vanished at 384 px with no error at all — and
 * here the same bug means "accepted what they could not read". There is no scroll
 * container in this component, and adding one to a parent is the defect.
 *
 * Both surfaces render from here: the partner's page and the operator's preview. One
 * document, two presentations — the PDF walks the same `renderClauses` array.
 *
 * The copy is Portuguese and is not translated. This contract is a Brazilian instrument —
 * CNPJ, alvará, MP 2.200-2 — and the spec pins both surfaces to `pt` (§8.3); putting the
 * strings in `messages/en.json` would claim a translation the `design` never wrote.
 */

import { formatDate, formatTaxId, type ContractSnapshot } from '@/lib/contract/snapshot'
import { renderClauses, templateByVersion } from '@/lib/contract/template'

export function ContractText({ snapshot }: { snapshot: ContractSnapshot }) {
  const template = templateByVersion(snapshot.templateVersion)
  const clauses = renderClauses(snapshot)

  return (
    <article className="mx-auto w-full max-w-3xl px-4 text-base leading-relaxed text-gray-900">
      <header className="border-b border-gray-300 pb-4">
        <h1 className="text-2xl font-bold">{template?.title ?? 'Contrato de parceria — Tuggi'}</h1>
        <p className="mt-2 text-base text-gray-700">
          {snapshot.partner.legalName} · CNPJ {formatTaxId(snapshot.partner.taxId)}
        </p>
        <p className="text-base text-gray-700">
          Versão {snapshot.templateVersion}, de {formatDate(snapshot.generatedAt)}
        </p>
      </header>

      <nav aria-label="Índice das cláusulas" className="mt-6">
        <h2 className="text-lg font-semibold">Índice</h2>
        <ol className="mt-2 space-y-1">
          {clauses.map((clause) => (
            <li key={clause.id}>
              <a className="text-primary-800 underline" href={`#clausula-${clause.id}`}>
                {clause.number}. {clause.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-8 space-y-6">
        {clauses.map((clause) => (
          <section key={clause.id} aria-labelledby={`clausula-${clause.id}`}>
            <h2 id={`clausula-${clause.id}`} className="text-lg font-semibold">
              {clause.number}. {clause.title}
            </h2>
            {clause.paragraphs.map((paragraph, index) => (
              <p key={index} className="mt-3">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>
    </article>
  )
}

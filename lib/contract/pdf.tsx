/**
 * The PDF of the contract — #342.
 *
 * WHY THIS LIBRARY. The CMS runs on Vercel and headless Chrome is out (card #342,
 * "Restrições técnicas"). `@react-pdf/renderer` 4.6.1 is a pure-JavaScript renderer with
 * its own layout engine: no browser, no native module, no binary to ship. It documents
 * `renderToBuffer` for exactly this — producing the bytes on a Node server
 * (https://react-pdf.org/advanced, "Node"). The two things it buys over a low-level PDF
 * writer are the two a long legal document cannot do without: automatic line wrapping and
 * automatic pagination.
 *
 * It also needs no font file. The default family is Helvetica, one of the PDF standard 14,
 * whose metrics ship inside the package — so nothing has to be traced into the Vercel
 * Function bundle for the accented Portuguese in these clauses to come out right.
 *
 * THE RENDER IS NOT DETERMINISTIC, AND THAT IS DESIGNED AROUND, NOT FOUGHT. Every PDF
 * carries a creation timestamp, so rendering the same snapshot twice yields two different
 * byte strings and two different hashes. Therefore the artefact is produced ONCE, stored,
 * and hashed as stored — `Conferir integridade` re-hashes the stored file and compares it
 * with the recorded hash. It never re-renders. Anyone "improving" this into a re-render
 * comparison turns a green check into a permanent red one.
 *
 * THE DOCUMENT CARRIES NO JUDGEMENT ABOUT OUR OWN DRAFT (BR-B2B-026, item 4). Until
 * 2026-08-17 the pre-signature page opened with a `MINUTA — pendente de revisão jurídica`
 * banner saying the contract "não pode ser enviado para assinatura", written when
 * `sendForSignature` really did refuse. That gate came out by decision of the operator, so
 * the banner survived as a claim contradicted by the very act of the partner reading it —
 * on the copy the partner downloads through the signing link. The state of our internal
 * review is not a fact about the instrument, and it is not printed here. Do not add it back.
 */

import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import {
  formatDate,
  formatDateTime,
  formatFee,
  formatTaxId,
  type ContractSnapshot,
} from './snapshot'
import { renderClauses, templateByVersion } from './template'
import { SUMMARY_DISCLAIMER, SUMMARY_TITLE, buildContractSummary } from './summary'

/**
 * What the acceptance appendix prints. Every field is a fact of the trail.
 *
 * THE SIGNER'S IP AND USER AGENT ARE DELIBERATELY ABSENT (#390). They are recorded — in
 * `core.partner_contract_acceptances`, whose rows the database guard makes immutable — and
 * the operator reads them on the internal surface, `GET /api/admin/clients/[clientId]/contract`.
 * What they are not is printed in the artefact the partner downloads, because that artefact
 * travels: it is served by a link that lives in two e-mails forever and reaches whoever
 * inherits a commercial mailbox. The legal proof of the acceptance is the hash and the
 * immutable row (MP 2.200-2, art. 10, §2º), not a line of network telemetry in a footer, so
 * publishing them buys nothing and exposes the signer. Do not add them back here.
 */
export interface AcceptanceStamp {
  signerName: string
  signerRole: string
  acceptedAt: string
  recipientEmail: string
  /** SHA-256 of the unsigned PDF — the exact document that was displayed and accepted. */
  documentHash: string
}

const styles = StyleSheet.create({
  page: { paddingTop: 56, paddingBottom: 64, paddingHorizontal: 56, fontSize: 10, lineHeight: 1.5, color: '#1a1a1a' },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  subtitle: { fontSize: 9, color: '#4a4a4a', marginBottom: 20 },
  clauseTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 6 },
  paragraph: { marginBottom: 6, textAlign: 'justify' },
  footer: { position: 'absolute', bottom: 32, left: 56, right: 56, fontSize: 8, color: '#6a6a6a' },
  stampRow: { flexDirection: 'row', marginBottom: 3 },
  stampLabel: { width: 150, color: '#4a4a4a' },
  stampValue: { flex: 1 },
  mono: { fontFamily: 'Courier', fontSize: 8 },
  summary: { borderWidth: 1, borderColor: '#1a1a1a', padding: 10, marginBottom: 8 },
  summaryRow: { marginBottom: 6 },
  summaryLabel: { fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  summaryBullet: { marginLeft: 10, marginBottom: 1 },
  summaryNote: { fontSize: 8, color: '#4a4a4a', marginTop: 6 },
  restrictive: { borderWidth: 1.5, borderColor: '#1a1a1a', padding: 10, marginTop: 10 },
  restrictiveFlag: { fontSize: 8, fontFamily: 'Helvetica-Bold', letterSpacing: 0.5 },
})

function ContractDocument({
  snapshot,
  acceptance,
}: {
  snapshot: ContractSnapshot
  acceptance?: AcceptanceStamp
}) {
  const template = templateByVersion(snapshot.templateVersion)
  const clauses = renderClauses(snapshot)
  const summary = buildContractSummary(snapshot)

  return (
    <Document
      title={`Contrato de parceria — ${snapshot.partner.legalName}`}
      author={snapshot.provider.legalName}
      subject={`Versão ${snapshot.templateVersion}`}
    >
      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.title}>{template?.title ?? 'Contrato de parceria — Tuggi'}</Text>
        <Text style={styles.subtitle}>
          {snapshot.partner.legalName} · CNPJ {formatTaxId(snapshot.partner.taxId)} · versão{' '}
          {snapshot.templateVersion}, de {formatDate(snapshot.generatedAt)}
        </Text>

        {/*
          O MESMO QUADRO DA TELA, NO ARQUIVO. Ter o resumo só numa das duas superfícies faria o
          que a pessoa leu diferir do que ela arquivou — e o quadro sai do mesmo `snapshot` que
          as cláusulas, então não diverge delas nem aqui.
        */}
        <View style={styles.summary} wrap={false}>
          <Text style={styles.clauseTitle}>{SUMMARY_TITLE}</Text>
          {summary.map((row) => (
            <View key={row.id} style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{row.label}</Text>
              {row.points.map((point, index) => (
                <Text key={index} style={styles.summaryBullet}>
                  {`\u2022 ${point}`}
                </Text>
              ))}
            </View>
          ))}
          <Text style={styles.summaryNote}>{SUMMARY_DISCLAIMER}</Text>
        </View>

        {clauses.map((clause) => (
          <View key={clause.id} style={clause.restrictive ? styles.restrictive : undefined} wrap>
            {/* O destaque vai para o arquivo também: ele é medida do art. 424 do Código Civil,
                e vale sobre o instrumento, não sobre a tela. */}
            {clause.restrictive ? (
              <Text style={styles.restrictiveFlag}>ATENÇÃO — ESTA CLÁUSULA LIMITA OS SEUS DIREITOS</Text>
            ) : null}
            <Text style={styles.clauseTitle}>
              {clause.number}. {clause.title}
            </Text>
            {clause.paragraphs.map((paragraph, index) => (
              <Text key={index} style={styles.paragraph}>
                {paragraph}
              </Text>
            ))}
          </View>
        ))}

        {acceptance ? <AcceptanceAppendix snapshot={snapshot} acceptance={acceptance} /> : null}

        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `${snapshot.partner.legalName} · CNPJ ${formatTaxId(snapshot.partner.taxId)} · ` +
            `modelo ${snapshot.templateVersion} · página ${pageNumber} de ${totalPages}`
          }
        />
      </Page>
    </Document>
  )
}

/**
 * The proof, printed inside the archived copy.
 *
 * `documentHash` here is the hash of the document WITHOUT this appendix — the bytes the
 * signer actually read. A document cannot carry its own hash, and pretending otherwise is
 * how a trail stops proving anything.
 */
function AcceptanceAppendix({
  snapshot,
  acceptance,
}: {
  snapshot: ContractSnapshot
  acceptance: AcceptanceStamp
}) {
  const rows: [string, string][] = [
    ['Assinado por', `${acceptance.signerName} (${acceptance.signerRole})`],
    ['Em nome de', `${snapshot.partner.legalName} — CNPJ ${formatTaxId(snapshot.partner.taxId)}`],
    ['Data e hora', formatDateTime(acceptance.acceptedAt)],
    ['E-mail do convite', acceptance.recipientEmail],
    ['Versão do modelo', snapshot.templateVersion],
    ['Valor aceito', snapshot.isCourtesy ? 'Cortesia, sem mensalidade' : formatFee(snapshot.monthlyFeeCents)],
  ]

  return (
    <View wrap={false}>
      <Text style={styles.clauseTitle}>Termo de aceite eletrônico</Text>
      <Text style={styles.paragraph}>
        Este termo registra o aceite eletrônico do contrato acima, na forma da cláusula de aceite
        eletrônico e do art. 10, §2º, da Medida Provisória nº 2.200-2/2001.
      </Text>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.stampRow}>
          <Text style={styles.stampLabel}>{label}</Text>
          <Text style={styles.stampValue}>{value}</Text>
        </View>
      ))}
      <View style={styles.stampRow}>
        <Text style={styles.stampLabel}>SHA-256 do documento aceito</Text>
        <Text style={[styles.stampValue, styles.mono]}>{acceptance.documentHash}</Text>
      </View>
    </View>
  )
}

/** The bytes. One call, one artefact — store what comes out of here and hash that. */
export async function renderContractPdf(
  snapshot: ContractSnapshot,
  acceptance?: AcceptanceStamp
): Promise<Uint8Array> {
  const buffer = await renderToBuffer(<ContractDocument snapshot={snapshot} acceptance={acceptance} />)
  return new Uint8Array(buffer)
}

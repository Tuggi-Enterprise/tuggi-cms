/**
 * O que o parceiro está aceitando, em seis linhas — e por que ele é derivado, nunca escrito.
 *
 * O PROBLEMA QUE ELE RESOLVE. O contrato tem 1.587 palavras e 17 cláusulas. Para saber quanto
 * paga, quando vence e como sai, o dono do restaurante lê as cláusulas 8, 9 e 10 inteiras, no
 * celular. A leitura estava garantida (o texto é real, o índice é ancorado, nada é cortado por
 * `max-height`) — o que faltava era a resposta rápida antes dela.
 *
 * POR QUE NADA AQUI É TEXTO FIXO. Um resumo escrito à mão diverge da cláusula no dia em que a
 * cláusula muda, e num contrato de adesão o que diverge é lido CONTRA quem redigiu (art. 423 do
 * Código Civil). Derivado do mesmo `snapshot` que as cláusulas, ele não pode divergir: é a mesma
 * fonte, formatada duas vezes. Feito assim, o resumo vira prova de transparência; feito à mão,
 * vira munição.
 *
 * CADA LINHA APONTA PARA A CLÁUSULA QUE MANDA. `clauseId` vira a âncora `#clausula-{id}` que já
 * existe na página, então o resumo não substitui a leitura — ele encurta o caminho até o
 * parágrafo que decide. E o rodapé diz isso com todas as letras: em caso de divergência, valem
 * as cláusulas.
 *
 * NÃO É TRADUZIDO, pelo mesmo motivo do resto do documento: é instrumento brasileiro, e a spec
 * do `design` (§8.3) fixa as duas superfícies em `pt`.
 */

import { formatCommissionRate, formatFee, type ContractSnapshot } from './snapshot'
import { ADJUSTMENT_INDEX, DUE_DAY_OF_MONTH, TERMINATION_NOTICE_DAYS } from './template'

export interface SummaryRow {
  /** Estável; o teste cita este id, nunca a posição. */
  id: string
  /** A pergunta que o parceiro está fazendo, na voz dele. */
  label: string
  value: string
  /** A cláusula que governa a linha — vira `#clausula-{id}` na página. */
  clauseId: string
}

/** A ressalva que impede o resumo de virar o contrato. Fica ao pé do quadro, sempre. */
export const SUMMARY_DISCLAIMER =
  'Este resumo é uma ajuda de leitura e não substitui o contrato. Em caso de divergência, ' +
  'valem as cláusulas abaixo.'

export const SUMMARY_TITLE = 'O que você está aceitando'

export function buildContractSummary(snapshot: ContractSnapshot): SummaryRow[] {
  const paid = snapshot.tier === 'paid'

  const price = !paid
    ? 'Nada. A faixa gratuita não tem mensalidade.'
    : snapshot.isCourtesy
      ? `Nada, enquanto durar a cortesia (${snapshot.courtesyReason}).`
      : `${formatFee(snapshot.monthlyFeeCents)} por mês. Uma vez por ano o valor pode subir, no ` +
        `máximo pela inflação do período (${ADJUSTMENT_INDEX}) — nunca mais que isso.`

  const when = !paid || snapshot.isCourtesy
    ? 'Não há cobrança.'
    : `Vence todo dia ${DUE_DAY_OF_MONTH}. A primeira cobrança só vem depois que o seu ` +
      `estabelecimento estiver no ar no aplicativo — nada é cobrado antes disso.`

  return [
    {
      id: 'what',
      label: 'O que é',
      value: paid
        ? 'O seu estabelecimento entra no aplicativo da Tuggi, e o turista que passa perto ouve ' +
          'o nome, a direção e uma descrição do lugar, escrita e narrada pela Tuggi.'
        : 'O seu estabelecimento entra no aplicativo da Tuggi, e o turista que passa perto ouve ' +
          'o nome e a direção do lugar.',
      clauseId: 'object',
    },
    { id: 'price', label: 'Quanto você paga', value: price, clauseId: paid ? 'price_and_payment' : 'object' },
    { id: 'due', label: 'Quando vence', value: when, clauseId: paid ? 'price_and_payment' : 'term' },
    {
      id: 'commission',
      label: 'Quanto você recebe',
      value:
        `${formatCommissionRate(snapshot.commissionRate)} da receita líquida dos turistas que ` +
        `chegarem pelo seu QR Code. A Tuggi manda o demonstrativo até o dia 10 e paga até o ` +
        `último dia útil do mês.`,
      clauseId: 'commission',
    },
    {
      id: 'duties',
      label: 'O que você faz',
      value:
        'Mantém o QR Code e o display à vista do público enquanto o contrato durar, e avisa a ' +
        'Tuggi se mudar endereço, razão social, representante ou a regularidade do ' +
        'estabelecimento.',
      clauseId: 'partner_obligations',
    },
    {
      id: 'exit',
      label: 'Como você sai',
      value:
        // "Não há multa" precisa dizer multa DE QUÊ: a v2 criou multa de mora sobre parcela
        // atrasada, e um resumo ambíguo sobre isso é exatamente o que o art. 423 lê contra nós.
        `Quando quiser, avisando por e-mail com ${TERMINATION_NOTICE_DAYS} dias de antecedência. ` +
        `Não há multa por sair e não há tempo mínimo de permanência.`,
      clauseId: 'term',
    },
  ]
}

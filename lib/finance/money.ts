/**
 * DINHEIRO EM TELA — e por que `formatFee` não serve aqui.
 *
 * `lib/contract/snapshot.ts:formatFee` é do CONTRATO, e o contrato tem exatamente uma moeda por
 * decisão de negócio: *"the only currency of this contract is the real"* (BR-B2B-017, 1º caso de
 * borda). O financeiro tem outra: a compra guarda a moeda dela e nada converte, porque há
 * parceiros com NIF/NIPC/VAT no cadastro e uma compra em EUR é questão de tempo.
 *
 * Chamar `formatFee` num total em EUR imprimiria `R$` sobre euros — um erro que ninguém nota
 * até alguém somar. Então são duas funções, cada uma com a sua regra, e nenhuma é cópia da outra.
 *
 * `null` IMPRIME `—` E NÃO `R$ 0,00`. Ausência de custo e custo zero são fatos diferentes em todo
 * este módulo, e a tela é o último lugar onde eles poderiam se fundir.
 *
 * MINUTOS NÃO ESTÃO AQUI. A forma `5 h 20 min` tem dono — `lib/format/duration.ts`, por spec,
 * incluindo a decisão de não traduzir `h` e `min` — e `formatDurationOrDash` já devolve `—` para
 * ausente. A tabela chama aquela função diretamente.
 *
 * Puro: sem fetch, sem Supabase, sem React.
 */

export function formatMoney(cents: number | null, currency: string): string {
  if (cents === null || !Number.isFinite(cents)) return '—'
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100)
  } catch {
    // Moeda que o Intl não conhece: imprime o código ao lado do número em vez de estourar.
    return `${currency} ${(cents / 100).toFixed(2)}`
  }
}

/** Um número, ou `—`. O mesmo contrato de ausência, para contagens. */
export function formatCount(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('pt-BR').format(value)
}

/**
 * O QUE O OPERADOR DIGITOU, EM CENTAVOS — ou `null`.
 *
 * POR QUE ISTO EXISTE, E É UM DEFEITO MEDIDO. Os formulários faziam
 * `Number(valor.replace(',', '.'))`, e em 2026-09-01 o operador não conseguiu cadastrar uma
 * compra. Duas falhas na mesma linha:
 *
 *   `1.000,00`  → `1.000.00` → NaN  → 400, e a tela só dizia "não foi possível salvar";
 *   `1.000`     → `1`               → R$ 0,01 ACEITO EM SILÊNCIO como o valor da compra.
 *
 * A segunda é a cara: R$ 1.000,00 lançado como um centavo produziria um custo unitário mil vezes
 * menor, sem 400, sem aviso, e o erro só apareceria como um parceiro suspeitosamente barato.
 *
 * O PONTO SOZINHO É AMBÍGUO, E A DESAMBIGUAÇÃO É POR CONTAGEM DE DÍGITOS. `1.000` é mil e `1.00`
 * é um: centavo tem no máximo dois dígitos, então três dígitos depois do último ponto só podem
 * ser milhar. Não há chute aqui — há uma regra, e ela cobre o teclado brasileiro e o americano.
 *
 * MAIS DE DUAS CASAS É RECUSADO, não arredondado. `1,005` é erro de digitação, e arredondar
 * dinheiro em silêncio é exatamente o que produziu o defeito acima.
 */
export function parseMoneyToCents(raw: string): number | null {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return null

  // Símbolo de moeda e espaços (inclusive o não separável que vem de copiar e colar) saem antes.
  const cleaned = trimmed.replace(/[R$\s ]/g, '')
  if (!/^-?[\d.,]+$/.test(cleaned)) return null

  const negative = cleaned.startsWith('-')
  const digitsOnly = cleaned.replace('-', '')

  const lastComma = digitsOnly.lastIndexOf(',')
  const lastDot = digitsOnly.lastIndexOf('.')

  let decimalAt = -1
  if (lastComma >= 0 && lastDot >= 0) {
    // Os dois presentes: o ÚLTIMO é o decimal, o outro é milhar. Cobre `1.000,00` e `1,000.00`.
    decimalAt = Math.max(lastComma, lastDot)
  } else if (lastComma >= 0) {
    decimalAt = lastComma
  } else if (lastDot >= 0) {
    // Ponto sozinho: três dígitos depois dele é milhar (`1.000`), o resto é decimal (`1.00`).
    decimalAt = digitsOnly.length - lastDot - 1 === 3 ? -1 : lastDot
  }

  const whole = (decimalAt >= 0 ? digitsOnly.slice(0, decimalAt) : digitsOnly).replace(/[.,]/g, '')
  const fraction = decimalAt >= 0 ? digitsOnly.slice(decimalAt + 1) : ''

  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) return null
  if (fraction.length > 2) return null
  if (whole === '' && fraction === '') return null

  const cents = Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0') || '0')
  if (!Number.isSafeInteger(cents)) return null
  return negative ? -cents : cents
}

/**
 * A GUARDA DE ENTRADA DAS ROTAS DO FINANCEIRO — os mesmos tetos, lidos por todas elas.
 *
 * POR QUE NUM ARQUIVO SÓ. São quatro rotas que recebem dinheiro, data e moeda, e um teto
 * duplicado é um teto que diverge: a compra recusaria R$ 10.000.000,01 e o custo fixo aceitaria.
 * O repositório não usa zod em rota (nenhuma rota de `app/api/**` importa), então a validação é
 * manual e explícita — e explícita não significa repetida.
 *
 * NÃO CONVERTE NADA. `CURRENCY` só confere o formato ISO 4217; nenhuma função aqui traduz moeda,
 * arredonda dinheiro ou preenche um campo ausente. Ausente volta `null` e a rota decide.
 *
 * Puro: sem fetch, sem Supabase, sem React.
 */

/** R$ 10.000.000,00 em centavos. Um teto, não uma expectativa: dígito a mais é erro de digitação. */
export const AMOUNT_MAX = 1_000_000_000
export const UNITS_MAX = 1_000_000
export const TEXT_MAX = 200
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
/** ISO 4217: três letras. A rota compara com isto e nunca converte. */
export const CURRENCY = /^[A-Z]{3}$/
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Um inteiro, ou `null`.
 *
 * `null` para tudo que não é inteiro — inclusive `1.5` e `"1.5"`. Um `Math.round` aqui aceitaria
 * meio centavo em silêncio, e meio centavo aceito em silêncio é como um total fecha errado.
 */
export function toInteger(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isInteger(raw) ? raw : null
  if (typeof raw !== 'string' || raw.trim() === '') return null
  if (!/^-?\d+$/.test(raw.trim())) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isInteger(parsed) ? parsed : null
}

/** Um número positivo com casas — a quantidade de uma receita (2 QR, 1,5 metro). */
export function toPositiveNumber(raw: unknown): number | null {
  const parsed = typeof raw === 'number' ? raw : Number.parseFloat(String(raw))
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

/** Texto aparado e cortado no teto. Vazio vira `null`, porque vazio não é um valor. */
export function text(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().slice(0, TEXT_MAX)
  return trimmed || null
}

/** Um valor em centavos dentro do teto, ou `null`. */
export function toAmountCents(raw: unknown): number | null {
  const parsed = toInteger(raw)
  if (parsed === null || parsed < 0 || parsed > AMOUNT_MAX) return null
  return parsed
}

/** A moeda normalizada em maiúsculas, ou `null` quando não é ISO 4217. */
export function toCurrency(raw: unknown, fallback = 'BRL'): string | null {
  if (raw === undefined || raw === null || raw === '') return fallback
  if (typeof raw !== 'string') return null
  const upper = raw.toUpperCase()
  return CURRENCY.test(upper) ? upper : null
}

/** Uma data `YYYY-MM-DD`, ou `null`. */
export function toIsoDate(raw: unknown): string | null {
  return typeof raw === 'string' && ISO_DATE.test(raw) ? raw : null
}

/**
 * O NOME DE UM PRODUTO, VIRANDO ID — minúsculas, sem acento, com sublinhado.
 *
 * O id é derivado e não digitado porque ele NUNCA muda depois: ele aparece em `product_recipe`,
 * `order_shipment`, `purchases` e em toda linha de `material_consumption` já congelada. Deixar
 * alguém digitá-lo convidaria um `Display Mesa` e um `display-mesa` a coexistirem.
 *
 * Devolve `null` quando não sobra nada — um nome só de símbolos não vira id.
 */
export function slugify(name: string): string | null {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
  return slug || null
}

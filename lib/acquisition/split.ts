import type {
  AcquisitionCity,
  AcquisitionCountry,
  AcquisitionSummary,
} from '@/lib/services/acquisition-service'

/**
 * A régua da tela de aquisição, em TS puro para ser testável sem montar nada.
 *
 * O erro que estas funções existem para impedir: somar lugar identificado com
 * lacuna de dado. São três estados com causas e consertos diferentes —
 *
 *   located / identified  → resolvido pelo nosso catálogo de fronteiras
 *   outside_boundaries    → tem coordenada, o país/município não está no catálogo;
 *                           conserta importando boundary (ou pelo geocode_cache)
 *   without_origin        → não tem coordenada; não tem conserto retroativo
 *
 * Uma linha "sem cidade: 53" que junta os dois últimos faz o operador procurar
 * bug de captura onde o problema é catálogo incompleto.
 */

export interface Split<T> {
  /** lugares de verdade, que podem ser rankeados entre si */
  real: T[]
  /** lacunas, que aparecem à parte e nunca entram no ranking */
  gaps: T[]
}

export function splitCities(cities: AcquisitionCity[]): Split<AcquisitionCity> {
  return {
    real: cities.filter((c) => c.status === 'located'),
    gaps: cities.filter((c) => c.status !== 'located'),
  }
}

export function splitCountries(countries: AcquisitionCountry[]): Split<AcquisitionCountry> {
  return {
    real: countries.filter((c) => c.status === 'identified'),
    gaps: countries.filter((c) => c.status !== 'identified'),
  }
}

/**
 * Maior valor para escalar as barras. Só os lugares reais entram: com a lacuna
 * dentro, uma barra de "sem cidade" maior que a de Cabo Frio esmagaria todas as
 * cidades de verdade contra a esquerda.
 */
export function rankMax<T extends { total: number }>(rows: T[]): number {
  return Math.max(1, ...rows.map((r) => r.total))
}

/**
 * Média diária. Divide pelos dias decorridos, não pelos dias do mês: no mês
 * corrente, dividir por 31 no dia 3 mostraria uma queda que não existe.
 */
export function dailyAverage(summary: Pick<AcquisitionSummary, 'total' | 'daysElapsed'>): number {
  return summary.total / Math.max(1, summary.daysElapsed)
}

/**
 * Antes de maio/2026 a drive.user_location_history mal existia — quase toda
 * conta anterior fica sem origem, e nenhum ping cai dentro de 1 h da criação.
 * A tela avisa em vez de deixar o operador ler lacuna como ausência de cadastro.
 */
export const ORIGIN_COVERAGE_START = '2026-05-01'

export function hasOriginCoverage(month: string): boolean {
  return month >= ORIGIN_COVERAGE_START
}

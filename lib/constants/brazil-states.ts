/**
 * The 27 Brazilian federative units, in the order they are offered in a select.
 *
 * Canonical list for anything that has to *offer* a UF. There is a second, private
 * copy of this fact inside `lib/services/trigger-points-google/core/boundary-detector.ts`
 * (`normalizeBrazilianState`), which maps abbreviation → full name for POI matching and
 * is not reachable from here. It was left alone on purpose: it returns accented names
 * for abbreviations and unaccented ones for full names, so folding it into this list
 * would change how POI boundaries match — a different card, reported in #341.
 */

export interface BrazilState {
  /** UF code, uppercase — what goes in `core.clients.state`. */
  code: string
  /** Full name, for the option label. */
  name: string
}

export const BRAZIL_STATES: readonly BrazilState[] = [
  { code: 'AC', name: 'Acre' },
  { code: 'AL', name: 'Alagoas' },
  { code: 'AP', name: 'Amapá' },
  { code: 'AM', name: 'Amazonas' },
  { code: 'BA', name: 'Bahia' },
  { code: 'CE', name: 'Ceará' },
  { code: 'DF', name: 'Distrito Federal' },
  { code: 'ES', name: 'Espírito Santo' },
  { code: 'GO', name: 'Goiás' },
  { code: 'MA', name: 'Maranhão' },
  { code: 'MT', name: 'Mato Grosso' },
  { code: 'MS', name: 'Mato Grosso do Sul' },
  { code: 'MG', name: 'Minas Gerais' },
  { code: 'PA', name: 'Pará' },
  { code: 'PB', name: 'Paraíba' },
  { code: 'PR', name: 'Paraná' },
  { code: 'PE', name: 'Pernambuco' },
  { code: 'PI', name: 'Piauí' },
  { code: 'RJ', name: 'Rio de Janeiro' },
  { code: 'RN', name: 'Rio Grande do Norte' },
  { code: 'RS', name: 'Rio Grande do Sul' },
  { code: 'RO', name: 'Rondônia' },
  { code: 'RR', name: 'Roraima' },
  { code: 'SC', name: 'Santa Catarina' },
  { code: 'SP', name: 'São Paulo' },
  { code: 'SE', name: 'Sergipe' },
  { code: 'TO', name: 'Tocantins' },
] as const

export const BRAZIL_STATE_CODES: readonly string[] = BRAZIL_STATES.map((state) => state.code)

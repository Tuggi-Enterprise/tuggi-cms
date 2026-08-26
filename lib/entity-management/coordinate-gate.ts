/**
 * Which abas do drawer só existem depois que alguém pôs o pino no mapa — e o que fazer quando
 * um deep link pede uma delas antes disso.
 *
 * O DEFEITO QUE ISTO FECHA, relatado pelo operador em 2026-08-26. O local que a aprovação do
 * parceiro cria nasce SEM coordenada e COM endereço (`lib/partner-form/place-prefill`, "o que é
 * deliberadamente deixado vazio"). Abrir esse local em `Limite & Triggers` mostrava um painel
 * vermelho dizendo `erro de sistema do fetch` — a tela chamando de defeito da máquina o estado
 * normal do registro que ela mesma acabou de criar, e sem mapa nenhum para resolver. Medido em
 * `Cozi +` (`56744ca1-9637-4e97-bec2-f93ac1e4158f`): `formatted_address` preenchido,
 * `core.attraction_coordinate` sem linha.
 *
 * A COORDENADA É PRÉ-REQUISITO, NÃO PENDÊNCIA PARALELA. O trigger point é um ponto a uma
 * distância e a um rumo DO local, e o limite é um polígono em volta dele: sem o centro, as duas
 * abas não têm de onde partir. Por isso o pedido de aba é rebaixado para `details`, que é onde o
 * mapa já abre sobre o endereço geocodificado e onde o clique do curador vira a coordenada
 * (#371, e `LocationPicker` é o único caminho de escrita).
 *
 * ELE REBAIXA, NÃO BLOQUEIA. O operador continua podendo clicar em `Limite & Triggers` — e lá
 * encontra a frase que diz o que falta e o botão que o leva a `Detalhes`. Uma aba que some é uma
 * aba que o operador procura.
 */

/** As abas do `EntityManagementDrawer`. Definidas aqui para o drawer e o portão concordarem. */
export type EntityTab = 'details' | 'description' | 'narration-audio' | 'trigger-points'

/**
 * As abas que precisam da coordenada do registro para significar alguma coisa.
 *
 * `description` e `narration-audio` NÃO estão aqui de propósito: escrever a descrição e gerar o
 * áudio de um local sem pino é trabalho válido e adiantado, e barrá-lo seria inventar uma
 * dependência que o produto não tem.
 */
export const COORDINATE_DEPENDENT_TABS: readonly EntityTab[] = ['trigger-points']

/** Se esta aba precisa que o registro já tenha coordenada. */
export function tabNeedsCoordinate(tab: EntityTab): boolean {
  return COORDINATE_DEPENDENT_TABS.includes(tab)
}

export interface OpeningTabInput {
  /** A aba que o deep link pediu (`?tab=`), ou nenhuma. */
  requested?: EntityTab | null
  /** Se `core.attraction_coordinate` já tem o par para este registro. */
  hasCoordinate: boolean
}

/**
 * Em qual aba o drawer abre.
 *
 * `details` é o padrão de sempre; o pedido do deep link vence, EXCETO quando ele aponta para uma
 * aba que a coordenada ausente esvazia — aí o operador é posto exatamente onde resolve isso.
 */
export function resolveOpeningTab({ requested, hasCoordinate }: OpeningTabInput): EntityTab {
  if (!requested) return 'details'
  if (!hasCoordinate && tabNeedsCoordinate(requested)) return 'details'
  return requested
}

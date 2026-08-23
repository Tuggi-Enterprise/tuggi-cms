/**
 * APAGAR UM LOCAL — e o que apagar um local leva junto.
 *
 * O QUE O CASCADE FAZ, medido no schema em 2026-08-23. `DELETE` em `core.attractions` propaga
 * para 17 tabelas, e elas não são todas da mesma natureza:
 *
 *  · **cadastro, e se refaz** — `attraction_coordinate`, `attraction_descriptions`,
 *    `attraction_image`, `attraction_trigger_points`, `place_details`, `cache_narrations`;
 *  · **HISTÓRICO, e não se refaz** — `drive.poi_visits`, `drive.poi_visit_analytics`,
 *    `drive.poi_engagement`, `drive.attraction_feedback`, `drive.trip_session_attractions`.
 *    São turistas que passaram ali. Nenhum reimport devolve isso;
 *  · **TRILHA DE DECISÃO** — `partner.partner_triage_refusals`, que é append-only de propósito
 *    (BR-B2B-011, item 5: reapresentar reabre a triagem, e as rodadas anteriores são o registro
 *    do que foi dito ao parceiro).
 *
 * E `partner.clients.welcome_poi_id` é `SET NULL`: o parceiro perde a página de boas-vindas sem
 * que nada diga que perdeu.
 *
 * POR ISSO O APAGAR AQUI NÃO É O DO POI. `deletePoi` apaga tudo isso sem perguntar, e essa é uma
 * armadilha que existe — não um padrão a copiar. O que este módulo decide é: **um registro que
 * não acumulou história pode sumir; um que acumulou, não.** Para esse, o caminho é `is_active`,
 * que tira do turista e preserva tudo (BR-POI-005).
 *
 * O caso que motivou o card é o primeiro grupo: as duplicatas que `Criar o local a partir da
 * proposta` gerou ao lado de estabelecimentos já publicados — zero visita, zero trigger point,
 * zero descrição. Essas são lixo, e lixo se joga fora.
 *
 * Puro: sem Supabase, sem React. Provado por `tests/api/place-delete.test.ts`.
 */

/** O que um local acumulou. Exatamente as contagens que a rota levanta antes de apagar. */
export interface PlaceHistory {
  /** `drive.poi_visits` — turistas que passaram ali. */
  visits: number
  /** `drive.attraction_feedback`. */
  feedback: number
  /** `drive.trip_session_attractions` — sessões de viagem que o citam. */
  sessions: number
  /** `partner.partner_triage_refusals` — a trilha append-only da triagem. */
  triageRefusals: number
  /** Quantos clientes o usam como POI de boas-vindas (`welcome_poi_id`). */
  welcomeFor: number
  /** `core.attractions.partner_client_id` — se é o local de algum parceiro. */
  partnerClientId: string | null
}

export type DeleteBlocker =
  | 'has_visits'
  | 'has_feedback'
  | 'has_sessions'
  | 'has_triage_refusal'
  | 'is_welcome_poi'
  | 'is_partner_place'

export type DeleteVerdict =
  | { kind: 'ok' }
  /** Cada motivo é uma coisa diferente a fazer, então vêm todos, não o primeiro. */
  | { kind: 'blocked'; reasons: DeleteBlocker[] }

/**
 * Se este local pode sumir do catálogo.
 *
 * TODOS OS MOTIVOS, E NÃO O PRIMEIRO: um local com visitas E vínculo de parceiro tem duas coisas
 * a resolver, e devolver uma de cada vez faz o operador tentar de novo para descobrir a
 * seguinte. A tela mostra a lista.
 *
 * `is_partner_place` está na lista e não é sobre história: apagar o local de um parceiro deixa a
 * esteira apontando para o nada e a parceria sem endereço, sem que ninguém tenha decidido isso.
 * Desvincular primeiro é um ato, e um ato explícito.
 */
export function verdictFor(history: PlaceHistory): DeleteVerdict {
  const reasons: DeleteBlocker[] = []

  if (history.visits > 0) reasons.push('has_visits')
  if (history.feedback > 0) reasons.push('has_feedback')
  if (history.sessions > 0) reasons.push('has_sessions')
  if (history.triageRefusals > 0) reasons.push('has_triage_refusal')
  if (history.welcomeFor > 0) reasons.push('is_welcome_poi')
  if (history.partnerClientId !== null) reasons.push('is_partner_place')

  return reasons.length === 0 ? { kind: 'ok' } : { kind: 'blocked', reasons }
}

export function canDelete(history: PlaceHistory): boolean {
  return verdictFor(history).kind === 'ok'
}

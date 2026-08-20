/**
 * SSOT do `drive.poi_visits.visit_source` — o que fez o áudio tocar.
 *
 * Três valores chegam do campo, escritos por três lugares diferentes do app:
 *
 * | `visit_source`     | Quem escreve                                      | Engajamento |
 * | :--                | :--                                               | :--         |
 * | `trigger_point`    | Android nativo, `SupabaseRPCClient.recordPOIVisit` | automático  |
 * | `audio_trigger`    | RN `RouteTrailSyncService`, sync do que tocou offline | automático |
 * | `poi_detail_screen`| RN `DailyAudioLimitService.recordVisit`, play na tela | manual   |
 *
 * Os dois primeiros são o mesmo fato para quem lê o dashboard — o Trigger Point
 * disparou sozinho na estrada —, e diferem só no caminho de gravação (nativo
 * imediato contra fila offline). O terceiro é o usuário que abriu o POI e apertou
 * play. Quem quiser separar os dois caminhos automáticos ainda tem o campo cru.
 */

export type VisitSourceKind = 'trigger_point' | 'manual_play' | 'unknown'

const KIND_BY_SOURCE: Record<string, VisitSourceKind> = {
  trigger_point: 'trigger_point',
  audio_trigger: 'trigger_point',
  poi_detail_screen: 'manual_play',
}

/**
 * `unknown` cobre três casos que a UI trata igual: o literal `'unknown'` que as
 * RPCs mandam no lugar de NULL, a RPC que ainda não devolve a coluna
 * (`core.dashboard_realtime_activity`) e qualquer valor novo que o app comece a
 * gravar antes de o CMS aprender a nomeá-lo.
 */
export function visitSourceKind(source?: string | null): VisitSourceKind {
  if (!source) return 'unknown'
  return KIND_BY_SOURCE[source] ?? 'unknown'
}

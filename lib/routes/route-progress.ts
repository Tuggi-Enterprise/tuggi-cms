/**
 * The shapes of the route-progress panel (#794) — `core.admin_get_custom_route_progress_summary`
 * and `core.admin_get_custom_route_progress_users`. Completion is "all stops", defined once in the
 * database (`drive.custom_route_progress`); nothing here recomputes it.
 *
 * The users row has NO `email`, although the RPC returns one: BR-USUARIO-042 item 1 — on a CMS
 * screen the tourist is the `nickname` (fallback: 8 chars of the `user_id`, `appUserLabel`), and
 * the route drops the column before it reaches the browser.
 */

export interface RouteProgressSummaryRow {
  route_id: string
  route_name: string
  started_count: number
  in_progress_count: number
  completed_count: number
}

export type RouteProgressStatus = 'in_progress' | 'completed'

export interface RouteProgressUserRow {
  user_id: string
  nickname: string | null
  status: RouteProgressStatus
  started_at: string | null
  last_activity_at: string | null
  reached_count: number
  total_waypoints: number
  completed_at: string | null
}

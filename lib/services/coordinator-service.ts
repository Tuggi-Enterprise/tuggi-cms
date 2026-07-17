/**
 * Coordinator (afiliados) — resolução de escopo no servidor.
 *
 * SSOT de "quem é o coordenador que está chamando e o que ele pode tocar".
 * Toda rota /api/coordinator/* passa por aqui — nenhuma reimplementa a regra.
 *
 * ⚠️ POR QUE ISTO EXISTE, e não um `.eq('parent_client_id', body.parent)`:
 * as rotas de coordenador leem/escrevem com SERVICE ROLE (bypassa RLS), exatamente como
 * /api/admin/clients. Com service role, o filtro em JS é a ÚNICA barreira — foi assim que
 * app/api/clients/pois/route.ts acabou vazando a base inteira (`clientIdToQuery` nulo ⇒
 * `if (clientIdToQuery)` falso ⇒ sem filtro). Aqui o escopo é resolvido no servidor a
 * partir da sessão, NUNCA do body, e escopo vazio é DENY — nunca "sem filtro".
 */

import { cookies } from 'next/headers'
import { getSupabaseRouteHandler, getSupabaseService } from '@/lib/core/supabase-client'

export interface CoordinatorContext {
  cmsUserId: string
  email: string
  /** Admin da Tuggi: enxerga qualquer guarda-chuva. */
  isAdmin: boolean
  /** Clients que o caller controla diretamente (via client_cms_users / clients.cms_user_id). */
  rootClientIds: string[]
  /** Escopo completo: raízes + descendentes. Vazio ⇒ deny. */
  scopeClientIds: string[]
}

export type CoordinatorResult =
  | { ok: true; ctx: CoordinatorContext }
  | { ok: false; status: number; error: string }

/**
 * Resolve o contexto do caller a partir da SESSÃO (nunca do body).
 *
 * Usa getUser() e não getSession(): getSession() só decodifica o cookie localmente e não
 * detecta sessão revogada — o próprio middleware.ts:40-42 documenta isso, mas as API
 * routes antigas ainda usam getSession(). Rota nova nasce certa.
 */
export async function resolveCoordinator(): Promise<CoordinatorResult> {
  const cookieStore = await cookies()
  const supabaseAuth = getSupabaseRouteHandler(cookieStore)

  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  if (authError || !user?.email) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }

  const service = getSupabaseService()

  const { data: cmsUser, error: cmsError } = await service
    .schema('core')
    .from('cms_users')
    .select('id, role, is_active')
    .eq('email', user.email)
    .eq('is_active', true)
    .maybeSingle()

  if (cmsError || !cmsUser) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }

  const isAdmin = cmsUser.role === 'admin'

  // Raízes: client_cms_users (vínculo VIVO) + clients.cms_user_id (legado).
  // NUNCA cms_users.client_id — está NULL em 9/9 dos usuários role='client' e, sendo
  // escalar, não representa o N:N real.
  const [{ data: links }, { data: owned }] = await Promise.all([
    service.schema('core').from('client_cms_users').select('client_id').eq('cms_user_id', cmsUser.id),
    service.schema('core').from('clients').select('id').eq('cms_user_id', cmsUser.id),
  ])

  const rootClientIds = Array.from(new Set([
    ...(links ?? []).map((l: any) => l.client_id),
    ...(owned ?? []).map((c: any) => c.id),
  ].filter(Boolean)))

  if (!isAdmin && rootClientIds.length === 0) {
    // FAIL CLOSED. Sem escopo não é "vê tudo" — é 403.
    return { ok: false, status: 403, error: 'Forbidden: no client scope' }
  }

  // Escopo = raízes + filhas. Espelha core.client_scope_ids() (SSOT no banco); aqui em JS
  // porque a rota usa service role e precisa do array para filtrar as queries.
  let scopeClientIds = rootClientIds
  if (rootClientIds.length > 0) {
    const { data: children } = await service
      .schema('core')
      .from('clients')
      .select('id')
      .in('parent_client_id', rootClientIds)
    scopeClientIds = Array.from(new Set([
      ...rootClientIds,
      ...(children ?? []).map((c: any) => c.id),
    ]))
  }

  return {
    ok: true,
    ctx: { cmsUserId: cmsUser.id, email: user.email, isAdmin, rootClientIds, scopeClientIds },
  }
}

/**
 * O caller pode tocar este client? Admin pode qualquer um; coordenador, só o próprio escopo.
 * Chamar SEMPRE antes de ler/escrever um client por id vindo da URL ou do body.
 */
export function canTouchClient(ctx: CoordinatorContext, clientId: string): boolean {
  if (ctx.isAdmin) return true
  return ctx.scopeClientIds.includes(clientId)
}

/**
 * O cms_user é um coordenador? (Está vinculado a algum client is_coordinator = true.)
 *
 * Usado pelas rotas de ESCRITA de POI/rota para bloquear coordenadores: por decisão de
 * produto, coordenador gerencia afiliados, não POIs — não pode criar/editar/excluir POI.
 * Recebe o cms_user.id (as rotas já o resolvem) em vez de reabrir a sessão.
 */
export async function callerIsCoordinator(cmsUserId: string): Promise<boolean> {
  const service = getSupabaseService()
  const [{ data: links }, { data: owned }] = await Promise.all([
    service.schema('core').from('client_cms_users').select('client_id').eq('cms_user_id', cmsUserId),
    service.schema('core').from('clients').select('id').eq('cms_user_id', cmsUserId),
  ])
  const ids = Array.from(new Set([
    ...(links ?? []).map((l: any) => l.client_id),
    ...(owned ?? []).map((c: any) => c.id),
  ].filter(Boolean)))
  if (ids.length === 0) return false

  const { data: coord } = await service
    .schema('core')
    .from('clients')
    .select('id')
    .in('id', ids)
    .eq('is_coordinator', true)
    .limit(1)
  return (coord?.length ?? 0) > 0
}

/**
 * Sob qual coordenador uma filha nova deve nascer.
 * Admin pode informar explicitamente; coordenador é SEMPRE forçado à própria raiz —
 * um parent_client_id vindo do body jamais é aceito de um não-admin.
 */
export function resolveParentForNewChild(
  ctx: CoordinatorContext,
  requestedParentId?: string | null
): { ok: true; parentId: string } | { ok: false; status: number; error: string } {
  if (ctx.isAdmin) {
    if (!requestedParentId) {
      return { ok: false, status: 400, error: 'parent_client_id is required for admin' }
    }
    return { ok: true, parentId: requestedParentId }
  }

  if (requestedParentId && !ctx.rootClientIds.includes(requestedParentId)) {
    return { ok: false, status: 403, error: 'Forbidden: parent out of scope' }
  }

  const parentId = requestedParentId ?? ctx.rootClientIds[0]
  if (!parentId) {
    return { ok: false, status: 403, error: 'Forbidden: no client scope' }
  }
  return { ok: true, parentId }
}

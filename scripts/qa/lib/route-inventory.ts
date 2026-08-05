/**
 * Where the harness gets "what should this route answer, per state" from.
 *
 * Real source of truth (once it exists): `docs/dev/inventario-rotas-api-cms.md`,
 * produced by `dev` in CARD-CMS-01 alongside `scripts/check-route-policies.ts`.
 * This module tries to parse a policy out of it; when the file is missing or
 * the row can't be read with confidence, it falls back to `PHASE1_ROUTES`
 * below — a hand-written policy for only the two routes `dev` is converting
 * in this round (`attraction-groups/group`, `attraction-groups/nearby`).
 * Every fallback use is logged, so a stale assumption never masquerades as
 * the inventory's answer (CLAUDE.md §6, "nome que mente é pior que nome ruim"
 * — the report must say which source answered, not just an expected status).
 */
import { readFileSync, existsSync } from 'node:fs'

export type Policy = 'public' | { roles: string[] }

export interface RoutePolicy {
  method: string
  routePath: string // e.g. "/api/attraction-groups/group"
  policy: Policy
  source: 'inventory' | 'fallback-phase1'
}

/**
 * CARD-CMS-01's "Como testar" names exactly these two routes for phase 1.
 * Policy assumption: any active `core.cms_users` row (admin/client/editor) —
 * the same default `lib/auth-middleware.ts:withAuth` ships with. This is a
 * guess standing in for the inventory, not a decision — `dev`'s inventory
 * overrides it the moment it exists and this file is re-read.
 */
export const PHASE1_ROUTES: RoutePolicy[] = [
  {
    method: 'POST',
    routePath: '/api/attraction-groups/group',
    policy: { roles: ['admin', 'client', 'editor'] },
    source: 'fallback-phase1',
  },
  {
    method: 'GET',
    routePath: '/api/attraction-groups/nearby',
    policy: { roles: ['admin', 'client', 'editor'] },
    source: 'fallback-phase1',
  },
  {
    method: 'POST',
    routePath: '/api/attraction-groups/nearby',
    policy: { roles: ['admin', 'client', 'editor'] },
    source: 'fallback-phase1',
  },
]

/**
 * Best-effort markdown table parse. Looks for a row that contains both the
 * route path and an HTTP method token, then reads the last non-empty pipe
 * cell as the policy text. Recognizes "público"/"public" as `Policy: 'public'`,
 * and otherwise treats the cell as a comma/slash-separated role list
 * (matches `withAuth`'s `allowedRoles` vocabulary: admin, client, editor).
 * Anything it can't confidently parse is left to the phase-1 fallback —
 * this parser is deliberately conservative, not clever.
 */
export function loadRoutePolicies(inventoryPath: string): RoutePolicy[] {
  if (!existsSync(inventoryPath)) {
    console.warn(
      `⚠️  Inventário não encontrado em ${inventoryPath} — usando a política local de fase 1 ` +
        `(PHASE1_ROUTES) para as duas rotas deste round. Isso é esperado até o \`dev\` publicar ` +
        `docs/dev/inventario-rotas-api-cms.md.`
    )
    return PHASE1_ROUTES
  }

  const raw = readFileSync(inventoryPath, 'utf-8')
  const lines = raw.split('\n')
  const parsed: RoutePolicy[] = []

  for (const fallback of PHASE1_ROUTES) {
    const row = lines.find(
      (l) => l.includes(fallback.routePath) && l.toUpperCase().includes(fallback.method)
    )
    if (!row) {
      console.warn(
        `⚠️  ${fallback.method} ${fallback.routePath} não apareceu no inventário — usando fallback de fase 1.`
      )
      parsed.push(fallback)
      continue
    }

    const cells = row.split('|').map((c) => c.trim()).filter(Boolean)
    const policyCell = cells[cells.length - 1] ?? ''

    if (/p[uú]blic|public/i.test(policyCell)) {
      parsed.push({ ...fallback, policy: 'public', source: 'inventory' })
      continue
    }

    const roles = policyCell
      .toLowerCase()
      .split(/[,/]/)
      .map((r) => r.trim())
      .filter((r) => ['admin', 'client', 'editor'].includes(r))

    if (roles.length === 0) {
      console.warn(
        `⚠️  Linha do inventário para ${fallback.method} ${fallback.routePath} não teve política ` +
          `reconhecível ("${policyCell}") — usando fallback de fase 1.`
      )
      parsed.push(fallback)
      continue
    }

    parsed.push({ ...fallback, policy: { roles }, source: 'inventory' })
  }

  return parsed
}

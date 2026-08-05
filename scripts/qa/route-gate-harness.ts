/**
 * CARD-CMS-01 — integration HTTP harness ("Como testar" § Integração HTTP).
 *
 * Fires each route in the inventory in four states — anonymous,
 * authenticated-without-a-cms_users-row, `client`, `admin` — against a
 * running server, and compares the response with the declared policy.
 *
 * Phase 1 (today): runs for real against the two routes `dev` is converting
 * (`attraction-groups/group`, `attraction-groups/nearby`), reading their
 * declared policy from `docs/dev/inventario-rotas-api-cms.md` (falls back to
 * a local guess — `PHASE1_ROUTES` in lib/route-inventory.ts — only if that
 * file is missing or the row can't be parsed). Phase 2: once `dev` finishes
 * converting the other 132 files, extend `loadRoutePolicies` to read every
 * row instead of just the two named in `PHASE1_ROUTES` — no other code
 * here changes, the request/verdict logic is already route-agnostic.
 *
 * The `client` and `admin` states are only as real as `core.cms_users`
 * makes them. This script checks that table (read-only) before judging
 * those two states, and reports INFO instead of PASS/FAIL when the row
 * `data` needs to insert (see scripts/qa/README.md) isn't there yet — a
 * silent PASS on an unrealized persona would be exactly the kind of
 * decorative coverage CLAUDE.md §5 warns about.
 *
 * Requires: `npm run dev` (or a preview deploy) reachable at BASE_URL, and
 * scripts/qa/.test-accounts.local.json from seed-test-accounts.ts.
 *
 * Run with: npx tsx --env-file=.env scripts/qa/route-gate-harness.ts
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { LOCAL_CREDENTIALS_PATH, type StoredAccount, type Persona } from './lib/accounts'
import { buildSessionCookieHeader } from './lib/session-cookie'
import { loadRoutePolicies, type Policy, type RoutePolicy } from './lib/route-inventory'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:3000'
const INVENTORY_PATH =
  // Lives in the workspace-level docs/dev/, one level above the tuggi-cms
  // repo (CLAUDE.md §1 — docs/dev is shared across projects there, not
  // per-repo). Override with QA_INVENTORY_PATH if that ever changes.
  process.env.QA_INVENTORY_PATH || resolve(process.cwd(), '../docs/dev/inventario-rotas-api-cms.md')

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SECRET_KEY) {
  console.error('❌ Faltam NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / SUPABASE_SECRET_KEY (.env).')
  process.exit(1)
}

const service = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

type StateName = 'anonymous' | 'authenticated-sem-cms-user' | 'client' | 'admin'

const STATE_TO_PERSONA: Record<Exclude<StateName, 'anonymous'>, Persona> = {
  'authenticated-sem-cms-user': 'no-cms-user',
  client: 'client',
  admin: 'admin',
}

interface StateContext {
  state: StateName
  cookieHeader: string | null
  /** null = "no cms_users row to check" (anonymous / sem-cms-user by design). */
  cmsRole: string | null
  /** Whether this state's ground truth is real today — false means REPORT INFO, not PASS/FAIL. */
  realized: boolean
}

async function loadAccounts(): Promise<StoredAccount[]> {
  const p = resolve(process.cwd(), LOCAL_CREDENTIALS_PATH)
  if (!existsSync(p)) {
    console.error(
      `❌ ${LOCAL_CREDENTIALS_PATH} não existe. Rode primeiro:\n` +
        `   npx tsx --env-file=.env scripts/qa/seed-test-accounts.ts`
    )
    process.exit(1)
  }
  return JSON.parse(readFileSync(p, 'utf-8'))
}

/** Read-only check — never writes to core.cms_users (CLAUDE.md §1, data owns that write). */
async function cmsUserRole(email: string): Promise<string | null> {
  const { data, error } = await service
    .schema('core')
    .from('cms_users')
    .select('role, is_active')
    .eq('email', email)
    .eq('is_active', true)
    .maybeSingle()
  if (error) {
    console.warn(`⚠️  Falha lendo core.cms_users para ${email}: ${error.message}`)
    return null
  }
  return data?.role ?? null
}

async function buildStates(accounts: StoredAccount[]): Promise<StateContext[]> {
  const byPersona = new Map(accounts.map((a) => [a.persona, a]))
  const states: StateContext[] = [{ state: 'anonymous', cookieHeader: null, cmsRole: null, realized: true }]

  for (const [state, persona] of Object.entries(STATE_TO_PERSONA) as [Exclude<StateName, 'anonymous'>, Persona][]) {
    const account = byPersona.get(persona)
    if (!account) {
      console.error(`❌ Persona "${persona}" não está em ${LOCAL_CREDENTIALS_PATH}. Rode o seed de novo.`)
      process.exit(1)
    }
    const { header } = await buildSessionCookieHeader(account.email, account.password, {
      supabaseUrl: SUPABASE_URL!,
      supabaseAnonKey: SUPABASE_ANON_KEY!,
    })
    const role = await cmsUserRole(account.email)

    // "authenticated-sem-cms-user" is realized BY the absence of a row — its
    // ground truth doesn't depend on `data`. "client"/"admin" are only
    // realized once the row `data` needs to insert exists with the matching role.
    const realized = state === 'authenticated-sem-cms-user' ? role === null : role === state

    states.push({ state, cookieHeader: header, cmsRole: role, realized })
  }

  return states
}

function isBlockedPolicy(policy: Policy, state: StateContext): boolean {
  if (policy === 'public') return false
  if (state.state === 'anonymous') return true // no session at all
  if (state.cmsRole === null) return true // authenticated, but no active cms_users row
  return !policy.roles.includes(state.cmsRole)
}

interface CheckResult {
  route: RoutePolicy
  state: StateContext
  status: number
  verdict: 'PASS' | 'FAIL' | 'INFO'
  detail: string
}

async function fireRequest(route: RoutePolicy, cookieHeader: string | null): Promise<number> {
  const url = `${BASE_URL}${route.routePath}`
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (cookieHeader) headers['cookie'] = cookieHeader

  // Minimal/invalid payloads on purpose: the harness is probing the AUTH
  // GATE, not business logic. A wired gate answers 401/403 before the
  // handler ever looks at the body; an unwired one answers whatever the
  // handler's own validation says (400 today, for both routes) — which is
  // itself the signal that phase 1 is still red, per the card.
  const init: RequestInit = { method: route.method, headers }
  if (route.method !== 'GET') init.body = JSON.stringify({})

  const target = route.method === 'GET' ? `${url}?poiId=00000000-0000-0000-0000-000000000000` : url
  const res = await fetch(target, init)
  return res.status
}

async function main() {
  const accounts = await loadAccounts()
  const routes = loadRoutePolicies(INVENTORY_PATH)
  const states = await buildStates(accounts)

  console.log(`Base URL: ${BASE_URL}`)
  console.log(`Inventário: ${INVENTORY_PATH} (${existsSync(INVENTORY_PATH) ? 'encontrado' : 'AUSENTE — fallback de fase 1'})\n`)

  // Fail fast with a clear message instead of 4×N confusing network errors.
  try {
    await fetch(BASE_URL, { method: 'GET' })
  } catch {
    console.error(`❌ ${BASE_URL} não respondeu. Rode \`npm run dev\` (ou aponte QA_BASE_URL para um preview) antes do harness.`)
    process.exit(1)
  }

  const results: CheckResult[] = []

  for (const route of routes) {
    for (const state of states) {
      const status = await fireRequest(route, state.cookieHeader)
      const expectedBlocked = isBlockedPolicy(route.policy, state)
      const actuallyBlocked = status === 401 || status === 403

      let verdict: CheckResult['verdict']
      let detail: string
      if (!state.realized) {
        verdict = 'INFO'
        detail = 'persona ainda não realizada em core.cms_users — ver scripts/qa/README.md'
      } else if (expectedBlocked === actuallyBlocked) {
        verdict = 'PASS'
        detail = expectedBlocked ? `bloqueado como esperado (${status})` : `liberado como esperado (${status})`
      } else {
        verdict = 'FAIL'
        detail = expectedBlocked
          ? `deveria bloquear (401/403), respondeu ${status}`
          : `deveria liberar, respondeu ${status} (gate bloqueando indevidamente)`
      }

      results.push({ route, state, status, verdict, detail })
    }
  }

  console.log(
    'Rota'.padEnd(38) +
      'Método'.padEnd(8) +
      'Estado'.padEnd(28) +
      'Política'.padEnd(28) +
      'Veredito'.padEnd(9) +
      'Detalhe'
  )
  for (const r of results) {
    const policyLabel = r.route.policy === 'public' ? 'público' : r.route.policy.roles.join('/')
    console.log(
      r.route.routePath.padEnd(38) +
        r.route.method.padEnd(8) +
        r.state.state.padEnd(28) +
        `${policyLabel} (${r.route.source})`.padEnd(28) +
        r.verdict.padEnd(9) +
        r.detail
    )
  }

  const failures = results.filter((r) => r.verdict === 'FAIL')
  const infos = results.filter((r) => r.verdict === 'INFO')
  console.log(
    `\n${results.length} verificações — ${results.length - failures.length - infos.length} PASS, ` +
      `${failures.length} FAIL, ${infos.length} INFO (personas não realizadas).`
  )

  if (infos.length > 0) {
    console.log(
      '\nINFO não é aprovação: as personas client/admin ainda respondem como "autenticado sem ' +
        'cms_users" porque a linha em core.cms_users está pendente do `data` (ver ' +
        'docs/dev/2026-08-05-qa-contas-de-teste-gate-api.md e a saída de seed-test-accounts.ts).'
    )
  }

  process.exit(failures.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('❌ Harness falhou:', err)
  process.exit(1)
})

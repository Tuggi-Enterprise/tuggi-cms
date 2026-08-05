/**
 * CARD-CMS-01 — the `core.cms_users` half of the test personas (owned by `data`).
 *
 * `seed-test-accounts.ts` creates the Supabase Auth users; this script creates the
 * `core.cms_users` row that turns two of them into the `admin` and `client` personas
 * the harness needs. Split in two scripts because the tables are owned by different
 * agents (CLAUDE.md §1), not because the steps are independent: run this one second.
 *
 * The rows are EPHEMERAL BY DESIGN. An `admin` row that survives the test run is a
 * standing privilege attached to a password on a workstation disk, and this project's
 * `service_role` key is already exposed in git history and cannot be rotated until the
 * app clears Apple review. So the cycle is: seed → harness → cleanup, every time.
 *
 *   npx tsx --env-file=.env scripts/qa/seed-cms-users.ts
 *   npx tsx --env-file=.env scripts/qa/seed-cms-users.ts --cleanup
 *
 * Modelling notes, measured against production on 2026-08-05:
 *  - the gate (`lib/auth-middleware.ts`) resolves the row by `email`, never by id, so
 *    `cms_users.id` is free. It is set to the `auth.users.id` here to make the row
 *    self-evidently a test row; production rows do NOT share ids with `auth.users`.
 *  - `client_id` stays NULL: all 12 production rows with `role='client'` have it NULL,
 *    the client-scoped routes key off `cms_users.id` (`attractions.created_by`) or the
 *    caller's JWT, and pointing it at the platform-owner client would add a fake member
 *    to that client's team lists. No `core.clients` row is needed for these personas.
 *  - `role` is constrained to admin|editor|viewer|client (`cms_users_role_check`).
 */
import { createClient } from '@supabase/supabase-js'
import { emailFor, isTestAccountEmail, TEST_ACCOUNT_DOMAIN, type Persona } from './lib/accounts'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('❌ Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY (.env).')
  process.exit(1)
}

const service = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

/** Personas that need a `core.cms_users` row. `no-cms-user` is defined by its absence. */
const SEEDED: { persona: Extract<Persona, 'admin' | 'client'>; role: 'admin' | 'client' }[] = [
  { persona: 'admin', role: 'admin' },
  { persona: 'client', role: 'client' },
]

async function authUserId(email: string): Promise<string | null> {
  // listUsers paginates and this project's GoTrue 500s past page 1 (see
  // docs/dev/2026-08-05-qa-contas-de-teste-gate-api.md), so ask for the one address.
  const { data, error } = await service.auth.admin.listUsers({ page: 1, perPage: 100 })
  if (error) throw new Error(`auth.admin.listUsers falhou: ${error.message}`)
  const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
  return found?.id ?? null
}

async function seed(): Promise<void> {
  for (const { persona, role } of SEEDED) {
    const email = emailFor(persona)
    const id = await authUserId(email)
    if (!id) {
      console.error(`❌ ${email} não existe em auth.users. Rode seed-test-accounts.ts primeiro.`)
      process.exit(1)
    }

    const { error } = await service
      .schema('core')
      .from('cms_users')
      .upsert(
        {
          id,
          email,
          full_name: `QA CARD-CMS-01 ${role} (efêmero — apagar após o harness)`,
          role,
          is_active: true,
          client_id: null,
        },
        { onConflict: 'email' }
      )
    if (error) {
      console.error(`❌ upsert core.cms_users ${email}: ${error.message}`)
      process.exit(1)
    }
    console.log(`✅ core.cms_users ${email} → role=${role}, id=${id}`)
  }
}

async function cleanup(): Promise<void> {
  // Always filtered by the test domain; a DELETE without WHERE on this table is a
  // destructive action the operator executes, never an agent (CLAUDE.md §3).
  const { data, error } = await service
    .schema('core')
    .from('cms_users')
    .delete()
    .ilike('email', `%@${TEST_ACCOUNT_DOMAIN}`)
    .select('email')
  if (error) {
    console.error(`❌ delete core.cms_users: ${error.message}`)
    process.exit(1)
  }
  const removed = (data ?? []).map((r: { email: string }) => r.email)
  if (removed.some((e) => !isTestAccountEmail(e))) {
    throw new Error(`filtro de cleanup pegou linha fora do domínio de teste: ${removed.join(', ')}`)
  }
  console.log(removed.length ? `🧹 removidas: ${removed.join(', ')}` : '🧹 nada a remover')

  const { data: left, error: leftError } = await service
    .schema('core')
    .from('cms_users')
    .select('email')
    .ilike('email', `%@${TEST_ACCOUNT_DOMAIN}`)
  if (leftError) {
    console.error(`❌ verificação pós-cleanup falhou: ${leftError.message}`)
    process.exit(1)
  }
  if ((left ?? []).length > 0) {
    console.error(`❌ cleanup não provado: ainda há ${left!.length} linha(s).`)
    process.exit(1)
  }
  console.log('✅ cleanup provado: 0 linhas de teste em core.cms_users.')
}

const main = process.argv.includes('--cleanup') ? cleanup : seed
main().catch((err) => {
  console.error('❌ Falhou:', err)
  process.exit(1)
})

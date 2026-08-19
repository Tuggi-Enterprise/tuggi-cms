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
 *    to that client's team lists. No `partner.clients` row is needed for these personas.
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

/**
 * Cleanup revokes the privilege; it does not DELETE the row, and that is a
 * measured constraint, not a preference.
 *
 * `DELETE FROM core.cms_users` fires ON DELETE SET NULL on
 * `core.attraction_trigger_points.created_by` and `.updated_by` (20.1M rows, both
 * unindexed) plus `core.poi_exclusions.excluded_by` (2.5M, unindexed), so it is
 * cancelled by `statement_timeout` (measured 2026-08-05: 9.2s, error 57014).
 * `is_active = false` is a plain UPDATE on the primary key — instant — and the
 * gate (`lib/auth-middleware.ts`) filters on `is_active`, so a deactivated row
 * authorizes exactly nothing. The hard DELETE is an operator step with the
 * timeout raised; see the message this prints.
 */
async function cleanup(): Promise<void> {
  const { data, error } = await service
    .schema('core')
    .from('cms_users')
    .update({ is_active: false })
    .ilike('email', `%@${TEST_ACCOUNT_DOMAIN}`)
    .select('email, role, is_active')
  if (error) {
    console.error(`❌ desativação em core.cms_users: ${error.message}`)
    process.exit(1)
  }
  const touched = (data ?? []) as { email: string; role: string; is_active: boolean }[]
  if (touched.some((r) => !isTestAccountEmail(r.email))) {
    throw new Error(`filtro de cleanup pegou linha fora do domínio de teste: ${touched.map((r) => r.email).join(', ')}`)
  }

  const { data: active, error: activeError } = await service
    .schema('core')
    .from('cms_users')
    .select('email, role')
    .ilike('email', `%@${TEST_ACCOUNT_DOMAIN}`)
    .eq('is_active', true)
  if (activeError) {
    console.error(`❌ verificação pós-cleanup falhou: ${activeError.message}`)
    process.exit(1)
  }
  if ((active ?? []).length > 0) {
    console.error(`❌ cleanup não provado: ${active!.length} persona(s) ainda ativa(s).`)
    process.exit(1)
  }

  console.log(`🧹 desativadas: ${touched.map((r) => `${r.email} (${r.role})`).join(', ') || 'nenhuma'}`)
  console.log('✅ cleanup provado: 0 linhas de teste ATIVAS em core.cms_users — nenhuma autoriza rota.')
  console.log(
    '\nDELETE definitivo é passo do operador (CLAUDE.md §3), porque precisa de timeout maior:\n' +
      "  psql \"$DB_URL\" -c \"SET statement_timeout='120s'; DELETE FROM core.cms_users WHERE email ILIKE '%@qa-test.tuggi.app';\""
  )
}

const main = process.argv.includes('--cleanup') ? cleanup : seed
main().catch((err) => {
  console.error('❌ Falhou:', err)
  process.exit(1)
})

/**
 * Creates the Supabase Auth users for the three CARD-CMS-01 test personas
 * (admin, client, no-cms-user). Idempotent: reruns reuse the existing Auth
 * user and rotate its password rather than failing on "already registered".
 *
 * What this script does NOT do, on purpose: it never writes to
 * `core.cms_users` or `partner.clients`. Those two tables are the actual
 * authorization decision (role, is_active, client_id) and writing to them is
 * `data`'s call under CLAUDE.md §1 ("qualquer SQL executado"), not qa's —
 * whether the write happens via psql or via `.insert()` makes no difference,
 * it is still a direct write to a production table. This script creates the
 * inert Auth identities and prints the exact insert `data` needs to run to
 * finish the `admin` and `client` personas.
 *
 * Run with: npx tsx --env-file=.env scripts/qa/seed-test-accounts.ts
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { randomBytes, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  PERSONAS,
  emailFor,
  LOCAL_CREDENTIALS_PATH,
  type StoredAccount,
} from './lib/accounts'
import { buildSessionCookieHeader } from './lib/session-cookie'
import { withRetry } from './lib/retry'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_SECRET_KEY) {
  console.error(
    '❌ Faltam variáveis de ambiente. Precisa de NEXT_PUBLIC_SUPABASE_URL, ' +
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY e SUPABASE_SECRET_KEY (.env).'
  )
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function generatePassword(): string {
  // 24 random bytes, base64url — well above any Supabase Auth minimum length.
  return randomBytes(24).toString('base64url')
}

/**
 * `auth.admin.listUsers` has no email filter (checked against the installed
 * @supabase/auth-js — GoTrueAdminApi.d.ts only takes page/perPage), so
 * finding an existing user means paging through everyone. On this project
 * that sweep is NOT reliable: page 1 (users 1-100) answers fine, but page 2
 * (101-200) and a single perPage=200/1000 request both answer a bare 500
 * (confirmed 2026-08-05, reproducible) — some record past position ~100
 * breaks GoTrue's serialization. Skipping a broken page and continuing (with
 * a warning) is deliberate: a full crash here would block seeding on a
 * pagination bug that has nothing to do with CARD-CMS-01. If the account
 * genuinely can't be found, `ensureAuthUser` surfaces that as a clear error
 * instead of silently creating a duplicate.
 */
async function findExistingUserByEmail(email: string) {
  const PER_PAGE = 100
  const first = await withRetry(() => admin.auth.admin.listUsers({ page: 1, perPage: PER_PAGE }))
  if (first.error) throw first.error

  const lastPage = (first.data as any).lastPage || 1
  const target = email.toLowerCase()

  const found1 = first.data.users.find((u) => u.email?.toLowerCase() === target)
  if (found1) return found1

  for (let page = 2; page <= lastPage; page++) {
    try {
      const { data, error } = await withRetry(() => admin.auth.admin.listUsers({ page, perPage: PER_PAGE }))
      if (error) throw error
      const found = data.users.find((u) => u.email?.toLowerCase() === target)
      if (found) return found
    } catch (err) {
      console.warn(
        `⚠️  auth.admin.listUsers(page=${page}) falhou (bug de paginação conhecido neste projeto, ` +
          `ver comentário em findExistingUserByEmail) — pulando a página, busca pode ficar incompleta.`
      )
    }
  }
  return null
}

async function ensureAuthUser(email: string, password: string): Promise<string> {
  // Create first, search only as a fallback: this project's Auth had ~260
  // users and zero of them on the `@qa-test.tuggi.app` domain before this
  // script ever ran, so the common case (first run) never needs the sweep
  // above at all — and the sweep is the part known to be flaky here.
  const created = await withRetry(() =>
    admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // no confirmation email is ever sent for this domain
    })
  )

  if (!created.error && created.data.user) {
    console.log(`+ ${email} criado (id ${created.data.user.id}).`)
    return created.data.user.id
  }

  const isDuplicate = /already.*registered|already.*exists/i.test(created.error?.message ?? '')
  if (!isDuplicate) {
    throw created.error ?? new Error('createUser returned no user and no error')
  }

  const existing = await findExistingUserByEmail(email)
  if (!existing) {
    throw new Error(
      `${email}: createUser diz que já existe, mas a varredura não achou o id ` +
        `(provavelmente bateu na página quebrada — ver findExistingUserByEmail). ` +
        `Resolva manualmente no painel do Supabase Auth antes de rodar de novo.`
    )
  }

  const { error: updateError } = await withRetry(() => admin.auth.admin.updateUserById(existing.id, { password }))
  if (updateError) throw updateError
  console.log(`↻ ${email} já existia (id ${existing.id}) — senha rotacionada.`)
  return existing.id
}

async function main() {
  const results: StoredAccount[] = []

  for (const persona of PERSONAS) {
    const email = emailFor(persona)
    const password = generatePassword()
    const userId = await ensureAuthUser(email, password)

    // Prove the account can actually log in and that we can produce the
    // cookie the harness will send — catching a broken account here, not
    // silently in the middle of the fase-2 run.
    await buildSessionCookieHeader(email, password, {
      supabaseUrl: SUPABASE_URL!,
      supabaseAnonKey: SUPABASE_PUBLISHABLE_KEY!,
    })

    results.push({ persona, email, userId, password, createdAt: new Date().toISOString() })
  }

  const outPath = resolve(process.cwd(), LOCAL_CREDENTIALS_PATH)
  writeFileSync(outPath, JSON.stringify(results, null, 2) + '\n', { mode: 0o600 })

  console.log(`\n✅ Credenciais gravadas em ${LOCAL_CREDENTIALS_PATH} (fora do git — ver .gitignore).`)
  console.log('   Login/senha de cada persona só existem nesse arquivo local; não são impressos aqui.\n')

  const adminAccount = results.find((r) => r.persona === 'admin')!
  const clientAccount = results.find((r) => r.persona === 'client')!

  console.log('— — — pendência para o `data` — — —')
  console.log(
    [
      'As personas "admin" e "client" existem em Supabase Auth mas ainda não são CMS users.',
      'Falta, em core.cms_users (e para "client", também um partner.clients de teste — não existe',
      'nenhum "%test%" hoje, ver docs/dev/2026-08-05-qa-contas-de-teste-gate-api.md):',
      '',
      `  insert into partner.clients (id, name, email)`,
      `  values ('${randomUUID()}', 'QA CARD-CMS-01 (apagar depois do card)', '${emailFor('client')}');`,
      '  -- guarde o id gerado acima como <client_id> abaixo',
      '',
      `  insert into core.cms_users (id, email, full_name, role, is_active, client_id) values`,
      `    ('${adminAccount.userId}', '${adminAccount.email}', 'QA CARD-CMS-01 admin', 'admin', true, null),`,
      `    ('${clientAccount.userId}', '${clientAccount.email}', 'QA CARD-CMS-01 client', 'client', true, '<client_id>');`,
      '',
      'Depois disso, scripts/qa/cleanup-test-accounts.ts continua limpando só o que ele criou',
      '(Auth) — a limpeza das duas linhas acima também é do `data`.',
    ].join('\n')
  )
}

main().catch((err) => {
  console.error('❌ Falha ao semear contas de teste:', err)
  process.exit(1)
})

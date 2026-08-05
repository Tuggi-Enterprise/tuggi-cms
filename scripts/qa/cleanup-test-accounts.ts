/**
 * Deletes the Supabase Auth users created by seed-test-accounts.ts.
 * Idempotent — running it with nothing left to clean is a no-op, not an error.
 *
 * Only removes `auth.users` rows. If `data` has since inserted the matching
 * `core.cms_users` (and `core.clients`) rows for the admin/client personas
 * per seed-test-accounts.ts's printed instructions, deleting the Auth user
 * first will orphan those rows (no FK back-reference is assumed here) —
 * ask `data` to remove them in the same pass; this script does not touch
 * `core.*` (CLAUDE.md §1, same boundary as the seed script).
 *
 * Run with: npx tsx --env-file=.env scripts/qa/cleanup-test-accounts.ts
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { existsSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { isTestAccountEmail, LOCAL_CREDENTIALS_PATH, TEST_ACCOUNT_DOMAIN } from './lib/accounts'
import { withRetry } from './lib/retry'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('❌ Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY (.env).')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function listAllUsers() {
  // See seed-test-accounts.ts / findExistingUserByEmail: this project's
  // auth.admin.listUsers 500s on some pages past position ~100 (confirmed
  // 2026-08-05). A broken page is skipped with a warning rather than
  // aborting the whole cleanup — a test account stuck on a broken page is
  // recoverable by hand later; crashing here would leave every other test
  // account undeleted too.
  const PER_PAGE = 100
  const first = await withRetry(() => admin.auth.admin.listUsers({ page: 1, perPage: PER_PAGE }))
  if (first.error) throw first.error

  const lastPage = (first.data as any).lastPage || 1
  const all = [...first.data.users]

  for (let page = 2; page <= lastPage; page++) {
    try {
      const { data, error } = await withRetry(() => admin.auth.admin.listUsers({ page, perPage: PER_PAGE }))
      if (error) throw error
      all.push(...data.users)
    } catch {
      console.warn(`⚠️  auth.admin.listUsers(page=${page}) falhou — pulando (ver comentário acima).`)
    }
  }
  return all
}

async function main() {
  const allUsers = await listAllUsers()
  const toDelete = allUsers.filter((u) => isTestAccountEmail(u.email))

  if (toDelete.length === 0) {
    console.log(`Nenhuma conta @${TEST_ACCOUNT_DOMAIN} encontrada — nada para limpar.`)
  }

  for (const user of toDelete) {
    const { error: delError } = await withRetry(() => admin.auth.admin.deleteUser(user.id))
    if (delError) {
      console.error(`❌ Falha ao remover ${user.email} (${user.id}):`, delError.message)
      continue
    }
    console.log(`- ${user.email} removido.`)
  }

  const localPath = resolve(process.cwd(), LOCAL_CREDENTIALS_PATH)
  if (existsSync(localPath)) {
    unlinkSync(localPath)
    console.log(`- ${LOCAL_CREDENTIALS_PATH} removido.`)
  }
}

main().catch((err) => {
  console.error('❌ Falha na limpeza:', err)
  process.exit(1)
})

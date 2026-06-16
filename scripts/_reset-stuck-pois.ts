/**
 * Reset POIs stuck in 'processing' status back to 'pending' so they can be re-claimed.
 *
 * Why this exists:
 *   claimForProcessing() only updates rows where processing_status IN
 *   ('pending','failed','new') or NULL. POIs left in 'processing' after a crash
 *   are not re-claimable.
 *
 * Important: kill any running `migrate-pois-batch` processes before running this,
 *   otherwise rows being legitimately processed right now will be reset under
 *   their feet. (We can't detect "actively processing vs stuck" because the
 *   homolog schema in this env doesn't have last_migration_attempt_at.)
 *
 * Usage (dry-run first to see what will change):
 *   npx tsx scripts/_reset-stuck-pois.ts --country "USA" --state "Hawaii" --dry-run true
 *   npx tsx scripts/_reset-stuck-pois.ts --country "USA" --state "Hawaii"
 *
 * Args:
 *   --country <name>   Optional. Filter by country.
 *   --state <name>     Optional. Filter by state.
 *   --dry-run true     Default false. Preview only — no UPDATE.
 */

import fs from 'fs'
import path from 'path'

// Load .env so the supabase client picks up creds.
const envPath = path.join(__dirname, '../.env')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=')
      if (idx !== -1) {
        const key = trimmed.substring(0, idx).trim()
        const val = trimmed.substring(idx + 1).trim().replace(/^["']|["']$/g, '')
        if (!process.env[key]) process.env[key] = val
      }
    }
  }
}

import { getSupabase } from '../lib/core/supabase-client'

const supabase = getSupabase('service')

interface Options {
  country?: string
  state?: string
  dryRun: boolean
}

function parseArgs(): Options {
  const argv = process.argv.slice(2)
  const opts: Options = { dryRun: false }
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '')
    const val = argv[i + 1]
    if (!key || val === undefined) continue
    switch (key) {
      case 'country':
        opts.country = val
        break
      case 'state':
        opts.state = val
        break
      case 'dry-run':
        opts.dryRun = val === 'true'
        break
    }
  }
  return opts
}

async function main() {
  const opts = parseArgs()

  console.log('🔧 Reset stuck-processing POIs')
  console.log('   country: ', opts.country ?? '(all)')
  console.log('   state  : ', opts.state ?? '(all)')
  console.log('   dry-run: ', opts.dryRun)
  console.log('')

  const buildFilter = (q: any) => {
    q = q.eq('processing_status', 'processing')
    if (opts.country) q = q.eq('country', opts.country)
    if (opts.state) q = q.eq('state', opts.state)
    return q
  }

  const { count, error: countErr } = await buildFilter(
    supabase
      .schema('homolog')
      .from('pois')
      .select('uuid_id', { head: true, count: 'exact' })
  )

  if (countErr) {
    console.error('❌ Count query failed:', countErr)
    process.exit(1)
  }

  console.log(`🔎 Rows with processing_status='processing': ${count ?? 0}`)

  if (!count) {
    console.log('✅ Nothing to do.')
    return
  }

  if (opts.dryRun) {
    const { data: sample } = await buildFilter(
      supabase
        .schema('homolog')
        .from('pois')
        .select('uuid_id, name, state')
        .limit(10)
    )
    console.log('   First 10 rows:')
    for (const row of sample ?? []) {
      console.log(`     ${row.uuid_id}  ${row.state ?? '-'}  ${row.name}`)
    }
    console.log("💡 Dry run — no rows modified. Re-run without --dry-run true to apply.")
    return
  }

  const { data: updated, error: updErr } = await buildFilter(
    supabase
      .schema('homolog')
      .from('pois')
      .update({ processing_status: 'pending' })
  ).select('uuid_id')

  if (updErr) {
    console.error('❌ Update failed:', updErr)
    process.exit(1)
  }

  console.log(`✅ Reset ${updated?.length ?? 0} POIs back to 'pending'.`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})

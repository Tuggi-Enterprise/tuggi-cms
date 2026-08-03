/**
 * regenerate-stale-route-translations.ts
 *
 * Regenera texto + áudio das traduções de rota que ficaram obsoletas após a
 * humanização dos textos-fonte. Chama a Edge Function generate-translated-audio
 * (route mode, service role) para cada par (rota ativa, idioma) que já existe.
 * Sequencial com backoff em caso de rate limit / erro.
 *
 * Uso:  npx tsx --env-file=.env scripts/regenerate-stale-route-translations.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!, KEY = process.env.SUPABASE_SECRET_KEY!
const db = createClient(URL, KEY, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function callEF(routeId: string, language: string, gender: string): Promise<{ ok: boolean; err?: string; rate?: boolean }> {
  try {
    const res = await fetch(`${URL}/functions/v1/generate-translated-audio`, {
      method: 'POST', headers: { Authorization: `Bearer ${KEY}`, apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ routeId, targetLanguage: language, voiceGender: gender, generateAudio: true }),
    })
    if (res.ok) return { ok: true }
    const t = await res.text()
    const rate = res.status === 429 || /rate|quota|limit|resource_exhausted/i.test(t)
    return { ok: false, err: `${res.status} ${t.slice(0, 120)}`, rate }
  } catch (e: any) { return { ok: false, err: e.message } }
}

async function main() {
  const { data: routes } = await db.from('custom_routes').select('id,name').eq('is_active', true)
  const ids = (routes || []).map(r => r.id), nm = new Map((routes || []).map(r => [r.id, r.name]))
  const { data: trs } = await db.from('custom_route_descriptions').select('route_id,language,gender').in('route_id', ids)
  const jobs = (trs || []).filter(t => ids.includes(t.route_id))
  console.log(`\n=== Regenerar traduções ${DRY ? '(DRY)' : '(EXECUTANDO)'} — ${jobs.length} pares (rota,idioma) ===\n`)

  let ok = 0, fail = 0
  const failed: string[] = []
  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i]
    const tag = `[${i + 1}/${jobs.length}] ${nm.get(j.route_id)} · ${j.language}`
    if (DRY) { console.log(`  ~ ${tag}`); continue }
    let r = await callEF(j.route_id, j.language, j.gender || 'male')
    if (!r.ok && r.rate) { console.log(`  ⏳ rate limit — aguardando 90s… (${tag})`); await sleep(90000); r = await callEF(j.route_id, j.language, j.gender || 'male') }
    if (r.ok) { console.log(`  ✓ ${tag}`); ok++ }
    else { console.log(`  ✗ ${tag} — ${r.err}`); fail++; failed.push(`${nm.get(j.route_id)}·${j.language}: ${r.err}`) }
    await sleep(1500)
  }
  console.log(`\n=== ok: ${ok} | falhas: ${fail} ===`)
  if (failed.length) { console.log('\nFalhas (reexecutar depois):'); failed.forEach(f => console.log('  · ' + f)) }
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })

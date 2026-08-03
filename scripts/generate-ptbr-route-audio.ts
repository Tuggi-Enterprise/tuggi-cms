/**
 * generate-ptbr-route-audio.ts
 *
 * Deixa cada rota ativa pronta em pt-br: gera o ÁUDIO pt-br (narração) via Edge
 * Function e sobrescreve o TEXTO pt-br com a fonte limpa exata (a EF parafraseia,
 * então o texto exibido fica = custom_routes, sem vício). NÃO toca em outros idiomas.
 *
 * - Rota sem linha pt-br OU sem áudio → chama a EF (generateAudio:true) para criar/gerar áudio.
 * - Todas → texto pt-br sobrescrito com a fonte (manually_edited=true); audio_url preservado.
 *
 * Uso:  npx tsx --env-file=.env scripts/generate-ptbr-route-audio.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!, KEY = process.env.SUPABASE_SECRET_KEY!
const db = createClient(URL, KEY, { auth: { persistSession: false }, db: { schema: 'core' } })
const DRY = process.argv.includes('--dry')
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function efPtBr(routeId: string): Promise<{ ok: boolean; err?: string; rate?: boolean }> {
  try {
    const res = await fetch(`${URL}/functions/v1/generate-translated-audio`, {
      method: 'POST', headers: { Authorization: `Bearer ${KEY}`, apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ routeId, targetLanguage: 'pt-br', voiceGender: 'male', generateAudio: true }),
    })
    if (res.ok) return { ok: true }
    const t = await res.text()
    return { ok: false, err: `${res.status} ${t.slice(0, 100)}`, rate: res.status === 429 || /rate|quota|resource_exhausted/i.test(t) }
  } catch (e: any) { return { ok: false, err: e.message } }
}

async function main() {
  const { data: routes } = await db.from('custom_routes').select('id,name,description').eq('is_active', true)
  const list = routes || []
  const { data: pt } = await db.from('custom_route_descriptions').select('route_id,audio_url').eq('language', 'pt-br')
  const ptMap = new Map((pt || []).map(r => [r.route_id, r.audio_url]))
  console.log(`\n=== Áudio pt-br das rotas ${DRY ? '(DRY)' : '(EXECUTANDO)'} — ${list.length} rotas ===\n`)

  let gen = 0, kept = 0, fail = 0
  const failed: string[] = []
  for (let i = 0; i < list.length; i++) {
    const r = list[i]
    const hasRow = ptMap.has(r.id), hasAudio = !!ptMap.get(r.id)
    const tag = `[${i + 1}/${list.length}] ${r.name}`
    if (hasAudio) {
      console.log(`  = ${tag} (já tem áudio)`); kept++
    } else {
      if (DRY) { console.log(`  + ${tag} (geraria áudio)`); gen++ }
      else {
        let res = await efPtBr(r.id)
        if (!res.ok && res.rate) { console.log(`  ⏳ rate limit — 90s… (${tag})`); await sleep(90000); res = await efPtBr(r.id) }
        if (res.ok) { console.log(`  ✓ áudio: ${tag}`); gen++ } else { console.log(`  ✗ ${tag} — ${res.err}`); fail++; failed.push(`${r.name}: ${res.err}`); await sleep(1500); continue }
        await sleep(1500)
      }
    }
    // sobrescreve o texto pt-br com a fonte limpa (preserva audio_url)
    if (!DRY) {
      const { error } = await db.from('custom_route_descriptions').update({
        name: r.name, description: r.description, manually_edited: true, manually_edited_at: new Date().toISOString(), status: 'ready',
      }).eq('route_id', r.id).eq('language', 'pt-br')
      if (error) console.log(`      ⚠ overwrite texto falhou (${r.name}): ${error.message}`)
    }
  }
  console.log(`\n=== áudio gerado: ${gen} | já tinham: ${kept} | falhas: ${fail} ===`)
  if (failed.length) { console.log('\nFalhas:'); failed.forEach(f => console.log('  · ' + f)) }
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })

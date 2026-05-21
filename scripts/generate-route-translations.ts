/**
 * generate-route-translations.ts
 *
 * Gera traduções para as rotas criadas nesta sessão.
 * Chama a Edge Function generate-translated-audio em route mode
 * para cada rota + idioma em sequência (evita rate limit da EF).
 *
 * Uso:
 *   npx tsx scripts/generate-route-translations.ts
 *   npx tsx scripts/generate-route-translations.ts --lang en-us      (só um idioma)
 *   npx tsx scripts/generate-route-translations.ts --no-audio        (só texto, sem TTS)
 */

import * as fs from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'

// ─── Bootstrap ────────────────────────────────────────────────────────────────

const envPath = path.join(__dirname, '../.env')
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const t = line.trim()
    if (t && !t.startsWith('#')) {
      const i = t.indexOf('='); if (i !== -1) process.env[t.slice(0,i).trim()] = t.slice(i+1).trim()
    }
  })
}

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || ''
const ADMIN_EMAIL   = process.env.ADMIN_EMAIL   || 'suporte@tuggi.app'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''
// EF URL
const EF_BASE_URL = `${SUPABASE_URL.replace('https://', 'https://')}/functions/v1`

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SECRET_KEY são obrigatórios')
  process.exit(1)
}

// Cliente de dados (service role, para queries no banco)
const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  db: { schema: 'core' }, auth: { autoRefreshToken: false, persistSession: false },
})

// Cliente de autenticação (para obter JWT válido para a EF)
const authClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ─── Args ─────────────────────────────────────────────────────────────────────

const langFilter = process.argv.includes('--lang')
  ? process.argv[process.argv.indexOf('--lang') + 1]
  : null
const generateAudio = !process.argv.includes('--no-audio')

// ─── Rotas alvo ───────────────────────────────────────────────────────────────

const ROUTE_NAMES = [
  'Descubra Lisboa Histórica',
  'Grand Tour de Lisboa — De Oriente a Belém',
  'Elétrico 28 — Pelos Morros de Lisboa',
  'Sintra — Palácios, Castelos e Mistério',
  'Outro Lado do Tejo — Cristo Rei e Almada',
]

// ─── Idiomas a gerar ──────────────────────────────────────────────────────────

const ALL_LANGUAGES = ['en-us', 'fr-fr', 'de-de', 'es-es']
const LANGUAGES = langFilter ? [langFilter] : ALL_LANGUAGES

// ─── Helpers ─────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

let cachedJWT: string | null = null

async function getJWT(): Promise<string> {
  if (cachedJWT) return cachedJWT

  // Tenta o service role key primeiro (se for JWT legado)
  if (SERVICE_KEY.startsWith('eyJ')) {
    cachedJWT = SERVICE_KEY
    return cachedJWT
  }

  // Caso contrário, autentica como admin para obter JWT válido
  if (!ADMIN_PASSWORD) {
    console.error('\n⚠️  Os novos keys Supabase (sb_ format) não são JWTs.')
    console.error('   Para chamar Edge Functions, adicione ao .env:')
    console.error('   ADMIN_PASSWORD=<sua-senha-admin>')
    console.error('   ADMIN_EMAIL=suporte@tuggi.app\n')
    throw new Error('ADMIN_PASSWORD não definido no .env')
  }

  const { data, error } = await authClient.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  })
  if (error || !data.session) throw new Error(`Login falhou: ${error?.message}`)
  cachedJWT = data.session.access_token
  console.log(`   ✅ Autenticado como ${ADMIN_EMAIL}\n`)
  return cachedJWT
}

async function callEF(routeId: string, language: string, gender = 'male') {
  const jwt = await getJWT()
  const res = await fetch(`${EF_BASE_URL}/generate-translated-audio`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ routeId, targetLanguage: language, voiceGender: gender, generateAudio }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`EF ${res.status}: ${err.slice(0, 200)}`)
  }
  return res.json()
}

function statusIcon(ok: boolean) { return ok ? '✅' : '❌' }

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const LINE = '═'.repeat(62)
  console.log(`\n${LINE}`)
  console.log(`  Gerar Traduções de Rotas`)
  console.log(`  Idiomas: ${LANGUAGES.join(', ')}`)
  console.log(`  Áudio TTS: ${generateAudio ? 'SIM' : 'NÃO (--no-audio)'}`)
  console.log(`${LINE}\n`)

  // 1. Buscar IDs das rotas
  const { data: routes, error } = await db
    .from('custom_routes')
    .select('id, name')
    .in('name', ROUTE_NAMES)
    .eq('is_active', true)

  if (error || !routes?.length) {
    console.error('❌ Rotas não encontradas. Rode os scripts de criação primeiro.')
    process.exit(1)
  }

  console.log(`Rotas encontradas: ${routes.length}\n`)

  let totalOk = 0
  let totalFail = 0

  // 2. Para cada rota × idioma, chamar a EF
  for (const route of routes) {
    console.log(`📍 ${route.name}`)
    console.log(`   ID: ${route.id}`)

    for (const lang of LANGUAGES) {
      try {
        process.stdout.write(`   ${lang.padEnd(8)} → `)
        const result = await callEF(route.id, lang)
        const name  = result?.data?.name?.slice(0, 45) ?? '?'
        const audio = result?.data?.audioUrl ? '🔊' : '📝'
        console.log(`${statusIcon(true)} ${audio} "${name}"`)
        totalOk++
      } catch (err) {
        console.log(`${statusIcon(false)} ${(err as Error).message}`)
        totalFail++
      }

      // Aguardar 2s entre chamadas para não atingir rate limit (10/hora)
      await sleep(2000)
    }
    console.log()
  }

  // 3. Resultado
  console.log(`${LINE}`)
  console.log(`  ✅ Sucesso: ${totalOk}  |  ❌ Falhou: ${totalFail}`)
  console.log(`  Total: ${totalOk + totalFail} traduções processadas`)
  console.log(`${LINE}\n`)

  // 4. Verificação
  console.log('Verificar no banco:')
  console.log('  SELECT r.name, crd.language, crd.status, crd.audio_url IS NOT NULL AS has_audio')
  console.log('  FROM core.custom_routes r')
  console.log('  JOIN core.custom_route_descriptions crd ON crd.route_id = r.id')
  console.log('  ORDER BY r.name, crd.language;')
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('\n❌', err.message); process.exit(1) })

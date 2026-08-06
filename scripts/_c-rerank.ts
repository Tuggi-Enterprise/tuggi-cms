/** RE-RANKING PRINCIPAL — doutrina Tuggi (dono 27/07): o critério NÃO é "turístico" nem "notável".
 * Um lugar fica visível se tem PELO MENOS UM eixo:
 *   h HISTÓRIA  — fato real e específico que o viajante não descobriria sozinho (não sabe → não inventa)
 *   p PRESENÇA  — feição que se VÊ da janela e faz perguntar "o que é aquilo?" (lagoa no centro, morro, ponte)
 * Nenhum eixo → N3 (mudo). Wikipedia/fama não provam eixo. Bairro só-residencial e comércio comum não têm
 * presença — só ficam com história real (dono: "levar informações que a pessoa dificilmente descobriria").
 * Também corrige CATEGORIA (evidência falível, nunca guardrail). Respeita curadoria manual.
 * Estrutura segue docs do Google: prefixo 100% estático (cache implícito ≥2048 tok), few-shot, delimitadores,
 * tarefa no fim, responseSchema. (Resgate dedicado do N3 é um SEGUNDO prompt, trabalho à parte.)
 *   npx tsx --env-file=.env scripts/_c-rerank.ts "United States" US [--apply] [--slice i/n]
 *   RERANK_CITY="New York"  → roda só essa cidade (piloto/validação)
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { SPECIFIC_TO_GROUP } from '../lib/shared/poi-taxonomy'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { db: { schema: 'core' } })
const KEY = process.env.GEMINI_API_KEY!, MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
const COUNTRY = process.argv[2], TAG = process.argv[3], APPLY = process.argv.includes('--apply')
let SLICE_I = 0, SLICE_N = 1
{ const k = process.argv.indexOf('--slice'); if (k >= 0 && process.argv[k + 1]?.includes('/')) { const [i, n] = process.argv[k + 1].split('/').map(Number); SLICE_I = i; SLICE_N = n } }
const OUT = '/private/tmp/claude-501/-Users-leandroramos-Documents-work-Tuggi-tuggi-cms/eab9641a-576d-40fe-983f-91204c2ec4c6/scratchpad'
let TOK_IN = 0, TOK_OUT = 0
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const MANUAL = ['manual', 'manual_premium_rescue', 'manual_rescue', 'rescue_mission']
const VALID_CAT = new Set(Object.keys(SPECIFIC_TO_GROUP))
// responseSchema (docs: "recomendamos structured output para JSON Schema mais complexo"); cat SEM enum de 90
// valores (VOCAB já está no prompt; client valida VALID_CAT) — evita inflar tokens de entrada.
const SCHEMA = { type: 'ARRAY', items: { type: 'OBJECT', properties: { n: { type: 'INTEGER' }, l: { type: 'INTEGER' }, e: { type: 'STRING', enum: ['h', 'p', 'n'] }, cat: { type: 'STRING' }, c: { type: 'STRING', enum: ['a', 'm', 'b'] }, r: { type: 'STRING' } }, required: ['n', 'l', 'e', 'c', 'r'], propertyOrdering: ['n', 'l', 'e', 'cat', 'c', 'r'] } }
let TOK_CACHED = 0, QUOTA_DEAD = false, q429streak = 0
// Disjuntor de quota: 2 chamadas seguidas esgotando em 429 → cota do dia acabou. Para de vez (o orquestrador
// espera renovar e retoma; RERANK_SINCE pula o já-feito). Evita martelar 429 por horas em país grande.
async function gen(prompt: string) { const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(KEY)}`; const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.15, responseMimeType: 'application/json', responseSchema: SCHEMA, thinkingConfig: { thinkingBudget: 0 } } }; let was429 = false; for (let a = 0; a < 5; a++) { let r: any; try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) } catch { was429 = false; await sleep(4000 * (a + 1)); continue } if (r.ok) { q429streak = 0; const j: any = await r.json(); const u = j.usageMetadata || {}; TOK_IN += u.promptTokenCount || 0; TOK_OUT += (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0); TOK_CACHED += u.cachedContentTokenCount || 0; return j.candidates?.[0]?.content?.parts?.[0]?.text || '[]' } if (r.status === 429) { was429 = true; await sleep(4000 * (a + 1)); continue } if (r.status >= 500) { was429 = false; await sleep(4000 * (a + 1)); continue } console.error(`gen HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`); return '[]' } if (was429) { q429streak++; if (q429streak >= 2) QUOTA_DEAD = true } console.error('gen: esgotou retries (quota/rede)'); return '[]' }

const VOCAB = `CATEGORIAS VÁLIDAS (escolha a que descreve o LUGAR REAL):
nature: mountain,hill,peak,volcano,ridge,valley,canyon,cliff,cave,glacier,forest,island,dune,rock_formation,viewpoint
water: lake,pond,reservoir,lagoon,river,stream,canal,waterfall,spring,water_body,beach,coast,bay,wetland,fountain
parks: park,garden,nature_reserve,national_park
culture: museum,gallery,artwork,monument,memorial,historic_site,archaeological_site,theatre,library,attraction,cemetery
religious: church,cathedral,chapel,mosque,temple,synagogue,monastery,shrine
civic: townhall,courthouse,marketplace,education,square
leisure: sports,stadium,zoo,amusement_park,playground,picnic_site,campsite
infrastructure: bridge,tower,lighthouse,airport,windmill,pier,dam,marina
lodging: hotel,mountain_hut,chalet
place: city,town,village,suburb,neighbourhood,hamlet,locality,borough,quarter`

// PREFIXO 100% ESTÁTICO (sem cidade/país) → mesmas ~1,1k tokens iniciais em toda chamada = cache implícito.
// A parte variável (cidade + lugares + ordem final) vai TODA para o fim, como os docs mandam.
const STATIC = `Você é o curador do Tuggi, um app que conta histórias a viajantes EM MOVIMENTO, passando de carro pela cidade. Sua missão NÃO é listar "pontos turísticos" nem premiar fama: é decidir sobre quais lugares vale a pena FALAR a quem passa — e silenciar o resto. O valor do Tuggi é contar o que a pessoa dificilmente descobriria sozinha.

## UM LUGAR SÓ FICA VISÍVEL SE TIVER PELO MENOS UM EIXO
- e:"h" HISTÓRIA — você CONHECE um fato real, específico e interessante deste lugar exato, que o viajante não descobriria sozinho. Se você NÃO conhece a história, NÃO INVENTE: o lugar não tem este eixo.
- e:"p" PRESENÇA — é uma feição que o viajante VÊ da janela e se pergunta "o que é aquilo?": lagoa no centro, morro, cachoeira, praia, ponte marcante, farol, mirante, prédio icônico. Explicar "o que aquilo é" já é valor, mesmo sem evento histórico.
- e:"n" NENHUM — sem história conhecida e sem presença → nível 3.
Ter Wikipedia/wikidata ou ser "notável" NÃO prova eixo nenhum. Bairro onde as pessoas apenas moram e prédio comercial comum NÃO têm presença — só ficam visíveis se tiverem história real. Um hotel é comércio, mas um hotel com passado lendário tem eixo h.

## NÍVEL
1 = ICÔNICO — define a cidade; o viajante pararia para ver. Cartão-postal.
2 = JOIA DA JANELA — passaria despercebido, mas tem história real OU presença. É o coração do Tuggi.
3 = MUDO — nenhum eixo. Bairro residencial comum, hotel/comércio sem história, rua comum, equipamento de bairro (parquinho, quadra, biblioteca, igreja de congregação local), loteamento imobiliário, estação comum, feição minúscula.
Mova nos DOIS sentidos: N3 com história boa SOBE; N1/N2 mudo DESCE.
cur é o estado ATUAL, NÃO evidência de acerto — reavalie do zero. Em especial cur:1: manter N1 exige que você saiba dizer POR QUE é cartão-postal; se não consegue, RETORNE o item com o nível certo. Deixar um hotel comum ou bairro residencial em N1 por omissão é o pior erro possível.

## CATEGORIA
A cat registrada é evidência FALÍVEL. Se descrever errado o que o lugar realmente é, corrija escolhendo do vocabulário; se está certa, omita "cat".
${VOCAB}

## ENTRADA (por item)
n=índice · nome · cat=categoria registrada · hist=marcado como histórico · wiki=tem referência externa · cur=nível atual.

## EXEMPLOS
{"n":4,"nome":"Hotel Chelsea","cat":"hotel","hist":true,"wiki":true,"cur":3} → {"n":4,"l":2,"e":"h","c":"a","r":"hotel-lenda da boemia; Dylan Thomas, Sid e Nancy"}
{"n":7,"nome":"Doubletree Suites","cat":"hotel","hist":false,"wiki":true,"cur":1} → {"n":7,"l":3,"e":"n","c":"a","r":"hotel comum, sem história para contar"}
{"n":9,"nome":"Lagoa do Centro","cat":"lagoon","hist":false,"wiki":false,"cur":3} → {"n":9,"l":2,"e":"p","c":"a","r":"lagoa visível no centro; passante quer saber o que é"}
{"n":12,"nome":"East Flatbush","cat":"neighbourhood","hist":false,"wiki":true,"cur":1} → {"n":12,"l":3,"e":"n","c":"a","r":"bairro residencial; nada a contar a quem passa"}
{"n":15,"nome":"Oak Manor","cat":"historic_site","hist":true,"wiki":false,"cur":2} → {"n":15,"l":3,"e":"n","cat":"locality","c":"m","r":"loteamento rotulado como sítio histórico"}
{"n":21,"nome":"Empire State Building","cat":"attraction","hist":true,"wiki":true,"cur":2} → {"n":21,"l":1,"e":"p","c":"a","r":"ícone que define a cidade"}

## SAÍDA
JSON array SÓ com os itens que mudam (nível OU categoria). Campos: n, l, e, cat (só se corrigir), c = confiança a|m|b, r = motivo ≤10 palavras — se e:"h", r DEVE ser o gancho da história; se e:"p", o que se vê. Na dúvida, não retorne o item.`

const PROMPT = (city: string, itemsJson: string) => `${STATIC}

## TAREFA — ${city}, ${COUNTRY}
Reavalie CADA lugar abaixo com seu conhecimento REAL de ${city} e retorne só os que mudam, no formato dos exemplos.
LUGARES:
${itemsJson}
Responda agora só com o JSON.`

async function main() {
  if (!COUNTRY || !TAG) { console.error('uso: _c-rerank.ts "<País>" <TAG> [--apply] [--slice i/n]'); process.exit(1) }
  // lista de cidades: cache em arquivo (evita 4 slices rodando a mesma agregação pesada = timeout no US)
  const cacheF = `${OUT}/cities_${TAG}.json`
  let allCities: string[]
  if (existsSync(cacheF)) { allCities = JSON.parse(readFileSync(cacheF, 'utf8')) }
  else {
    let cd: any = null
    for (let a = 0; a < 6; a++) { const r = await sb.rpc('diag_sql', { q: `select city, count(*) n from core.attractions where country='${COUNTRY.replace(/'/g, "''")}' and city is not null and city<>'' group by city having count(*)>=5 order by n desc` }); if (!r.error) { cd = r.data; break } await sleep(3000 * (a + 1)) }
    if (!cd) { console.error('erro cidades: timeout após retries'); process.exit(1) }
    allCities = (cd as any[]).map(c => c.city)
    writeFileSync(cacheF, JSON.stringify(allCities))
  }
  if (process.env.RERANK_CACHE_ONLY) { console.log(`cache ${TAG}: ${allCities.length} cidades`); return }
  const ONLY = process.env.RERANK_CITY || null   // piloto: roda uma cidade só
  const cities = (ONLY ? allCities.filter(c => c === ONLY) : allCities).filter((_, idx) => idx % SLICE_N === SLICE_I)
  console.log(`${APPLY ? 'APPLY' : 'DRY'} — RE-RANK ${COUNTRY} (${TAG}) slice ${SLICE_I}/${SLICE_N}: ${cities.length} cidades`)
  const nowIso = new Date().toISOString()
  const SINCE = process.env.RERANK_SINCE || null   // resumível: pula cidade já reranqueada desde esta data
  let cityDone = 0, citySkip = 0, up = 0, down = 0, catfix = 0; const applyIds: string[] = []; const moves: any[] = []
  for (const city of cities) {
    if (QUOTA_DEAD) { console.log('⛔ quota 2.5-flash esgotada — encerro para retomar depois (SINCE pula o já-feito)'); break }
    let rows: any[] | null = null
    for (let a = 0; a < 5; a++) { const r = await sb.from('attractions').select('id,name,primary_category,osm_category,is_historic,wikidata,wikipedia,priority_level,priority_source,source_type,priority_ai_reason,priority_ai_at').eq('country', COUNTRY).eq('city', city).limit(6000); if (!r.error) { rows = r.data; break } await sleep(700 * (a + 1)) }
    if (!rows) continue
    // resume: se a cidade já tem POI reranqueado nesta rodada (>= SINCE), pula
    if (SINCE && rows.some(r => String(r.priority_ai_reason || '').startsWith('[rerank]') && r.priority_ai_at && r.priority_ai_at >= SINCE)) { citySkip++; continue }
    const cand = rows.filter(r => r.priority_source !== 'manual' && !MANUAL.includes(r.source_type))
    if (cand.length < 5) continue
    const short = cand.map((r, i) => ({ n: i, nome: r.name, cat: r.primary_category || r.osm_category || null, hist: r.is_historic === true, wiki: !!(r.wikidata || r.wikipedia), cur: r.priority_level }))
    const verdict = new Map<number, any>()
    // 55/chamada: menos requests (cota é por request/dia) e garante ≥2048 tokens → cache implícito elegível
    for (let i = 0; i < short.length; i += 55) { const txt = await gen(PROMPT(city, JSON.stringify(short.slice(i, i + 55)))); try { for (const o of JSON.parse(txt)) verdict.set(o.n, o) } catch {} }
    for (let i = 0; i < cand.length; i++) {
      const r = cand[i], v = verdict.get(i); if (!v || (v.c !== 'a' && v.c !== 'm')) continue
      const l = v.l, cur = r.priority_level
      const lChg = [1, 2, 3].includes(l) && l !== cur
      const newCat = (v.cat && VALID_CAT.has(v.cat) && v.cat !== r.primary_category) ? v.cat : null
      if (!lChg && !newCat) continue
      const patch: any = { priority_ai_reason: `[rerank] ${v.e === 'h' ? 'hist:' : v.e === 'p' ? 'pres:' : '—'} ${v.r}`, priority_ai_conf: v.c, priority_ai_at: nowIso }
      if (lChg) { patch.priority_override = l; patch.priority_level = l; patch.priority_source = 'ai'; patch.priority_ai = l; if (l < cur) up++; else down++ }
      if (newCat) { patch.primary_category = newCat; patch.category_group = SPECIFIC_TO_GROUP[newCat]; catfix++ }
      if (moves.length < (APPLY ? 40 : 2000)) moves.push({ name: r.name, cur, l: lChg ? l : cur, e: v.e, oldCat: r.primary_category, newCat, r: v.r })
      if (APPLY) { for (let a = 0; a < 5; a++) { const { error } = await sb.from('attractions').update(patch).eq('id', r.id); if (!error) { applyIds.push(r.id); break } await sleep(700 * (a + 1)) } }
    }
    cityDone++
    if (APPLY && applyIds.length >= 200) { const b = applyIds.splice(0, applyIds.length); for (let i = 0; i < b.length; i += 100) await sb.rpc('app_poi_read_build', { p_ids: b.slice(i, i + 100) }) }
  }
  if (APPLY && applyIds.length) for (let i = 0; i < applyIds.length; i += 100) await sb.rpc('app_poi_read_build', { p_ids: applyIds.slice(i, i + 100) })
  if (!APPLY) writeFileSync(`${OUT}/rerank_${TAG}_s${SLICE_I}.json`, JSON.stringify(moves))
  console.log(`\n== ${TAG} slice ${SLICE_I}/${SLICE_N}: ${cityDone} cidades (${citySkip} puladas/já-feitas) · ⬆${up} · ⬇${down} · 🏷${catfix} categorias · moves=${up + down + catfix} ==`)
  console.log('amostra:'); moves.slice(0, 30).forEach(m => console.log(`  N${m.cur}→N${m.l} [${m.e}]${m.newCat ? ` 🏷${m.oldCat}→${m.newCat}` : ''} ${(m.name || '').slice(0, 30)} — ${m.r}`))
  console.log(`💰 tokens ${TOK_IN}+${TOK_OUT} (cache: ${TOK_CACHED}) ≈ US$ ${((TOK_IN * 0.3 + TOK_OUT * 2.5) / 1e6).toFixed(3)} | ${APPLY ? 'APPLY' : 'DRY'}${QUOTA_DEAD ? ' | ⛔ QUOTA_DEAD' : ''}`)
}
main().then(() => process.exit(QUOTA_DEAD ? 3 : 0))   // exit 3 = cota esgotada → orquestrador espera e retoma
